"""
process_manager.py — Single-Instance llama-server Manager

Manages EXACTLY ONE llama-server.exe at a time, always on the same port.
Model switching: kill current → start new on same port.
Reference: llm-gateway.py single-model architecture
"""

import os
import time
import subprocess
import threading
import urllib.request
import urllib.error
from typing import Optional
from dataclasses import dataclass, field

import psutil


LLAMA_PORT = 8080  # The single port all models share


@dataclass
class ServerInstance:
    family: str
    port: int
    pid: int
    process: subprocess.Popen
    log_file: str
    started_at: float
    status: str = "running"

    @property
    def uptime_seconds(self) -> float:
        return time.time() - self.started_at

    @property
    def memory_mb(self) -> float:
        try:
            return psutil.Process(self.pid).memory_info().rss / (1024*1024)
        except Exception:
            return 0.0

    @property
    def cpu_percent(self) -> float:
        try:
            proc = psutil.Process(self.pid)
            return proc.cpu_percent(interval=0.1)
        except Exception:
            return 0.0


class ProcessManager:
    """Manages exactly ONE llama-server on LLAMA_PORT at a time."""

    def __init__(self, log_dir: str):
        self._instance: Optional[ServerInstance] = None
        self._lock = threading.Lock()
        self._log_dir = log_dir
        os.makedirs(log_dir, exist_ok=True)

    # ── Public API ──────────────────────────────────────────

    def get_current(self) -> Optional[ServerInstance]:
        """Return the currently running instance (or None)."""
        with self._lock:
            inst = self._instance
            if inst and inst.process.poll() is None:
                return inst
            if inst:
                self._instance = None
            return None

    def list_instances(self) -> list:
        """Return [instance_dict] or [] — single-model mode."""
        inst = self.get_current()
        if not inst:
            return []
        return [{
            "family": inst.family,
            "port": inst.port,
            "pid": inst.pid,
            "status": "running",
            "uptime_seconds": inst.uptime_seconds,
            "memory_mb": round(inst.memory_mb, 1),
            "cpu_percent": round(inst.cpu_percent, 1),
            "log_file": inst.log_file,
        }]

    def start_server(
        self,
        server_exe: str,
        model_path: str,
        family: str,
        extra_args: list,
    ) -> ServerInstance:
        """Kill current server (if any), start new one on LLAMA_PORT."""
        with self._lock:
            self._kill_current()

            log_file = os.path.join(
                self._log_dir,
                f"gateway_{family}.log"
            )

            cmd = [
                server_exe,
                "--model", model_path,
                "--host", "127.0.0.1",
                "--port", str(LLAMA_PORT),
            ] + extra_args

            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.DEVNULL,
                stderr=open(log_file, "w"),
                creationflags=subprocess.CREATE_NO_WINDOW,
            )

            inst = ServerInstance(
                family=family,
                port=LLAMA_PORT,
                pid=proc.pid,
                process=proc,
                log_file=log_file,
                started_at=time.time(),
            )
            self._instance = inst
            return inst

    def stop_current(self) -> bool:
        """Stop the current server instance."""
        with self._lock:
            return self._kill_current()

    def stop_all(self):
        """Stop current instance + system-wide safety net."""
        with self._lock:
            self._kill_current()
        # Safety net: kill orphaned llama-server
        try:
            subprocess.run(
                ["taskkill", "/f", "/im", "llama-server.exe"],
                capture_output=True, timeout=5,
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
        except Exception:
            pass

    def wait_for_ready(self, timeout: int = 120) -> dict:
        """Wait for /health on LLAMA_PORT. Returns status dict."""
        start = time.time()
        for _ in range(timeout):
            if self._instance and self._instance.process.poll() is not None:
                return {
                    "ok": False,
                    "error": "process died",
                    "log_tail": self._tail_log(self._instance.log_file, 20),
                }
            try:
                resp = urllib.request.urlopen(
                    f"http://127.0.0.1:{LLAMA_PORT}/health",
                    timeout=2,
                )
                if resp.status == 200:
                    return {"ok": True, "elapsed": round(time.time() - start, 1)}
            except Exception:
                pass
            time.sleep(1)
        return {"ok": False, "error": "timeout",
                "log_tail": self._tail_log(self._instance.log_file, 30) if self._instance else ""}

    def is_ready(self, timeout: int = 60) -> bool:
        """Quick check if server is ready."""
        for _ in range(timeout):
            try:
                resp = urllib.request.urlopen(
                    f"http://127.0.0.1:{LLAMA_PORT}/health", timeout=1)
                return resp.status == 200
            except Exception:
                time.sleep(1)
        return False

    # ── Internal ────────────────────────────────────────────

    def _kill_current(self) -> bool:
        inst = self._instance
        if inst is None:
            return False
        self._instance = None
        try:
            proc = psutil.Process(inst.pid)
            proc.terminate()
            gone, alive = psutil.wait_procs([proc], timeout=8)
            if alive:
                for p in alive:
                    try:
                        p.kill()
                        p.wait(timeout=5)
                    except Exception:
                        pass
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass
        time.sleep(1)  # GPU VRAM release
        return True

    def _tail_log(self, log_path: str, lines: int = 20) -> str:
        try:
            with open(log_path, "r", encoding="utf-8", errors="replace") as f:
                return "".join(f.readlines()[-lines:])
        except Exception:
            return ""
