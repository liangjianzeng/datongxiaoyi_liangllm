/**
 * benchmark-panel.js — LLM 基准测试面板
 *
 * 功能分组（按 category）：
 *   性能 · TTFT / TPS / LongContext / Concurrency / Streaming
 *   鲁棒性 · Stability
 *   质量 · Quality / Reasoning
 *
 * 勾选组合 → 一键执行 → 实时进度 + 最终报告 + 导出 Markdown/JSON
 */

const BenchmarkPanel = {
  template: `
    <div class="bench-panel">
      <!-- header -->
      <div class="panel-header">
        <div>
          <h2 class="panel-title">基准测试 Benchmark</h2>
          <p class="panel-sub">对已加载模型进行组合式能力测试 · 勾选即方案 · 一键执行</p>
        </div>
        <div class="panel-actions">
          <el-tag v-if="running" type="warning" effect="dark" class="running-tag">
            <el-icon class="is-loading"><Loading /></el-icon>
            运行中：{{ runningModel }}
          </el-tag>
          <el-tag v-else-if="lastReport" type="success" effect="light">已完成 · {{ lastReport.model || runningModel }}</el-tag>
          <el-tag v-else type="info">就绪 · 选择测试方案后开始</el-tag>
        </div>
      </div>

      <div class="bench-body">
        <!-- left: test selector -->
        <div class="bench-col bench-col-left">
          <div class="card">
            <div class="card-head">
              <span class="card-title">① 选择测试方案</span>
              <div class="card-head-actions">
                <el-button link size="small" @click="checkAll">全选</el-button>
                <el-button link size="small" @click="uncheckAll">清空</el-button>
                <el-button link size="small" @click="selectPreset('quick')">快速</el-button>
                <el-button link size="small" @click="selectPreset('full')">全套</el-button>
              </div>
            </div>

            <el-empty v-if="!testKeys.length"
                      description="正在拉取测试列表..." :image-size="60" />

            <div v-for="(items, cat) in groupedTests" :key="cat" class="test-group">
              <div class="test-group-head">
                <el-icon><component :is="categoryIcon(cat)" /></el-icon>
                <span>{{ cat }}</span>
                <el-tag size="small" :type="categoryTagType(cat)" effect="light">
                  {{ items.length }}
                </el-tag>
              </div>
              <el-checkbox-group v-model="selected" class="test-group-body">
                <el-checkbox v-for="t in items" :key="t.id" :label="t.id" :value="t.id">
                  <div class="chk-item">
                    <span class="chk-label">{{ t.label }}</span>
                    <span class="chk-desc">{{ t.description }}</span>
                  </div>
                </el-checkbox>
              </el-checkbox-group>
            </div>
          </div>

          <div class="card">
            <div class="card-head">
              <span class="card-title">② 目标模型</span>
            </div>
            <div class="target-select">
              <el-radio-group v-model="targetSource" size="small">
                <el-radio-button label="auto">自动使用当前已加载</el-radio-button>
                <el-radio-button label="pick">手动选择</el-radio-button>
              </el-radio-group>
              <el-select v-if="targetSource === 'pick'"
                         v-model="selectedFamily"
                         placeholder="请先加载一个模型"
                         clearable style="margin-top:8px;width:100%">
                <el-option v-for="f in loadedFamilies"
                           :key="f" :label="f" :value="f" />
              </el-select>
              <div v-else class="auto-tip">
                <el-icon><InfoFilled /></el-icon>
                <span>{{ currentAutoLabel }}</span>
              </div>
            </div>
          </div>

          <div class="card run-card">
            <el-button type="primary" size="large"
                       :disabled="!canRun || running"
                       :loading="running"
                       @click="startRun">
              <el-icon><VideoPlay /></el-icon>
              {{ running ? '测试进行中...' : '开始基准测试' }}
              <el-tag effect="dark" size="small" style="margin-left:6px"
                       :type="selected.length ? 'success' : 'info'">
                {{ selected.length }} 项
              </el-tag>
            </el-button>
            <el-button size="large" :disabled="!running" @click="cancelRun"
                       style="margin-left:8px">
              <el-icon><VideoPause /></el-icon> 取消
            </el-button>
            <el-button size="large" :disabled="!lastReport" @click="clearReport"
                       style="margin-left:8px">
              <el-icon><Delete /></el-icon> 清空报告
            </el-button>
          </div>
        </div>

        <!-- middle: progress timeline -->
        <div class="bench-col bench-col-mid">
          <div class="card">
            <div class="card-head">
              <span class="card-title">③ 实时进度</span>
              <span class="progress-right">
                <el-progress v-if="running" :percentage="globalPct"
                             :stroke-width="12"
                             :show-text="true"
                             :text-inside="true"
                             style="width:200px" />
                <span v-if="!running && lastReport" class="muted">
                  完成 · {{ lastReport.total_seconds }}s
                </span>
              </span>
            </div>
            <div class="timeline" v-if="timeline.length">
              <div v-for="(e, i) in timeline" :key="i" class="tl-item"
                   :class="tlClass(e)">
                <el-icon class="tl-icon"
                         :class="tlIconClass(e)"><component :is="tlIcon(e)" /></el-icon>
                <div class="tl-body">
                  <div class="tl-title">{{ tlTitle(e) }}</div>
                  <div class="tl-meta" v-if="e.payload && (e.payload.detail || e.payload.stage)">
                    {{ e.payload.stage || '' }}
                    <span v-if="e.payload.detail">· {{ e.payload.detail }}</span>
                    <span v-if="e.payload.pct !== undefined">
                      · {{ e.payload.pct }}%
                    </span>
                    <span v-if="e.payload.current !== undefined">
                      ({{ e.payload.current }}/{{ e.payload.total }})
                    </span>
                  </div>
                  <div class="tl-sub" v-if="e.payload && e.payload.description">
                    {{ e.payload.description }}
                  </div>
                </div>
              </div>
            </div>
            <el-empty v-else description="启动测试后，进度与事件会实时出现在这里"
                      :image-size="60" />
          </div>
        </div>

        <!-- right: report -->
        <div class="bench-col bench-col-right">
          <div class="card">
            <div class="card-head">
              <span class="card-title">④ 测试报告</span>
              <div v-if="lastReport" class="card-head-actions">
                <el-button size="small" @click="exportReport('json')">
                  <el-icon><Download /></el-icon> JSON
                </el-button>
                <el-button size="small" type="success" @click="exportReport('md')">
                  <el-icon><Document /></el-icon> Markdown
                </el-button>
              </div>
            </div>
            <div v-if="!lastReport" class="empty-report">
              <el-empty description="还没有报告，开始一次测试吧" :image-size="80" />
            </div>
            <div v-else class="report">
              <div class="report-summary">
                <div class="summary-grid">
                  <div class="summary-kpi">
                    <div class="kpi-label">最佳 TPS</div>
                    <div class="kpi-val">{{ fmt(lastReport.summary?.best_tps) }} tok/s</div>
                  </div>
                  <div class="summary-kpi">
                    <div class="kpi-label">最佳 TTFT</div>
                    <div class="kpi-val">{{ fmt(lastReport.summary?.best_ttft_ms) }} ms</div>
                  </div>
                  <div class="summary-kpi">
                    <div class="kpi-label">平均通过率</div>
                    <div class="kpi-val">{{ fmt(lastReport.summary?.mean_pass_rate) }} %</div>
                  </div>
                  <div class="summary-kpi">
                    <div class="kpi-label">耗时</div>
                    <div class="kpi-val">{{ lastReport.total_seconds }} s</div>
                  </div>
                </div>
                <div class="report-meta muted">
                  模型: {{ lastReport.model || 'unknown' }} · 生成于 {{ lastReport.generated_at }}
                </div>
              </div>

              <el-collapse v-if="lastReport.results && lastReport.results.length"
                          accordion expand-arrow-position="end">
                <el-collapse-item v-for="r in lastReport.results" :key="r.test || r.name"
                                  :name="r.test || r.name"
                                  :title="collapsibleTitle(r)"
                                  :disabled="r.ok === false">
                  <div class="result-block">
                    <p class="result-desc">{{ r.description }}</p>

                    <!-- metrics -->
                    <div v-if="r.metrics && Object.keys(r.metrics).length" class="result-metrics">
                      <div class="sub-title">关键指标</div>
                      <el-table :data="[r.metrics]" border size="small"
                                stripe style="width:100%">
                        <el-table-column v-for="(v, k) in r.metrics" :key="k"
                                         :prop="k" :label="k" width="120">
                          <template #default="{ row }">
                            <span class="metric-key">{{ k }}</span>
                          </template>
                        </el-table-column>
                        <el-table-column v-for="(v, k) in r.metrics" :key="'v-'+k"
                                         :prop="k" :label="label">
                          <template #default="{ row }">
                            <span class="metric-val">{{ fmt(v) }}
                              <el-tag size="small" v-if="r.unit && k === 'unit'">{{ r.unit }}</el-tag>
                            </span>
                          </template>
                        </el-table-column>
                      </el-table>
                      <div class="metrics-rows">
                        <div v-for="(v, k) in r.metrics" :key="k" class="metrics-row"
                             v-show="!['samples'].includes(k)">
                          <span class="metric-key">{{ k }}</span>
                          <span class="metric-val">{{ fmt(v) }}
                            <span v-if="r.unit && k === 'unit'" class="muted"> {{ r.unit }}</span>
                          </span>
                        </div>
                      </div>
                    </div>

                    <!-- scenarios (TPS longctx etc) -->
                    <div v-if="r.scenarios" class="result-scenarios">
                      <div class="sub-title">分场景指标</div>
                      <el-table :data="scenarioRows(r)" border size="small"
                                stripe style="width:100%">
                        <el-table-column prop="scene" label="场景" width="120" />
                        <el-table-column prop="metric" label="指标" width="100" />
                        <el-table-column prop="value" label="值" />
                      </el-table>
                    </div>

                    <!-- samples (quality/reasoning/stability) -->
                    <div v-if="r.samples && r.samples.length && r.test !== 'stability'" class="result-samples">
                      <div class="sub-title">样例</div>
                      <el-table :data="r.samples" border size="small"
                                stripe style="width:100%">
                        <el-table-column prop="id" label="用例" width="120" />
                        <el-table-column label="结果" width="80">
                          <template #default="{ row }">
                            <el-tag v-if="row.ok === true" type="success" size="small">通过</el-tag>
                            <el-tag v-else-if="row.ok === false" type="danger" size="small">失败</el-tag>
                            <el-tag v-else type="info" size="small">-</el-tag>
                          </template>
                        </el-table-column>
                        <el-table-column prop="prompt" label="Prompt" min-width="160" />
                        <el-table-column prop="output" label="输出" min-width="240" />
                      </el-table>
                    </div>

                    <div v-if="r.runs && r.runs.length" class="result-samples">
                      <div class="sub-title">每次运行</div>
                      <el-table :data="r.runs" border size="small"
                                stripe style="width:100%">
                        <el-table-column type="index" label="#" width="40" />
                        <el-table-column prop="elapsed_s" label="耗时 s" width="80" />
                        <el-table-column prop="tps" label="TPS" width="80" />
                        <el-table-column prop="completion_tokens" label="输出 tokens" width="100" />
                        <el-table-column prop="output_hash" label="输出摘要" />
                        <el-table-column prop="error" label="错误" width="120">
                          <template #default="{ row }">
                            <el-tag v-if="row.error" type="danger" size="small">{{ row.error }}</el-tag>
                          </template>
                        </el-table-column>
                      </el-table>
                    </div>
                  </div>
                </el-collapse-item>
              </el-collapse>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,

  props: {
    instances: { type: Array, default: () => [] },
  },

  data() {
    return {
      tests: {},          // id -> {id, label, category, description}
      selected: [],       // array of test id
      targetSource: 'auto',
      selectedFamily: '',
      running: false,
      runningModel: '',
      timeline: [],       // [{type, ts, payload}]
      lastReport: null,
      eventTimer: null,
      pollTimer: null,
      testKeys: [],
    };
  },

  computed: {
    groupedTests() {
      const groups = {};
      for (const id of this.testKeys) {
        const t = this.tests[id];
        if (!t) continue;
        const cat = t.category || '其它';
        if (!groups[cat]) groups[cat] = [];
        groups[cat].push({ id, ...t });
      }
      return groups;
    },
    loadedFamilies() {
      return (this.instances || [])
        .filter(i => i.status === 'running')
        .map(i => i.family);
    },
    canRun() {
      return !!this.selected.length &&
        (this.targetSource === 'auto' ? this.loadedFamilies.length > 0
                                      : !!this.selectedFamily);
    },
    currentAutoLabel() {
      if (this.loadedFamilies.length === 0) {
        return '未检测到已加载的模型，请先在模型管理中加载一个模型。';
      }
      if (this.loadedFamilies.length === 1) {
        return `将自动对 "${this.loadedFamilies[0]}" 执行测试。`;
      }
      return `检测到 ${this.loadedFamilies.length} 个已加载模型（${this.loadedFamilies.join(', ')}），将使用最后一个。`;
    },
    globalPct() {
      const last = this.timeline.slice().reverse().find(e => e.payload && e.payload.pct !== undefined);
      if (last) return last.payload.pct;
      const firstRun = this.timeline.find(e => e.type === 'start');
      const lastDone = this.timeline.find(e => e.type === 'done');
      if (lastDone) return 100;
      return 0;
    },
  },

  mounted() {
    this.loadTests();
  },
  beforeUnmount() {
    if (this.eventTimer) clearInterval(this.eventTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);
  },

  methods: {
    async loadTests() {
      try {
        const data = await window.api.getBenchmarkTests();
        this.tests = data.tests || {};
        this.testKeys = Object.keys(this.tests).sort();
        this.selectPreset('quick');
      } catch (e) {
        ElementPlus.ElMessage.error(`拉取测试列表失败: ${e.message}`);
      }
    },

    selectPreset(preset) {
      const all = this.testKeys;
      if (!all.length) return;
      if (preset === 'quick') {
        // quality + tps + ttft + reasoning + streaming
        this.selected = all.filter(id =>
          ['ttft', 'tps', 'quality', 'reasoning', 'streaming'].includes(id));
      } else if (preset === 'full') {
        this.selected = [...all];
      }
    },
    checkAll() { this.selected = [...this.testKeys]; },
    uncheckAll() { this.selected = []; },

    categoryIcon(cat) {
      return cat === '性能' ? 'Timer' :
             cat === '质量' ? 'Histogram' : 'DataBoard';
    },
    categoryTagType(cat) {
      return cat === '性能' ? '' : cat === '质量' ? 'success' : 'warning';
    },

    async startRun() {
      let family = null;
      if (this.targetSource === 'pick') {
        family = this.selectedFamily;
        if (!family) {
          ElementPlus.ElMessage.warning('请选择目标模型');
          return;
        }
      }
      if (!this.selected.length) {
        ElementPlus.ElMessage.warning('请至少选择一个测试项');
        return;
      }
      this.running = true;
      this.runningModel = family || this.loadedFamilies[this.loadedFamilies.length - 1] || 'current';
      this.timeline = [];
      this.lastReport = null;
      try {
        await window.api.runBenchmark(this.selected, family);
        this.startPolling();
      } catch (e) {
        this.running = false;
        ElementPlus.ElMessage.error(`启动失败: ${e.message}`);
      }
    },

    async cancelRun() {
      try {
        await window.api.cancelBenchmark();
        ElementPlus.ElMessage.info('已请求取消...');
      } catch (e) { /* ignore */ }
    },

    startPolling() {
      const tick = async () => {
        try {
          const data = await window.api.getBenchmarkEvents();
          if (data.events && data.events.length) {
            this.timeline.push(...data.events);
          }
          if (data.status === 'done' || data.status === 'cancelled' ||
              data.status === 'error') {
            this.running = false;
            if (this.eventTimer) clearInterval(this.eventTimer);
            await this.loadReport();
          }
        } catch (e) { /* ignore */ }
      };
      this.eventTimer = setInterval(tick, 700);
      tick();
    },

    async loadReport() {
      try {
        const data = await window.api.getBenchmarkReport();
        if (data.available) {
          this.lastReport = data.report;
        }
      } catch (e) { /* ignore */ }
    },

    async exportReport(format) {
      try {
        const url = `${window.api.getBenchmarkExportUrl(format)}`;
        const resp = await fetch(url);
        if (!resp.ok) throw new Error('下载失败');
        const blob = await resp.blob();
        const cd = resp.headers.get('content-disposition') || '';
        const m = cd.match(/filename="?([^"]+)"?/);
        const name = m ? m[1] : `benchmark.${format}`;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(a.href);
        ElementPlus.ElMessage.success(`已导出 ${format.toUpperCase()}`);
      } catch (e) {
        ElementPlus.ElMessage.error(`导出失败: ${e.message}`);
      }
    },

    clearReport() {
      this.lastReport = null;
      this.timeline = [];
    },

    tlClass(e) {
      return {
        'tl-start': e.type === 'start',
        'tl-done': e.type === 'done',
        'tl-cancel': e.type === 'cancel',
        'tl-error': e.type === 'error',
        'tl-result': e.type === 'result',
        'tl-stage': e.type === 'stage',
        'tl-progress': e.type === 'progress',
      };
    },
    tlIconClass(e) {
      return {
        'tl-icon-done': e.type === 'done',
        'tl-icon-error': e.type === 'error',
        'tl-icon-cancel': e.type === 'cancel',
        'tl-icon-progress': e.type === 'progress',
        'tl-icon-result': e.type === 'result',
      };
    },
    tlIcon(e) {
      switch (e.type) {
        case 'start': return 'Promotion';
        case 'progress': return 'TrendCharts';
        case 'stage': return 'Collection';
        case 'result': return 'Document';
        case 'done': return 'Finished';
        case 'cancel': return 'WarningFilled';
        case 'error': return 'CircleCloseFilled';
        default: return 'Timer';
      }
    },
    tlTitle(e) {
      if (e.type === 'start') return `开始测试：${e.payload?.total || 0} 项`;
      if (e.type === 'done') return `测试完成 · 总耗时 ${e.payload?.total_seconds}s`;
      if (e.type === 'cancel') return '已取消';
      if (e.type === 'error') return '发生错误';
      if (e.type === 'stage') return `${e.payload?.name}`;
      if (e.type === 'progress')
        return `进度 ${e.payload?.current}/${e.payload?.total} · ${e.payload?.pct}%`;
      if (e.type === 'result') {
        const r = e.payload?.result || {};
        return `✓ ${r.name || r.test}`;
      }
      return e.type;
    },

    collapsibleTitle(r) {
      const passRate = r.metrics && r.metrics.pass_rate !== undefined
        ? ` · 通过率 ${r.metrics.pass_rate}%`
        : '';
      if (r.test === 'ttft') {
        return `${r.name} · 平均 ${r.metrics?.mean ?? '?'} ${r.unit || ''}${r.metrics?.unit ?? ''}`;
      }
      if (r.test === 'tps') {
        const vals = Object.values(r.scenarios || {});
        const mean = vals.find(v => v.tps_stats?.mean)?.tps_stats?.mean;
        return `${r.name} · ~${mean || '?'} tok/s`;
      }
      if (r.test === 'stability') {
        return `${r.name} · 耗时CV ${r.metrics?.elapsed_cv_pct ?? '?'}% · 失败率 ${r.metrics?.fail_rate_pct ?? '?'}%`;
      }
      return `${r.name}${passRate}`;
    },

    scenarioRows(r) {
      const rows = [];
      if (!r.scenarios) return rows;
      for (const [scene, sc] of Object.entries(r.scenarios)) {
        if (sc.tps_stats) {
          for (const [k, v] of Object.entries(sc.tps_stats)) {
            if (k === 'unit') continue;
            rows.push({ scene, metric: k, value: v });
          }
        }
        if (sc.throughput_tps_total !== undefined) {
          rows.push({ scene, metric: '总吞吐 tps',
                     value: sc.throughput_tps_total });
        }
        if (sc.success_count !== undefined) {
          rows.push({ scene, metric: '成功',
                     value: `${sc.success_count}/${sc.success_count + sc.failure_count}` });
        }
      }
      return rows;
    },

    fmt(v) {
      if (v === undefined || v === null) return '—';
      if (typeof v === 'boolean') return v ? '是' : '否';
      if (typeof v === 'number') {
        if (Number.isInteger(v)) return v.toString();
        return v.toFixed(2);
      }
      return String(v);
    },
  },
};

window.BenchmarkPanel = BenchmarkPanel;
