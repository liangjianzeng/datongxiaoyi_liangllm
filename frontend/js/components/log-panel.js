/**
 * log-panel.js — Vue 3 日志管理组件
 *
 * 管理员日志面板，支持：
 *   - 日志概览卡（近7日总量/今日/各级别/各模型分布）
 *   - 日期范围选择 + 模型筛选 + 级别筛选 + 模块筛选 + 关键词
 *   - 分页表格展示（可展开 extra JSON）
 *   - 日志文件列表（按日期/归档）+ 下载/归档/删除
 *   - 批量归档 / 清理
 */

const LogPanel = {
  name: 'LogPanel',
  emits: [],
  template: `
    <div class="log-panel">
      <!-- Header -->
      <div class="log-header">
        <div>
          <h2>日志管理</h2>
          <p class="log-sub">系统运行日志 · LLM 模型生命周期 · 每日归档</p>
        </div>
        <div class="log-header-actions">
          <el-button :icon="Refresh" size="small" @click="loadAll">刷新</el-button>
          <el-dropdown trigger="click" @command="onBulkCommand">
            <el-button size="small">批量操作 <el-icon class="el-icon--right"><ArrowDown /></el-icon></el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item :command="{cmd:'archive30'}">归档 30 天前日志</el-dropdown-item>
                <el-dropdown-item :command="{cmd:'cleanup30'}">清理 30 天前日志</el-dropdown-item>
                <el-dropdown-item divided :command="{cmd:'archive90'}">归档 90 天前日志</el-dropdown-item>
                <el-dropdown-item :command="{cmd:'cleanup90'}">清理 90 天前日志</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </div>

      <!-- Summary -->
      <div class="stat-cards">
        <div class="stat-card accent">
          <div class="stat-value">{{ summary.total || 0 }}</div>
          <div class="stat-label">近 {{ summary.days || 7 }} 日日志总量</div>
        </div>
        <div class="stat-card success">
          <div class="stat-value">{{ summary.today || 0 }}</div>
          <div class="stat-label">今日新增</div>
        </div>
        <div class="stat-card warning">
          <div class="stat-value">{{ getLevelCount('ERROR') }}</div>
          <div class="stat-label">错误 ERROR</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{{ getLevelCount('WARN') }}</div>
          <div class="stat-label">警告 WARN</div>
        </div>
      </div>

      <!-- Tabs -->
      <div class="content-tabs" style="margin-top: 20px;">
        <button class="tab" :class="{active: currentTab === 'query'}" @click="currentTab='query'">检索查询</button>
        <button class="tab" :class="{active: currentTab === 'files'}" @click="currentTab='files'">日志文件</button>
      </div>

      <!-- =========== QUERY VIEW =========== -->
      <div v-if="currentTab === 'query'" class="log-query">
        <el-card class="log-filter-card">
          <div class="log-filter-row">
            <div class="log-filter-field">
              <label>起始日期</label>
              <el-date-picker v-model="filters.date_from" type="date" value-format="YYYY-MM-DD"
                :disabled="isLoading" placeholder="YYYY-MM-DD" style="width:100%;" @change="onFilterChange" />
            </div>
            <div class="log-filter-field">
              <label>结束日期</label>
              <el-date-picker v-model="filters.date_to" type="date" value-format="YYYY-MM-DD"
                :disabled="isLoading" placeholder="YYYY-MM-DD" style="width:100%;" @change="onFilterChange" />
            </div>
            <div class="log-filter-field">
              <label>级别</label>
              <el-select v-model="filters.level" clearable placeholder="全部级别" style="width:100%;" @change="onFilterChange">
                <el-option label="DEBUG" value="DEBUG" />
                <el-option label="INFO" value="INFO" />
                <el-option label="WARN" value="WARN" />
                <el-option label="ERROR" value="ERROR" />
                <el-option label="FATAL" value="FATAL" />
              </el-select>
            </div>
            <div class="log-filter-field">
              <label>模块</label>
              <el-select v-model="filters.module" clearable placeholder="全部模块" style="width:100%;" @change="onFilterChange">
                <el-option v-for="m in availableModules" :key="m" :label="m" :value="m" />
              </el-select>
            </div>
            <div class="log-filter-field">
              <label>模型</label>
              <el-select v-model="filters.model" clearable placeholder="全部模型" style="width:100%;" @change="onFilterChange">
                <el-option v-for="m in availableModels" :key="m" :label="m || '(无模型)'" :value="m" />
              </el-select>
            </div>
          </div>
          <div class="log-filter-row" style="margin-top: 12px;">
            <div class="log-filter-field log-filter-field-wide">
              <label>关键词检索</label>
              <el-input v-model="filters.keyword" placeholder="支持 message/extra JSON 全文匹配..."
                clearable @keyup.enter="runQuery" @clear="onFilterChange">
                <template #prefix><el-icon><Search /></el-icon></template>
              </el-input>
            </div>
            <div class="log-filter-field">
              <label>排序</label>
              <el-select v-model="filters.order" style="width:100%;" @change="onFilterChange">
                <el-option label="时间倒序 (新→旧)" value="desc" />
                <el-option label="时间正序 (旧→新)" value="asc" />
              </el-select>
            </div>
            <div class="log-filter-field log-filter-field-action">
              <el-button type="primary" :loading="isLoading" @click="runQuery">查询</el-button>
              <el-button @click="resetFilters">重置</el-button>
            </div>
          </div>
        </el-card>

        <el-card v-if="queryResult" class="log-result-card">
          <div class="log-result-header">
            <div class="log-result-meta">
              共 <b>{{ queryResult.total }}</b> 条
              · 当前 {{ pageStart }}-{{ pageEnd }}
              · 每页 {{ filters.limit }}
            </div>
            <div class="log-result-pages">
              <el-button size="small" :disabled="filters.offset === 0" @click="pageDown">上一页</el-button>
              <el-button size="small" :disabled="!hasNextPage" @click="pageUp">下一页</el-button>
            </div>
          </div>

          <el-table :data="queryResult.items" stripe style="width:100%;"
            @row-click="openDetail" highlight-current-row ref="logTableRef"
            empty-text="当前筛选条件下没有日志记录">
            <el-table-column label="时间" width="170">
              <template #default="{row}">
                <span class="log-ts">{{ row.ts }}</span>
              </template>
            </el-table-column>
            <el-table-column label="级别" width="80">
              <template #default="{row}">
                <span class="log-level" :class="'L' + row.level">{{ row.level }}</span>
              </template>
            </el-table-column>
            <el-table-column label="模块" width="140">
              <template #default="{row}">
                <el-tag size="small" type="info" effect="plain">{{ row.module }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="模型" width="140">
              <template #default="{row}">
                <el-tag v-if="row.model" size="small" type="success" effect="light">{{ row.model }}</el-tag>
                <span v-else class="muted">—</span>
              </template>
            </el-table-column>
            <el-table-column label="消息" min-width="300">
              <template #default="{row}">
                <span class="log-msg">{{ row.message }}</span>
                <el-tag v-if="hasExtra(row)"
                  size="small" type="warning" effect="plain" class="log-extra-chip">
                  extra
                </el-tag>
              </template>
            </el-table-column>
          </el-table>

          <div class="log-result-pages" style="margin-top:12px; justify-content:flex-end;">
            <el-button size="small" :disabled="filters.offset === 0" @click="pageDown">上一页</el-button>
            <el-button size="small" :disabled="!hasNextPage" @click="pageUp">下一页</el-button>
          </div>
        </el-card>
      </div>

      <!-- =========== FILES VIEW =========== -->
      <div v-if="currentTab === 'files'" class="log-files">
        <el-card>
          <template #header>
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span>日志文件（按日期分文件，JSON 行格式）</span>
              <el-button size="small" :icon="Folder" @click="openLogDir">打开日志目录</el-button>
            </div>
          </template>
          <el-table :data="allFiles" stripe style="width:100%;"
            empty-text="暂无日志文件">
            <el-table-column label="日期" width="180">
              <template #default="{row}">
                <span>{{ row.day || '(unknown)' }}</span>
                <el-tag v-if="row.archived" size="small" type="warning" effect="plain" style="margin-left:6px;">已归档</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="name" label="文件名" min-width="260"></el-table-column>
            <el-table-column label="大小" width="120">
              <template #default="{row}">{{ formatBytes(row.size) }}</template>
            </el-table-column>
            <el-table-column label="修改时间" width="200">
              <template #default="{row}">{{ row.mtime }}</template>
            </el-table-column>
            <el-table-column label="操作" width="300">
              <template #default="{row}">
                <el-button size="small" @click="downloadFile(row)">下载</el-button>
                <el-button v-if="!row.archived" size="small" type="primary" plain
                  @click="archiveFile(row)">归档</el-button>
                <el-button v-if="!row.archived" size="small" type="danger" plain
                  @click="deleteFile(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </div>

      <!-- =========== DETAIL DRAWER =========== -->
      <el-drawer v-model="detailVisible" title="日志详情" direction="rtl" size="450px">
        <div v-if="currentDetail" class="log-detail">
          <div class="log-detail-item"><span class="k">时间</span><span class="v mono">{{ currentDetail.ts }}</span></div>
          <div class="log-detail-item"><span class="k">级别</span>
            <span class="log-level" :class="'L' + currentDetail.level">{{ currentDetail.level }}</span>
          </div>
          <div class="log-detail-item"><span class="k">模块</span><span class="v">{{ currentDetail.module }}</span></div>
          <div class="log-detail-item"><span class="k">模型</span>
            <span class="v">{{ currentDetail.model || '(none)' }}</span>
          </div>
          <div class="log-detail-item"><span class="k">消息</span>
            <div class="v log-msg-full">{{ currentDetail.message }}</div>
          </div>
          <div v-if="hasExtra(currentDetail)">
            <span class="k" style="display:block; margin-bottom:6px;">附加信息 (extra)</span>
            <pre class="log-extra">{{ formatJSON(currentDetail.extra) }}</pre>
          </div>
        </div>
      </el-drawer>
    </div>
  `,

  data() {
    const today = new Date();
    const iso = (d) => d.toISOString().slice(0, 10);
    const defaultFrom = new Date(today.getTime() - 7 * 24 * 3600 * 1000);
    return {
      currentTab: 'query',
      isLoading: false,
      summary: { total: 0, today: 0, days: 7, by_level: {}, by_model: {} },
      queryResult: null,
      allFiles: [],
      filters: {
        date_from: iso(defaultFrom),
        date_to: iso(today),
        level: '',
        module: '',
        model: '',
        keyword: '',
        order: 'desc',
        limit: 200,
        offset: 0,
      },
      availableModules: [],
      availableModels: [],
      detailVisible: false,
      currentDetail: null,
    };
  },

  computed: {
    hasNextPage() {
      if (!this.queryResult) return false;
      const { offset, limit, total } = this.queryResult;
      return offset + limit < total;
    },
    pageStart() {
      if (!this.queryResult) return 0;
      return this.queryResult.offset + 1;
    },
    pageEnd() {
      if (!this.queryResult) return 0;
      const end = this.queryResult.offset + this.queryResult.items.length;
      return Math.min(end, this.queryResult.total);
    },
  },

  mounted() {
    this.loadAll().catch(() => {});
  },

  methods: {
    async loadAll() {
      this.isLoading = true;
      try {
        await Promise.all([
          this.loadSummary().catch(() => {}),
          this.loadFiles().catch(() => {}),
        ]);
        await this.runQuery();
      } finally {
        this.isLoading = false;
      }
    },
    async loadSummary() {
      try {
        const data = await window.api.getLogSummary(7);
        this.summary = data || this.summary;
      } catch { /* ignore */ }
    },
    async loadFiles() {
      try {
        const data = await window.api.listLogFiles();
        this.allFiles = data.files || [];
      } catch { /* ignore */ }
    },
    async runQuery() {
      this.isLoading = true;
      try {
        const clean = { ...this.filters };
        if (!clean.level) delete clean.level;
        if (!clean.module) delete clean.module;
        if (!clean.model) delete clean.model;
        if (!clean.keyword) delete clean.keyword;
        const res = await window.api.queryLogs(clean);
        this.queryResult = res || { items: [], total: 0, offset: 0, limit: this.filters.limit };
        const modules = new Set();
        const models = new Set();
        (this.queryResult.items || []).forEach(e => {
          if (e.module) modules.add(e.module);
          if (e.model) models.add(e.model);
        });
        this.availableModules = Array.from(modules).sort();
        this.availableModels = Array.from(models).sort();
      } catch (e) {
        ElementPlus.ElMessage.error('查询失败: ' + (e.message || String(e)));
      } finally {
        this.isLoading = false;
      }
    },
    getLevelCount(level) {
      return (this.summary && this.summary.by_level && this.summary.by_level[level]) || 0;
    },
    hasExtra(row) {
      return row && row.extra && typeof row.extra === 'object' && Object.keys(row.extra).length > 0;
    },
    onFilterChange() {
      this.filters.offset = 0;
      this.runQuery();
    },
    resetFilters() {
      const today = new Date();
      const iso = (d) => d.toISOString().slice(0, 10);
      const from = new Date(today.getTime() - 7 * 24 * 3600 * 1000);
      this.filters = {
        date_from: iso(from),
        date_to: iso(today),
        level: '',
        module: '',
        model: '',
        keyword: '',
        order: 'desc',
        limit: 200,
        offset: 0,
      };
      this.runQuery();
    },
    pageUp() {
      this.filters.offset += this.filters.limit;
      this.runQuery();
    },
    pageDown() {
      this.filters.offset = Math.max(0, this.filters.offset - this.filters.limit);
      this.runQuery();
    },
    openDetail(row) {
      this.currentDetail = row;
      this.detailVisible = true;
    },
    formatJSON(obj) {
      try { return JSON.stringify(obj, null, 2); } catch { return String(obj); }
    },
    formatBytes(n) {
      if (n == null) return '—';
      if (n < 1024) return n + ' B';
      if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
      if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
      return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
    },
    async downloadFile(row) {
      const day = row.day || (row.name || '').replace(/\..+$/, '');
      window.open(window.api.getLogDownloadUrl(day), '_blank');
    },
    async archiveFile(row) {
      try {
        await ElementPlus.ElMessageBox.confirm(
          `归档 ${row.name}？归档后会压缩成 zip 放进 archive/ 子目录。`, '确认归档',
          { confirmButtonText: '归档', cancelButtonText: '取消', type: 'info' },
        );
      } catch { return; }
      try {
        await window.api.archiveLogDay(row.day);
        ElementPlus.ElMessage.success('已归档');
        await this.loadFiles();
      } catch (e) {
        ElementPlus.ElMessage.error('归档失败: ' + (e.message || String(e)));
      }
    },
    async deleteFile(row) {
      try {
        await ElementPlus.ElMessageBox.confirm(
          `确定永久删除 ${row.name}？此操作不可撤销。`, '确认删除',
          { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' },
        );
      } catch { return; }
      try {
        await window.api.deleteLogDay(row.day);
        ElementPlus.ElMessage.success('已删除');
        await this.loadFiles();
      } catch (e) {
        ElementPlus.ElMessage.error('删除失败: ' + (e.message || String(e)));
      }
    },
    openLogDir() {
      window.open(window.api.getLogDownloadUrl('').replace(/\/[^\/]*$/, '/'), '_blank');
    },
    async onBulkCommand(cmd) {
      try {
        if (cmd.cmd === 'archive30') {
          await ElementPlus.ElMessageBox.confirm('归档 30 天前所有日志为 zip？', '批量归档');
          await window.api.archiveLogsBefore(30);
          ElementPlus.ElMessage.success('归档完成');
        } else if (cmd.cmd === 'cleanup30') {
          await ElementPlus.ElMessageBox.confirm('永久清理 30 天前所有日志？', '批量清理');
          await window.api.cleanupLogsBefore(30);
          ElementPlus.ElMessage.success('清理完成');
        } else if (cmd.cmd === 'archive90') {
          await ElementPlus.ElMessageBox.confirm('归档 90 天前所有日志为 zip？', '批量归档');
          await window.api.archiveLogsBefore(90);
          ElementPlus.ElMessage.success('归档完成');
        } else if (cmd.cmd === 'cleanup90') {
          await ElementPlus.ElMessageBox.confirm('永久清理 90 天前所有日志？', '批量清理');
          await window.api.cleanupLogsBefore(90);
          ElementPlus.ElMessage.success('清理完成');
        }
        await this.loadFiles();
      } catch (e) {
        if (e === 'cancel' || (e && e.message === 'cancel')) return;
        ElementPlus.ElMessage.error('操作失败: ' + (e.message || String(e)));
      }
    },
  },
};

window.LogPanel = LogPanel;
