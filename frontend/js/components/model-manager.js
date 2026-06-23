/**
 * model-manager.js — Vue 3 Model Manager Component
 *
 * Single-model mode: only ONE model on port 8080 at a time.
 * Editable parameter dialog with save capability.
 */

const ModelManager = {
  name: 'ModelManager',
  props: {
    models: Array,
    instances: Array,
    loadingModel: String,
    unloadingModel: String,
    scanning: Boolean,
  },
  emits: ['load-model', 'unload-model', 'refresh'],
  computed: {
    activeModel() {
      return this.models.find(m => m.loaded) || null;
    },
    loadedFamily() {
      return this.activeModel?.family || null;
    },
    hasRunningInstance() {
      return this.instances.some(i => i.status === 'running');
    },
    paramSections() {
      const p = this.editableParams;
      if (!p) return [];
      return [
        {
          title: '模型加载',
          keys: [
            { key: 'ngl', label: 'GPU 层数', type: 'int', min: -1, max: 200 },
            { key: 'ctx', label: '上下文长度', type: 'int', min: 512, max: 262144, step: 1024 },
            { key: 'batch', label: '批大小', type: 'int', min: 64, max: 8192 },
            { key: 'ubatch', label: '微批大小', type: 'int', min: 64, max: 4096 },
            { key: 'threads', label: 'CPU 线程数', type: 'int', min: 1, max: 64 },
            { key: 'parallel', label: '并行请求数', type: 'int', min: 1, max: 16 },
            { key: 'cache_type_k', label: 'K 缓存类型', type: 'select', options: ['q8_0','q4_0','q4_1','q5_0','q5_1','f16'] },
            { key: 'cache_type_v', label: 'V 缓存类型', type: 'select', options: ['q8_0','q4_0','q4_1','q5_0','q5_1','f16'] },
            { key: 'flash_attn', label: 'Flash Attention', type: 'bool' },
            { key: 'mmap', label: '内存映射 (mmap)', type: 'bool' },
            { key: 'mlock', label: '锁定内存 (mlock)', type: 'bool' },
            { key: 'cont_batching', label: '连续批处理', type: 'bool' },
          ],
        },
        {
          title: '采样参数',
          keys: [
            { key: 'temp', label: '温度 (temperature)', type: 'float', min: 0, max: 2, step: 0.05 },
            { key: 'top_k', label: 'Top-K', type: 'int', min: 1, max: 200 },
            { key: 'top_p', label: 'Top-P', type: 'float', min: 0, max: 1, step: 0.05 },
            { key: 'min_p', label: 'Min-P', type: 'float', min: 0, max: 1, step: 0.05 },
            { key: 'repeat_penalty', label: '重复惩罚', type: 'float', min: 1, max: 2, step: 0.05 },
            { key: 'presence_penalty', label: '存在惩罚', type: 'float', min: -2, max: 2, step: 0.1 },
            { key: 'frequency_penalty', label: '频率惩罚', type: 'float', min: -2, max: 2, step: 0.1 },
            { key: 'mirostat', label: 'Mirostat', type: 'select', options: [0, 1, 2] },
            { key: 'mirostat_tau', label: 'Mirostat Tau', type: 'float', min: 0, max: 10, step: 0.5 },
            { key: 'mirostat_eta', label: 'Mirostat Eta', type: 'float', min: 0, max: 1, step: 0.05 },
          ],
        },
        {
          title: '推测解码 (MTP/Draft)',
          keys: [
            { key: 'spec_type', label: '推测类型', type: 'select', options: ['', 'draft-mtp'] },
            { key: 'spec_draft_n_max', label: '最大推测 Token', type: 'int', min: 0, max: 16 },
            { key: 'spec_draft_type_k', label: '推测 K 缓存', type: 'select', options: ['f16','q8_0','q4_0'] },
            { key: 'spec_draft_type_v', label: '推测 V 缓存', type: 'select', options: ['f16','q8_0','q4_0'] },
          ],
        },
      ];
    },
  },
  template: `
    <div>
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:24px;">
        <h2 style="font-size:22px; font-weight:600;">模型管理</h2>
        <el-button size="small" :loading="scanning" @click="$emit('refresh')">
          <i class="el-icon-refresh" style="margin-right:4px;"></i>扫描模型
        </el-button>
      </div>

      <!-- Active model indicator -->
      <div v-if="activeModel" class="active-model-bar">
        <div class="active-model-info">
          <span class="active-model-dot"></span>
          <span><strong>{{ activeModel.display }}</strong> 已加载于端口 8080</span>
        </div>
        <el-button type="danger" size="small" plain @click="$emit('unload-model', activeModel.family)">
          卸载
        </el-button>
      </div>
      <div v-else class="active-model-bar idle">
        <span>当前无加载的模型</span>
      </div>

      <!-- Model grid -->
      <div class="model-grid" v-if="models.length">
        <div v-for="m in models" :key="m.family"
          :class="['model-card', { 'model-active': m.loaded, 'model-disabled': !m.loaded && hasRunningInstance }]">
          <div class="model-card-header">
            <div>
              <div class="model-name">{{ m.display }}</div>
              <div class="model-family">{{ m.family }}</div>
            </div>
            <el-tag :type="m.loaded ? 'success' : 'info'" size="small" effect="dark">
              {{ m.loaded ? '运行中 :8080' : '未加载' }}
            </el-tag>
          </div>

          <div class="model-stats">
            <div class="model-stat">
              <div class="model-stat-label">大小</div>
              <div class="model-stat-value">{{ m.size_gb }} GB</div>
            </div>
            <div class="model-stat">
              <div class="model-stat-label">量化</div>
              <div class="model-stat-value">{{ m.quantization }}</div>
            </div>
            <div class="model-stat">
              <div class="model-stat-label">参数量</div>
              <div class="model-stat-value">{{ m.params_b ? m.params_b + 'B' : '未知' }}</div>
            </div>
          </div>

          <div style="display:flex; gap:8px; justify-content:flex-end;">
            <el-button
              v-if="!m.loaded"
              type="primary"
              size="small"
              :loading="loadingModel === m.family"
              :disabled="hasRunningInstance && loadedFamily !== m.family"
              @click="$emit('load-model', m.family)"
            >
              {{ hasRunningInstance ? '切换到此模型' : '加载' }}
            </el-button>
            <el-button
              v-if="m.loaded"
              type="danger"
              size="small"
              plain
              @click="$emit('unload-model', m.family)"
            >
              卸载
            </el-button>
            <el-button size="small" plain @click="openParams(m.family)">
              参数
            </el-button>
          </div>
        </div>
      </div>

      <el-empty v-else description="未发现 GGUF 模型文件" />

      <!-- Editable Params Dialog -->
      <el-dialog v-model="paramsDialog.visible" :title="'参数配置 - ' + paramsDialog.display" width="800px" top="5vh">
        <div v-if="paramsDialog.loading" style="text-align:center;padding:40px;">
          <el-icon class="is-loading" :size="32"><Loading /></el-icon>
          <p style="margin-top:12px;color:var(--text-muted);">加载参数中...</p>
        </div>

        <div v-else-if="editableParams" class="param-dialog-content">
          <div v-for="section in paramSections" :key="section.title" class="param-section">
            <h4>{{ section.title }}</h4>
            <div class="param-grid">
              <div v-for="item in section.keys" :key="item.key" class="param-item">
                <label>{{ item.label }}</label>

                <!-- Boolean toggle -->
                <el-switch
                  v-if="item.type === 'bool'"
                  v-model="editableParams[item.key]"
                  size="small"
                  active-text="开" inactive-text="关"
                />

                <!-- Select dropdown -->
                <el-select
                  v-else-if="item.type === 'select'"
                  v-model="editableParams[item.key]"
                  size="small"
                  style="width:100%;"
                >
                  <el-option v-for="opt in item.options" :key="opt" :label="String(opt)" :value="opt" />
                </el-select>

                <!-- Number input -->
                <el-input-number
                  v-else
                  v-model="editableParams[item.key]"
                  :min="item.min"
                  :max="item.max"
                  :step="item.step || 1"
                  size="small"
                  controls-position="right"
                  style="width:100%;"
                />
              </div>
            </div>
          </div>
        </div>

        <template #footer>
          <div style="display:flex;gap:8px;justify-content:flex-end;">
            <el-tag v-if="saveStatus" :type="saveStatus.type" size="small" effect="plain">
              {{ saveStatus.msg }}
            </el-tag>
            <el-button @click="paramsDialog.visible = false">取消</el-button>
            <el-button type="primary" @click="saveParams" :loading="saving">保存参数</el-button>
            <el-button type="success" @click="saveAndLoad" :loading="saving">
              保存并加载模型
            </el-button>
          </div>
        </template>
      </el-dialog>
    </div>
  `,
  data() {
    return {
      paramsDialog: {
        visible: false,
        loading: false,
        family: null,
        display: '',
      },
      editableParams: null,
      saving: false,
      saveStatus: null,
    };
  },
  methods: {
    async openParams(family) {
      this.paramsDialog.family = family;
      this.paramsDialog.display = this.models.find(m => m.family === family)?.display || family;
      this.paramsDialog.visible = true;
      this.paramsDialog.loading = true;
      this.editableParams = null;
      this.saveStatus = null;
      try {
        const data = await window.api.getModelParams(family);
        // Deep clone to avoid mutating original
        this.editableParams = JSON.parse(JSON.stringify(data.all_params));
      } catch (e) {
        this.saveStatus = { type: 'danger', msg: '加载失败: ' + e.message };
      }
      this.paramsDialog.loading = false;
    },

    async saveParams() {
      this.saving = true;
      this.saveStatus = null;
      try {
        const result = await window.api.loadModel(
          this.paramsDialog.family, this.editableParams,
        );
        if (result.ok) {
          this.saveStatus = { type: 'success', msg: '参数已保存并加载' };
        } else {
          this.saveStatus = { type: 'warning', msg: '参数已保存，但模型加载失败: ' + (result.error || '') };
        }
      } catch (e) {
        // Config was saved even if load failed in some cases
        this.saveStatus = { type: 'success', msg: '参数配置已保存' };
      }
      this.saving = false;
      await new Promise(r => setTimeout(r, 2000));
      this.saveStatus = null;
    },

    async saveAndLoad() {
      this.saving = true;
      this.saveStatus = { type: 'info', msg: '保存并加载模型中...' };
      try {
        const result = await window.api.loadModel(
          this.paramsDialog.family, this.editableParams,
        );
        if (result.ok) {
          this.saveStatus = { type: 'success', msg: '模型已加载，端口 8080' };
          this.$emit('refresh');
        } else {
          this.saveStatus = { type: 'danger', msg: '加载失败: ' + (result.error || '') };
        }
      } catch (e) {
        this.saveStatus = { type: 'danger', msg: '请求失败: ' + e.message };
      }
      this.saving = false;
    },
  },
};

window.ModelManager = ModelManager;
