/**
 * api.js — HTTP API for LiangLLM backend.
 *
 * Prefers Electron IPC window.liangllm.getBackendUrl() when available.
 * Falls back to http://127.0.0.1:19600 (dev mode / static server).
 */

let _apiBase = "http://127.0.0.1:19600";

if (typeof window !== "undefined" && window.liangllm && typeof window.liangllm.getBackendUrl === "function") {
  try {
    const url = window.liangllm.getBackendUrl();
    if (typeof url === "string" && url.trim()) _apiBase = url.trim();
  } catch {}
}

const API_BASE = _apiBase;

window.LiangApi = {
  _fetch(path, options = {}) {
    const url = `${API_BASE}${path}`;
    const config = {
      headers: { "Content-Type": "application/json", ...options.headers },
      ...options,
    };
    if (config.body && typeof config.body === "object") {
      config.body = JSON.stringify(config.body);
    }
    return fetch(url, config).then((resp) => {
      if (!resp.ok) {
        return resp.text().then((text) => {
          let detail = text;
          try { const j = JSON.parse(text); detail = j.detail || j.error || text; } catch {}
          throw new Error(detail || `HTTP ${resp.status}`);
        });
      }
      return resp.json();
    });
  },

  getApiBase() { return API_BASE; },

  getStatus()         { return this._fetch("/api/status"); },
  getBackends()       { return this._fetch("/api/backends"); },
  listInstances()     { return this._fetch("/api/instances"); },
  listModels()        { return this._fetch("/api/models"); },

  getModelParams(family) {
    return this._fetch(`/api/models/${encodeURIComponent(family)}/params`);
  },

  loadModel(family, params = null, port = null) {
    return this._fetch("/api/models/load", { method: "POST", body: { family, params, port } });
  },

  unloadModel(family) {
    return this._fetch("/api/models/unload", { method: "POST", body: { family } });
  },

  unloadAllModels() {
    return this._fetch("/api/models/unload_all", { method: "POST" });
  },

  getGlobalConfig()   { return this._fetch("/api/config"); },
  saveGlobalConfig(c) { return this._fetch("/api/config", { method: "POST", body: c }); },
  listProfiles()      { return this._fetch("/api/profiles"); },

  saveProfile(name, params, description = "") {
    return this._fetch("/api/profiles", { method: "POST", body: { name, params, description } });
  },

  deleteProfile(name) {
    return this._fetch(`/api/profiles/${encodeURIComponent(name)}`, { method: "DELETE" });
  },

  chatCompletion(model, messages, params = {}) {
    return this._fetch("/api/chat", { method: "POST", body: { model, messages, ...params } });
  },

  chatStream(model, messages, params = {}, signal) {
    const url = `${API_BASE}/api/chat/stream`;
    const body = JSON.stringify({ model, messages, ...params });
    const fetchOpts = { method: "POST", headers: { "Content-Type": "application/json" }, body };
    if (signal) fetchOpts.signal = signal;
    return fetch(url, fetchOpts);
  },

  getMetrics()       { return this._fetch("/api/metrics"); },
  resetMetrics()     { return this._fetch("/api/metrics/reset", { method: "POST" }); },

  runBenchmark(family, params = {}) {
    return this._fetch("/api/benchmark", { method: "POST", body: { family, ...params } });
  },

  getBenchmarkReport(taskId) { return this._fetch(`/api/benchmark/${encodeURIComponent(taskId)}`); },
  listBenchmarks()     { return this._fetch("/api/benchmarks"); },
  getLog(tail = 200)   { return this._fetch(`/api/log?tail=${tail}`); },
};