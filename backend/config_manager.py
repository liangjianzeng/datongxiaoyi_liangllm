"""
config_manager.py — Configuration Profiles Persistence

Manages parameter profiles (presets) as JSON files, allowing users to
save/load/delete model configuration sets.
Also stores system-wide settings (llamaCPP dir, model dir, etc.)
"""

import os
import json
import threading
from typing import Optional, Dict, List
from datetime import datetime


class ConfigManager:
    """Persistent configuration profiles for model parameters."""

    def __init__(self, config_dir: str):
        self._config_dir = config_dir
        self._profiles_dir = os.path.join(config_dir, "profiles")
        self._global_config_path = os.path.join(config_dir, "liangllm.json")
        self._lock = threading.RLock()
        os.makedirs(self._profiles_dir, exist_ok=True)

    # ── Global Config ───────────────────────────────────────

    def get_global(self) -> dict:
        """Read the global application config, merging with defaults."""
        if not os.path.isfile(self._global_config_path):
            return self._default_global()
        with self._lock:
            try:
                with open(self._global_config_path, "r", encoding="utf-8") as f:
                    saved = json.load(f)
                defaults = self._default_global()
                merged = dict(defaults)
                merged.update(saved)
                merged["startup_behavior"] = merged.get("startup_behavior", "idle")
                if merged != saved:
                    self.save_global(merged)
                return merged
            except Exception:
                return self._default_global()

    def save_global(self, config: dict):
        """Persist global application config."""
        with self._lock:
            config["_updated_at"] = datetime.now().isoformat()
            with open(self._global_config_path, "w", encoding="utf-8") as f:
                json.dump(config, f, indent=2, ensure_ascii=False)

    # ── Model-Specific Config ───────────────────────────────

    def get_model_config(self, family: str) -> Optional[dict]:
        """Get saved config for a specific model."""
        path = self._model_config_path(family)
        if not os.path.isfile(path):
            return None
        with self._lock:
            try:
                with open(path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                return None

    def save_model_config(self, family: str, params: dict):
        """Save parameter config for a specific model."""
        path = self._model_config_path(family)
        with self._lock:
            data = {
                "family": family,
                "params": params,
                "_updated_at": datetime.now().isoformat(),
            }
            with open(path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)

    def delete_model_config(self, family: str) -> bool:
        """Delete saved config for a model."""
        path = self._model_config_path(family)
        if not os.path.isfile(path):
            return False
        with self._lock:
            os.remove(path)
            return True

    # ── Profiles (cross-model presets) ──────────────────────

    def list_profiles(self) -> List[dict]:
        """List all saved parameter profiles."""
        profiles = []
        if not os.path.isdir(self._profiles_dir):
            return profiles
        with self._lock:
            for fname in sorted(os.listdir(self._profiles_dir)):
                if not fname.endswith(".json"):
                    continue
                fpath = os.path.join(self._profiles_dir, fname)
                try:
                    with open(fpath, "r", encoding="utf-8") as f:
                        data = json.load(f)
                    profiles.append({
                        "name": data.get("name", fname[:-5]),
                        "description": data.get("description", ""),
                        "params": data.get("params", {}),
                        "created_at": data.get("created_at", ""),
                        "updated_at": data.get("updated_at", ""),
                    })
                except Exception:
                    continue
        return profiles

    def get_profile(self, name: str) -> Optional[dict]:
        """Get a specific profile by name."""
        path = os.path.join(self._profiles_dir, f"{name}.json")
        if not os.path.isfile(path):
            return None
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return None

    def save_profile(self, name: str, params: dict, description: str = ""):
        """Save a parameter profile."""
        path = os.path.join(self._profiles_dir, f"{name}.json")
        now = datetime.now().isoformat()
        existing = self.get_profile(name)
        data = {
            "name": name,
            "description": description,
            "params": params,
            "created_at": existing.get("created_at", now) if existing else now,
            "updated_at": now,
        }
        with self._lock:
            with open(path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)

    def delete_profile(self, name: str) -> bool:
        """Delete a parameter profile."""
        path = os.path.join(self._profiles_dir, f"{name}.json")
        if not os.path.isfile(path):
            return False
        with self._lock:
            os.remove(path)
            return True

    # ── Internal ────────────────────────────────────────────

    def _model_config_path(self, family: str) -> str:
        safe_name = family.replace("/", "_").replace("\\", "_")
        return os.path.join(self._config_dir, f"model_{safe_name}.json")

    def _default_global(self) -> dict:
        return {
            "theme": "dark",
            "language": "zh-CN",
            "backend_preference": "auto",          # auto | cuda | vulkan | sycl | cpu
            "llama_backend_dir": "",              # 用户指定的 llama-cpp 根目录（扫描起点）
            "llama_server_exe": "",               # 直接指向 llama-server.exe 的路径（优先级最高）
            "models_dir": "",                     # 用户指定的模型目录
            "default_port_range": [8080, 8099],
            "default_host": "127.0.0.1",
            "startup_behavior": "idle",           # idle | auto | last_model
            "auto_load_model": None,
            "last_loaded_model": None,
            "gpu_layers": 99,                     # 默认 -ngl
            "ctx_size": 32768,
            "threads": 0,                         # 0 = 自动
            "batch_size": 1024,
            "mmap": True,
            "mlock": False,
            "flash_attn": False,
            "cont_batching": False,
            "parallel": 1,
            "log_level": "info",
            "log_retention_days": 30,
            "api_key": "",
            "api_provider": "llama-cpp",          # llama-cpp | vLLM | Ollama | OpenAI | Custom
            "api_base_url": "",                   # 自定义上游 OpenAI 兼容 endpoint
            "auto_update_check": True,
            "telemetry": False,
            "max_startup_wait_seconds": 120,
        }
