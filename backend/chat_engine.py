"""
chat_engine.py — Chat & Completion Proxy

Proxies chat/completion requests to the single llama-server instance
always running on LLAMA_PORT (8080).
Reference: OpenAI Chat Completions API spec
"""

import json
import time
import asyncio
from typing import AsyncGenerator, Optional, List

import httpx

LLAMA_PORT = 8080


class ChatEngine:
    """Proxies chat requests to the single llama-server on :{LLAMA_PORT}."""

    def __init__(self):
        self._client = httpx.AsyncClient(timeout=httpx.Timeout(300.0))

    async def chat_completion(
        self,
        messages: List[dict],
        stream: bool = False,
        max_tokens: int = 4096,
        temperature: float = 0.7,
        top_p: float = 0.9,
        top_k: int = 40,
        repeat_penalty: float = 1.1,
        stop: Optional[List[str]] = None,
    ) -> dict:
        """Non-streaming chat completion."""
        body = self._build_body(
            messages, stream=False, max_tokens=max_tokens,
            temperature=temperature, top_p=top_p, top_k=top_k,
            repeat_penalty=repeat_penalty, stop=stop,
        )
        try:
            resp = await self._client.post(
                f"http://127.0.0.1:{LLAMA_PORT}/v1/chat/completions",
                json=body,
            )
            resp.raise_for_status()
            return resp.json()
        except httpx.TimeoutException:
            return {"error": "Request timed out", "timed_out": True}
        except httpx.HTTPStatusError as e:
            return {"error": f"Backend error: {e.response.status_code}",
                    "detail": e.response.text[:500] if e.response.text else ""}
        except Exception as e:
            return {"error": str(e)}

    async def chat_completion_stream(
        self,
        messages: List[dict],
        max_tokens: int = 4096,
        temperature: float = 0.7,
        top_p: float = 0.9,
        top_k: int = 40,
        repeat_penalty: float = 1.1,
        stop: Optional[List[str]] = None,
    ) -> AsyncGenerator[str, None]:
        """Streaming chat completion — yields SSE data chunks + final usage.

        Creates a fresh httpx.AsyncClient per request to avoid connection-pool
        starvation when the caller cancels mid-stream or the previous SSE
        response isn't fully drained before a new request arrives.
        """
        body = self._build_body(
            messages, stream=True, max_tokens=max_tokens,
            temperature=temperature, top_p=top_p, top_k=top_k,
            repeat_penalty=repeat_penalty, stop=stop,
        )
        start_time = time.time()

        async with httpx.AsyncClient(timeout=httpx.Timeout(300.0)) as client:
            try:
                async with client.stream(
                    "POST",
                    f"http://127.0.0.1:{LLAMA_PORT}/v1/chat/completions",
                    json=body,
                ) as response:
                    async for line in response.aiter_lines():
                        if not line.startswith("data: "):
                            continue
                        chunk = line[6:].strip()
                        if chunk == "[DONE]":
                            elapsed = time.time() - start_time
                            metrics = json.dumps({
                                "_metrics": {
                                    "elapsed_seconds": round(elapsed, 2),
                                }
                            })
                            yield f"data: {metrics}\n\n"
                            yield "data: [DONE]\n\n"
                            return
                        yield f"data: {chunk}\n\n"
            except httpx.TimeoutException:
                yield f"data: {json.dumps({'error': 'Request timed out'})}\n\n"
                yield "data: [DONE]\n\n"
            except Exception as e:
                yield f"data: {json.dumps({'error': str(e)})}\n\n"
                yield "data: [DONE]\n\n"

    async def completion(
        self,
        prompt: str,
        stream: bool = False,
        max_tokens: int = 512,
        temperature: float = 0.7,
    ) -> dict:
        """Text completion endpoint."""
        body = {
            "prompt": prompt,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "stream": stream,
        }
        try:
            resp = await self._client.post(
                f"http://127.0.0.1:{LLAMA_PORT}/v1/completions",
                json=body,
            )
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            return {"error": str(e)}

    async def get_model_info(self) -> dict:
        """Get model info from the backend server."""
        try:
            resp = await self._client.get(
                f"http://127.0.0.1:{LLAMA_PORT}/v1/models",
                timeout=5.0,
            )
            resp.raise_for_status()
            return resp.json()
        except Exception:
            return {"data": []}

    async def health_check(self) -> dict:
        """Quick health check of the backend server."""
        try:
            resp = await self._client.get(
                f"http://127.0.0.1:{LLAMA_PORT}/health",
                timeout=3.0,
            )
            if resp.status_code == 200:
                return resp.json()
            return {"status": "unhealthy", "http_code": resp.status_code}
        except httpx.ConnectError:
            return {"status": "unreachable"}
        except Exception as e:
            return {"status": "error", "detail": str(e)}

    def _build_body(self, messages, stream, **kwargs) -> dict:
        body = {
            "messages": messages,
            "stream": stream,
            "max_tokens": kwargs.get("max_tokens", 4096),
            "temperature": kwargs.get("temperature", 0.7),
            "top_p": kwargs.get("top_p", 0.9),
            "top_k": kwargs.get("top_k", 40),
            "repeat_penalty": kwargs.get("repeat_penalty", 1.1),
        }
        stop = kwargs.get("stop")
        if stop:
            body["stop"] = stop
        return body
