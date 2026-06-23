/**
 * app.js — LiangLLM Main Vue 3 Application
 */

const { Monitor, Cpu, ChatDotSquare, Setting, DataAnalysis, Refresh, Loading, Histogram, Tools, FolderOpened, Connection, InfoFilled } = ElementPlusIconsVue;

const app = Vue.createApp({
  data() {
    return {
      activeView: 'dashboard',
      globalConfig: {},
      models: [],
      instances: [],
      backendInfo: null,
      metricsData: {},
      profiles: [],
      selectedModelParams: null,
      loadingModel: '',
      unloadingModel: '',
      scanning: false,
      apiBase: 'http://127.0.0.1:19600',
      pollTimer: null,
      readyPollTimer: null,
      autoLoadNotified: false,
    };
  },

  computed: {
    metricsSummary() {
      return this.metricsData?.summary || {};
    },
    backendAvailable() {
      return this.backendInfo?.available === true;
    },
  },

  async mounted() {
    window.api = window.LiangApi;

    this.backendInfo = { label: '连接后端中...', available: false, gpu_devices: [] };

    this.readyPollTimer = setInterval(() => this.checkBackend(), 1500);
    this.checkBackend();
    this.pollTimer = setInterval(() => this.pollLight(), 10000);
  },

  beforeUnmount() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.readyPollTimer) clearInterval(this.readyPollTimer);
  },

  methods: {
    async checkBackend() {
      try {
        const status = await window.api.getStatus();
        this.backendInfo = status.backend;
        this.backendInfo.models_dir = status.models_dir;
        this.backendInfo.server_path = status.backend.server_path;
        this.globalConfig = status.config || {};
        this.models = status.models_count > 0 ? this.models : [];

        if (status.backend.available) {
          if (this.readyPollTimer) clearInterval(this.readyPollTimer);
          this.readyPollTimer = null;
          this.loadAllData();
          this.notifyAutoLoad(status.auto_load);
        }
        if (this.backendInfo.label !== status.backend.label) {
          this.backendInfo = status.backend;
        }
      } catch (e) {
        this.backendInfo = { label: '等待后端启动...', available: false, gpu_devices: [] };
      }
    },

    async loadAllData() {
      try {
        const [modelsData, instancesData, metricsData, profilesData] = await Promise.all([
          window.api.listModels(),
          window.api.listInstances(),
          window.api.getMetrics(),
          window.api.listProfiles(),
        ]);
        this.models = modelsData.models;
        this.instances = instancesData.instances;
        this.metricsData = metricsData;
        this.profiles = profilesData.profiles;
      } catch (e) {
        console.error('loadAllData error:', e);
      }
    },

    async pollLight() {
      try {
        const instancesData = await window.api.listInstances();
        this.instances = instancesData.instances;
        const metricsData = await window.api.getMetrics();
        this.metricsData = metricsData;
      } catch (e) {}
    },

    async refreshAll() {
      try {
        const status = await window.api.getStatus();
        this.backendInfo = status.backend;
        this.backendInfo.models_dir = status.models_dir;
        this.backendInfo.server_path = status.backend.server_path;
        if (status.backend.available) {
          await this.loadAllData();
          this.notifyAutoLoad(status.auto_load);
        }
      } catch (e) {
        ElementPlus.ElMessage.warning('后端暂未就绪');
      }
    },

    notifyAutoLoad(autoLoad) {
      if (!autoLoad || autoLoad.status !== 'ok' || this.autoLoadNotified) return;
      this.autoLoadNotified = true;
      const elapsed = autoLoad.elapsed_seconds ? ` (${autoLoad.elapsed_seconds.toFixed(1)}s)` : '';
      ElementPlus.ElMessage.success(`自动加载 ${autoLoad.family} 成功${elapsed}`);
    },

    async refreshModels() {
      this.scanning = true;
      ElementPlus.ElMessage({ message: '正在扫描模型目录...', duration: 1500 });
      try {
        const data = await window.api.listModels();
        this.models = data.models;
        ElementPlus.ElMessage.success(`发现 ${this.models.length} 个模型`);
      } catch (e) {
        ElementPlus.ElMessage.error(`扫描失败: ${e.message}`);
      } finally {
        this.scanning = false;
      }
    },

    async refreshMetrics() {
      try {
        const data = await window.api.getMetrics();
        this.metricsData = data;
      } catch (e) {
        ElementPlus.ElMessage.error(`获取指标失败: ${e.message}`);
      }
    },

    async resetMetrics() {
      try {
        await window.api.resetMetrics();
        await this.refreshMetrics();
        ElementPlus.ElMessage.success('指标已重置');
      } catch (e) {
        ElementPlus.ElMessage.error(`重置失败: ${e.message}`);
      }
    },

    async onLoadModel(family) {
      try {
        await ElementPlus.ElMessageBox.confirm(
          `确定要加载模型 "${family}" 吗？\n加载后将启动 llama-server 占用 GPU / CPU 资源。`,
          {
            title: '确认加载',
            type: 'warning',
            confirmButtonText: '加载',
            cancelButtonText: '取消',
          },
        );
      } catch (_) {
        return;
      }

      this.loadingModel = family;
      const loadMsg = ElementPlus.ElMessage({
        message: `正在加载 ${family}，请稍候...`,
        duration: 0,
        showClose: true,
      });
      try {
        const result = await window.api.loadModel(family);
        loadMsg.close();
        if (result.ok) {
          ElementPlus.ElMessage.success(`模型 ${family} 已加载 (端口 ${result.port})`);
        } else {
          ElementPlus.ElMessage.error(`加载失败: ${result.error}`);
          if (result.log_tail) console.error('Log tail:', result.log_tail);
        }
      } catch (e) {
        loadMsg.close();
        ElementPlus.ElMessage.error(`加载失败: ${e.message}`);
      } finally {
        this.loadingModel = '';
        await this.refreshModels();
      }
    },

    async onUnloadModel(family) {
      try {
        await ElementPlus.ElMessageBox.confirm(
          `确定要卸载模型 "${family}" 吗？\nllama-server 进程将被终止，GPU/CPU 资源释放。`,
          {
            title: '确认卸载',
            type: 'warning',
            confirmButtonText: '卸载',
            cancelButtonText: '取消',
          },
        );
      } catch (_) {
        return;
      }

      this.unloadingModel = family;
      const unloadMsg = ElementPlus.ElMessage({
        message: `正在卸载 ${family}...`,
        duration: 0,
        showClose: true,
      });
      try {
        const result = await window.api.unloadModel(family);
        unloadMsg.close();
        if (result.ok) {
          ElementPlus.ElMessage.success(`模型 ${family} 已卸载`);
        } else {
          ElementPlus.ElMessage.error(`卸载失败: ${result.error || '请确认模型是否正在运行'}`);
        }
      } catch (e) {
        unloadMsg.close();
        ElementPlus.ElMessage.error(`卸载失败: ${e.message}`);
      } finally {
        this.unloadingModel = '';
        await this.refreshModels();
      }
    },

    async onSelectModelForConfig(family) {
      try {
        const data = await window.api.getModelParams(family);
        this.selectedModelParams = data.all_params;
      } catch (e) {
        ElementPlus.ElMessage.error(`获取参数失败: ${e.message}`);
      }
    },

    async onSaveModelConfig(family, params) {
      try {
        const result = await window.api.loadModel(family, params);
        if (result.ok) {
          ElementPlus.ElMessage.success(`参数已保存并应用到 ${family}`);
        } else {
          ElementPlus.ElMessage.warning(`配置已保存，但加载失败: ${result.error}`);
        }
      } catch (e) {
        ElementPlus.ElMessage.success('参数配置已保存');
      }
      await this.refreshModels();
    },

    async onSaveProfile(name, params, description) {
      try {
        await window.api.saveProfile(name, params, description);
        ElementPlus.ElMessage.success(`配置集 "${name}" 已保存`);
        const data = await window.api.listProfiles();
        this.profiles = data.profiles;
      } catch (e) {
        ElementPlus.ElMessage.error(`保存失败: ${e.message}`);
      }
    },

    async onDeleteProfile(name) {
      try {
        await window.api.deleteProfile(name);
        ElementPlus.ElMessage.success(`配置集 "${name}" 已删除`);
        const data = await window.api.listProfiles();
        this.profiles = data.profiles;
      } catch (e) {
        ElementPlus.ElMessage.error(`删除失败: ${e.message}`);
      }
    },

    async onSaveGlobalConfig(config) {
      try {
        await window.api.saveGlobalConfig(config);
        ElementPlus.ElMessage.success('全局配置已保存');
      } catch (e) {
        ElementPlus.ElMessage.error(`保存失败: ${e.message}`);
      }
    },

    onMenuSelect(view) {
      this.activeView = view;
      if (view === 'dashboard' || view === 'models') {
        this.refreshAll();
      } else if (view === 'metrics') {
        this.refreshMetrics();
      }
    },
  },
});

app.use(ElementPlus);
for (const [name, component] of Object.entries(ElementPlusIconsVue)) {
  if (app.component(name)) continue;
  app.component(name, component);
}

app.component('dashboard-panel', window.DashboardPanel);
app.component('model-manager', window.ModelManager);
app.component('chat-panel', window.ChatPanel);
app.component('config-panel', window.ConfigPanel);
app.component('system-panel', window.SystemPanel);
app.component('metrics-panel', window.MetricsPanel);
app.component('benchmark-panel', window.BenchmarkPanel);
app.component('log-panel', window.LogPanel);

app.mount('#app');
