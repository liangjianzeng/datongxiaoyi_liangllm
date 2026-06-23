"""
server.py — LiangLLM Backend API Server

FastAPI server providing the REST API for the LiangLLM desktop UI.
Manages model lifecycle, configuration, chat, and metrics.

Architecture:
  UI (Electron/Vue) → HTTP/SSE → FastAPI → ProcessManager → llama-server.exe
                                  ├─ ModelManager     (model discovery)
                                  ├─ ConfigManager    (presets/profiles)
                                  ├─ ChatEngine       (chat proxy)
                                  └─ MetricsCollector (performance stats)
"""

import os
import sys
import json
import time
import asyncio
import platform
from contextlib import asynccontextmanager
from typing import Optional, List
from pathlib import Path
from datetime import datetime

from fastapi import FastAPI, HTTPException, Query, Body, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
import uvicorn

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from model_manager import ModelManager
from process_manager import ProcessManager, LLAMA_PORT
from config_manager import ConfigManager
from chat_engine import ChatEngine
from metrics_collector import MetricsCollector, InferenceRecord
from backend_selector import detect_backend, list_all_available_backends
from benchmark_runner import BenchmarkRunner, AVAILABLE_TESTS
from logger_manager import LoggerManager, init_logger_manager, get_logger_manager


def _resolve_llm_project(app_root: str) -> str:
    """Find the directory holding llama-cpp-* backend folders.

    Search order (first hit wins):
      1. <app_root>/backends/   (all backends collected in one place)
      2. <app_root>/..          (classic sibling layout: LiangLLM/llama-cpp-*)
      3. <app_root>             (self-contained clone: LiangLLM-App/llama-cpp-*)
    """
    backends_dir = os.path.join(app_root, "backends")
    if os.path.isdir(backends_dir):
        candidates = ["llama-cpp-cuda", "llama-cpp-vulkan", "llama-cpp-sycl"]
        for c in candidates:
            if os.path.isfile(os.path.join(backends_dir, c, "llama-server.exe")):
                return backends_dir

    sibling = os.path.abspath(os.path.join(app_root, ".."))
    for sub in ("llama-cpp-cuda", "llama-cpp-vulkan", "llama-cpp-sycl"):
        if os.path.isfile(os.path.join(sibling, sub, "llama-server.exe")):
            return sibling

    for sub in ("llama-cpp-cuda", "llama-cpp-vulkan", "llama-cpp-sycl"):
        if os.path.isfile(os.path.join(app_root, sub, "llama-server.exe")):
            return app_root

    return sibling


def _resolve_models_dir(app_root: str, llm_project: str) -> str:
    """Pick a writable models directory.

    Search order (first writable wins):
      1. <app_root>/models/        (self-contained, shipped with clone)
      2. <llm_project>/models/    (classic sibling layout)
    Creates the chosen directory if it doesn't exist.
    """
    local = os.path.join(app_root, "models")
    if not os.path.isdir(local):
        try:
            os.makedirs(local, exist_ok=True)
            print(f"  [OK] Created local models directory: {local}")
        except Exception:
            pass

    sibling = os.path.join(llm_project, "models")
    if os.path.isdir(sibling) and os.listdir(sibling):
        return sibling

    return local


BACKEND_DIR = os.path.abspath(os.path.dirname(__file__))
APP_ROOT = os.path.abspath(os.path.join(BACKEND_DIR, ".."))

LLM_PROJECT = _resolve_llm_project(APP_ROOT)
MODELS_DIR = _resolve_models_dir(APP_ROOT, LLM_PROJECT)

LOG_DIR = os.path.join(APP_ROOT, "log")
CONFIG_DIR = os.path.join(APP_ROOT, "config")

os.makedirs(MODELS_DIR, exist_ok=True)
os.makedirs(LOG_DIR, exist_ok=True)
os.makedirs(CONFIG_DIR, exist_ok=True)


model_manager = ModelManager(MODELS_DIR)
process_manager = ProcessManager(LOG_DIR)
config_manager = ConfigManager(CONFIG_DIR)
chat_engine = ChatEngine()
metrics_collector = MetricsCollector()
logger_manager = init_logger_manager(LOG_DIR, retention_days=30)


class LoadModelRequest(BaseModel):
    family: str
    port: Optional[int] = None
    params: Optional[dict] = None

class ChatRequest(BaseModel):
    model: str = "lfm2.5"
    messages: list = []
    stream: bool = False
    max_tokens: int = 4096
    temperature: Optional[float] = None
    top_p: Optional[float] = None
    top_k: Optional[int] = None
    repeat_penalty: Optional[float] = None

class SaveProfileRequest(BaseModel):
    name: str
    params: dict
    description: str = ""

class SaveModelConfigRequest(BaseModel):
    family: str
    params: dict


_auto_load_state: dict = {
    "family": None, "status": "idle",
    "error": None, "log_tail": None, "elapsed_seconds": None,
}


def _resolve_auto_load_family(global_config: dict) -> Optional[str]:
    behavior = global_config.get("startup_behavior", "idle")
    if behavior == "auto":
        return global_config.get("auto_load_model")
    elif behavior == "last_model":
        return global_config.get("last_loaded_model")
    return None


async def _background_auto_load(family: str):
    _auto_load_state.update({
        "family": family, "status": "loading",
        "error": None, "log_tail": None, "elapsed_seconds": None,
    })

    info = model_manager.get_model(family)
    if not info:
        print(f"  [Auto] WARNING Model '{family}' not found in {MODELS_DIR}")
        _auto_load_state.update({
            "status": "failed",
            "error": f"Model '{family}' not found in {MODELS_DIR}",
        })
        return

    backend = detect_backend(LLM_PROJECT)
    if not backend.available or not backend.server_path:
        print(f"  [Auto] WARNING No GPU backend available, skipping auto-load")
        _auto_load_state.update({
            "status": "failed",
            "error": "No GPU backend available (no llama-server.exe detected)",
        })
        return

    await asyncio.sleep(0.5)

    print(f"  [Auto] Loading '{family}' ({info.display}) ...")
    saved = config_manager.get_model_config(family)
    defaults = model_manager.get_default_params(family)
    params = dict(defaults)
    if saved and saved.get("params"):
        params.update(saved["params"])

    args = model_manager.build_server_args(family, params, backend.server_path)

    process_manager.start_server(
        server_exe=backend.server_path,
        model_path=info.path,
        family=family,
        extra_args=args[2:],
    )

    result = process_manager.wait_for_ready(timeout=120)
    if result["ok"]:
        config_manager.save_model_config(family, params)
        logger_manager.info("auto_load", f"{family} loaded in {result['elapsed_seconds']:.1f}s", model=family)
        print(f"  [Auto] OK '{family}' loaded on :8080"
              f" ({result['elapsed_seconds']:.1f}s)")
    else:
        err = result.get("error", "unknown")
        logger_manager.error("auto_load", f"{family} failed: {err}", model=family)
        _auto_load_state.update({
            "status": "failed",
            "error": err,
            "log_tail": result.get("log_tail", ""),
        })
        print(f"  [Auto] FAIL '{family}' failed: {err}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    backend = detect_backend(LLM_PROJECT)
    global_config = config_manager.get_global()
    app.state.backend = backend
    logger_manager.info("system", f"LiangLLM backend starting up, backend={backend.label} (kind={backend.kind})")
    print(f"  Backend: {backend.label} (kind={backend.kind})")
    print(f"  Server:  {backend.server_path or 'N/A'}")
    print(f"  Models:  {MODELS_DIR}  ({len(model_manager.list_models())} found)")
    print(f"  Bins:    {LLM_PROJECT}")
    print(f"  Config:  {CONFIG_DIR}")

    auto_family = _resolve_auto_load_family(global_config)
    if auto_family:
        asyncio.create_task(_background_auto_load(auto_family))

    print()
    yield
    print()
    print("  [Shutdown] Cleaning up processes...")
    logger_manager.info("system", "LiangLLM backend shutting down")
    process_manager.stop_all()


app = FastAPI(title="LiangLLM API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:19600",
        "http://localhost:19600",
        "null",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/status")
async def get_status():
    b = getattr(app.state, "backend", None)
    if b is None:
        b = detect_backend(LLM_PROJECT)
    all_backends = list_all_available_backends(LLM_PROJECT)
    instances = process_manager.list_instances()
    global_config = config_manager.get_global()
    return {
        "backend": {
            "kind": b.kind,
            "label": b.label,
            "available": b.available,
            "server_path": b.server_path,
            "gpu_devices": b.gpu_devices,
            "all_backends": [
                {"kind": bk.kind, "label": bk.label, "available": bk.available}
                for bk in all_backends
            ],
        },
        "platform": platform.platform(),
        "python": sys.version,
        "models_dir": MODELS_DIR,
        "models_count": len(model_manager.list_models()),
        "instances": instances,
        "config": global_config,
        "auto_load": dict(_auto_load_state),
    }


@app.get("/api/backends")
async def list_backends():
    backends = list_all_available_backends(LLM_PROJECT)
    return {"backends": [
        {"kind": b.kind, "label": b.label, "available": b.available,
         "gpu_devices": b.gpu_devices}
        for b in backends
    ]}


@app.get("/api/models")
async def list_models():
    models = model_manager.list_models()
    running = {inst["family"] for inst in process_manager.list_instances()
               if inst["status"] == "running"}
    for m in models:
        m["loaded"] = m["family"] in running
        saved = config_manager.get_model_config(m["family"])
        m["saved_params"] = saved["params"] if saved else None
    return {"models": models}


@app.get("/api/models/{family}/params")
async def get_model_params(family: str):
    info = model_manager.get_model(family)
    if not info:
        raise HTTPException(status_code=404, detail=f"Model '{family}' not found")
    defaults = model_manager.get_default_params(family)
    saved = config_manager.get_model_config(family)
    return {
        "family": family,
        "display": info.display,
        "default_params": defaults,
        "saved_params": saved["params"] if saved else None,
        "all_params": saved["params"] if saved else defaults,
    }


@app.post("/api/models/load")
async def load_model(req: LoadModelRequest):
    info = model_manager.get_model(req.family)
    if not info:
        logger_manager.error("models", f"Model '{req.family}' not found", model=req.family)
        raise HTTPException(status_code=404, detail=f"Model '{req.family}' not found")

    backend = detect_backend(LLM_PROJECT)
    if not backend.available or not backend.server_path:
        logger_manager.error("models", f"No GPU backend available for {req.family}", model=req.family)
        raise HTTPException(status_code=503, detail="No GPU backend available. "
            "Put llama-server.exe into one of: backends/llama-cpp-*/, "
            "../llama-cpp-*/, or ./llama-cpp-*/")

    saved = config_manager.get_model_config(req.family)
    defaults = model_manager.get_default_params(req.family)
    params = dict(defaults)
    if saved and saved.get("params"):
        params.update(saved["params"])
    if req.params:
        params.update(req.params)

    args = model_manager.build_server_args(req.family, params, backend.server_path)

    logger_manager.info("models", f"Starting {req.family} via {backend.label}",
                        model=req.family, extra={"backend": backend.label})
    process_manager.start_server(
        server_exe=backend.server_path,
        model_path=info.path,
        family=req.family,
        extra_args=args[2:],
    )

    result = process_manager.wait_for_ready(timeout=120)

    if result["ok"]:
        config_manager.save_model_config(req.family, params)
        logger_manager.info("models",
                            f"{req.family} ready on port 8080 in {result['elapsed']:.1f}s",
                            model=req.family, extra={"port": 8080, "elapsed": result['elapsed']})
        return {
            "ok": True, "family": req.family, "port": 8080,
            "elapsed_seconds": result["elapsed"],
            "backend": backend.label,
        }
    logger_manager.error("models", f"{req.family} failed to start: {result.get('error','unknown')}",
                         model=req.family, extra={"log_tail": result.get("log_tail", "")[:2000]})
    return {
        "ok": False,
        "error": result.get("error", "unknown"),
        "log_tail": result.get("log_tail", ""),
    }


@app.post("/api/models/unload")
async def unload_model(family: str = Body(..., embed=True)):
    current = process_manager.get_current()
    if not current:
        raise HTTPException(status_code=404, detail="No server running")
    if current.family != family:
        raise HTTPException(status_code=400,
                            detail=f"'{family}' is not loaded (current: {current.family})")
    logger_manager.info("models", f"Unloading {family}", model=family,
                        extra={"uptime_seconds": current.uptime_seconds})
    process_manager.stop_current()
    return {"ok": True, "family": family, "status": "unloaded"}


@app.post("/api/models/unload_all")
async def unload_all_models():
    process_manager.stop_all()
    return {"ok": True, "status": "all unloaded"}


_auto_load_lock = asyncio.Lock()


async def _ensure_model_loaded(family: str) -> Optional[int]:
    instance = process_manager.get_current()
    if instance and instance.status == "running" and instance.family == family:
        return 8080

    async with _auto_load_lock:
        instance = process_manager.get_current()
        if instance and instance.status == "running" and instance.family == family:
            return 8080

        info = model_manager.get_model(family)
        if not info:
            return None

        backend = detect_backend(LLM_PROJECT)
        if not backend.available or not backend.server_path:
            return None

        saved = config_manager.get_model_config(family)
        defaults = model_manager.get_default_params(family)
        params = dict(defaults)
        if saved and saved.get("params"):
            params.update(saved["params"])

        args = model_manager.build_server_args(family, params, backend.server_path)

        process_manager.start_server(
            server_exe=backend.server_path,
            model_path=info.path,
            family=family,
            extra_args=args[2:],
        )

        result = process_manager.wait_for_ready(timeout=120)
        if result["ok"]:
            config_manager.save_model_config(family, params)
            config_manager.save_global({
                **config_manager.get_global(),
                "last_loaded_model": family,
            })
            return LLAMA_PORT

        return None


@app.get("/v1/models")
async def openai_list_models():
    models = []
    running = {inst["family"] for inst in process_manager.list_instances()
               if inst["status"] == "running"}
    for m in model_manager.list_models():
        models.append({
            "id": m["family"],
            "object": "model",
            "created": int(time.time()),
            "owned_by": "liangllm",
            "running": m["family"] in running,
        })
    return {"object": "list", "data": models}


@app.post("/v1/chat/completions")
async def openai_chat_completions(body: dict = Body(...)):
    model_query = body.get("model", "")
    if not model_query:
        raise HTTPException(status_code=400, detail="model is required")

    family = model_manager.resolve_family(model_query)
    if not family:
        raise HTTPException(status_code=404,
                            detail=f"Model '{model_query}' not found")

    port = await _ensure_model_loaded(family)
    if not port:
        raise HTTPException(status_code=503,
                            detail=f"Failed to load model '{family}'")

    messages = body.get("messages", [])
    stream = body.get("stream", False)

    params = {"max_tokens": body.get("max_tokens", 4096)}
    for key in ("temperature", "top_p", "top_k"):
        if body.get(key) is not None:
            params[key] = body[key]
    stop = body.get("stop")
    if stop is not None:
        params["stop"] = [stop] if isinstance(stop, str) else stop

    from chat_engine import ChatEngine
    global chat_engine

    if stream:
        async def event_stream():
            async for chunk in chat_engine.chat_completion_stream(
                messages=messages, **params,
            ):
                yield chunk

        return StreamingResponse(
            event_stream(), media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "Connection": "keep-alive",
                     "X-Accel-Buffering": "no"},
        )

    return await chat_engine.chat_completion(
        messages=messages, stream=False, **params,
    )


@app.get("/api/tags")
async def ollama_list_models():
    models = []
    running = {inst["family"] for inst in process_manager.list_instances()
               if inst["status"] == "running"}
    for m in model_manager.list_models():
        models.append({
            "name": m["display"] + (":running" if m["family"] in running else ""),
            "model": m["family"],
            "size": int(m["size_gb"] * 1e9),
            "running": m["family"] in running,
            "details": {
                "format": "gguf",
                "family": m["family"],
                "quantization": m["quantization"],
                "parameter_size": f"{m['params_b']:.1f}B" if m["params_b"] else "unknown",
            },
        })
    return {"models": models}


@app.post("/api/generate")
async def ollama_generate(body: dict = Body(...)):
    model_query = body.get("model", "")
    if not model_query:
        raise HTTPException(status_code=400, detail="model is required")

    family = model_manager.resolve_family(model_query)
    if not family:
        raise HTTPException(status_code=404, detail=f"Model '{model_query}' not found")

    port = await _ensure_model_loaded(family)
    if not port:
        raise HTTPException(status_code=503, detail=f"Failed to load model '{family}'")

    prompt = body.get("prompt", "")
    stream = body.get("stream", False)
    max_tokens = body.get("max_tokens", body.get("options", {}).get("num_predict", 512))
    temperature = body.get("temperature", body.get("options", {}).get("temperature", 0.2))

    chat_body = {
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": max_tokens, "temperature": temperature,
    }

    global chat_engine
    if stream:
        async def event_stream():
            async for chunk in chat_engine.chat_completion_stream(**chat_body):
                yield chunk
        return StreamingResponse(
            event_stream(), media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "Connection": "keep-alive",
                     "X-Accel-Buffering": "no"},
        )

    return await chat_engine.chat_completion(**chat_body)


@app.get("/api/config")
async def get_global_config():
    return config_manager.get_global()


@app.post("/api/config")
async def save_global_config(config: dict = Body(...)):
    config_manager.save_global(config)
    return {"ok": True}


@app.get("/api/profiles")
async def list_profiles():
    return {"profiles": config_manager.list_profiles()}


@app.post("/api/profiles")
async def save_profile(req: SaveProfileRequest):
    config_manager.save_profile(req.name, req.params, req.description)
    return {"ok": True}


@app.delete("/api/profiles/{name}")
async def delete_profile(name: str):
    ok = config_manager.delete_profile(name)
    if not ok:
        raise HTTPException(status_code=404, detail=f"Profile '{name}' not found")
    return {"ok": True}


@app.post("/api/chat")
async def chat_completion(req: ChatRequest):
    family = model_manager.resolve_family(req.model)
    if not family:
        raise HTTPException(status_code=404, detail=f"Model '{req.model}' not found")
    port = await _ensure_model_loaded(family)
    if not port:
        raise HTTPException(status_code=400, detail=f"Failed to load model '{family}'")

    params = {"max_tokens": req.max_tokens}
    if req.temperature is not None:  params["temperature"] = req.temperature
    if req.top_p is not None:        params["top_p"] = req.top_p
    if req.top_k is not None:        params["top_k"] = req.top_k
    if req.repeat_penalty is not None: params["repeat_penalty"] = req.repeat_penalty

    global chat_engine
    t0 = time.monotonic()
    result = await chat_engine.chat_completion(
        messages=req.messages, stream=False, **params,
    )
    elapsed = time.monotonic() - t0

    if "usage" in result:
        tokens = result["usage"].get("completion_tokens", 0)
        prompt_tokens = result["usage"].get("prompt_tokens", 0)
        metrics_collector.record_inference(InferenceRecord(
            model_family=req.model, tokens_generated=tokens,
            prompt_tokens=prompt_tokens, elapsed_seconds=round(elapsed, 2),
            tokens_per_second=round(tokens / elapsed, 2) if elapsed > 0 else 0,
            temperature=req.temperature or 0.7, max_tokens=req.max_tokens,
        ))

    return result


@app.post("/api/chat/stream")
async def chat_completion_stream(req: ChatRequest):
    family = model_manager.resolve_family(req.model)
    if not family:
        raise HTTPException(status_code=404, detail=f"Model '{req.model}' not found")
    port = await _ensure_model_loaded(family)
    if not port:
        raise HTTPException(status_code=400, detail=f"Failed to load model '{family}'")

    params = {"max_tokens": req.max_tokens}
    if req.temperature is not None:  params["temperature"] = req.temperature
    if req.top_p is not None:        params["top_p"] = req.top_p
    if req.top_k is not None:        params["top_k"] = req.top_k
    if req.repeat_penalty is not None: params["repeat_penalty"] = req.repeat_penalty

    global chat_engine

    async def event_stream():
        start_time = time.monotonic()
        prompt_tokens = 0
        completion_tokens = 0
        got_usage = False
        model_name = None

        async for chunk_str in chat_engine.chat_completion_stream(
            messages=req.messages, **params,
        ):
            if chunk_str.startswith("data: "):
                raw = chunk_str[6:].strip()
                if raw == "[DONE]":
                    elapsed = time.monotonic() - start_time
                    if not got_usage:
                        metrics_collector.record_inference(InferenceRecord(
                            model_family=req.model,
                            tokens_generated=completion_tokens,
                            prompt_tokens=prompt_tokens,
                            elapsed_seconds=round(elapsed, 2),
                            tokens_per_second=round(completion_tokens / elapsed, 2) if elapsed > 0 else 0,
                            temperature=req.temperature or 0.7,
                            max_tokens=req.max_tokens,
                        ))
                    break
                try:
                    data = json.loads(raw)
                    if "_metrics" in data:
                        continue
                    if data.get("usage"):
                        got_usage = True
                        completion_tokens = data["usage"].get("completion_tokens", 0)
                        prompt_tokens = data["usage"].get("prompt_tokens", 0)
                    if "choices" in data and data["choices"]:
                        if data["choices"][0].get("finish_reason"):
                            model_name = data.get("model") or model_name
                except json.JSONDecodeError:
                    pass
            yield chunk_str
        else:
            elapsed = time.monotonic() - start_time
            if not got_usage:
                metrics_collector.record_inference(InferenceRecord(
                    model_family=req.model,
                    tokens_generated=completion_tokens,
                    prompt_tokens=prompt_tokens,
                    elapsed_seconds=round(elapsed, 2),
                    tokens_per_second=round(completion_tokens / elapsed, 2) if elapsed > 0 else 0,
                    temperature=req.temperature or 0.7,
                    max_tokens=req.max_tokens,
                ))

    return StreamingResponse(
        event_stream(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive",
                 "X-Accel-Buffering": "no"},
    )


@app.get("/api/metrics")
async def get_metrics():
    return {
        "summary": metrics_collector.get_summary(),
        "models": metrics_collector.get_all_stats(),
        "recent": metrics_collector.get_recent_inferences(limit=50),
    }


@app.get("/api/metrics/{family}")
async def get_model_metrics(family: str):
    stats = metrics_collector.get_model_stats(family)
    recent = [r for r in metrics_collector.get_recent_inferences(limit=100)
              if r["model_family"] == family]
    return {"stats": stats, "recent": recent}


@app.post("/api/metrics/reset")
async def reset_metrics():
    metrics_collector.reset()
    return {"ok": True}


@app.get("/api/instances")
async def list_instances():
    return {"instances": process_manager.list_instances()}


# ── Benchmark ────────────────────────────────────────────

@app.get("/api/benchmark/tests")
async def list_benchmark_tests():
    return {"tests": AVAILABLE_TESTS}


_bench_state: dict = {
    "runner": None,         # BenchmarkRunner
    "events": None,         # asyncio.Queue
    "task": None,           # asyncio.Task
    "report": None,         # final report dict
    "status": "idle",       # idle | running | done | error | cancelled
    "running_model": None,  # which model is being benchmarked
}


@app.get("/api/benchmark")
async def get_benchmark_status():
    return {
        "status": _bench_state["status"],
        "running_model": _bench_state["running_model"],
        "report": _bench_state["report"],
    }


class BenchmarkRunRequest(BaseModel):
    tests: List[str]
    family: Optional[str] = None


@app.post("/api/benchmark/run")
async def run_benchmark(req: BenchmarkRunRequest):
    global _bench_state

    if _bench_state["status"] == "running":
        raise HTTPException(status_code=409,
                            detail="已有测试正在运行，请先取消或等待完成")

    family = req.family
    if not family:
        current = process_manager.get_current()
        if current and current.status == "running":
            family = current.family

    if not family:
        raise HTTPException(status_code=400,
                            detail="当前没有运行的模型，请先在模型管理中加载一个模型再开始基准测试。")

    events = asyncio.Queue()
    runner = BenchmarkRunner(base_url=f"http://127.0.0.1:{LLAMA_PORT}",
                             event_queue=events)
    _bench_state = {
        "runner": runner,
        "events": events,
        "task": None,
        "report": None,
        "status": "running",
        "running_model": family,
    }

    async def _wrap():
        try:
            report = await runner.run(req.tests)
            _bench_state["report"] = report
            _bench_state["status"] = "done"
        except Exception as e:
            _bench_state["status"] = "error"
            _bench_state["report"] = {"error": str(e)}

    _bench_state["task"] = asyncio.create_task(_wrap())
    return {"ok": True, "status": "running", "model": family,
            "tests": req.tests}


@app.post("/api/benchmark/cancel")
async def cancel_benchmark():
    runner = _bench_state.get("runner")
    if runner and _bench_state["status"] == "running":
        await runner.cancel()
        _bench_state["status"] = "cancelled"
    return {"ok": True}


@app.get("/api/benchmark/events")
async def benchmark_events(last_n: int = 200):
    """Return buffered events up to last_n. Resets buffer after read."""
    events_q = _bench_state.get("events")
    out = []
    if events_q is not None:
        while not events_q.empty():
            try:
                e = events_q.get_nowait()
                out.append(e.to_dict() if hasattr(e, "to_dict") else e)
            except asyncio.QueueEmpty:
                break
        out = out[-last_n:]
    return {
        "status": _bench_state["status"],
        "running_model": _bench_state["running_model"],
        "events": out,
    }


@app.get("/api/benchmark/report")
async def get_benchmark_report():
    if _bench_state["report"] is None:
        return {"available": False,
                "status": _bench_state["status"]}
    return {"available": True, "report": _bench_state["report"],
            "status": _bench_state["status"],
            "running_model": _bench_state["running_model"]}


@app.get("/api/benchmark/export")
async def export_benchmark(format: str = "json"):
    if _bench_state["report"] is None:
        raise HTTPException(status_code=404, detail="无测试报告可导出")
    report = _bench_state["report"]
    model = _bench_state["running_model"] or "unknown"
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    safe_model = "".join(c for c in model if c.isalnum() or c in ("_", "-")) or "model"
    filename = f"benchmark-{safe_model}-{stamp}.{format}"

    if format == "json":
        body = json.dumps(report, ensure_ascii=False, indent=2)
        return JSONResponse(
            content=body, media_type="application/json; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    if format == "md":
        body = _report_to_markdown(report, model)
        return Response(
            content=body, media_type="text/markdown; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    raise HTTPException(status_code=400, detail=f"unsupported format: {format}")


def _report_to_markdown(report: dict, model: str) -> str:
    from benchmark_runner import AVAILABLE_TESTS
    lines = []
    lines.append(f"# LiangLLM 基准测试报告")
    lines.append("")
    lines.append(f"- **模型**: `{report.get('model', model)}`")
    lines.append(f"- **测试时间**: {report.get('generated_at', '')}")
    lines.append(f"- **总耗时**: {report.get('total_seconds', 0)} s")
    lines.append(f"- **后端**: {report.get('backend', '')}")
    lines.append(f"- **执行的测试**: `{', '.join(report.get('tests_run', []))}`")
    lines.append("")
    s = report.get("summary", {}) or {}
    lines.append("## 总览")
    lines.append("")
    lines.append("| 指标 | 值 |")
    lines.append("|---|---|")
    if s.get("best_tps") is not None:
        lines.append(f"| 最佳 TPS | {s['best_tps']} tok/s |")
    if s.get("best_ttft_ms") is not None:
        lines.append(f"| 最佳 TTFT | {s['best_ttft_ms']} ms |")
    if s.get("mean_pass_rate") is not None:
        lines.append(f"| 平均通过率 | {s['mean_pass_rate']} % |")
    lines.append(f"| 执行失败的测试 | {s.get('failed_tests', 0)} |")
    lines.append("")
    lines.append("## 分项结果")
    lines.append("")
    for r in report.get("results", []):
        lines.append(f"### {r.get('name', r.get('test'))}")
        lines.append("")
        lines.append(f"> {r.get('description', '')}")
        lines.append("")
        if "metrics" in r and r["metrics"]:
            lines.append("| 指标 | 值 |")
            lines.append("|---|---|")
            m = r["metrics"]
            if isinstance(m, dict):
                for k, v in m.items():
                    if k == "samples" or v is None:
                        continue
                    lines.append(f"| {k} | {v} |")
            lines.append("")
        if "scenarios" in r and r["scenarios"]:
            lines.append("| 场景 | 指标 | 值 |")
            lines.append("|---|---|---|")
            for name, sc in r["scenarios"].items():
                if "tps_stats" in sc:
                    for k, v in sc["tps_stats"].items():
                        if k == "unit":
                            continue
                        lines.append(f"| {name} | {k} ({sc['tps_stats'].get('unit','')}) | {v} |")
            lines.append("")
        if "samples" in r and r["samples"] and len(r["samples"]) < 8:
            lines.append("**样例**:")
            lines.append("")
            for s in r["samples"]:
                lines.append(f"- `{s}`")
            lines.append("")
    return "\n".join(lines)


try:
    from fastapi import Response  # noqa: F401
except Exception:
    pass


# ── Logging API ───────────────────────────────────────────

class LogWriteRequest(BaseModel):
    level: str = "INFO"
    module: str = "system"
    message: str
    model: str | None = None
    extra: dict | None = None


@app.post("/api/logs/write")
async def api_logs_write(req: LogWriteRequest):
    logger_manager.write(req.level, req.module, req.message,
                         model=req.model, extra=req.extra)
    return {"ok": True}


@app.get("/api/logs/files")
async def api_logs_files():
    return {"files": logger_manager.list_log_files()}


@app.get("/api/logs/days")
async def api_logs_days():
    return {"days": logger_manager.list_days(), "log_dir": str(logger_manager.log_dir)}


@app.get("/api/logs/summary")
async def api_logs_summary(days: int = 7):
    return logger_manager.summary(days=days)


@app.get("/api/logs")
async def api_logs_query(
    date_from: str = Query(...),
    date_to: str | None = Query(None),
    level: str | None = Query(None),
    module: str | None = Query(None),
    model: str | None = Query(None),
    keyword: str | None = Query(None),
    limit: int = Query(500, ge=1, le=5000),
    offset: int = Query(0, ge=0),
    order: str = Query("desc"),
):
    return logger_manager.query(
        date_from=date_from, date_to=date_to,
        level=level, module=module, model=model, keyword=keyword,
        limit=limit, offset=offset, order=order,
    )


@app.delete("/api/logs/day/{day}")
async def api_logs_delete_day(day: str):
    ok = logger_manager.delete_day(day)
    if not ok:
        raise HTTPException(status_code=404, detail=f"log for {day} not found")
    logger_manager.info("logs", f"Deleted log file {day}.log")
    return {"ok": True, "day": day}


@app.post("/api/logs/archive/{day}")
async def api_logs_archive_day(day: str, delete_source: bool = Body(True, embed=True)):
    res = logger_manager.archive_day(day, delete_source=delete_source)
    if not res.get("ok"):
        raise HTTPException(status_code=404, detail=res.get("error", "not found"))
    logger_manager.info("logs", f"Archived {day}.log -> {res['zip']}")
    return res


@app.post("/api/logs/archive-before")
async def api_logs_archive_before(days: int = Body(30, embed=True)):
    res = logger_manager.archive_all_before(days, delete_source=True)
    logger_manager.info("logs", f"Archived {res['count']} log files older than {days} days")
    return res


@app.post("/api/logs/cleanup")
async def api_logs_cleanup(days: int = Body(30, embed=True)):
    res = logger_manager.cleanup_before(days)
    logger_manager.info("logs", f"Cleaned up {res['count']} log files older than {days} days")
    return res


@app.get("/api/logs/download/{day}")
async def api_logs_download(day: str):
    from pathlib import Path
    p = logger_manager.log_dir / f"{day}.log"
    if not p.exists():
        archived = logger_manager.archive_dir / f"{day}.zip"
        if archived.exists():
            return FileResponse(
                str(archived), media_type="application/zip",
                filename=f"{day}.zip",
            )
        raise HTTPException(status_code=404, detail=f"log for {day} not found")
    return FileResponse(
        str(p), media_type="text/plain; charset=utf-8",
        filename=f"{day}.log",
    )


@app.post("/api/logs/ingest")
async def api_logs_ingest(body: dict = Body(...)):
    """Append an external log line (e.g., from front-end renderer)."""
    if isinstance(body, list):
        for entry in body:
            if isinstance(entry, dict):
                logger_manager.write(
                    entry.get("level", "INFO"),
                    entry.get("module", "system"),
                    entry.get("message", ""),
                    model=entry.get("model"),
                    extra=entry.get("extra"),
                )
    elif isinstance(body, dict):
        logger_manager.write(
            body.get("level", "INFO"),
            body.get("module", "system"),
            body.get("message", ""),
            model=body.get("model"),
            extra=body.get("extra"),
        )
    return {"ok": True}


@app.get("/api/instances/{family}")
async def get_instance(family: str):
    inst = process_manager.get_current()
    if not inst or inst.family != family:
        raise HTTPException(status_code=404, detail=f"No instance for '{family}'")
    return {
        "family": inst.family, "port": inst.port, "pid": inst.pid,
        "status": inst.status, "uptime_seconds": inst.uptime_seconds,
        "memory_mb": round(inst.memory_mb, 1),
        "cpu_percent": round(inst.cpu_percent, 1),
        "log_file": inst.log_file,
    }


FRONTEND_DIR = os.path.join(APP_ROOT, "frontend")
if os.path.isdir(FRONTEND_DIR):
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
    print(f"  Frontend: http://127.0.0.1:19600/")


def main():
    import argparse
    parser = argparse.ArgumentParser(description="LiangLLM Backend")
    parser.add_argument("--port", type=int, default=19600)
    parser.add_argument("--host", type=str, default="127.0.0.1")
    args = parser.parse_args()

    print("=" * 56)
    print("  LiangLLM Backend")
    print(f"  API:     http://{args.host}:{args.port}")
    print(f"  Models:  {MODELS_DIR}")
    print(f"  Bins:    {LLM_PROJECT}")
    print(f"  Logs:    {LOG_DIR}")
    print("=" * 56)
    print()

    backend = detect_backend(LLM_PROJECT)
    print(f"  [GPU] {backend.label} (kind={backend.kind})")
    if backend.server_path:
        print(f"  [BIN] {backend.server_path}")
    print()

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
