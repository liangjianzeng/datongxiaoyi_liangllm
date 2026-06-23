/**
 * system-panel.js 鈥?绯荤粺璁剧疆闈㈡澘
 *
 * 瑕嗙洊鑼冨洿:
 *  1. 鍩虹鐜 (鍚庣寮曟搸鐩綍/妯″瀷鐩綍/llama-server.exe)
 *  2. 纭欢涓?GPU (鍚庣寮曟搸鍋忓ソ/鑷姩鎵弿)
 *  3. 鎺ㄧ悊榛樿鍙傛暟 (ngl/ctx/threads/batch/mmap/mlock 绛?
 *  4. 涓婃父 OpenAI 鍏煎鏈嶅姟 (vLLM/Ollama/OpenAI/Custom)
 *  5. 搴旂敤琛屼负 (涓婚/璇█/鍚姩鏂瑰紡/鏃ュ織淇濈暀/閬ユ祴)
 *  6. 绯荤粺淇℃伅浠〃鐩?(骞冲彴/CPU/鍐呭瓨/纾佺洏/GPU 瀹炴椂)
 */

const CATEGORIES = [
  { key: "env",         label: "鍩虹鐜",  icon: "FolderOpened" },
  { key: "hardware",    label: "纭欢涓庡紩鎿?, icon: "Cpu" },
  { key: "defaults",    label: "鎺ㄧ悊榛樿鍊?, icon: "Setting" },
  { key: "upstream",    label: "涓婃父鏈嶅姟",  icon: "Connection" },
  { key: "behavior",    label: "搴旂敤琛屼负",  icon: "Monitor" },
  { key: "about",       label: "绯荤粺淇℃伅",  icon: "InfoFilled" },
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
          <h2 style="font-size:22px; font-weight:600; margin:0;">绯荤粺璁剧疆</h2>
          <div class="system-sub">搴曞眰璺緞銆佸紩鎿庡亸濂姐€侀粯璁ゆ帹鐞嗗弬鏁颁笌涓婃父鏈嶅姟</div>
        </div>
        <div class="system-actions">
          <el-button type="primary" :loading="saving" @click="saveAll">
            淇濆瓨璁剧疆
          </el-button>
          <el-button @click="resetAll">鎭㈠榛樿</el-button>
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
          <!-- 鍩虹鐜 -->
          <div v-show="activeCat === 'env'" class="system-section">
            <el-card>
              <template #header>
                <div class="sec-hd"><el-icon><FolderOpened /></el-icon>鍩虹鐜璺緞</div>
              </template>
              <el-form label-width="128px" :model="state" @submit.prevent>
                <el-form-item label="LLAMA 寮曟搸鐩綍">
                  <div class="path-row">
                    <el-input v-model="state.llama_backend_dir" placeholder="渚嬪 D:\\llama.cpp 鎴?E:\\tools\\llama-cpp-cuda" />
                    <el-button @click="pickLlamaDir">閫夋嫨</el-button>
                    <el-button @click="clearField('llama_backend_dir')" plain>娓呯┖</el-button>
                  </div>
                  <div class="hint">鎸囧畾 llama-cpp 婧愮爜/鏋勫缓鏍圭洰褰曪紝绯荤粺浼氶€掑綊鎵弿瀛愮洰褰曟壘 llama-server.exe銆傜暀绌哄垯璧拌嚜鍔ㄦ帰娴嬨€?/div>
                </el-form-item>

                <el-form-item label="LLAMA Server EXE">
                  <div class="path-row">
                    <el-input v-model="state.llama_server_exe" placeholder="鐩存帴鎸囧悜鏌愪釜 llama-server.exe锛堜紭鍏堢骇鏈€楂橈級" />
                    <el-button @click="pickLlamaExe">閫夋嫨 EXE</el-button>
                    <el-button @click="clearField('llama_server_exe')" plain>娓呯┖</el-button>
                  </div>
                  <div class="hint">鐩存帴鎸囧畾 exe 璺緞锛屼紭鍏堜簬鐩綍鎵弿銆傛敮鎸?llama-server.exe / llama-server / server銆?/div>
                </el-form-item>

                <el-form-item label="妯″瀷鐩綍">
                  <div class="path-row">
                    <el-input v-model="state.models_dir" :placeholder="modelDirHint" />
                    <el-button @click="pickModelsDir">閫夋嫨</el-button>
                    <el-button @click="scanModelsNow" :loading="scanning">绔嬪嵆鎵弿</el-button>
                  </div>
                  <div class="hint">鏀剧疆 .gguf 妯″瀷鏂囦欢鐨勭洰褰曘€傞娆″惎鍔ㄤ細榛樿寤轰竴涓?LiangLLM/models銆?/div>
                  <div v-if="scanResult" class="scan-result">
                    <el-tag type="success" size="small">
                      鍙戠幇 {{ scanResult.files_count }} 涓?GGUF / {{ scanResult.families_count }} 涓ā鍨嬫棌
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
                <div class="sec-hd"><el-icon><InfoFilled /></el-icon>鑷姩鎺㈡祴鍒扮殑鍚庣</div>
              </template>
              <div v-if="backendList.length">
                <div v-for="b in backendList" :key="b.server_path + b.root_dir" class="backend-row">
                  <div class="backend-left">
                    <el-tag :type="b.available ? 'success' : 'info'" size="small">{{ b.label }}</el-tag>
                    <div class="backend-path">
                      <div>type: {{ b.kind }} 路 available: {{ b.available ? 'yes' : 'no' }}</div>
                      <div v-if="b.server_path" class="backend-path-p">{{ b.server_path }}</div>
                      <div v-if="b.root_dir" class="backend-path-p hint">root: {{ b.root_dir }}</div>
                    </div>
                  </div>
                  <div class="backend-gpus" v-if="b.gpu_devices && b.gpu_devices.length">
                    <el-tag v-for="(g,i) in b.gpu_devices" :key="i" size="small" type="warning">{{ g }}</el-tag>
                  </div>
                </div>
              </div>
              <el-empty v-else description="鏈彂鐜?llama-server 鍚庣锛屽彲鎵嬪姩鎸囧畾銆? />
              <el-button style="margin-top:12px;" @click="rescan">閲嶆柊鎵弿寮曟搸</el-button>
            </el-card>
          </div>

          <!-- 纭欢涓庡紩鎿?-->
          <div v-show="activeCat === 'hardware'" class="system-section">
            <el-card>
              <template #header>
                <div class="sec-hd"><el-icon><Cpu /></el-icon>寮曟搸鍋忓ソ</div>
              </template>
              <el-form label-width="128px" :model="state">
                <el-form-item label="寮曟搸鍋忓ソ">
                  <el-select v-model="state.backend_preference" style="width:260px;">
                    <el-option label="鑷姩锛圕UDA > Vulkan > SYCL > CPU锛? value="auto" />
                    <el-option label="NVIDIA CUDA" value="cuda" />
                    <el-option label="Intel Vulkan" value="vulkan" />
                    <el-option label="Intel SYCL" value="sycl" />
                    <el-option label="浠?CPU" value="cpu" />
                  </el-select>
                  <div class="hint">鑷姩閫夋嫨浼氭牴鎹彲鐢ㄧ‖浠舵寫鏈€濂界殑銆傚鏋滀綘瑁呬簡澶氫釜鍚庣锛屽彲鎵嬪姩閿佸畾銆?/div>
                </el-form-item>
              </el-form>
            </el-card>
          </div>

          <!-- 鎺ㄧ悊榛樿鍊?-->
          <div v-show="activeCat === 'defaults'" class="system-section">
            <el-card>
              <template #header>
                <div class="sec-hd"><el-icon><Setting /></el-icon>鍏ㄥ眬榛樿鎺ㄧ悊鍙傛暟</div>
              </template>
              <el-form label-width="140px" :model="state">
                <el-row :gutter="12">
                  <el-col :span="12">
                    <el-form-item label="GPU 灞傛暟 (-ngl)">
                      <el-input-number v-model.number="state.gpu_layers" :min="-1" :max="99" />
                    </el-form-item>
                    <el-form-item label="涓婁笅鏂?(-c)">
                      <el-input-number v-model.number="state.ctx_size" :min="512" :max="131072" :step="1024" />
                    </el-form-item>
                    <el-form-item label="Batch 澶у皬 (-b)">
                      <el-input-number v-model.number="state.batch_size" :min="64" :max="4096" />
                    </el-form-item>
                    <el-form-item label="CPU 绾跨▼">
                      <el-input-number v-model.number="state.threads" :min="0" :max="64" />
                      <div class="hint">0 = 鑷姩</div>
                    </el-form-item>
                  </el-col>
                  <el-col :span="12">
                    <el-form-item label="KV Cache (K)">
                      <el-select v-model="state.cache_type_k">
                        <el-option v-for="o in cacheKVOps" :key="o" :label="o" :value="o" />
                      </el-select>
                    </el-form-item>
                    <el-form-item label="骞惰璇锋眰鏁?>
                      <el-input-number v-model.number="state.parallel" :min="1" :max="8" />
                    </el-form-item>
                    <el-form-item>
                      <el-checkbox v-model="state.mmap">Memory Map (-ngl 鏃舵洿鐪佸唴瀛?</el-checkbox>
                    </el-form-item>
                    <el-form-item>
                      <el-checkbox v-model="state.mlock">閿佸畾鍐呭瓨 (闃?swap)</el-checkbox>
                    </el-form-item>
                    <el-form-item>
                      <el-checkbox v-model="state.flash_attn">Flash Attention (鏇村揩 GPU)</el-checkbox>
                    </el-form-item>
                    <el-form-item>
                      <el-checkbox v-model="state.cont_batching">Continuous Batching</el-checkbox>
                    </el-form-item>
                  </el-col>
                </el-row>
              </el-form>
            </el-card>
          </div>

          <!-- 涓婃父鏈嶅姟 -->
          <div v-show="activeCat === 'upstream'" class="system-section">
            <el-card>
              <template #header>
                <div class="sec-hd"><el-icon><Connection /></el-icon>涓婃父 OpenAI 鍏煎鏈嶅姟</div>
              </template>
              <el-form label-width="128px" :model="state">
                <el-form-item label="鏈嶅姟鎻愪緵鏂?>
                  <el-select v-model="state.api_provider" style="width:260px;">
                    <el-option label="llama.cpp server (鏈湴)" value="llama-cpp" />
                    <el-option label="vLLM / sglang / LMDeploy" value="vllm" />
                    <el-option label="Ollama" value="ollama" />
                    <el-option label="MLX / Apple Silicon" value="mlx" />
                    <el-option label="DeepSeek / DeepEP" value="deepsleep" />
                    <el-option label="OpenAI 瀹樻柟 / OpenRouter / Together" value="openai" />
                    <el-option label="鑷畾涔? value="custom" />
                  </el-select>
                </el-form-item>

                <el-form-item label="鑷畾涔?Base URL">
                  <el-input v-model="state.api_base_url" placeholder="https://api.openai.com 鎴?http://127.0.0.1:8000" />
                </el-form-item>

                <el-form-item label="API Key">
                  <el-input v-model="state.api_key" show-password placeholder="sk-... 鎴栫暀绌? />
                </el-form-item>

                <el-form-item>
                  <el-button type="primary" :loading="testing" @click="testUpstream">娴嬭瘯涓婃父杩為€氭€?/el-button>
                  <span style="margin-left:12px; color:var(--text-muted); font-size:12px;" v-if="upstreamTest">
                    {{ upstreamTest.ok ? ('OK 路 妯″瀷鏁? ' + upstreamTest.models_count) : ('FAIL 路 ' + upstreamTest.error) }}
                  </span>
                </el-form-item>
              </el-form>
            </el-card>
          </div>

          <!-- 搴旂敤琛屼负 -->
          <div v-show="activeCat === 'behavior'" class="system-section">
            <el-card>
              <template #header>
                <div class="sec-hd"><el-icon><Monitor /></el-icon>搴旂敤琛屼负</div>
              </template>
              <el-form label-width="140px" :model="state">
                <el-form-item label="涓婚">
                  <el-radio-group v-model="state.theme">
                    <el-radio-button label="dark">鏆楄壊</el-radio-button>
                    <el-radio-button label="light">浜壊</el-radio-button>
                  </el-radio-group>
                </el-form-item>

                <el-form-item label="鍚姩鏂瑰紡">
                  <el-radio-group v-model="state.startup_behavior">
                    <el-radio-button label="idle">绌洪棽</el-radio-button>
                    <el-radio-button label="auto">鑷姩鍔犺浇</el-radio-button>
                    <el-radio-button label="last_model">鎭㈠涓婃</el-radio-button>
                  </el-radio-group>
                </el-form-item>

                <el-form-item label="鏃ュ織绛夌骇">
                  <el-select v-model="state.log_level" style="width:160px;">
                    <el-option v-for="l in ['debug','info','warn','error']" :key="l" :label="l" :value="l" />
                  </el-select>
                </el-form-item>

                <el-form-item label="鏃ュ織淇濈暀澶╂暟">
                  <el-input-number v-model.number="state.log_retention_days" :min="7" :max="365" />
                </el-form-item>

                <el-form-item>
                  <el-checkbox v-model="state.auto_update_check">鍚姩鏃舵鏌ユ洿鏂?/el-checkbox>
                </el-form-item>
                <el-form-item>
                  <el-checkbox v-model="state.telemetry">鍖垮悕閬ユ祴锛堝穿婧?閿欒涓婃姤锛?/el-checkbox>
                </el-form-item>
              </el-form>
            </el-card>
          </div>

          <!-- 绯荤粺淇℃伅 -->
          <div v-show="activeCat === 'about'" class="system-section">
            <el-card>
              <template #header>
                <div class="sec-hd"><el-icon><InfoFilled /></el-icon>绯荤粺淇℃伅</div>
              </template>
              <el-button @click="refreshInfo">鍒锋柊</el-button>
              <el-empty v-if="!info" description="鐐瑰嚮鍒锋柊鑾峰彇绯荤粺淇℃伅" />
              <div v-else class="info-grid">
                <div class="info-kv">
                  <el-tag type="info">骞冲彴</el-tag> <span>{{ info.platform }}</span>
                </div>
                <div class="info-kv">
                  <el-tag type="info">Python</el-tag> <span>{{ info.python }}</span>
                </div>
                <div class="info-kv">
                  <el-tag type="warning">CPU</el-tag> <span>{{ info.cpu.count }} 绾跨▼</span>
                </div>
                <div class="info-kv">
                  <el-tag type="warning">鍐呭瓨</el-tag>
                  <span>{{ info.memory.available_mb }} / {{ info.memory.total_mb }} MB ({{ info.memory.percent }}%)</span>
                </div>
                <div class="info-kv">
                  <el-tag type="warning">纾佺洏</el-tag>
                  <span>{{ info.disk.free_gb }} / {{ info.disk.total_gb }} GB ({{ info.disk.percent }}%)</span>
                </div>
                <div class="info-kv">
                  <el-tag type="success">搴旂敤鏍?/el-tag>
                  <span class="hint2">{{ info.app.root }}</span>
                </div>
                <div class="info-kv">
                  <el-tag type="success">寮曟搸鐩綍</el-tag>
                  <span class="hint2">{{ info.app.backend_dir }}</span>
                </div>
                <div class="info-kv">
                  <el-tag type="success">閰嶇疆鐩綍</el-tag>
                  <span class="hint2">{{ info.app.config_dir }}</span>
                </div>
                <div class="info-kv">
                  <el-tag type="success">鏃ュ織鐩綍</el-tag>
                  <span class="hint2">{{ info.app.log_dir }}</span>
                </div>
                <div class="info-kv">
                  <el-tag type="success">妯″瀷鐩綍</el-tag>
                  <span class="hint2">{{ info.models_dir }}</span>
                  <el-tag size="small" style="margin-left:8px;">{{ info.models_scan.files_count }} 鏂囦欢 / {{ info.models_scan.families_count }} 鏃?/el-tag>
                </div>

                <div class="info-kv">
                  <el-tag type="primary">閫変腑寮曟搸</el-tag>
                  <span>{{ info.llama_backend.picked.label }}
                    {{ info.llama_backend.picked.available ? '鉁? : '鉁? }}
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
                      <span>鏄惧瓨 {{ (g.mem_total_mb/1024).toFixed(1) }} GB 路 绌洪棽 {{ (g.mem_free_mb/1024).toFixed(1) }} GB 路 {{ g.util_pct }}% 鍗犵敤</span>
                    </div>
                  </template>
                  <template v-else>
                    <div class="gpu-title">NVIDIA GPU</div>
                    <div class="hint">鏈娴嬪埌 nvidia-smi锛堝彲鑳芥槸 Intel / AMD / Apple 骞冲彴锛?/div>
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
  computed: {
    modelDirHint() {
      if (this.state && this.state.models_dir) return this.state.models_dir;
      return "鐣欑┖灏嗕娇鐢ㄩ粯璁?LiangLLM/models";
    },
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

    pickLlamaDir() {
      this._pick("llama_backend_dir", { title: "閫夋嫨 llama-cpp 鏋勫缓鏍圭洰褰? });
    },
    pickLlamaExe() {
      this._pickFile("llama_server_exe", {
        title: "閫夋嫨 llama-server.exe",
        filters: [{ name: "鍙墽琛屾枃浠?, extensions: ["exe", "sh", "cmd", "bat"] }],
      });
    },
    pickModelsDir() {
      this._pick("models_dir", { title: "閫夋嫨妯″瀷鐩綍锛?gguf锛? });
    },
    _pick(key, opts) {
      if (!window.liangllm || !window.liangllm.selectFolder) {
        ElementPlus.ElMessage.warning("浠呮闈㈢鍙墦寮€绯荤粺鏂囦欢瀵硅瘽妗嗭紝璇锋墜鍔ㄨ緭鍏ヨ矾寰?);
        return;
      }
      window.liangllm.selectFolder(opts).then((r) => {
        if (r && r.ok) { this.state[key] = r.path; }
      });
    },
    _pickFile(key, opts) {
      if (!window.liangllm || !window.liangllm.selectFile) {
        ElementPlus.ElMessage.warning("浠呮闈㈢鍙墦寮€绯荤粺鏂囦欢瀵硅瘽妗嗭紝璇锋墜鍔ㄨ緭鍏ヨ矾寰?);
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
        const r = await window.LiangApi._fetch("/api/system/scan-models", { method: "POST", body });
        this.scanResult = r;
        if (r.ok) ElementPlus.ElMessage.success(`鎵弿瀹屾垚锛?{r.files_count} 鏂囦欢 / ${r.families_count} 鏃廯);
        else ElementPlus.ElMessage.error(r.error || "鎵弿澶辫触");
      } finally { this.scanning = false; }
    },

    async rescan() {
      try {
        const r = await window.LiangApi._fetch("/api/system/scan-backends", { method: "POST", body: {} });
        this.backendList = r.all_backends || [];
        ElementPlus.ElMessage.success(`鍙戠幇 ${this.backendList.length} 涓彲鐢ㄥ悗绔痐);
      } catch (e) { ElementPlus.ElMessage.error(String(e)); }
    },

    async testUpstream() {
      this.testing = true;
      try {
        const r = await window.LiangApi._fetch("/api/system/test-upstream", {
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
        const r = await window.LiangApi._fetch("/api/system/info");
        this.info = r;
        this.backendList = r.llama_backend.all_backends || [];
        if (r.models_scan) this.scanResult = r.models_scan;
      } catch (e) { ElementPlus.ElMessage.error(String(e)); }
    },

    async saveAll() {
      this.saving = true;
      try {
        await window.LiangApi.saveGlobalConfig(this.state);
        ElementPlus.ElMessage.success("璁剧疆宸蹭繚瀛?);
        this.$emit("save-global-config", { ...this.state });
      } catch (e) { ElementPlus.ElMessage.error(String(e)); }
      finally { this.saving = false; }
    },

    async resetAll() {
      try {
        const r = await window.LiangApi._fetch("/api/system/reset-config", { method: "POST", body: {} });
        this.state = { ...this._defaults(), ...r.config };
        ElementPlus.ElMessage.info("宸叉仮澶嶉粯璁?);
      } catch (e) {
        this.state = { ...this._defaults() };
        ElementPlus.ElMessage.info("宸插湪鍓嶇鎭㈠榛樿锛屼繚瀛樼敓鏁?);
      }
    },
  },
};

window.SystemPanel = SystemPanel;

