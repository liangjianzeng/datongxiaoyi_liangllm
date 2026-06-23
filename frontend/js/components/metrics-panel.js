/**
 * metrics-panel.js — Vue 3 Metrics Dashboard Component
 *
 * Displays inference performance statistics with simple chart viz.
 */

const MetricsPanel = {
  name: 'MetricsPanel',
  props: {
    metrics: Object,
    instances: Array,
  },
  emits: ['refresh', 'reset'],
  template: `
    <div>
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:24px;">
        <h2 style="font-size:22px; font-weight:600;">性能指标</h2>
        <div>
          <el-button size="small" @click="$emit('refresh')">刷新</el-button>
          <el-button size="small" type="danger" plain @click="confirmReset">重置</el-button>
        </div>
      </div>

      <!-- Summary Cards -->
      <div class="stat-cards">
        <div class="stat-card accent">
          <div class="stat-value">{{ summary?.total_inferences || 0 }}</div>
          <div class="stat-label">推理总次数</div>
        </div>
        <div class="stat-card success">
          <div class="stat-value">{{ formatTokens(summary?.total_tokens || 0) }}</div>
          <div class="stat-label">总 Token 数</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{{ summary?.avg_tps_all || 0 }}</div>
          <div class="stat-label">平均速度 (t/s)</div>
        </div>
        <div class="stat-card warning">
          <div class="stat-value">{{ summary?.model_count || 0 }}</div>
          <div class="stat-label">活跃模型数</div>
        </div>
      </div>

      <!-- Per-model stats -->
      <el-card style="margin-bottom:24px;">
        <template #header>
          <span>各模型统计</span>
        </template>
        <el-table :data="modelStats" stripe style="width:100%" v-if="modelStats.length">
          <el-table-column prop="family" label="模型" width="160"></el-table-column>
          <el-table-column prop="total_inferences" label="推理次数" width="100"></el-table-column>
          <el-table-column prop="total_tokens" label="总 Tokens" width="120">
            <template #default="{row}">{{ formatTokens(row.total_tokens) }}</template>
          </el-table-column>
          <el-table-column prop="avg_tps" label="平均 t/s" width="100"></el-table-column>
          <el-table-column prop="max_tps" label="最高 t/s" width="100"></el-table-column>
          <el-table-column prop="min_tps" label="最低 t/s" width="100"></el-table-column>
          <el-table-column prop="total_time_seconds" label="总耗时" min-width="100">
            <template #default="{row}">{{ row.total_time_seconds }}s</template>
          </el-table-column>
        </el-table>
        <el-empty v-else description="暂无推理记录" />
      </el-card>

      <!-- Recent Inferences -->
      <el-card>
        <template #header>
          <span>最近推理记录 (最近 50 条)</span>
        </template>
        <el-table :data="recentInferences" stripe style="width:100%" v-if="recentInferences.length">
          <el-table-column prop="time_str" label="时间" width="80"></el-table-column>
          <el-table-column prop="model_family" label="模型" width="120"></el-table-column>
          <el-table-column prop="prompt_tokens" label="Prompt Tokens" width="130"></el-table-column>
          <el-table-column prop="tokens_generated" label="生成 Tokens" width="130">
            <template #default="{row}">{{ row.tokens_generated }}</template>
          </el-table-column>
          <el-table-column prop="tokens_per_second" label="速度 (t/s)" width="100">
            <template #default="{row}">
              <el-tag :type="row.tokens_per_second > 10 ? 'success' : row.tokens_per_second > 5 ? 'warning' : 'info'"
                size="small">
                {{ row.tokens_per_second }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="elapsed_seconds" label="耗时" width="80">
            <template #default="{row}">{{ row.elapsed_seconds }}s</template>
          </el-table-column>
        </el-table>
        <el-empty v-else description="暂无推理记录" />
      </el-card>
    </div>
  `,
  computed: {
    summary() {
      return this.metrics?.summary || {};
    },
    modelStats() {
      return this.metrics?.models || [];
    },
    recentInferences() {
      return this.metrics?.recent || [];
    },
  },
  methods: {
    formatTokens(n) {
      if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
      if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
      return String(n);
    },
    confirmReset() {
      ElementPlus.ElMessageBox.confirm(
        '确定重置所有指标数据？此操作不可撤销。', '确认重置',
        { confirmButtonText: '重置', cancelButtonText: '取消', type: 'warning' }
      ).then(() => this.$emit('reset'))
       .catch(() => {});
    },
  },
};

window.MetricsPanel = MetricsPanel;
