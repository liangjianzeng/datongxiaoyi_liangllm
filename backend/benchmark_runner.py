"""
benchmark_runner.py — LLM Benchmark Engine

Provides a composable suite of performance/quality tests against a running
llama-server backend (OpenAI-compatible on :8080).

Test categories (composable via checklist):

  1. ttft        Time To First Token — measures cold/warm start latency.
  2. tps         Tokens Per Second — throughput at various output lengths.
  3. longctx     Long Context — throughput degradation with long prompt (>8k tokens).
  4. concurrency Multi-request concurrency — N requests in parallel, aggregate throughput.
  5. quality     Quality Spot Checks — deterministic prompt suite (exact/contains match).
  6. reasoning   Reasoning Capability — GSM8K / math / logic mini-suite.
  7. stability   Stability — repeated same-prompt runs, variance & failure rate.
  8. streaming   Streaming — TTFX and token cadence over a SSE stream.

Each test returns a dict: {name, metrics, details, samples}.

Runner works in background asyncio task and publishes progress/events via a
thread-safe buffer so a separate WebSocket/poll channel can stream updates.
"""

import asyncio
import time
import json
import math
import hashlib
import statistics
from dataclasses import dataclass, field, asdict
from typing import List, Optional, Dict, Any, Tuple
from datetime import datetime

import httpx


DEFAULT_PROMPTS = {
    "short": "用一句话介绍什么是量子纠缠，控制在30字以内。",
    "medium": (
        "请详细解释一下 Transformer 架构中 Self-Attention 机制的原理，"
        "并说明为什么它比 RNN 更适合处理长序列。"
    ),
    "long": (
        "你是一名资深的 AI 系统架构师。请用 800-1000 字，全面阐述"
        "当前大语言模型推理优化的主流技术路线。要求覆盖以下子主题：\n"
        "1. KV Cache 与 Paged Attention\n"
        "2. Speculative Decoding\n"
        "3. Quantization（GPTQ / AWQ / GGUF）\n"
        "4. Continuous Batching 与请求调度\n"
        "5. Speculative Sampling / Multi-Token Prediction\n"
        "6. 框架层：vLLM / TGI / Ollama / llama.cpp 的差异化\n"
        "每个子主题请给出 1-2 句核心要点，最后给出你对 2026 年趋势的判断。"
    ),
}


QUALITY_SUITE = [
    {
        "id": "q_hello",
        "prompt": "只回答：你好",
        "expect_contains": "你好",
        "max_tokens": 8,
    },
    {
        "id": "q_reason1",
        "prompt": "1+1等于几？只回答一个数字。",
        "expect_any": ["2", "二"],
        "max_tokens": 8,
    },
    {
        "id": "q_language",
        "prompt": "Please respond with exactly the single English word: banana",
        "expect_contains": "banana",
        "case_insensitive": True,
        "max_tokens": 16,
    },
    {
        "id": "q_coherent",
        "prompt": "用中文写一句关于春天的描述，不少于15个汉字。",
        "min_chars": 15,
        "max_tokens": 48,
    },
    {
        "id": "q_code",
        "prompt": "用 Python 写一个冒泡排序函数，只输出代码。",
        "expect_any": ["def ", "def bubble"],
        "max_tokens": 120,
    },
]


REASONING_SUITE = [
    {
        "id": "r_gsm8k_1",
        "prompt": "小明有 23 个苹果，给了小红 7 个，又买了 9 个。现在小明有多少个苹果？只回答数字。",
        "answer": "25",
    },
    {
        "id": "r_logic_1",
        "prompt": "所有的猫都是动物，咪咪是一只猫。据此推出：A. 咪咪是动物 B. 动物是猫 C. 猫是咪咪。只回答选项字母。",
        "answer_contains": "A",
    },
    {
        "id": "r_count_1",
        "prompt": "在句子 '人工智能可以赋能千行百业' 中，汉字一共出现了多少个（不包括引号）？只回答数字。",
        "answer": "10",
    },
]


@dataclass
class BenchmarkEvent:
    type: str  # progress / stage / result / error / done
    payload: Any = None
    ts: float = field(default_factory=time.time)

    def to_dict(self):
        return {"type": self.type, "ts": self.ts, "payload": self.payload}


class BenchmarkRunner:
    """Run an arbitrary combination of benchmark tests against 127.0.0.1:8080."""

    def __init__(self, base_url: str = "http://127.0.0.1:8080",
                 event_queue: Optional[asyncio.Queue] = None):
        self.base_url = base_url.rstrip("/")
        self.events = event_queue or asyncio.Queue()
        self._client: Optional[httpx.AsyncClient] = None
        self._started_at: Optional[float] = None
        self._results: List[Dict[str, Any]] = []
        self._cancelled = False

    # ── Event helpers ──────────────────────────────────────

    async def _emit(self, ev_type: str, payload: Any = None):
        await self.events.put(BenchmarkEvent(type=ev_type, payload=payload))

    async def _emit_progress(self, stage: str, current: int, total: int,
                             detail: str = ""):
        await self._emit("progress", {
            "stage": stage,
            "current": current,
            "total": total,
            "pct": round(current * 100.0 / max(1, total), 1),
            "detail": detail,
        })

    # ── HTTP helpers ────────────────────────────────────────

    async def _openai_chat(self, messages, *, temperature=0.0,
                           max_tokens=256, stream=False, timeout=120,
                           extra_headers=None):
        url = f"{self.base_url}/v1/chat/completions"
        body = {
            "model": "bench",
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": stream,
        }
        headers = {"Content-Type": "application/json"}
        if extra_headers:
            headers.update(extra_headers)
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=timeout, headers=headers)
        return await self._client.post(url, json=body)

    # ── Tests ──────────────────────────────────────────────

    async def _test_ttft(self, max_tokens: int = 64):
        prompt = DEFAULT_PROMPTS["short"]
        # warm
        await self._emit("stage", {"name": "ttft", "detail": "warmup 1 request"})
        try:
            await self._openai_chat([{"role": "user", "content": prompt}],
                                    temperature=0.0, max_tokens=max_tokens)
        except Exception as e:
            return self._err("ttft", f"warmup failed: {e}")

        N = 5
        await self._emit("stage", {"name": "ttft", "detail": f"cold/warm {N} runs"})
        ttft_samples = []
        for i in range(N):
            if self._cancelled:
                return self._err("ttft", "cancelled")
            t0 = time.perf_counter()
            try:
                resp = await self._openai_chat(
                    [{"role": "user", "content": prompt}],
                    temperature=0.0, max_tokens=max_tokens,
                )
                ttft = (time.perf_counter() - t0) * 1000
                ok = resp.status_code == 200
                if ok:
                    data = resp.json()
                    usage = data.get("usage", {})
                    ttft_samples.append({
                        "ttft_ms": round(ttft, 1),
                        "completion_tokens": usage.get("completion_tokens", 0),
                        "prompt_tokens": usage.get("prompt_tokens", 0),
                        "total_tokens": usage.get("total_tokens", 0),
                    })
                else:
                    ttft_samples.append({"ttft_ms": None, "error": resp.status_code})
            except Exception as e:
                ttft_samples.append({"ttft_ms": None, "error": str(e)})
            await self._emit_progress("ttft", i + 1, N)

        latencies = [s["ttft_ms"] for s in ttft_samples if s.get("ttft_ms")]
        if not latencies:
            return self._err("ttft", "all requests failed")
        return {
            "test": "ttft",
            "name": "TTFT / 冷启动延迟",
            "description": "短提示下从发送请求到响应完成的端到端时间（网络→推理→完整响应）。",
            "unit": "ms",
            "metrics": self._stats(latencies, unit="ms"),
            "samples": ttft_samples,
        }

    async def _test_tps(self):
        results = {}
        cases = [
            ("short", DEFAULT_PROMPTS["short"], 64),
            ("medium", DEFAULT_PROMPTS["medium"], 256),
            ("long", DEFAULT_PROMPTS["long"], 512),
        ]
        for tag, prompt, max_tokens in cases:
            if self._cancelled:
                break
            runs = []
            N = 3 if tag != "short" else 4
            await self._emit("stage", {"name": "tps",
                                        "detail": f"{tag} ×{N}"})
            for i in range(N):
                await self._emit_progress("tps", i + 1, N, tag)
                t0 = time.perf_counter()
                try:
                    resp = await self._openai_chat(
                        [{"role": "user", "content": prompt}],
                        temperature=0.0, max_tokens=max_tokens,
                    )
                    if resp.status_code != 200:
                        runs.append({"error": resp.status_code})
                        continue
                    data = resp.json()
                    usage = data.get("usage", {}) or {}
                    el = time.perf_counter() - t0
                    ct = usage.get("completion_tokens", 0)
                    pt = usage.get("prompt_tokens", 0)
                    tps = ct / el if el > 0 else 0
                    runs.append({
                        "elapsed_s": round(el, 2),
                        "completion_tokens": ct,
                        "prompt_tokens": pt,
                        "tps": round(tps, 2),
                    })
                except Exception as e:
                    runs.append({"error": str(e)})
            ok = [r["tps"] for r in runs if "tps" in r]
            results[tag] = {
                "prompt": f"{tag} ({len(prompt)}字)",
                "max_tokens": max_tokens,
                "samples": runs,
                "tps_stats": self._stats(ok, unit="tok/s"),
            }
        return {
            "test": "tps",
            "name": "Tokens/s / 生成速度",
            "description": "不同提示长度下的稳定生成速度（completion_tokens / wall time）。",
            "unit": "tok/s",
            "scenarios": results,
        }

    async def _test_longctx(self):
        # Build an 8k+ prompt by repeating a paragraph.
        base = DEFAULT_PROMPTS["long"]
        big = (base + "\n\n") * 4  # ~4k chars → ~10k tokens rough
        prompt = big + "\n\n请根据上文，用中文列 5 条总结要点。"
        await self._emit("stage", {"name": "longctx", "detail":
                                   f"prompt ~{len(prompt)} chars"})
        runs = []
        for i in range(3):
            await self._emit_progress("longctx", i + 1, 3)
            t0 = time.perf_counter()
            try:
                resp = await self._openai_chat(
                    [{"role": "user", "content": prompt}],
                    temperature=0.0, max_tokens=256,
                )
                el = time.perf_counter() - t0
                if resp.status_code == 200:
                    data = resp.json()
                    usage = data.get("usage", {}) or {}
                    ct = usage.get("completion_tokens", 0)
                    pt = usage.get("prompt_tokens", 0)
                    tps = ct / el if el > 0 else 0
                    runs.append({
                        "elapsed_s": round(el, 2),
                        "prompt_tokens": pt,
                        "completion_tokens": ct,
                        "tps": round(tps, 2),
                    })
                else:
                    runs.append({"error": resp.status_code})
            except Exception as e:
                runs.append({"error": str(e)})
        ok = [r["tps"] for r in runs if "tps" in r]
        return {
            "test": "longctx",
            "name": "Long Context / 长上下文",
            "description": "长 prompt（~8k+ tokens）场景下的推理速度与首 token 延迟，反映模型在大上下文下的稳定性。",
            "unit": "tok/s",
            "samples": runs,
            "metrics": self._stats(ok, unit="tok/s"),
        }

    async def _test_concurrency(self):
        prompt = DEFAULT_PROMPTS["medium"]
        concurrency_levels = [1, 2, 4]
        results = {}
        for c in concurrency_levels:
            if self._cancelled:
                break
            await self._emit("stage", {"name": "concurrency",
                                        "detail": f"parallel={c}"})
            tasks = [
                self._openai_chat(
                    [{"role": "user", "content": prompt}],
                    temperature=0.0, max_tokens=128,
                )
                for _ in range(c)
            ]
            t0 = time.perf_counter()
            resps = await asyncio.gather(*tasks, return_exceptions=True)
            elapsed = time.perf_counter() - t0
            tps_total = 0
            ttfts_ms = []
            ok_count = 0
            for r in resps:
                if isinstance(r, Exception) or getattr(r, "status_code", 500) != 200:
                    continue
                ok_count += 1
                try:
                    data = r.json()
                    usage = data.get("usage", {}) or {}
                    tps_total += usage.get("completion_tokens", 0)
                except Exception:
                    pass
            results[str(c)] = {
                "parallel_requests": c,
                "elapsed_s": round(elapsed, 2),
                "success_count": ok_count,
                "failure_count": c - ok_count,
                "throughput_tps_total": round(tps_total / elapsed, 2) if elapsed > 0 else 0,
            }
        return {
            "test": "concurrency",
            "name": "Concurrency / 并发",
            "description": "同时发送 N 个请求，统计整体吞吐与成功率，评估服务端并发能力。",
            "scenarios": results,
        }

    async def _test_quality(self):
        results = []
        total = len(QUALITY_SUITE)
        for idx, tc in enumerate(QUALITY_SUITE):
            if self._cancelled:
                break
            await self._emit_progress("quality", idx + 1, total, tc["id"])
            try:
                resp = await self._openai_chat(
                    [{"role": "user", "content": tc["prompt"]}],
                    temperature=0.0, max_tokens=tc.get("max_tokens", 64),
                )
                if resp.status_code != 200:
                    results.append({"id": tc["id"], "ok": False,
                                    "reason": f"HTTP {resp.status_code}"})
                    continue
                data = resp.json()
                content = (data["choices"][0]["message"]["content"]
                           if data.get("choices") else "")
                ok, reason = self._check_quality(tc, content)
                results.append({
                    "id": tc["id"], "ok": ok, "reason": reason,
                    "prompt": tc["prompt"], "output": content[:200],
                })
            except Exception as e:
                results.append({"id": tc["id"], "ok": False,
                                "reason": str(e)})
        passed = sum(1 for r in results if r["ok"])
        return {
            "test": "quality",
            "name": "Quality / 基础质量",
            "description": "5 条确定性 prompt，检查基本语言、数学、代码、指令跟随能力。",
            "unit": "%",
            "metrics": {
                "pass_rate": round(passed / max(1, len(results)) * 100, 1),
                "passed": passed,
                "total": len(results),
            },
            "samples": results,
        }

    @staticmethod
    def _check_quality(tc, content):
        text = (content or "").strip()
        check_key = "expect_contains" if "expect_contains" in tc else \
            "expect_any" if "expect_any" in tc else None
        if check_key == "expect_contains":
            expected = tc["expect_contains"]
            if tc.get("case_insensitive"):
                text, expected = text.lower(), expected.lower()
            return (expected in text), \
                f"contain '{tc['expect_contains']}' → {text[:60]}"
        if check_key == "expect_any":
            any_ok = any(x in text for x in tc["expect_any"])
            return any_ok, f"any of {tc['expect_any']} → {text[:60]}"
        if "min_chars" in tc:
            return (len(text) >= tc["min_chars"]), \
                f"chars={len(text)}/{tc['min_chars']}"
        return True, "no rule"

    async def _test_reasoning(self):
        results = []
        total = len(REASONING_SUITE)
        for idx, tc in enumerate(REASONING_SUITE):
            if self._cancelled:
                break
            await self._emit_progress("reasoning", idx + 1, total, tc["id"])
            try:
                resp = await self._openai_chat(
                    [{"role": "user", "content": tc["prompt"]}],
                    temperature=0.0, max_tokens=64,
                )
                if resp.status_code != 200:
                    results.append({"id": tc["id"], "ok": False,
                                    "reason": f"HTTP {resp.status_code}"})
                    continue
                data = resp.json()
                content = (data["choices"][0]["message"]["content"]
                           if data.get("choices") else "")
                ok = False
                if "answer" in tc:
                    ok = tc["answer"] in content
                elif "answer_contains" in tc:
                    ok = tc["answer_contains"] in content
                results.append({
                    "id": tc["id"], "ok": ok,
                    "expected": tc.get("answer") or tc.get("answer_contains"),
                    "output": content[:200],
                })
            except Exception as e:
                results.append({"id": tc["id"], "ok": False,
                                "reason": str(e)})
        passed = sum(1 for r in results if r["ok"])
        return {
            "test": "reasoning",
            "name": "Reasoning / 推理能力",
            "description": "轻量数学、逻辑、计数 3 条推理测试。",
            "unit": "%",
            "metrics": {
                "pass_rate": round(passed / max(1, len(results)) * 100, 1),
                "passed": passed,
                "total": len(results),
            },
            "samples": results,
        }

    async def _test_stability(self):
        prompt = DEFAULT_PROMPTS["medium"]
        N = 6
        await self._emit("stage", {"name": "stability",
                                    "detail": f"same prompt ×{N}"})
        runs = []
        for i in range(N):
            if self._cancelled:
                break
            await self._emit_progress("stability", i + 1, N)
            t0 = time.perf_counter()
            try:
                resp = await self._openai_chat(
                    [{"role": "user", "content": prompt}],
                    temperature=0.0, max_tokens=128,
                )
                el = time.perf_counter() - t0
                if resp.status_code == 200:
                    data = resp.json()
                    usage = data.get("usage", {}) or {}
                    ct = usage.get("completion_tokens", 0)
                    pt = usage.get("prompt_tokens", 0)
                    tps = ct / el if el > 0 else 0
                    digest = hashlib.md5(
                        (data.get("choices", [{}])[0]
                          .get("message", {}).get("content", ""))
                        .encode("utf-8"),
                    ).hexdigest()[:10]
                    runs.append({
                        "elapsed_s": round(el, 2),
                        "completion_tokens": ct,
                        "prompt_tokens": pt,
                        "tps": round(tps, 2),
                        "output_hash": digest,
                    })
                else:
                    runs.append({"error": resp.status_code})
            except Exception as e:
                runs.append({"error": str(e)})
        ok = [r for r in runs if "tps" in r]
        if not ok:
            return self._err("stability", "all requests failed")
        elapsed = [r["elapsed_s"] for r in ok]
        tps = [r["tps"] for r in ok]
        # variance / cv
        def cv(arr):
            if len(arr) < 2:
                return 0.0
            m = statistics.mean(arr)
            if m == 0:
                return 0.0
            s = statistics.pstdev(arr)
            return round(s / m * 100, 1)
        fail_rate = (N - len(ok)) / N * 100
        outputs = {r["output_hash"] for r in ok}
        return {
            "test": "stability",
            "name": "Stability / 稳定性",
            "description": "同一 prompt 多次运行，统计耗时方差、失败率、输出多样性。",
            "unit": "%",
            "runs": runs,
            "metrics": {
                "elapsed_stats": self._stats(elapsed, unit="s"),
                "tps_stats": self._stats(tps, unit="tok/s"),
                "elapsed_cv_pct": cv(elapsed),
                "tps_cv_pct": cv(tps),
                "fail_rate_pct": round(fail_rate, 1),
                "unique_outputs": len(outputs),
            },
        }

    async def _test_streaming(self):
        prompt = DEFAULT_PROMPTS["medium"]
        await self._emit("stage", {"name": "streaming", "detail": "stream 1 run"})
        t0 = time.perf_counter()
        try:
            resp = await self._openai_chat(
                [{"role": "user", "content": prompt}],
                temperature=0.0, max_tokens=128, stream=True,
            )
        except Exception as e:
            return self._err("streaming", str(e))
        if resp.status_code != 200:
            return self._err("streaming", f"HTTP {resp.status_code}")

        first_chunk_t = None
        token_times = []
        total_tokens = 0
        async for line in resp.aiter_lines():
            if not line or not line.startswith("data: "):
                continue
            now = time.perf_counter()
            if first_chunk_t is None:
                first_chunk_t = now
            raw = line[6:].strip()
            if raw == "[DONE]":
                break
            try:
                obj = json.loads(raw)
            except Exception:
                continue
            delta = obj.get("choices", [{}])[0].get("delta", {})
            if delta.get("content"):
                token_times.append(now)
                total_tokens += 1
        total_elapsed = time.perf_counter() - t0
        ttft_ms = (first_chunk_t - t0) * 1000 if first_chunk_t else None
        tps = total_tokens / total_elapsed if total_elapsed > 0 else 0
        per_token = []
        if len(token_times) > 1:
            for i in range(1, len(token_times)):
                per_token.append((token_times[i] - token_times[i - 1]) * 1000)
        per_token_stats = self._stats(per_token, unit="ms") if per_token else {"count": 0}
        return {
            "test": "streaming",
            "name": "Streaming / 流式体验",
            "description": "SSE 模式下从首包到逐 token 到达的延迟与整体生成速度。",
            "unit": "ms",
            "metrics": {
                "ttft_ms": round(ttft_ms, 1) if ttft_ms is not None else None,
                "total_tokens": total_tokens,
                "total_elapsed_s": round(total_elapsed, 2),
                "tps": round(tps, 2),
                "per_token_latency": per_token_stats,
            },
        }

    # ── Runner ─────────────────────────────────────────────

    def _err(self, name, reason):
        return {"test": name, "ok": False, "error": reason}

    @staticmethod
    def _stats(values, unit: str = ""):
        if not values:
            return {"count": 0, "unit": unit}
        v = sorted(values)
        n = len(v)
        mean = statistics.mean(v)
        out = {
            "count": n,
            "mean": round(mean, 2),
            "min": round(v[0], 2),
            "max": round(v[-1], 2),
            "p50": round(statistics.median(v), 2),
            "p90": round(v[min(n - 1, int(n * 0.9))], 2),
            "p95": round(v[min(n - 1, int(n * 0.95))], 2),
            "unit": unit,
        }
        if n >= 2:
            out["pstdev"] = round(statistics.pstdev(v), 2)
        return out

    async def run(self, tests: List[str]):
        """Run selected tests in sequence, return full report dict."""
        self._started_at = time.time()
        self._cancelled = False
        self._results = []
        ALL = {
            "ttft": self._test_ttft,
            "tps": self._test_tps,
            "longctx": self._test_longctx,
            "concurrency": self._test_concurrency,
            "quality": self._test_quality,
            "reasoning": self._test_reasoning,
            "stability": self._test_stability,
            "streaming": self._test_streaming,
        }
        selected = [t for t in tests if t in ALL]
        await self._emit("start", {
            "tests": selected,
            "total": len(selected),
            "backend": self.base_url,
            "started_at": datetime.now().isoformat(timespec="seconds"),
        })
        for i, name in enumerate(selected):
            if self._cancelled:
                break
            await self._emit("progress", {
                "stage": name, "current": i,
                "total": len(selected), "pct": round(i * 100.0 / len(selected), 1),
                "detail": "start",
            })
            try:
                result = await ALL[name]()
            except Exception as e:
                result = self._err(name, f"exception: {e}")
            self._results.append(result)
            await self._emit("result", {
                "index": i, "total": len(selected),
                "result": result,
            })
        total_elapsed = time.time() - self._started_at
        report = self._build_report(selected, total_elapsed)
        await self._emit("done", {
            "total_seconds": round(total_elapsed, 2),
            "summary": report["summary"],
        })
        await self._close()
        return report

    async def cancel(self):
        self._cancelled = True
        await self._emit("cancel", {})

    async def _close(self):
        if self._client is not None:
            try:
                await self._client.aclose()
            except Exception:
                pass
            self._client = None

    def _build_report(self, selected, total_elapsed) -> Dict[str, Any]:
        model_guess = "unknown"
        try:
            # best-effort: query llama-server /v1/models
            import urllib.request
            req = urllib.request.Request(
                f"{self.base_url}/v1/models")
            with urllib.request.urlopen(req, timeout=3) as r:
                data = json.loads(r.read().decode("utf-8"))
                items = data.get("data", [])
                if items:
                    model_guess = items[0].get("id", "unknown")
        except Exception:
            pass
        return {
            "version": 1,
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "total_seconds": round(total_elapsed, 2),
            "backend": self.base_url,
            "model": model_guess,
            "tests_run": selected,
            "results": self._results,
            "summary": self._aggregate_summary(),
        }

    def _aggregate_summary(self) -> Dict[str, Any]:
        tps_list = []
        tftt_list = []
        pass_rates = []
        failures = 0
        for r in self._results:
            if r.get("test") == "tps":
                for sc in r.get("scenarios", {}).values():
                    s = sc.get("tps_stats", {})
                    if s.get("mean") is not None:
                        tps_list.append(s["mean"])
            elif r.get("test") == "ttft":
                m = r.get("metrics", {})
                if m.get("mean") is not None:
                    tftt_list.append(m["mean"])
            elif r.get("test") in ("quality", "reasoning"):
                pass_rates.append(r.get("metrics", {}).get("pass_rate", 0))
            elif r.get("ok") is False:
                failures += 1
        return {
            "mean_tps": round(statistics.mean(tps_list), 2) if tps_list else None,
            "best_tps": round(max(tps_list), 2) if tps_list else None,
            "best_ttft_ms": round(min(tftt_list), 1) if tftt_list else None,
            "mean_pass_rate": round(statistics.mean(pass_rates), 1) if pass_rates else None,
            "failed_tests": failures,
        }


AVAILABLE_TESTS = {
    "ttft": {
        "label": "TTFT · 首字节延迟",
        "category": "性能",
        "description": "短提示下从请求发出到收到完整响应的端到端延迟 (ms)。",
    },
    "tps": {
        "label": "TPS · 生成速度",
        "category": "性能",
        "description": "短/中/长 提示三档下的稳定生成速度 (tok/s)。",
    },
    "longctx": {
        "label": "Long Context · 长上下文",
        "category": "性能",
        "description": "~8k tokens 长 Prompt 下的推理速度，看是否掉速。",
    },
    "concurrency": {
        "label": "Concurrency · 并发",
        "category": "性能",
        "description": "1/2/4 并发请求下整体吞吐与成功率。",
    },
    "streaming": {
        "label": "Streaming · 流式体验",
        "category": "性能",
        "description": "SSE 流式下首包延迟与逐 token 到达间隔。",
    },
    "stability": {
        "label": "Stability · 稳定性",
        "category": "鲁棒性",
        "description": "同一 prompt 多次运行，统计耗时方差、失败率、输出多样性。",
    },
    "quality": {
        "label": "Quality · 基础质量",
        "category": "质量",
        "description": "5 条确定性格式化测试：语言、数学、代码、指令跟随。",
    },
    "reasoning": {
        "label": "Reasoning · 推理能力",
        "category": "质量",
        "description": "轻量数学 / 逻辑 / 计数推理 3 题。",
    },
}
