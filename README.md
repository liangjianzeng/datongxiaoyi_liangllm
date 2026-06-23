# LiangLLM APP

> Electron + FastAPI 的本地 LLM 管理控制台。一站式集成模型服务、推理调用、对话面板、实时监控与管理配置。
> README.md 同步至 README.html · 2026-06-23

---

## 一、关于

**LiangLLM APP** 是一款面向个人/团队的本地 LLM 图形化管理工具，核心目标：

- **一个界面** 管理所有本地模型服务（llama.cpp server、后续可扩展 vLLM / Ollama / MLX 等）
- **实时可视化** 展示模型实例状态、GPU/CPU/内存占用、推理性能
- **开箱即用对话** 内置带流式响应的聊天面板，支持多实例并行
- **零云依赖** 默认完全本地运行，API 层可插拔、可离线

## 二、技术栈

- **前端**：Electron 33 · Vue 3 (Vue CDN runtime) · Element Plus · 自定义暗色 CSS Variables · 内嵌 SVG 图标
- **后端**：Python 3.11+ · FastAPI 0.110+ · Uvicorn · Pydantic v2 · httpx（流式代理）· 自动探测 llama-server
- **通信**：HTTP REST + SSE（OpenAI 兼容 `/v1/chat/completions` · `/stream`）· IPC（Electron 主进程 ↔ renderer 传 backend URL / 重启后端）
- **服务支持**：OpenAI 兼容协议；当前后端 llama.cpp server，可扩展 vLLM · Ollama · MLX · DeepEP

## 三、页面结构

主窗口分为五大面板：

- **仪表盘**：实例概览 + GPU / 系统实时指标 + 快捷操作
- **对话**：聊天面板（带系统提示词、温度/Top-P/Top-K/MaxTokens 参数折叠面板、SSE 流式输出）
- **模型管理**：加载 / 卸载 / 切换模型族，实例生命周期
- **基准测试**：内置多场景跑分与 Markdown 报告导出
- **日志 / 指标 / 配置**：滚动日志、实时推理统计、全局设置

## 四、今日变更一览（2026-06-23）

### 对话引擎（关键修复）
- 重构 `backend/chat_engine.py` 流式代理：**每次请求创建独立 `httpx.AsyncClient`**，彻底解决「第二次对话不响应」的连接池饥饿
- SSE 解析改为 `split(/\r?\n/)`，兼容 Windows `\r\n` 与 Linux `\n` 行尾
- `finally` 块强制清理 `streaming` / `streamContent` / `abortController`，防止状态泄漏
- 单飞锁：`canSend` computed 确保并发发送被阻挡

### 对话面板 UI
- 重写 `frontend/css/style.css` 对话区：消息气泡（用户侧 neon 渐变、助手侧描边）、统一 14px 字号 1.65 行高、max-width 72%、圆角 16px/4px
- 发送按钮 neon 边框 + hover 发光，滚动条 8px 暗青色
- 深色主题统一变量：`--neon-cyan #22e7ff` · `--neon-violet #9d5bff` · 输入区 padding 16px 20px
- 输入区 + 系统提示词面板不再刺眼，统一采用浅蓝暗青色调

### 前后端一体化
- `electron/main.js` 动态 backend URL：spawn `backend/server.py` 固定端口 19600（127.0.0.1），IPC `get-backend-url` 暴露给 renderer
- `frontend/js/api.js` 优先通过 IPC `window.liangllm.getBackendUrl()` 获取真实后端地址，回退到 `http://127.0.0.1:19600`
- 后端仅绑定 127.0.0.1，CORS 白名单仅本地 19600，外网无法访问
- 单文件后端 `backend/server.py`（统一入口），模块化 `chat_engine.py` / `model_manager.py` / `process_manager.py` / `metrics_collector.py` / `benchmark_runner.py` / `config_manager.py` / `logger_manager.py` / `backend_selector.py`

### 一键启动
- 根目录 `run.bat`：自动 pip venv + npm install + Electron 启动，自动清理 19600 / 8080 旧端口
- `scripts/setup-cuda.ps1`：Windows CUDA 一键环境检测脚本
- `scripts/build.js`：前端打包辅助
- `package.json` Electron Builder portable + nsis 双目标

## 五、架构总览

```
┌──────────────────────┐      IPC get-backend-url        ┌──────────────────────┐
│   Electron 主进程     │────────────────────────────────▶│  Renderer (Vue 3)     │
│   electron/main.js   │      spawn backend/server.py    │  dashboard / chat /   │
│   preload.js          │                                  │  benchmark / config   │
└──────────┬───────────┘                                  └──────────┬───────────┘
           │                                                        │
     127.0.0.1:19600                                         HTTP / SSE
           │                                                        │
           ▼                                                        ▼
                    ┌──────────────────────────────────────────────┐
                    │  backend/server.py  FastAPI 127.0.0.1:19600  │
                    │  chat_engine.py   httpx.AsyncClient proxy     │
                    │  model_manager.py  process_manager.py        │
                    │  metrics_collector.py  benchmark_runner.py   │
                    │  config_manager.py  logger_manager.py        │
                    │  backend_selector.py                         │
                    └───────────────────────┬──────────────────────┘
                                            │  OpenAI 协议 / llama.cpp
                                            ▼
                              ┌───────────────────────────────────────────┐
                              │  模型服务  llama.cpp server :8080+        │
                              │  （可扩展 vLLM · Ollama · MLX · DeepEP） │
                              └───────────────────────────────────────────┘
```

### 目录 / 模块

```
LiangLLM-App/
├── backend/                 # FastAPI 127.0.0.1:19600
│   ├── server.py             # 统一入口（1100+ 行）
│   ├── chat_engine.py        # SSE 流式代理（独立 AsyncClient 每次请求）
│   ├── model_manager.py      # 模型加载 / 卸载 / 切换族
│   ├── process_manager.py    # 进程守护 / 启停 / 端口复用
│   ├── metrics_collector.py  # 推理吞吐记录
│   ├── benchmark_runner.py  # 多场景跑分 + Markdown 导出
│   ├── config_manager.py    # 全局 / 实例 JSON 配置
│   ├── logger_manager.py     # 滚动日志
│   ├── backend_selector.py   # 自动探测 llama-server / 可用后端
│   └── requirements.txt
├── electron/
│   ├── main.js               # 主进程 + spawn backend + IPC + Tray
│   └── preload.js            # 安全桥接 window.liangllm
├── frontend/
│   ├── index.html            # Element Plus + Vue CDN runtime
│   ├── css/style.css         # 暗色主题 CSS Variables + 对话区重写
│   ├── js/api.js             # IPC 动态 backend URL 解析
│   ├── js/app.js             # 应用装配
│   └── js/components/        # 8 个 Vue 组件：
│       ├── dashboard-panel.js
│       ├── chat-panel.js
│       ├── config-panel.js
│       ├── benchmark-panel.js
│       ├── metrics-panel.js
│       ├── log-panel.js
│       └── model-manager.js
├── run.bat                   # Windows 一键启动
├── package.json              # Electron Builder
├── scripts/
│   ├── build.js
│   └── setup-cuda.ps1
└── README.md / README.html
```

## 六、核心模块说明

| 模块 | 文件 | 说明 |
| --- | --- | --- |
| FastAPI 主入口 | backend/server.py | /api/* 所有路由 + lifespan + CORS |
| 聊天引擎 | backend/chat_engine.py | 独立 AsyncClient + SSE 代理 + metrics |
| 模型管理 | backend/model_manager.py | GGUF 加载 + 族切换 |
| 进程守护 | backend/process_manager.py | 跨平台 taskkill/kill 封装 |
| 推理指标 | backend/metrics_collector.py | tokens/s · latency · 吞吐 |
| 基准测试 | backend/benchmark_runner.py | 多场景 + Markdown / JSON 导出 |
| 配置管理 | backend/config_manager.py | JSON 读写（gitignored） |
| 日志 | backend/logger_manager.py | 滚动日志面板 |
| 后端探测 | backend/backend_selector.py | 自动找 llama-server 二进制 |
| Electron 主进程 | electron/main.js | 窗口 / IPC / spawn backend / Tray |
| 安全桥 | electron/preload.js | 暴露 window.liangllm.* |
| 前端 API | frontend/js/api.js | REST + SSE，动态 backend URL |
| 聊天 UI | frontend/js/components/chat-panel.js | 模型选择 + 参数折叠 + SSE 流式 + 单飞锁 |
| 仪表盘 | dashboard-panel.js | 实例 + GPU + 系统指标 |
| 模型面板 | model-manager.js | 加载 / 卸载 |
| 基准面板 | benchmark-panel.js | 跑分 + 看报告 |
| 指标面板 | metrics-panel.js | tokens/s / 吞吐图表 |
| 日志面板 | log-panel.js | 实时日志 |
| 配置面板 | config-panel.js | 主题 / 日志等级 / 自动加载 |

## 七、主要 API 接口

| Method | Path | 说明 |
| --- | --- | --- |
| `GET` | `/api/status` | 后端状态 + 实例列表 + 配置 |
| `GET` | `/api/models` | 已注册模型族 |
| `POST` | `/api/models/load` | 加载指定模型族 |
| `POST` | `/api/models/unload` | 卸载 |
| `POST` | `/api/chat/completions` | OpenAI 兼容非流 |
| `POST` | `/api/chat/stream` | SSE 流式（ChatEngine 代理到 llama-server） |
| `GET` | `/api/metrics` | 推理指标 |
| `GET` | `/api/benchmark/tests` | 可用跑分用例 |
| `POST` | `/api/benchmark/run` | 执行跑分 |
| `GET` | `/api/benchmark/report` | 最新跑分报告 |
| `GET` | `/api/benchmark/export` | Markdown / JSON 导出 |
| `GET` | `/api/logs` | 滚动日志 |
| `POST` | `/api/logs/write` | 写日志 |

## 八、功能亮点

- **一键启动**：Windows `run.bat` 自动 pip venv + npm + Electron，清旧端口
- **流式对话（已修复）**：SSE 实时 + `\r?\n` 跨平台解析 + 独立 AsyncClient + 单飞锁，连续多轮 OK
- **参数动态调节**：系统提示词 / temperature / top_p / top_k / max_tokens，会话级折叠面板
- **仪表盘 & 监控**：实例卡片 + GPU / CPU / 内存 + 实时指标 + 跑分图表
- **基准测试**：内置多场景 + Markdown 报告下载
- **暗色主题 + 对话区重写**：neon 渐变气泡 + 浅蓝青色输入区，无刺眼白底
- **零云依赖**：仅绑定 127.0.0.1，CORS 仅本地；外网无法访问
- **可插拔后端**：统一 OpenAI 协议，llama.cpp · vLLM · Ollama · MLX · DeepEP 直接填 base_url / model

## 九、启动

### Windows（一键）
```cmd
cd LiangLLM-App
run.bat
```

### 手动
```bash
# 后端
cd backend
python -m venv venv
# Windows
venv\Scripts\activate
# macOS / Linux
source venv/bin/activate
pip install -r requirements.txt
python server.py                         # 默认 127.0.0.1:19600

# 前端（Electron）
cd ..
npm install
npm start                                 # Electron 窗口自动拉起 + spawn backend
```

### 启动本地模型示例

```bash
# llama.cpp server
llama-server.exe -m D:\models\Qwen2.5-7B-Instruct-Q4_K_M.gguf --port 8080 -ngl 99
# vLLM
python -m vllm.entrypoints.openai.api_server --model /path/to/model --port 8081
# Ollama
ollama serve &
ollama run <model-name>
```

## 十、配置（gitignored，本机私有）

全局：`config/liangllm.json`（主题 / backend_preference / 默认端口范围 / 启动行为 / 自动加载模型 / 日志等级）

实例：`config/model_*.json`（每个模型族一套：family / port / n_gpu_layers / ctx_size 等）

> 两个目录 `config/` 和 `backend/config/` 均被 `.gitignore` 屏蔽，不会被提交到 Git。

## 十一、接入其他模型服务

统一管理的关键 = **统一 OpenAI Chat Completion 协议 + 多实例配置**：

- **llama.cpp server**：当前已实现 + SSE 流式
- **vLLM**：OpenAI 兼容，支持多卡 Continuous Batching
- **Ollama**：`ollama serve` 自带 OpenAI 兼容 endpoint
- **MLX (Apple Silicon)**：`mlx-lm serve`
- **DeepEP / DeepSeek 系列**：推荐走 vLLM
- **云厂商**：OpenRouter / Together AI / DeepInfra / 智谱 / 百川，配 `api_key` 即可

## 十二、Roadmap

- Ollama / vLLM / MLX 一键模板
- 实例多会话记忆
- Prompt 模板库
- 历史对话导出
- 自动重启 & 健康检查告警
- CPU / Metal / CUDA 一键启动脚本

## 十三、License

以仓库 LICENSE 文件为准开源/私有使用；第三方依赖遵守各自许可证。
