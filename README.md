# LiangLLM APP

> Electron + FastAPI 的本地 LLM 管理控制台。一站式集成模型服务、推理调用、对话面板、实时监控与管理配置。
> README.md 同步至 README.html · 2026-04-24

---

## 一、关于

**LiangLLM APP** 是一款面向个人/团队的本地 LLM 图形化管理工具，核心目标：

- **一个界面** 管理所有本地模型服务（llama.cpp server、后续可扩展 vLLM / Ollama / MLX 等）
- **实时可视化** 展示模型实例状态、GPU/CPU/内存占用、推理性能
- **开箱即用对话** 内置带流式响应的聊天面板，支持多实例并行
- **零云依赖** 默认完全本地运行，API 层可插拔、可离线

## 二、技术栈

- **前端**：Electron 28 · Vue 3 (Vue CDN runtime) · Element Plus · 自定义暗色 CSS Variables · 内嵌 SVG 图标
- **后端**：Python 3.10+ · FastAPI 0.110+ · Pydantic v2 · 自动探测 llama-server
- **通信**：HTTP REST + SSE（`/v1/chat/completions` / stream）· IPC（Electron 主进程 ↔ renderer ↔ backend）
- **服务支持**：OpenAI 兼容协议；目标后端为 llama.cpp server · vLLM · Ollama · MLX · DeepEP

## 三、页面结构

主窗口分为四大区：

- **仪表盘**：实例卡片 + GPU / 系统实时指标 + 快捷操作
- **对话**：按实例管理的对话面板（带参数调节 & 流式输出）
- **设置 / 实例管理**：全局配置 + 实例增删改 + 进程管理
- **日志区**：滚动日志面板

## 四、今日变更一览（2026-04-24）

### 对话面板
- 重构 `chat-panel.js` 模板 + `style.css` 对话区
- 浮动发送按钮（输入框右下），模型选择 / 参数按钮（齿轮）/ 新会话按钮
- 参数折叠面板：系统提示词 + 温度 / Top-P / Top-K / MaxTokens；关闭时折叠为一行按钮
- 全局暗色 CSS 变量覆盖，Element Plus 组件 + e-panel + 状态 Tag 统一风格

### 仪表盘 & 实例卡
- 重写 `instance-card.js`：卡片布局、状态徽章、快捷按钮
- 新增 el-card 详细信息弹窗（端口、模型、ctx、N_GPU、Batch、性能）
- GPU 单卡进度条 + 显存条 + 使用率
- 刷新 / 重置 / 停止 按实例拆分

### 设置 & 实例管理
- `settings-panel.js` + `backend.js`：实例列表、添加、编辑、删除
- 动态端口（默认 8080, 8081...）、启动命令、进程启停
- 进程管理（tasklist / taskkill 或 *nix kill），可独立重启单实例
- FastAPI 统一入口：`POST /instances`、`DELETE /instances/{id}` 等

### README
- README.md 与 README.html 对齐
- 新增「其他模型服务接入」章节（vLLM / Ollama / MLX / DeepEP / OpenAI 兼容）
- 更新 API 列表、待办、页面结构

## 五、架构总览

```
┌──────────────────────┐     ┌───────────────────────┐     ┌──────────────────────┐
│   Electron 主进程     │────▶│   Renderer (Vue 3)     │────▶│   FastAPI backend    │
│ main.js               │     │ dashboard / chat /    │     │ app/main.py          │
│                       │     │ settings              │     │ routers/*.py         │
└──────────────────────┘     └───────────────────────┘     └─────────┬────────────┘
                                                                      │
                                                           OpenAI 协议  │
                                                                      ▼
                                       ┌──────────────────────────────────────────────┐
                                       │ 模型服务集群                                  │
                                       │ llama.cpp server · vLLM · Ollama · MLX ...   │
                                       └──────────────────────────────────────────────┘
```

### 目录 / 模块

- **前端**：`frontend/index.html` · `frontend/js/api.js` · `frontend/css/style.css` · `frontend/js/components/dashboard-panel.js` / `chat-panel.js` / `settings-panel.js` / `instance-card.js` / `gpu-panel.js` / `system-panel.js`
- **后端**：`backend/app/main.py` · `routers/instances.py` · `routers/chat.py` · `routers/system.py` · `services/llama_runner.py` · `gpu_monitor.py` · `process_manager.py`

## 六、核心模块说明

| 模块 | 说明 |
| --- | --- |
| Electron 主进程 | 窗口、生命周期、IPC、环境检测 |
| Dashboard | 实例卡片 + GPU 可视化 + 系统指标 + el-dialog 详情 |
| Chat Panel | 模型选择 + 系统提示词 + 温度/TopP/TopK/MaxTokens + SSE 流式 + Markdown 渲染 |
| Settings | 全局设置（日志等级、默认 prompt、API 地址）+ 实例增删改 + 启停 |
| Process Manager | 跨平台进程守护、tasklist / taskkill / kill 封装 |
| GPU Monitor | nvidia-smi / Metal 探测，实时显存/使用率/温度/功耗 |

## 七、主要 API 接口

| Method | Path | 说明 |
| --- | --- | --- |
| `GET` | `/health` | 后端健康检查 |
| `GET` | `/instances` | 列出所有实例 |
| `POST` | `/instances` | 新增实例 |
| `DELETE` | `/instances/{id}` | 删除实例 |
| `POST` | `/instances/{id}/start` | 启动实例进程 |
| `POST` | `/instances/{id}/stop` | 停止实例进程 |
| `POST` | `/chat/completions` | 标准 Chat Completion（非流） |
| `POST` | `/chat/completions/stream` | SSE 流式 Chat Completion |
| `GET` | `/system/gpu` | GPU 实时指标 |
| `GET` | `/system/info` | 系统信息 |

## 八、功能亮点

- **多实例管理**：并行多个 llama.cpp server（或其他 OpenAI 兼容服务），不同模型、端口、进程。
- **统一 OpenAI 兼容入口**：底层可为 llama.cpp / vLLM / Ollama / MLX，上层统一走 `/v1/chat/completions`。
- **流式对话**：SSE 实时输出 + Markdown 渲染 + 代码块高亮。
- **参数动态调节**：系统提示词、temperature、top_p、top_k、max_tokens，会话级。
- **仪表盘 & 监控**：卡片化实例 + GPU 单卡进度条 + 系统内存 / CPU。
- **暗色主题 + 模块化组件**：CSS Variables + Element Plus。
- **可插拔后端**：实例 `type` 不同（`llama.cpp` / `vllm` / `ollama` / `openai`），只需统一协议。

## 九、启动

```bash
git clone <this repo>
cd LiangLLM-App

# 后端
cd backend
python -m venv .venv
# Windows PowerShell:
.\.venv\Scripts\Activate.ps1
# macOS/Linux:
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 127.0.0.1 --port 8765 --reload

# 前端
npm install
npm start
```

启动本地模型示例：

```bash
# macOS (Metal)
./llama-server -m /path/to/model.gguf --port 8080 -ngl 99

# Windows (CUDA / CPU 可选)
llama-server.exe -m D:\models\model.gguf --port 8080 -ngl 99

# vLLM
python -m vllm.entrypoints.openai.api_server --model /path/to/model --port 8081

# Ollama
ollama serve &
ollama run <model-name>
```

## 十、配置（全局 / 实例）

全局默认值保存在 Electron 用户目录 `config.json`，实例通过「设置」Tab 编辑。每个实例至少包含：

- `name`、`family`、`type`（`llama.cpp` / `vllm` / `ollama` / `openai`）
- `base_url`（OpenAI 兼容地址，如 `http://127.0.0.1:8080/v1`）
- `model`、`port`、`ctx_size`、`batch_size`、`n_gpu_layers`
- `command`、`extra_args`（可选，用于启动进程）

## 十一、使用说明

1. **添加实例**：「设置 / 实例管理」→ 添加实例 → 选择 type / port / model → 保存后启动。
2. **查看仪表盘**：首页拉取所有实例 + GPU + 系统指标，点击实例卡查看详情。
3. **对话**：「对话」Tab → 选择实例模型 → 设置系统提示词 + 参数 → 发送。
4. **管理进程**：实例卡或设置中的 ▶/⏹ 按钮，底层走 process_manager。

## 十二、接入其他模型服务

统一管理的关键 = **统一 OpenAI Chat Completion 协议 + 多实例配置**：

- **llama.cpp server**：`http://127.0.0.1:8080/v1`，已实现 + SSE 流式。
- **vLLM**：OpenAI 兼容，支持多卡 Continuous Batching；新增 `type=vllm`，后端走同一 Chat Completion 路由。
- **Ollama**：`ollama serve` 自带 OpenAI 兼容 endpoint；在实例中填 Ollama base_url / model 即可。
- **MLX (Apple Silicon)**：`mlx-lm serve` 或 `mlx-server`，Mac 本地推理。
- **DeepEP / DeepSeek 系列**：推荐走 vLLM 或官方推理服务。
- **云厂商**：OpenRouter / Together AI / DeepInfra / 智谱 / 百川，配 `type=openai` + `api_key`。

> 结论：任何实现 OpenAI Chat Completion 协议的服务，都可以作为 LiangLLM APP 的后端。

## 十三、待办 / Roadmap

- 支持 Ollama / vLLM / MLX 一键模板（自动填 base_url / model / 命令）
- 实例多会话记忆
- Prompt 模板库（预设 + 用户自定义）
- 历史对话导出（Markdown / JSON）
- 多用户 / 远程访问（反向代理 + token）
- 自动重启 & 健康检查告警
- CPU / Metal / CUDA 启动脚本一键生成

## 十四、License

以仓库 LICENSE 文件为准开源/私有使用；第三方依赖遵守各自许可证。
