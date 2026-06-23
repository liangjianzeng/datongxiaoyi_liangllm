/**
 * system-panel.js — 系统设置面板
 *
 * 覆盖范围:
 *  1. 基础环境 (后端引擎目录/模型目录/llama-server.exe)
 *  2. 硬件与 GPU (后端引擎偏好/自动扫描)
 *  3. 推理默认参数 (ngl/ctx/threads/batch/mmap/mlock 等)
 *  4. 上游 OpenAI 兼容服务 (vLLM/Ollama/OpenAI/Custom)
 *  5. 应用行为 (主题/语言/启动方式/日志保留/遥测)
 *  6. 系统信息仪表盘 (平台/CPU/内存/磁盘/GPU 实时)
 */

const CATEGORIES = [
  { key: "env",         label: "基础环境",  icon: "FolderOpened" },
  { key: "hardware",    label: "硬件与引擎", icon: "Cpu" },
  { key: "defaults",    label: "推理默认值", icon: "Setting" },
  { key: "upstream",    label: "上游服务",  icon: "Connection" },
  { key: "behavior",    label: "应用行为",  icon: "Monitor" },
  { key: "about",       label: "系统信息",  icon: "InfoFilled" },
];

const SystemPanel = {
  name: "SystemPanel",
  props: {
    globalConfig: Object,
  },
  emits: ["save-global-config"],
  template: `
    <div class="system-panel">
      <div class="system-header">
        <div>
          <h2 style="font-size:22px; font-weight:600; margin:0;">系统设置</h2>
          <div class="system-sub">底层路径、引擎偏好、默认推理参数与上游服务</div>
        </div>
        <div class="system-actions">
          <el-button type="primary" :loading="saving" @click="saveAll">
            保存设置
          </el-button>
          <el-button @click="resetAll">恢复默认</el-button>
        </div>
      </div>

      <div class="system-layout">
        <div class="system-side">
          <div
            v-for="c in categories" :key="c.key"
            class="system-side-item"
            :class="{ active: activeCat === c.key }"
            @click="activeCat = c.key"
          >
            <el-icon><component :is="c.icon" /></el-icon>
            <span>{{ c.label }}</span>
          </div>
        </div>

        <div class="system-content">
          <!-- 基础环境 -->
          <div v-show="activeCat === 'env'" class="system-section">
            <el-card>
              <template #header>
                <div class="sec-hd"><el-icon><FolderOpened /></el-icon>基础环境路径</div>
              </template>
              <el-form label-width="128px" :model="state" @submit.prevent>
                <el-form-item label="LLAMA 引擎目录">
                  <div class="path-row">
                    <el-input v-model="state.llama_backend_dir" placeholder="例如 D:\\llama.cpp 或 E:\\tools\\llama-cpp-cuda" />
                    <el-button @click="pickLlamaDir">选择</el-button>
                    <el-button @click="clearField('llama_backend_dir')" plain>清空</el-button>
                  </div>
                  <div class="hint">指定 llama-cpp 源码/构建根目录，系统会递归扫描子目录找 llama-server.exe。留空则走自动探测。</div>
                </el-form-item>

                <el-form-item label="LLAMA Server EXE">
                  <div class="path-row">
                    <el-input v-model="state.llama_server_exe" placeholder="直接指向某个 llama-server.exe（优先级最高）" />
                    <el-button @click="pickLlamaExe">选择 EXE</el-button>
                    <el-button @click="clearField('llama_server_exe')" plain>清空</el-button>
                  </div>
                  <div class="hint">直接指定 exe 路径，优先于目录扫描。支持 llama-server.exe / llama-server / server。</div>
                </el-form-item>

                <el-form-item label="模型目录">
                  <div class="path-row">
                    <el-input v-model="state.models_dir" :placeholder="modelDirHint" />
                    <el-button @click="pickModelsDir">选择</el-button>
                    <el-button @click="scanModelsNow" :loading="scanning">立即扫描</el-button>
                  </div>
                  <div class="hint">放置 .gguf 模型文件的目录。首次启动会默认建一个 LiangLLM/models。</div>
                  <div v-if="scanResult" class="scan-result">
                    <el-tag type="success" size="small">
                      发现 {{ scanResult.files_count }} 个 GGUF / {{ scanResult.families_count }} 个模型族
                    </el-tag>
                    <div v-if="scanResult.families" class="family-chips">
                      <el-tag v-for="f in scanResult.families.slice(0, 12)" :key="f" size="small" class="chip">{{ f }}</el-tag>
                    </div>
                  </div>
                </el-form-item>
              </el-form>
            </el-card>

            <el-card style="margin-top:16px;">
              <template #header>
                <div class="sec-hd"><el-icon><InfoFilled /></el-icon>自动探测到的后端</div>
              </template>
              <div v-if="backendList.length">
                <div v-for="b in backendList" :key="b.server_path + b.root_dir" class="backend-row">
                  <div class="backend-left">
                    <el-tag :type="b.available ? 'success' : 'info'" size="small">{{ b.label }}</el-tag>
                    <div class="backend-path">
                      <div>type: {{ b.kind }} · available: {{ b.available ? 'yes' : 'no' }}</div>
                      <div v-if="b.server_path" class="backend-path-p">{{ b.server_path }}</div>
                      <div v-if="b.root_dir" class="backend-path-p hint">root: {{ b.root_dir }}</div>
                    </div>
                  </div>
                  <div class="backend-gpus" v-if="b.gpu_devices && b.gpu_devices.length">
                    <el-tag v-for="(g,i) in b.gpu_devices" :key="i" size="small" type="warning">{{ g }}</el-tag>
                  </div>
                </div>
              </div>
              <el-empty v-else description="未发现 llama-server 后端，可手动指定。" />
              <el-button style="margin-top:12px;" @click="rescan">重新扫描引擎</el-button>
            </el-card>
          </div>

          <!-- 硬件与引擎 -->
          <div v-show="activeCat === 'hardware'" class="system-section">
            <el-card>
              <template #header>
                <div class="sec-hd"><el-icon><Cpu /></el-icon>引擎偏好</div>
              </template>
              <el-form label-width="128px" :model="state">
                <el-form-item label="引擎偏好">
                  <el-select v-model="state.backend_preference" style="width:260px;">
                    <el-option label="自动（CUDA > Vulkan > SYCL > CPU）" value="auto" />
                    <el-option label="NVIDIA CUDA" value="cuda" />
                    <el-option label="Intel Vulkan" value="vulkan" />
                    <el-option label="Intel SYCL" value="sycl" />
                    <el-option label="仅 CPU" value="cpu" />
                  </el-select>
                  <div class="hint">自动选择会根据可用硬件挑最好的。如果你装了多个后端，可手动锁定。</div>
                </el-form-item>
              </el-form>
            </el-card>
          </div>

          <!-- 推理默认值 -->
          <div v-show="activeCat === 'defaults'" class="system-section">
            <el-card>
              <template #header>
                <div class="sec-hd"><el-icon><Setting /></el-icon>全局默认推理参数</div>
              </template>
              <el-form label-width="140px" :model="state">
                <el-row :gutter="12">
                  <el-col :span="12">
                    <el-form-item label="GPU 层数 (-ngl)">
                      <el-input-number v-model.number="state.gpu_layers" :min="-1" :max="99" />
                    </el-form-item>
                    <el-form-item label="上下文 (-c)">
                      <el-input-number v-model.number="state.ctx_size" :min="512" :max="131072" :step="1024" />
                    </el-form-item>
                    <el-form-item label="Batch 大小 (-b)">
                      <el-input-number v-model.number="state.batch_size" :min="64" :max="4096" />
                    </el-form-item>
                    <el-form-item label="CPU 线程">
                      <el-input-number v-model.number="state.threads" :min="0" :max="64" />
                      <div class="hint">0 = 自动</div>
                    </el-form-item>
                  </el-col>
                  <el-col :span="12">
                    <el-form-item label="KV Cache (K)">
                      <el-select v-model="state.cache_type_k">
                        <el-option v-for="o in cacheKVOps" :key="o" :label="o" :value="o" />
                      </el-select>
                    </el-form-item>
                    <el-form-item label="并行请求数">
                      <el-input-number v-model.number="state.parallel" :min="1" :max="8" />
                    </el-form-item>
                    <el-form-item>
                      <el-checkbox v-model="state.mmap">Memory Map (-ngl 时更省内存)</el-checkbox>
                    </el-form-item>
                    <el-form-item>
                      <el-checkbox v-model="state.mlock">锁定内存 (防 swap)</el-checkbox>
                    </el-form-item>
                    <el-form-item>
                      <el-checkbox v-model="state.flash_attn">Flash Attention (更快 GPU)</el-checkbox>
                    </el-form-item>
                    <el-form-item>
                      <el-checkbox v-model="state.cont_batching">Continuous Batching</el-checkbox>
                    </el-form-item>
                  </el-col>
                </el-row>
              </el-form>
            </el-card>
          </div>

          <!-- 上游服务 -->
          <div v-show="activeCat === 'upstream'" class="system-section">
            <el-card>
              <template #header>
                <div class="sec-hd"><el-icon><Connection /></el-icon>上游 OpenAI 兼容服务</div>
              </template>
              <el-form label-width="128px" :model="state">
                <el-form-item label="服务提供方">
                  <el-select v-model="state.api_provider" style="width:260px;">
                    <el-option label="llama.cpp server (本地)" value="llama-cpp" />
                    <el-option label="vLLM / sglang / LMDeploy" value="vllm" />
                    <el-option label="Ollama" value="ollama" />
                    <el-option label="MLX / Apple Silicon" value="mlx" />
                    <el-option label="DeepSeek / DeepEP" value="deepsleep" />
                    <el-option label="OpenAI 官方 / OpenRouter / Together" value="openai" />
                    <el-option label="自定义" value="custom" />
                  </el-select>
                </el-form-item>

                <el-form-item label="自定义 Base URL">
                  <el-input v-model="state.api_base_url" placeholder="https://api.openai.com 或 http://127.0.0.1:8000" />
                </el-form-item>

                <el-form-item label="API Key">
                  <el-input v-model="state.api_key" show-password placeholder="sk-... 或留空" />
                </el-form-item>

                <el-form-item>
                  <el-button type="primary" :loading="testing" @click="testUpstream">测试上游连通性</el-button>
                  <span style="margin-left:12px; color:var(--text-muted); font-size:12px;" v-if="upstreamTest">
                    {{ upstreamTest.ok ? ('OK · 模型数: ' + upstreamTest.models_count) : ('FAIL · ' + upstreamTest.error) }}
                  </span>
                </el-form-item>
              </el-form>
            </el-card>
          </div>

          <!-- 应用行为 -->
          <div v-show="activeCat === 'behavior'" class="system-section">
            <el-card>
              <template #header>
                <div class="sec-hd"><el-icon><Monitor /></el-icon>应用行为</div>
              </template>
              <el-form label-width="140px" :model="state">
                <el-form-item label="主题">
                  <el-radio-group v-model="state.theme">
                    <el-radio-button label="dark">暗色</el-radio-button>
                    <el-radio-button label="light">亮色</el-radio-button>
                  </el-radio-group>
                </el-form-item>

                <el-form-item label="启动方式">
                  <el-radio-group v-model="state.startup_behavior">
                    <el-radio-button label="idle">空闲</el-radio-button>
                    <el-radio-button label="auto">自动加载</el-radio-button>
                    <el-radio-button label="last_model">恢复上次</el-radio-button>
                  </el-radio-group>
                </el-form-item>

                <el-form-item label="日志等级">
                  <el-select v-model="state.log_level" style="width:160px;">
                    <el-option v-for="l in ['debug','info','warn','error']" :key="l" :label="l" :value="l" />
                  </el-select>
                </el-form-item>

                <el-form-item label="日志保留天数">
                  <el-input-number v-model.number="state.log_retention_days" :min="7" :max="365" />
                </el-form-item>

                <el-form-item>
                  <el-checkbox v-model="state.auto_update_check">启动时检查更新</el-checkbox>
                </el-form-item>
                <el-form-item>
                  <el-checkbox v-model="state.telemetry">匿名遥测（崩溃/错误上报）</el-checkbox>
                </el-form-item>
              </el-form>
            </el-card>
          </div>

          <!-- 系统信息 -->
          <div v-show="activeCat === 'about'" class="system-section">
            <el-card>
              <template #header>
                <div class="sec-hd"><el-icon><InfoFilled /></el-icon>系统信息</div>
              </template>
              <el-button @click="refreshInfo">刷新</el-button>
              <el-empty v-if="!info" description="点击刷新获取系统信息" />
              <div v-else class="info-grid">
                <div class="info-kv">
                  <el-tag type="info">平台</el-tag> <span>{{ info.platform }}</span>
                </div>
                <div class="info-kv">
                  <el-tag type="info">Python</el-tag> <span>{{ info.python }}</span>
                </div>
                <div class="info-kv">
                  <el-tag type="warning">CPU</el-tag> <span>{{ info.cpu.count }} 线程</span>
                </div>
                <div class="info-kv">
                  <el-tag type="warning">内存</el-tag>
                  <span>{{ info.memory.available_mb }} / {{ info.memory.total_mb }} MB ({{ info.memory.percent }}%)</span>
                </div>
                <div class="info-kv">
                  <el-tag type="warning">磁盘</el-tag>
                  <span>{{ info.disk.free_gb }} / {{ info.disk.total_gb }} GB ({{ info.disk.percent }}%)</span>
                </div>
                <div class="info-kv">
                  <el-tag type="success">应用根</el-tag>
                  <span class="hint2">{{ info.app.root }}</span>
                </div>
                <div class="info-kv">
                  <el-tag type="success">引擎目录</el-tag>
                  <span class="hint2">{{ info.app.backend_dir }}</span>
                </div>
                <div class="info-kv">
                  <el-tag type="success">配置目录</el-tag>
                  <span class="hint2">{{ info.app.config_dir }}</span>
                </div>
                <div class="info-kv">
                  <el-tag type="success">日志目录</el-tag>
                  <span class="hint2">{{ info.app.log_dir }}</span>
                </div>
                <div class="info-kv">
                  <el-tag type="success">模型目录</el-tag>
                  <span class="hint2">{{ info.models_dir }}</span>
                  <el-tag size="small" style="margin-left:8px;">{{ info.models_scan.files_count }} 文件 / {{ info.models_scan.families_count }} 族</el-tag>
                </div>

                <div class="info-kv">
                  <el-tag type="primary">选中引擎</el-tag>
                  <span>{{ info.llama_backend.picked.label }}
                    {{ info.llama_backend.picked.available ? '✓' : '✗' }}
                  </span>
                </div>
                <div v-if="info.llama_backend.picked.server_path" class="info-kv">
                  <el-tag type="primary">Engine EXE</el-tag>
                  <span class="hint2">{{ info.llama_backend.picked.server_path }}</span>
                </div>

                <div class="info-gpus">
                  <template v-if="info.gpu && info.gpu.length">
                    <div class="gpu-title">NVIDIA GPU (nvidia-smi)</div>
                    <div v-for="g in info.gpu" :key="g.index" class="gpu-row">
                      <el-tag type="success">{{ g.name }}</el-tag>
                      <span>显存 {{ (g.mem_total_mb/1024).toFixed(1) }} GB · 空闲 {{ (g.mem_free_mb/1024).toFixed(1) }} GB · {{ g.util_pct }}% 占用</span>
                    </div>
                  </template>
                  <template v-else>
                    <div class="gpu-title">NVIDIA GPU</div>
                    <div class="hint">未检测到 nvidia-smi（可能是 Intel / AMD / Apple 平台）</div>
                  </template>
                </div>
              </div>
            </el-card>
          </div>
        </div>
      </div>
    </div>
  `,
  data() {
    return {
      activeCat: "env",
      saving: false,
      scanning: false,
      testing: false,
      info: null,
      backendList: [],
      scanResult: null,
      upstreamTest: null,
      cacheKVOps: ["f16", "q8_0", "q4_0", "q4_1"],
      state: this._defaults(),
    };
  },
  watch: {
    globalConfig: {
      immediate: true,
      deep: true,
      handler(v) { this.state = { ...this._defaults(), ...(v || {}) }; },
    },
  },
  methods: {
    _defaults() {
      return {
        theme: "dark", language: "zh-CN",
        backend_preference: "auto",
        llama_backend_dir: "",
        llama_server_exe: "",
        models_dir: "",
        default_port_range: [8080, 8099],
        default_host: "127.0.0.1",
        startup_behavior: "idle",
        auto_load_model: null,
        last_loaded_model: null,
        gpu_layers: 99,
        ctx_size: 32768,
        threads: 0,
        batch_size: 1024,
        cache_type_k: "q8_0",
        cache_type_v: "q8_0",
        parallel: 1,
        mmap: true,
        mlock: false,
        flash_attn: false,
        cont_batching: false,
        log_level: "info",
        log_retention_days: 30,
        api_key: "",
        api_provider: "llama-cpp",
        api_base_url: "",
        auto_update_check: true,
        telemetry: false,
        max_startup_wait_seconds: 120,
      };
    },

    get modelDirHint() {
      if (this.state.models_dir) return this.state.models_dir;
      return "留空将使用默认 LiangLLM/models";
    },

    pickLlamaDir() {
      this._pick("llama_backend_dir", { title: "选择 llama-cpp 构建根目录" });
    },
    pickLlamaExe() {
      this._pickFile("llama_server_exe", {
        title: "选择 llama-server.exe",
        filters: [{ name: "可执行文件", extensions: ["exe", "sh", "cmd", "bat"] }],
      });
    },
    pickModelsDir() {
      this._pick("models_dir", { title: "选择模型目录（.gguf）" });
    },
    _pick(key, opts) {
      if (!window.liangllm || !window.liangllm.selectFolder) {
        ElementPlus.ElMessage.warning("仅桌面端可打开系统文件对话框，请手动输入路径");
        return;
      }
      window.liangllm.selectFolder(opts).then((r) => {
        if (r && r.ok) { this.state[key] = r.path; }
      });
    },
    _pickFile(key, opts) {
      if (!window.liangllm || !window.liangllm.selectFile) {
        ElementPlus.ElMessage.warning("仅桌面端可打开系统文件对话框，请手动输入路径");
        return;
      }
      window.liangllm.selectFile(opts).then((r) => {
        if (r && r.ok) { this.state[key] = r.path; }
      });
    },
    clearField(key) { this.state[key] = ""; },

    async scanModelsNow() {
      this.scanning = true;
      try {
        const body = { models_dir: this.state.models_dir || undefined };
        const r = await LiangApi._fetch("/api/system/scan-models", { method: "POST", body });
        this.scanResult = r;
        if (r.ok) ElementPlus.ElMessage.success(`扫描完成：${r.files_count} 文件 / ${r.families_count} 族`);
        else ElementPlus.ElMessage.error(r.error || "扫描失败");
      } finally { this.scanning = false; }
    },

    async rescan() {
      try {
        const r = await LiangApi._fetch("/api/system/scan-backends", { method: "POST", body: {} });
        this.backendList = r.all_backends || [];
        ElementPlus.ElMessage.success(`发现 ${this.backendList.length} 个可用后端`);
      } catch (e) { ElementPlus.ElMessage.error(String(e)); }
    },

    async testUpstream() {
      this.testing = true;
      try {
        const r = await LiangApi._fetch("/api/system/test-upstream", {
          method: "POST",
          body: {
            base_url: this.state.api_base_url,
            api_key: this.state.api_key,
            provider: this.state.api_provider,
          },
        });
        this.upstreamTest = r;
      } finally { this.testing = false; }
    },

    async refreshInfo() {
      try {
        const r = await LiangApi._fetch("/api/system/info");
        this.info = r;
        this.backendList = r.llama_backend.all_backends || [];
        if (r.models_scan) this.scanResult = r.models_scan;
      } catch (e) { ElementPlus.ElMessage.error(String(e)); }
    },

    async saveAll() {
      this.saving = true;
      try {
        await LiangApi.saveGlobalConfig(this.state);
        ElementPlus.ElMessage.success("设置已保存");
        this.$emit("save-global-config", { ...this.state });
      } catch (e) { ElementPlus.ElMessage.error(String(e)); }
      finally { this.saving = false; }
    },

    async resetAll() {
      try {
        const r = await LiangApi._fetch("/api/system/reset-config", { method: "POST", body: {} });
        this.state = { ...this._defaults(), ...r.config };
        ElementPlus.ElMessage.info("已恢复默认");
      } catch (e) {
        this.state = { ...this._defaults() };
        ElementPlus.ElMessage.info("已在前端恢复默认，保存生效");
      }
    },
  },
};

window.SystemPanel = SystemPanel;
