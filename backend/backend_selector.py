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
import json
import re
from pathlib import Path
from dataclasses import dataclass, field
from typing import Optional, List


BACKEND_MAP = {
    "cuda":   {"dir": "llama-cpp-cuda",   "binary": "llama-server.exe",
               "extra_args": [], "label": "NVIDIA CUDA"},
    "vulkan": {"dir": "llama-cpp-vulkan", "binary": "llama-server.exe",
               "extra_args": [], "label": "Intel Vulkan"},
    "sycl":   {"dir": "llama-cpp-sycl",   "binary": "llama-server.exe",
               "extra_args": [], "label": "Intel SYCL"},
}

BINARY_NAMES_WINDOWS = ["llama-server.exe"]
BINARY_NAMES_POSIX   = ["llama-server", "server"]


@dataclass
class BackendInfo:
    kind: str                        # "cuda" | "vulkan" | "sycl" | "cpu" | "custom"
    label: str                       # human-readable
    server_path: Optional[str]       # full path to llama-server.exe
    extra_args: list = field(default_factory=list)
    gpu_devices: list = field(default_factory=list)
    available: bool = False
    root_dir: Optional[str] = None   # 后端所在根目录（UI 展示）


def _candidate_binary_names() -> List[str]:
    if platform.system() == "Windows":
        return BINARY_NAMES_WINDOWS
    return BINARY_NAMES_POSIX


def _is_executable(fpath: str) -> bool:
    if platform.system() == "Windows":
        return fpath.lower().endswith(".exe")
    return os.access(fpath, os.X_OK)


def _deep_find_server_under(root: str, max_depth: int = 4) -> List[str]:
    """Search all subdirectories under root for llama-server binary."""
    hits = []
    binary_names = _candidate_binary_names()
    if not os.path.isdir(root):
        return hits
    for cur, dirs, files in os.walk(root):
        rel = os.path.relpath(cur, root)
        depth = 0 if rel == "." else rel.count(os.sep) + 1
        if depth > max_depth:
            dirs[:] = []
            continue
        for fname in files:
            if fname in binary_names and _is_executable(os.path.join(cur, fname)):
                hits.append(os.path.join(cur, fname))
    return hits


def _scan_user_llama_dir(user_dir: str) -> List[BackendInfo]:
    """Scan a user-specified directory recursively."""
    results = []
    if not user_dir or not os.path.isdir(user_dir):
        return results
    found = _deep_find_server_under(user_dir, max_depth=5)
    for server_path in found:
        kind = _guess_kind_from_path(server_path)
        label = _kind_label(kind)
        devices = _probe_gpu_devices(os.path.dirname(server_path))
        results.append(BackendInfo(
            kind=kind, label=label,
            server_path=server_path, available=True,
            extra_args=[], gpu_devices=devices,
            root_dir=os.path.dirname(server_path),
        ))
    return results


def _guess_kind_from_path(path: str) -> str:
    p = path.lower()
    if "cuda" in p or "nvidia" in p:
        return "cuda"
    if "vulkan" in p or "arc" in p or "intel" in p:
        return "vulkan"
    if "sycl" in p:
        return "sycl"
    return "custom"


def _kind_label(kind: str) -> str:
    m = {
        "cuda": "NVIDIA CUDA",
        "vulkan": "Intel Vulkan",
        "sycl":   "Intel SYCL",
        "cpu":    "CPU-only",
        "custom": "Custom (用户指定)",
    }
    return m.get(kind, "Unknown")


def _find_backend_dir(project_root: str, subdir: str) -> Optional[str]:
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
    bench = os.path.join(backend_dir, "llama-bench.exe") if platform.system() == "Windows" \
        else os.path.join(backend_dir, "llama-bench")
    return bench if os.path.isfile(bench) else None


def _probe_gpu_devices(backend_dir: str) -> list:
    """Run llama-bench --list-devices and parse output."""
    bench = _get_llama_bench(backend_dir)
    if not bench or not os.path.isfile(bench):
        return []
    try:
        result = subprocess.run(
            [bench, "--list-devices"],
            capture_output=True, text=True, timeout=30,
            creationflags=subprocess.CREATE_NO_WINDOW if platform.system() == "Windows" else 0,
        )
        devices = []
        for line in result.stdout.splitlines():
            line = line.strip()
            if "ggml_vulkan:" in line and "=" in line:
                chunk = line.split("=", 1)[1].strip()
                if chunk:
                    devices.append(chunk)
            elif line.startswith("Vulkan") or line.startswith("CUDA"):
                devices.append(line)
            elif "MiB" in line and line:
                devices.append(line)
        return devices
    except Exception:
        return []


def _detect_nvidia_cuda() -> bool:
    nvsmi = shutil.which("nvidia-smi")
    if not nvsmi:
        return False
    try:
        result = subprocess.run(
            [nvsmi, "--query-gpu=name,driver_version,memory.total",
             "--format=csv,noheader"],
            capture_output=True, text=True, timeout=10,
            creationflags=subprocess.CREATE_NO_WINDOW if platform.system() == "Windows" else 0,
        )
        return result.returncode == 0 and result.stdout.strip() != ""
    except Exception:
        return False


def scan_system_for_llama_servers() -> List[str]:
    """Best-effort broad scan: PATH + common install paths.
    Returns a list of full paths to candidate binaries.
    """
    hits = []
    # 1. which() on each name
    for name in _candidate_binary_names():
        p = shutil.which(name)
        if p:
            hits.append(os.path.abspath(p))

    # 2. Common install locations (Windows)
    if platform.system() == "Windows":
        roots = [
            r"C:\Program Files",
            r"C:\Program Files (x86)",
            os.path.expanduser(r"~\scoop\apps"),
            os.path.expanduser(r"~\AppData\Local\Programs"),
            r"D:\tools", r"D:\apps", r"D:\llama", r"D:\LLM", r"D:\models",
            r"E:\tools", r"E:\apps", r"E:\LLM", r"E:\DTXY",
        ]
        for root in roots:
            if not os.path.isdir(root):
                continue
            found = _deep_find_server_under(root, max_depth=3)
            hits.extend(found)

    # 3. /usr/local/bin, /opt, etc. (posix)
    else:
        for root in ["/usr/local/bin", "/opt", os.path.expanduser("~")]:
            if os.path.isdir(root):
                hits.extend(_deep_find_server_under(root, max_depth=2))

    # dedupe
    return list({os.path.abspath(h) for h in hits})


def scan_models_dir(models_dir: str) -> dict:
    """List all GGUF files under models_dir, grouped by family.
    family 推导规则: 文件名去除大小写无关的 '-q4_k_m' / '-f16' 等量化后缀。
    """
    result = {"families": [], "files": []}
    if not models_dir or not os.path.isdir(models_dir):
        return result

    quant_suffix_re = re.compile(r"""
        (?:[-_]
            (?:q[2458]_[0-9a-z]+|
               f16|
               iq[1-4]_[a-z0-9]+)
        )+$
    """, re.VERBOSE | re.IGNORECASE)

    seen_families = {}

    def walk(dir_path, prefix="", depth=0):
        if depth > 3:
            return
        try:
            entries = os.listdir(dir_path)
        except Exception:
            return
        for entry in entries:
            full = os.path.join(dir_path, entry)
            if entry.startswith("."):
                continue
            if os.path.isdir(full):
                walk(full, entry, depth + 1)
                continue
            lower = entry.lower()
            if not lower.endswith(".gguf"):
                continue
            try:
                size = os.path.getsize(full)
            except Exception:
                size = 0
            rel = os.path.relpath(full, models_dir)
            base = os.path.splitext(entry)[0]
            family = quant_suffix_re.sub("", base) or base
            if family not in seen_families:
                seen_families[family] = family
            result["files"].append({
                "name": entry,
                "path": full,
                "rel_path": rel,
                "size_bytes": size,
                "size_human": _human_size(size),
                "family": family,
            })

    walk(models_dir)
    result["families"] = sorted(seen_families.keys())
    return result


def _human_size(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024:
            return f"{n:.1f} {unit}" if unit != "B" else f"{n} B"
        n /= 1024
    return f"{n:.1f} PB"


def build_backend_from_user_exe(exe_path: str) -> BackendInfo:
    """Create a BackendInfo directly from a user-selected .exe path."""
    if not exe_path or not os.path.isfile(exe_path):
        return BackendInfo(kind="custom", label="Custom", server_path=None,
                           available=False)
    kind = _guess_kind_from_path(exe_path)
    label = _kind_label(kind)
    devices = _probe_gpu_devices(os.path.dirname(exe_path))
    return BackendInfo(
        kind=kind, label=label, server_path=os.path.abspath(exe_path),
        available=True, extra_args=[], gpu_devices=devices,
        root_dir=os.path.dirname(exe_path),
    )


# ── Legacy API preserved ──────────────────────────────────

def detect_backend(project_root: str = None,
                   user_llama_dir: str = "",
                   user_server_exe: str = "",
                   preference: str = "auto") -> BackendInfo:
    """
    Auto-detect the best available GPU backend.

    Priority:
      1. user_server_exe  (用户直接指定 exe，最高优先级)
      2. user_llama_dir   (用户指定扫描起点)
      3. bundled project directories (classic LiangLLM/llama-cpp-*)
      4. system-wide scan (PATH / Program Files / D:\\tools ...)
    Among CUDA > Vulkan > SYCL for each location.
    """
    if project_root is None:
        project_root = os.path.dirname(os.path.abspath(__file__))

    # ── 1. Direct exe ──
    if user_server_exe and os.path.isfile(user_server_exe):
        return build_backend_from_user_exe(user_server_exe)

    # ── 2. User llama dir ──
    if user_llama_dir:
        user_scan = _scan_user_llama_dir(user_llama_dir)
        picked = _pick_by_preference(user_scan, preference)
        if picked:
            return picked

    # ── 3. Bundled project dirs ──
    if preference in ("auto", "cuda", "vulkan", "sycl"):
        if _detect_nvidia_cuda() and preference in ("auto", "cuda"):
            for backend_name in ["cuda"]:
                bdir = _find_backend_dir(project_root, BACKEND_MAP[backend_name]["dir"])
                if bdir is None:
                    continue
                info = BACKEND_MAP[backend_name]
                server = os.path.join(bdir, info["binary"])
                if os.path.isfile(server):
                    devices = _probe_gpu_devices(bdir)
                    return BackendInfo(
                        kind="cuda", label=info["label"],
                        server_path=server, extra_args=info["extra_args"],
                        gpu_devices=devices, available=True,
                        root_dir=bdir,
                    )
        for backend_name in ("vulkan", "sycl"):
            if preference != "auto" and preference != backend_name:
                continue
            bdir = _find_backend_dir(project_root, BACKEND_MAP[backend_name]["dir"])
            if bdir is None:
                continue
            info = BACKEND_MAP[backend_name]
            server = os.path.join(bdir, info["binary"])
            if os.path.isfile(server):
                devices = _probe_gpu_devices(bdir)
                return BackendInfo(
                    kind=backend_name, label=info["label"],
                    server_path=server, extra_args=info["extra_args"],
                    gpu_devices=devices, available=True,
                    root_dir=bdir,
                )

    # ── 4. System scan ──
    sys_server_paths = scan_system_for_llama_servers()
    sys_scan = []
    for p in sys_server_paths:
        sys_scan.append(BackendInfo(
            kind=_guess_kind_from_path(p),
            label=_kind_label(_guess_kind_from_path(p)),
            server_path=p, available=True,
            extra_args=[], gpu_devices=_probe_gpu_devices(os.path.dirname(p)),
            root_dir=os.path.dirname(p),
        ))
    picked = _pick_by_preference(sys_scan, preference)
    if picked:
        return picked

    # ── 5. CPU fallback ──
    return BackendInfo(
        kind="cpu", label="CPU-only (未找到 llama-server)",
        server_path=None, available=False,
        extra_args=["-ngl", "0"],
    )


def _pick_by_preference(infos: List[BackendInfo], preference: str) -> Optional[BackendInfo]:
    if not infos:
        return None
    if preference and preference != "auto":
        for info in infos:
            if info.kind == preference and info.available:
                return info
    priority = {"cuda": 0, "vulkan": 1, "sycl": 2, "custom": 3, "cpu": 4}
    infos_sorted = sorted(infos, key=lambda i: priority.get(i.kind, 99))
    for info in infos_sorted:
        if info.available:
            return info
    return None


def list_all_available_backends(project_root: str = None,
                                user_llama_dir: str = "",
                                user_server_exe: str = "") -> list:
    """List all backends that can be found, across bundled dirs + user dir + system."""
    if project_root is None:
        project_root = os.path.dirname(os.path.abspath(__file__))

    results: List[BackendInfo] = []
    seen = set()

    def _add(info: BackendInfo):
        if not info.server_path:
            return
        key = os.path.abspath(info.server_path).lower()
        if key in seen:
            return
        seen.add(key)
        results.append(info)

    if user_server_exe and os.path.isfile(user_server_exe):
        _add(build_backend_from_user_exe(user_server_exe))

    if user_llama_dir:
        for info in _scan_user_llama_dir(user_llama_dir):
            _add(info)

    for kind, info in BACKEND_MAP.items():
        bdir = _find_backend_dir(project_root, info["dir"])
        if bdir is None:
            continue
        server = os.path.join(bdir, info["binary"])
        available = os.path.isfile(server)
        if available:
            devices = _probe_gpu_devices(bdir)
            _add(BackendInfo(
                kind=kind, label=info["label"],
                server_path=server, extra_args=info["extra_args"],
                gpu_devices=devices, available=True, root_dir=bdir,
            ))

    for p in scan_system_for_llama_servers():
        _add(BackendInfo(
            kind=_guess_kind_from_path(p),
            label=_kind_label(_guess_kind_from_path(p)),
            server_path=p, available=True,
            extra_args=[], gpu_devices=_probe_gpu_devices(os.path.dirname(p)),
            root_dir=os.path.dirname(p),
        ))

    # dedupe + sort by priority
    priority = {"cuda": 0, "vulkan": 1, "sycl": 2, "custom": 3}
    results.sort(key=lambda i: priority.get(i.kind, 99))
    return results
