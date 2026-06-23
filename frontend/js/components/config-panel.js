/**
 * config-panel.js — Vue 3 Config Panel Component
 *
 * Full parameter editor with save/load profiles.
 * Organized into sections: Model Loading, Sampling, Advanced, Speculative Decoding.
 */

const ConfigPanel = {
  name: 'ConfigPanel',
  props: {
    models: Array,
    profiles: Array,
    selectedModelParams: Object,
  },
  emits: ['save-model-config', 'save-profile', 'delete-profile', 'select-model'],
  template: `
    <div>
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:24px;">
        <h2 style="font-size:22px; font-weight:600;">参数配置</h2>
      </div>

      <el-row :gutter="24">
        <!-- Left: Model Selector + Param Editor -->
        <el-col :span="16">
          <el-card>
            <template #header>
              <div style="display:flex; justify-content:space-between;">
                <span>参数编辑器</span>
                <div style="display:flex; gap:8px;">
                  <el-select
                    v-model="selectedFamily"
                    placeholder="选择模型"
                    size="small"
                    style="width:200px;"
                    @change="onModelSelect"
                  >
                    <el-option
                      v-for="m in models" :key="m.family"
                      :label="m.display"
                      :value="m.family"
                    />
                  </el-select>
                </div>
              </div>
            </template>

            <div v-if="selectedFamily" style="max-height:60vh; overflow-y:auto;">
              <!-- Model Loading -->
              <div class="param-section">
                <h4>模型加载参数</h4>
                <div class="param-grid">
                  <div class="param-item">
                    <label>GPU 层数 (-ngl)</label>
                    <input type="number" v-model.number="params.ngl" min="-1" max="99" />
                  </div>
                  <div class="param-item">
                    <label>上下文长度 (-c)</label>
                    <input type="number" v-model.number="params.ctx" min="512" max="131072" step="1024" />
                  </div>
                  <div class="param-item">
                    <label>Batch 大小 (-b)</label>
                    <input type="number" v-model.number="params.batch" min="64" max="4096" />
                  </div>
                  <div class="param-item">
                    <label>MicroBatch (-ub)</label>
                    <input type="number" v-model.number="params.ubatch" min="64" max="4096" />
                  </div>
                  <div class="param-item">
                    <label>CPU 线程</label>
                    <input type="number" v-model.number="params.threads" min="1" max="32" />
                  </div>
                  <div class="param-item">
                    <label>KV Cache K</label>
                    <select v-model="params.cache_type_k">
                      <option value="f16">f16</option>
                      <option value="q8_0">q8_0</option>
                      <option value="q4_0">q4_0</option>
                      <option value="q4_1">q4_1</option>
                    </select>
                  </div>
                  <div class="param-item">
                    <label>KV Cache V</label>
                    <select v-model="params.cache_type_v">
                      <option value="f16">f16</option>
                      <option value="q8_0">q8_0</option>
                      <option value="q4_0">q4_0</option>
                      <option value="q4_1">q4_1</option>
                    </select>
                  </div>
                  <div class="param-item">
                    <label>并行请求数</label>
                    <input type="number" v-model.number="params.parallel" min="1" max="8" />
                  </div>
                  <div class="param-item">
                    <label>
                      <input type="checkbox" v-model="params.mmap" />
                      Memory Map
                    </label>
                  </div>
                  <div class="param-item">
                    <label>
                      <input type="checkbox" v-model="params.mlock" />
                      Lock Memory
                    </label>
                  </div>
                  <div class="param-item">
                    <label>
                      <input type="checkbox" v-model="params.flash_attn" />
                      Flash Attention
                    </label>
                  </div>
                  <div class="param-item">
                    <label>
                      <input type="checkbox" v-model="params.cont_batching" />
                      Continuous Batching
                    </label>
                  </div>
                </div>
              </div>

              <!-- Sampling -->
              <div class="param-section">
                <h4>采样参数</h4>
                <div class="param-grid">
                  <div class="param-item">
                    <label>Temperature</label>
                    <input type="number" v-model.number="params.temp" min="0" max="2" step="0.05" />
                  </div>
                  <div class="param-item">
                    <label>Top-K</label>
                    <input type="number" v-model.number="params.top_k" min="0" max="200" />
                  </div>
                  <div class="param-item">
                    <label>Top-P</label>
                    <input type="number" v-model.number="params.top_p" min="0" max="1" step="0.05" />
                  </div>
                  <div class="param-item">
                    <label>Min-P</label>
                    <input type="number" v-model.number="params.min_p" min="0" max="1" step="0.01" />
                  </div>
                  <div class="param-item">
                    <label>Repeat Penalty</label>
                    <input type="number" v-model.number="params.repeat_penalty" min="1" max="2" step="0.05" />
                  </div>
                  <div class="param-item">
                    <label>Presence Penalty</label>
                    <input type="number" v-model.number="params.presence_penalty" min="0" max="2" step="0.1" />
                  </div>
                  <div class="param-item">
                    <label>Frequency Penalty</label>
                    <input type="number" v-model.number="params.frequency_penalty" min="0" max="2" step="0.1" />
                  </div>
                  <div class="param-item">
                    <label>Mirostat</label>
                    <select v-model.number="params.mirostat">
                      <option :value="0">关闭</option>
                      <option :value="1">V1</option>
                      <option :value="2">V2</option>
                    </select>
                  </div>
                </div>
              </div>

              <!-- Speculative Decoding -->
              <div class="param-section">
                <h4>推测解码 (MTP / Draft)</h4>
                <div class="param-grid">
                  <div class="param-item">
                    <label>Spec Type</label>
                    <select v-model="params.spec_type">
                      <option value="">关闭</option>
                      <option value="draft-mtp">Draft MTP</option>
                    </select>
                  </div>
                  <div class="param-item">
                    <label>Max Draft Tokens</label>
                    <input type="number" v-model.number="params.spec_draft_n_max" min="1" max="5" />
                  </div>
                  <div class="param-item">
                    <label>Draft KV Cache K</label>
                    <select v-model="params.spec_draft_type_k">
                      <option value="f16">f16</option>
                      <option value="q8_0">q8_0</option>
                    </select>
                  </div>
                  <div class="param-item">
                    <label>Draft KV Cache V</label>
                    <select v-model="params.spec_draft_type_v">
                      <option value="f16">f16</option>
                      <option value="q8_0">q8_0</option>
                    </select>
                  </div>
                </div>
              </div>

              <!-- Actions -->
              <div style="display:flex; gap:8px; margin-top:16px; padding-top:16px; border-top:1px solid var(--border);">
                <el-button type="primary" @click="saveModelConfig">
                  保存到此模型
                </el-button>
                <el-button @click="resetToDefaults">
                  恢复默认
                </el-button>
                <el-button @click="showSaveProfileDialog">
                  保存为配置集
                </el-button>
              </div>
            </div>

            <el-empty v-else description="请选择一个模型来编辑参数" />
          </el-card>
        </el-col>

        <!-- Right: Profiles -->
        <el-col :span="8">
          <el-card>
            <template #header>
              <span>参数配置集</span>
            </template>

            <div v-if="profiles.length">
              <div v-for="p in profiles" :key="p.name"
                style="padding:10px; margin-bottom:8px; background:var(--bg-tertiary); border-radius:8px;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                  <div>
                    <div style="font-weight:500; font-size:14px;">{{ p.name }}</div>
                    <div style="font-size:12px; color:var(--text-muted); margin-top:2px;">
                      {{ p.description || '无描述' }}
                    </div>
                  </div>
                  <div style="display:flex; gap:4px;">
                    <el-button size="small" circle @click="applyProfile(p)">
                      <i class="el-icon-upload"></i>
                    </el-button>
                    <el-button size="small" circle type="danger" plain
                      @click="confirmDeleteProfile(p.name)">
                      <i class="el-icon-delete"></i>
                    </el-button>
                  </div>
                </div>
              </div>
            </div>
            <el-empty v-else description="暂无保存的配置集" />
          </el-card>
        </el-col>
      </el-row>

      <!-- Save Profile Dialog -->
      <el-dialog v-model="saveDialog.visible" title="保存为配置集" width="400px">
        <el-form>
          <el-form-item label="配置集名称">
            <el-input v-model="saveDialog.name" placeholder="例如: fast, quality, balanced" />
          </el-form-item>
          <el-form-item label="描述">
            <el-input v-model="saveDialog.description" placeholder="可选的描述" />
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="saveDialog.visible = false">取消</el-button>
          <el-button type="primary" @click="doSaveProfile">保存</el-button>
        </template>
      </el-dialog>
    </div>
  `,
  data() {
    return {
      selectedFamily: '',
      params: {
        ngl: 99, ctx: 32768, batch: 1024, ubatch: 512,
        threads: 8, cache_type_k: 'q8_0', cache_type_v: 'q8_0',
        parallel: 1, mmap: true, mlock: false,
        flash_attn: false, cont_batching: false,
        temp: 0.7, top_k: 40, top_p: 0.9, min_p: 0.0,
        repeat_penalty: 1.1, presence_penalty: 0.0, frequency_penalty: 0.0,
        mirostat: 0, mirostat_tau: 5.0, mirostat_eta: 0.1,
        spec_type: '', spec_draft_n_max: 2,
        spec_draft_type_k: 'f16', spec_draft_type_v: 'f16',
      },
      saveDialog: {
        visible: false,
        name: '',
        description: '',
      },
    };
  },
  watch: {
    selectedModelParams(val) {
      if (val) {
        Object.assign(this.params, val);
      }
    },
  },
  methods: {
    onModelSelect(family) {
      this.$emit('select-model', family);
    },
    saveModelConfig() {
      if (!this.selectedFamily) return;
      this.$emit('save-model-config', this.selectedFamily, { ...this.params });
    },
    resetToDefaults() {
      // Reset to hardcoded defaults
      Object.assign(this.params, {
        ngl: 99, ctx: 32768, batch: 1024, ubatch: 512,
        threads: 8, cache_type_k: 'q8_0', cache_type_v: 'q8_0',
        parallel: 1, mmap: true, mlock: false,
        flash_attn: false, cont_batching: false,
        temp: 0.7, top_k: 40, top_p: 0.9, min_p: 0.0,
        repeat_penalty: 1.1, presence_penalty: 0.0, frequency_penalty: 0.0,
        mirostat: 0, mirostat_tau: 5.0, mirostat_eta: 0.1,
        spec_type: '', spec_draft_n_max: 2,
        spec_draft_type_k: 'f16', spec_draft_type_v: 'f16',
      });
    },
    showSaveProfileDialog() {
      this.saveDialog.name = '';
      this.saveDialog.description = '';
      this.saveDialog.visible = true;
    },
    doSaveProfile() {
      if (!this.saveDialog.name.trim()) {
        ElementPlus.ElMessage.warning('请输入配置集名称');
        return;
      }
      this.$emit('save-profile', this.saveDialog.name.trim(), { ...this.params }, this.saveDialog.description);
      this.saveDialog.visible = false;
    },
    applyProfile(profile) {
      if (profile.params) {
        Object.assign(this.params, profile.params);
        ElementPlus.ElMessage.success(`已应用配置集: ${profile.name}`);
      }
    },
    confirmDeleteProfile(name) {
      ElementPlus.ElMessageBox.confirm(`确定删除配置集 "${name}"?`, '确认', {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning',
      }).then(() => {
        this.$emit('delete-profile', name);
      }).catch(() => {});
    },
  },
};

window.ConfigPanel = ConfigPanel;
