"""
backend_selector.py — GPU Backend Auto-Detection

Auto-detects available GPU backends for llama.cpp:
- NVIDIA CUDA (highest priority)
- Intel Vulkan (Intel Arc iGPU/dGPU)
- Intel SYCL (fallback for Intel)
- CPU-only (last resort)

Reference: LM Studio / Ollama detection patterns
"""

import os
import subprocess
import platform
import shutil
from pathlib import Path
from dataclasses import dataclass, field
from typing import Optional


BACKEND_MAP = {
    "cuda":   {"dir": "llama-cpp-cuda",   "binary": "llama-server.exe",
               "extra_args": [], "label": "NVIDIA CUDA"},
    "vulkan": {"dir": "llama-cpp-vulkan", "binary": "llama-server.exe",
               "extra_args": [], "label": "Intel Vulkan"},
    "sycl":   {"dir": "llama-cpp-sycl",   "binary": "llama-server.exe",
               "extra_args": [], "label": "Intel SYCL"},
}


@dataclass
class BackendInfo:
    kind: str                        # "cuda" | "vulkan" | "sycl" | "cpu"
    label: str                       # human-readable
    server_path: Optional[str]       # full path to llama-server.exe
    extra_args: list = field(default_factory=list)
    gpu_devices: list = field(default_factory=list)
    available: bool = False


def _find_backend_dir(project_root: str, subdir: str) -> Optional[str]:
    """Locate a backend directory relative to the project root."""
    candidates = [
        os.path.join(project_root, subdir),
        os.path.join(project_root, "..", subdir),
        os.path.join(project_root, "..", "..", subdir),
        os.path.join(project_root, "backends", subdir),
    ]
    for c in candidates:
        abs_path = os.path.abspath(c)
        if os.path.isdir(abs_path):
            return abs_path
    return None


def _get_llama_bench(backend_dir: str) -> Optional[str]:
    """Find llama-bench.exe in the backend directory."""
    bench = os.path.join(backend_dir, "llama-bench.exe")
    return bench if os.path.isfile(bench) else None


def _list_devices(bench_path: str) -> list:
    """Run llama-bench --list-devices and parse output."""
    try:
        result = subprocess.run(
            [bench_path, "--list-devices"],
            capture_output=True, text=True, timeout=30,
            creationflags=subprocess.CREATE_NO_WINDOW
        )
        lines = result.stdout.splitlines()
        devices = []
        for line in lines:
            line = line.strip()
            # Parse Vulkan device info
            if "ggml_vulkan:" in line and "=" in line:
                device_info = line.split("=", 1)[1].strip() if "=" in line else line
                devices.append(device_info)
            # Parse available devices section
            elif line.startswith("Vulkan") or line.startswith("CUDA") or "MiB" in line:
                devices.append(line)
        return devices if devices else []
    except Exception:
        return []


def _detect_nvidia_cuda() -> bool:
    """Check if NVIDIA CUDA is available via nvidia-smi."""
    nvsmi = shutil.which("nvidia-smi")
    if not nvsmi:
        return False
    try:
        result = subprocess.run(
            [nvsmi, "--query-gpu=name,driver_version,memory.total",
             "--format=csv,noheader"],
            capture_output=True, text=True, timeout=10,
            creationflags=subprocess.CREATE_NO_WINDOW
        )
        return result.returncode == 0 and result.stdout.strip() != ""
    except Exception:
        return False


def detect_backend(project_root: str = None) -> BackendInfo:
    """
    Auto-detect the best available GPU backend.
    Priority: CUDA > Vulkan > SYCL > CPU
    """
    if project_root is None:
        project_root = os.path.dirname(os.path.abspath(__file__))

    # --- 1. Check NVIDIA CUDA ---
    if _detect_nvidia_cuda():
        for backend_name in ["cuda"]:
            bdir = _find_backend_dir(project_root, BACKEND_MAP[backend_name]["dir"])
            if bdir is None:
                continue
            info = BACKEND_MAP[backend_name]
            server = os.path.join(bdir, info["binary"])
            if os.path.isfile(server):
                bench = _get_llama_bench(bdir)
                devices = _list_devices(bench) if bench else []
                return BackendInfo(
                    kind="cuda", label=info["label"],
                    server_path=server, extra_args=info["extra_args"],
                    gpu_devices=devices, available=True,
                )

    # --- 2. Check Intel Vulkan ---
    for backend_name in ["vulkan", "sycl"]:
        bdir = _find_backend_dir(project_root, BACKEND_MAP[backend_name]["dir"])
        if bdir is None:
            continue
        info = BACKEND_MAP[backend_name]
        server = os.path.join(bdir, info["binary"])
        if os.path.isfile(server):
            bench = _get_llama_bench(bdir)
            devices = _list_devices(bench) if bench else []
            return BackendInfo(
                kind=backend_name, label=info["label"],
                server_path=server, extra_args=info["extra_args"],
                gpu_devices=devices, available=True,
            )

    # --- 3. CPU fallback ---
    return BackendInfo(
        kind="cpu", label="CPU-only",
        server_path=None, available=False,
        extra_args=["-ngl", "0"],
    )


def list_all_available_backends(project_root: str = None) -> list:
    """List all backends that have binary directories (regardless of GPU)."""
    if project_root is None:
        project_root = os.path.dirname(os.path.abspath(__file__))

    results = []
    for kind, info in BACKEND_MAP.items():
        bdir = _find_backend_dir(project_root, info["dir"])
        if bdir is None:
            continue
        server = os.path.join(bdir, info["binary"])
        available = os.path.isfile(server)
        bench = _get_llama_bench(bdir) if available else None
        devices = _list_devices(bench) if bench else []
        results.append(BackendInfo(
            kind=kind, label=info["label"],
            server_path=server if available else None,
            extra_args=info["extra_args"],
            gpu_devices=devices, available=available,
        ))
    return results
