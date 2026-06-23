/**
 * dashboard-panel.js — Vue 3 Dashboard Component
 *
 * Two-level tabs: "全部" (overview) + per-model gauges.
 * SVG circular gauges for key performance metrics.
 */

const DashboardPanel = {
  name: 'DashboardPanel',
  props: {
    models: Array,
    instances: Array,
    backend: Object,
    metricsSummary: Object,
    metricsData: Object,
  },
  emits: ['refresh'],
  data() {
    return {
      activeOverviewTab: 'all',
    };
  },
  computed: {
    // ── Logical Computed ──
    loadedModels() {
      return this.models.filter(m => m.loaded);
    },
    modelTabs() {
      const tabs = [{ key: 'all', label: '全部' }];
      for (const m of this.loadedModels) {
        tabs.push({ key: m.family, label: m.display });
      }
      return tabs;
    },
    allStats() {
      return this.metricsData?.models || [];
    },
    selectedModelStats() {
      if (this.activeOverviewTab === 'all') return null;
      return this.allStats.find(s => s.family === this.activeOverviewTab) || null;
    },
    runningInstances() {
      return this.instances.filter(i => i.status === 'running');
    },
    totalInferences() {
      return this.metricsSummary?.total_inferences || 0;
    },
    totalTokens() {
      return this.metricsSummary?.total_tokens || 0;
    },
    avgTps() {
      return this.metricsSummary?.avg_tps_all || 0;
    },
    hasAnyMetrics() {
      return this.totalInferences > 0 || this.totalTokens > 0;
    },
    gaugeTps() {
      if (this.activeOverviewTab === 'all') return this.avgTps;
      return this.selectedModelStats?.avg_tps || 0;
    },
    gaugeTokens() {
      if (this.activeOverviewTab === 'all') return this.totalTokens;
      return this.selectedModelStats?.total_tokens || 0;
    },
    gaugeModels() {
      if (this.activeOverviewTab === 'all') return this.models.length;
      return 1;
    },
    gaugeInferences() {
      if (this.activeOverviewTab === 'all') return this.totalInferences;
      return this.selectedModelStats?.total_inferences || 0;
    },
    recentInferences() {
      return this.metricsData?.recent || [];
    },
    // ── Gauge Offsets ──
    tpsDashOffset() {
      const max = 200;
      const val = Math.min(this.gaugeTps, max);
      return 301.6 * (1 - val / max);
    },
    tokensDashOffset() {
      const max = 500000;
      const val = Math.min(this.gaugeTokens, max);
      return 301.6 * (1 - val / max);
    },
    instancesDashOffset() {
      const val = Math.min(this.runningInstances.length, this.models.length);
      const max = Math.max(this.models.length, 1);
      return 301.6 * (1 - val / max);
    },
    // ── Status Button ──
    backendClass() {
      if (!this.backend?.available) return 'offline';
      return 'online';
    },
    backendLabel() {
      if (!this.backend) return '连接中...';
      return this.backend.available ? (this.backend.label || '已连接') : '等待后端';
    },
  },
  template: `
    <div>
      <!-- Header with status button -->
      <div class="section-header">
        <h2>仪表盘</h2>
        <div class="section-header-right">
          <button class="refresh-metrics-btn" @click="$emit('reset')" title="重置指标"
            :disabled="!backend?.available">重置指标</button>
          <button class="refresh-status-btn" :class="backendClass" @click="$emit('refresh')" :disabled="!backend?.available">
            <span class="status-indicator"></span>
            <span class="btn-label">{{ backendLabel }}</span>
            <span class="btn-icon">&#x21bb;</span>
          </button>
        </div>
      </div>

      <!-- Empty-state tips -->
      <div v-if="!hasAnyMetrics && backend?.available" class="dash-empty-hint">
        <div class="dash-empty-hint-icon">&#128202;</div>
        <div>
          <div class="dash-empty-hint-title">还没有对话数据</div>
          <div class="dash-empty-hint-desc">去"对话"里聊几句，这里就会开始记录 Tokens / TPS / 推理次数</div>
        </div>
      </div>

      <!-- Model Tabs -->
      <div class="dash-tabs" v-if="modelTabs.length > 1">
        <button
          v-for="tab in modelTabs"
          :key="tab.key"
          :class="['dash-tab', { active: activeOverviewTab === tab.key }]"
          @click="activeOverviewTab = tab.key"
        >{{ tab.label }}</button>
      </div>

      <!-- Stats Row -->
      <div class="stat-cards">
        <div class="stat-card accent">
          <div class="stat-value">{{ gaugeModels }}</div>
          <div class="stat-label">可用模型</div>
          <div class="stat-sub">{{ loadedModels.length }} 个已加载</div>
        </div>
        <div class="stat-card success">
          <div class="stat-value">{{ runningInstances.length }}</div>
          <div class="stat-label">运行中的服务</div>
        </div>
        <div class="stat-card warning">
          <div class="stat-value">{{ gaugeInferences }}</div>
          <div class="stat-label">推理总次数</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{{ gaugeTps }}</div>
          <div class="stat-label">平均速度 (t/s)</div>
          <div class="stat-sub">{{ formatTokens(gaugeTokens) }} tokens</div>
        </div>
      </div>

      <!-- Gauges Grid -->
      <div class="gauges-grid">
        <!-- TPS Gauge -->
        <div class="gauge-card">
          <div class="gauge-label">推理速度</div>
          <svg viewBox="0 0 120 120" class="gauge-svg">
            <circle cx="60" cy="60" r="48" fill="none" stroke="var(--bg-tertiary)" stroke-width="8"/>
            <circle cx="60" cy="60" r="48" fill="none" stroke="var(--accent)" stroke-width="8"
              stroke-dasharray="301.6" :stroke-dashoffset="tpsDashOffset"
              stroke-linecap="round" transform="rotate(-90,60,60)"/>
            <text x="60" y="48" text-anchor="middle" fill="var(--text-primary)" font-size="22" font-weight="600">{{ gaugeTps }}</text>
            <text x="60" y="66" text-anchor="middle" fill="var(--text-muted)" font-size="10">tokens/s</text>
          </svg>
          <div class="gauge-stat">
            <span class="gauge-stat-val">{{ gaugeInferences }} 次</span>
            <span class="gauge-stat-label">总推理数</span>
          </div>
        </div>

        <!-- Tokens Gauge -->
        <div class="gauge-card">
          <div class="gauge-label">总 Token</div>
          <svg viewBox="0 0 120 120" class="gauge-svg">
            <circle cx="60" cy="60" r="48" fill="none" stroke="var(--bg-tertiary)" stroke-width="8"/>
            <circle cx="60" cy="60" r="48" fill="none" stroke="var(--success)" stroke-width="8"
              stroke-dasharray="301.6" :stroke-dashoffset="tokensDashOffset"
              stroke-linecap="round" transform="rotate(-90,60,60)"/>
            <text x="60" y="48" text-anchor="middle" fill="var(--text-primary)" font-size="18" font-weight="600">{{ formatTokens(gaugeTokens) }}</text>
            <text x="60" y="66" text-anchor="middle" fill="var(--text-muted)" font-size="10">tokens</text>
          </svg>
          <div class="gauge-stat">
            <span class="gauge-stat-val">{{ formatTokens(gaugeTokens) }}</span>
            <span class="gauge-stat-label">累积生成</span>
          </div>
        </div>

        <!-- Instances Gauge -->
        <div class="gauge-card">
          <div class="gauge-label">服务状态</div>
          <svg viewBox="0 0 120 120" class="gauge-svg">
            <circle cx="60" cy="60" r="48" fill="none" stroke="var(--bg-tertiary)" stroke-width="8"/>
            <circle cx="60" cy="60" r="48" fill="none" stroke="var(--warning)" stroke-width="8"
              stroke-dasharray="301.6" :stroke-dashoffset="instancesDashOffset"
              stroke-linecap="round" transform="rotate(-90,60,60)"/>
            <text x="60" y="42" text-anchor="middle" fill="var(--text-primary)" font-size="22" font-weight="600">{{ runningInstances.length }}</text>
            <text x="60" y="60" text-anchor="middle" fill="var(--text-muted)" font-size="10">运行中</text>
            <text x="60" y="78" text-anchor="middle" fill="var(--text-muted)" font-size="9">{{ models.length }} 模型</text>
          </svg>
          <div class="gauge-stat">
            <span class="gauge-stat-val">{{ runningInstances.length }} / {{ models.length }}</span>
            <span class="gauge-stat-label">运行实例</span>
          </div>
        </div>

        <!-- Backend Status Gauge -->
        <div class="gauge-card">
          <div class="gauge-label">GPU 后端</div>
          <svg viewBox="0 0 120 120" class="gauge-svg">
            <circle cx="60" cy="60" r="48" fill="none" stroke="var(--bg-tertiary)" stroke-width="8"/>
            <circle cx="60" cy="60" r="48" fill="none" :stroke="backend?.available ? 'var(--success)' : 'var(--danger)'" stroke-width="8"
              stroke-dasharray="301.6" stroke-dashoffset="0"
              stroke-linecap="round" transform="rotate(-90,60,60)"/>
            <text x="60" y="42" text-anchor="middle" fill="var(--text-primary)" font-size="14" font-weight="600">{{ backend?.label || 'N/A' }}</text>
            <text x="60" y="60" text-anchor="middle" :fill="backend?.available ? 'var(--success)' : 'var(--danger)'" font-size="11">
              {{ backend?.available ? '已连接' : '未连接' }}
            </text>
            <text x="60" y="78" text-anchor="middle" fill="var(--text-muted)" font-size="9">{{ backend?.gpu_devices?.length || 0 }} GPU</text>
          </svg>
          <div class="gauge-stat">
            <span class="gauge-stat-val">{{ backend?.server_path ? 'llama-server' : '未检测' }}</span>
            <span class="gauge-stat-label">推理引擎</span>
          </div>
        </div>
      </div>

      <!-- Recent Inferences -->
      <el-card v-if="recentInferences && recentInferences.length" style="margin-top:16px;">
        <template #header>
          <span>最近推理记录</span>
        </template>
        <el-table :data="recentInferences" stripe size="small" style="width:100%">
          <el-table-column prop="model_family" label="模型" min-width="140"></el-table-column>
          <el-table-column label="Tokens" min-width="160">
            <template #default="{row}">
              {{ row.prompt_tokens }} + {{ row.tokens_generated }} = {{ (row.prompt_tokens||0)+(row.tokens_generated||0) }}
            </template>
          </el-table-column>
          <el-table-column prop="tokens_per_second" label="t/s" width="80">
            <template #default="{row}">{{ row.tokens_per_second }}</template>
          </el-table-column>
          <el-table-column prop="elapsed_seconds" label="耗时(s)" width="80"></el-table-column>
          <el-table-column label="温度" width="70">
            <template #default="{row}">{{ (row.temperature ?? 0).toFixed(2) }}</template>
          </el-table-column>
        </el-table>
      </el-card>

      <!-- Running Instances (full width, below gauges) -->
      <el-card style="margin-top:16px;">
        <template #header>
          <span>运行中的实例</span>
        </template>
        <el-table :data="runningInstances" stripe style="width:100%" size="small" v-if="runningInstances.length">
          <el-table-column prop="family" label="模型" min-width="120"></el-table-column>
          <el-table-column prop="port" label="端口" width="60"></el-table-column>
          <el-table-column prop="status" label="状态" width="80">
            <template #default="{row}">
              <el-tag :type="row.status === 'running' ? 'success' : 'danger'" size="small">{{ row.status }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="uptime_seconds" label="运行时间" width="90">
            <template #default="{row}">{{ formatUptime(row.uptime_seconds) }}</template>
          </el-table-column>
          <el-table-column prop="memory_mb" label="内存" width="80">
            <template #default="{row}">{{ row.memory_mb }} MB</template>
          </el-table-column>
          <el-table-column prop="cpu_percent" label="CPU %" width="70">
            <template #default="{row}">{{ row.cpu_percent }}%</template>
          </el-table-column>
        </el-table>
        <el-empty v-else description="无运行中的模型实例" :image-size="80" />
      </el-card>
    </div>
  `,
  methods: {
    formatUptime(seconds) {
      if (!seconds) return '-';
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const s = Math.floor(seconds % 60);
      if (h > 0) return `${h}h ${m}m`;
      if (m > 0) return `${m}m ${s}s`;
      return `${s}s`;
    },
    formatTokens(n) {
      if (!n) return '0';
      if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
      if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
      return String(n);
    },
  },
};

window.DashboardPanel = DashboardPanel;
