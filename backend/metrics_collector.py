"""
metrics_collector.py — Performance Metrics Collection

Collects and aggregates inference performance metrics from the
llama-server backend. Provides historical tracking and real-time stats.
Reference: LM Studio performance stats
"""

import time
import json
import threading
from collections import deque
from typing import Dict, List, Optional
from dataclasses import dataclass, field
from datetime import datetime


@dataclass
class InferenceRecord:
    model_family: str
    tokens_generated: int
    prompt_tokens: int
    elapsed_seconds: float
    tokens_per_second: float
    timestamp: float = field(default_factory=time.time)
    temperature: float = 0.0
    max_tokens: int = 0


class MetricsCollector:
    """Collects and aggregates inference performance statistics."""

    def __init__(self, max_history: int = 1000):
        self._history: deque = deque(maxlen=max_history)
        self._session_stats: Dict[str, dict] = {}
        self._lock = threading.Lock()

    def record_inference(self, record: InferenceRecord):
        """Record a completed inference."""
        with self._lock:
            self._history.append(record)
            # Update running session stats
            fam = record.model_family
            if fam not in self._session_stats:
                self._session_stats[fam] = {
                    "total_inferences": 0,
                    "total_tokens": 0,
                    "total_prompt_tokens": 0,
                    "total_time_seconds": 0.0,
                    "max_tps": 0.0,
                    "min_tps": float('inf'),
                }
            s = self._session_stats[fam]
            s["total_inferences"] += 1
            s["total_tokens"] += record.tokens_generated
            s["total_prompt_tokens"] += record.prompt_tokens
            s["total_time_seconds"] += record.elapsed_seconds
            s["max_tps"] = max(s["max_tps"], record.tokens_per_second)
            s["min_tps"] = min(s["min_tps"], record.tokens_per_second)

    # ── Query Methods ───────────────────────────────────────

    def get_model_stats(self, family: str) -> dict:
        """Get aggregated stats for a specific model."""
        with self._lock:
            base = self._session_stats.get(family, {})
            if not base:
                return {
                    "family": family,
                    "total_inferences": 0,
                    "total_tokens": 0,
                    "avg_tps": 0,
                    "max_tps": 0,
                    "min_tps": 0,
                }
            avg_tps = (base["total_tokens"] / base["total_time_seconds"]
                       if base["total_time_seconds"] > 0 else 0)
            min_tps = base["min_tps"] if base["min_tps"] != float('inf') else 0
            return {
                "family": family,
                "total_inferences": base["total_inferences"],
                "total_tokens": base["total_tokens"],
                "total_prompt_tokens": base["total_prompt_tokens"],
                "total_time_seconds": round(base["total_time_seconds"], 2),
                "avg_tps": round(avg_tps, 2),
                "max_tps": round(base["max_tps"], 2),
                "min_tps": round(min_tps, 2),
            }

    def get_all_stats(self) -> List[dict]:
        """Get aggregated stats for all models."""
        with self._lock:
            return [self.get_model_stats(fam) for fam in self._session_stats]

    def get_recent_inferences(self, limit: int = 20) -> List[dict]:
        """Get most recent inference records."""
        with self._lock:
            records = list(self._history)[-limit:]
            return [{
                "model_family": r.model_family,
                "tokens_generated": r.tokens_generated,
                "prompt_tokens": r.prompt_tokens,
                "elapsed_seconds": round(r.elapsed_seconds, 2),
                "tokens_per_second": round(r.tokens_per_second, 2),
                "temperature": r.temperature,
                "timestamp": r.timestamp,
                "time_str": datetime.fromtimestamp(r.timestamp).strftime("%H:%M:%S"),
            } for r in records]

    def get_summary(self) -> dict:
        """Get overall summary across all models."""
        with self._lock:
            total_inf = sum(
                s["total_inferences"] for s in self._session_stats.values())
            total_tok = sum(
                s["total_tokens"] for s in self._session_stats.values())
            total_time = sum(
                s["total_time_seconds"] for s in self._session_stats.values())
            return {
                "total_inferences": total_inf,
                "total_tokens": total_tok,
                "total_time_seconds": round(total_time, 2),
                "avg_tps_all": round(total_tok / total_time, 2) if total_time > 0 else 0,
                "model_count": len(self._session_stats),
                "active_models": list(self._session_stats.keys()),
            }

    def reset(self):
        """Reset all collected metrics."""
        with self._lock:
            self._history.clear()
            self._session_stats.clear()
