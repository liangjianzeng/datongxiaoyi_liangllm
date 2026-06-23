/**
 * chat-panel.js — Vue 3 Chat Component
 */

const ChatPanel = {
  name: 'ChatPanel',
  props: { instances: Array, apiBase: String },
  template: `
    <div class="chat-root">
      <div class="chat-header">
        <div class="chat-header-left">
          <h2>对话</h2>
          <el-tag v-if="selectedModel" size="small" effect="plain">{{ selectedModel }}</el-tag>
          <el-tag v-if="streaming" size="small" type="warning">生成中</el-tag>
        </div>
        <div class="chat-header-right">
          <el-select v-model="selectedModel" placeholder="选择已加载的模型" size="default" style="width:220px;">
            <el-option
              v-for="inst in availableInstances"
              :key="inst.family"
              :label="inst.family + ' :' + inst.port"
              :value="inst.family"
            />
          </el-select>
          <el-button :icon="Setting" size="default" plain
            :type="showSettings ? 'primary' : ''"
            @click="showSettings = !showSettings">参数</el-button>
          <el-button :icon="Refresh" size="default" plain @click="clearChat">新会话</el-button>
        </div>
      </div>

      <div class="chat-container">
        <div ref="messageContainer" class="chat-messages">
          <div v-if="!messages.length && !streaming" class="chat-empty">
            <div class="chat-empty-icon">&#128172;</div>
            <p>选择一个已加载的模型开始对话</p>
            <p class="chat-empty-hint">在"模型管理"中加载模型后，即可在此对话</p>
          </div>

          <div v-for="(msg, idx) in messages" :key="msg._id || ('m' + idx)"
            :class="['chat-message', msg.role]">
            <div class="msg-header">
              <span class="msg-dot"></span>
              {{ msg.role === 'user' ? '你' : msg.role === 'assistant' ? modelName : '系统' }}
            </div>
            <div class="msg-body" v-html="renderMessage(msg.content)"></div>
          </div>

          <div v-if="streaming" class="chat-message assistant">
            <div class="msg-header">
              <span class="msg-dot"></span>
              {{ modelName }}
            </div>
            <div class="msg-body">{{ streamContent }}<span class="stream-cursor">▍</span></div>
          </div>
        </div>

        <div class="chat-input-wrap">
          <div v-if="showSettings" class="chat-settings">
            <div class="chat-settings-row full">
              <span class="chat-settings-label">系统提示词</span>
              <el-input
                v-model="systemPrompt"
                type="textarea"
                :rows="1"
                autosize
                placeholder="可选，例如：你是一个有帮助的中文助手。"
                size="small"
                resize="none"
              />
            </div>
            <div class="chat-settings-row">
              <div class="chat-settings-field">
                <span class="chat-settings-label">温度</span>
                <el-slider v-model="temperature" :min="0" :max="2" :step="0.05" :show-tooltip="true" />
              </div>
              <div class="chat-settings-field">
                <span class="chat-settings-label">Top-P</span>
                <el-slider v-model="topP" :min="0" :max="1" :step="0.05" :show-tooltip="true" />
              </div>
              <div class="chat-settings-field">
                <span class="chat-settings-label">最大 Token</span>
                <el-input-number v-model="maxTokens" :min="64" :max="32768" :step="256"
                  size="small" controls-position="right" />
              </div>
            </div>
          </div>

          <div class="chat-input-row">
            <el-input
              v-model="userInput"
              type="textarea"
              :rows="2"
              :autosize="{ minRows: 2, maxRows: 6 }"
              placeholder="输入消息，Enter 发送，Shift+Enter 换行"
              @keydown.enter.exact.prevent="sendMessage"
              :disabled="streaming || !selectedModel"
              resize="none"
            />
            <button :class="['chat-send', {stop: streaming}]"
              :disabled="(!canSend) || (!!streaming)"
              @click="streaming ? stopStreaming() : sendMessage()"
              :title="streaming ? '停止生成' : (canSend ? '发送' : '请选择模型并输入内容')">
              <svg v-if="!streaming" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
              <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12"/></svg>
            </button>
          </div>
          <div v-if="!selectedModel" class="chat-input-hint">请先在"模型管理"中加载一个模型</div>
        </div>
      </div>
    </div>
  `,
  data() {
    return {
      _nextId: 1,
      messages: [],
      userInput: '',
      selectedModel: '',
      streaming: false,
      streamContent: '',
      abortController: null,
      showSettings: false,
      systemPrompt: '',
      temperature: 0.7,
      maxTokens: 4096,
      topP: 0.9,
    };
  },
  computed: {
    availableInstances() {
      return (this.instances || []).filter(i => i && (i.status === 'running' || i.status === 'ok' || i.running === true));
    },
    modelName() { return this.selectedModel || '模型'; },
    canSend() { return !!(this.userInput && this.userInput.trim() && this.selectedModel); },
  },
  methods: {
    _uid() { return 'm_' + (this._nextId++); },

    async sendMessage() {
      if (!this.canSend || this.streaming) return;

      const text = this.userInput.trim();
      this.userInput = '';

      const userMsg = { _id: this._uid(), role: 'user', content: text };
      this.messages.push(userMsg);
      this.messages = [...this.messages];

      const apiMessages = [];
      if (this.systemPrompt.trim()) {
        apiMessages.push({ role: 'system', content: this.systemPrompt.trim() });
      }
      for (const m of this.messages) {
        apiMessages.push({ role: m.role, content: m.content });
      }

      this.streaming = true;
      this.streamContent = '';
      this.abortController = new AbortController();
      let ok = false;

      try {
        const resp = await window.api.chatStream(
          this.selectedModel, apiMessages,
          { max_tokens: this.maxTokens, temperature: this.temperature, top_p: this.topP },
          this.abortController.signal,
        );

        if (!resp.ok) {
          let detail = `HTTP ${resp.status}`;
          try {
            const t = await resp.clone().text();
            detail = t.slice(0, 300);
            try { detail = JSON.parse(detail).detail || detail; } catch {}
          } catch {}
          throw new Error(detail);
        }

        if (!resp.body || !resp.body.getReader) throw new Error('流式响应不可读');

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() || '';

          for (const raw of lines) {
            const line = raw.trim();
            if (!line || !line.startsWith('data:')) continue;
            const chunk = line.slice(5).trim();
            if (!chunk) continue;
            if (chunk === '[DONE]') { ok = true; break; }

            try {
              const data = JSON.parse(chunk);
              if (!data || typeof data !== 'object') { this.streamContent += chunk; continue; }
              if (data._metrics) continue;
              if (data.error) { this.streamContent += `\n[错误: ${data.error}]`; continue; }
              if (data.choices && Array.isArray(data.choices) && data.choices[0]) {
                const c = data.choices[0];
                const delta = c.delta || {};
                const content = delta.content || c.content || '';
                if (content) {
                  this.streamContent += content;
                  this.scrollToBottom();
                }
              }
            } catch {
              if (chunk.length < 500) this.streamContent += chunk;
            }
          }
          if (ok) break;
        }
      } catch (e) {
        if (e && e.name === 'AbortError') {
          // user stopped
        } else {
          const msg = (e && e.message) ? e.message : String(e);
          if (this.streamContent && this.streamContent.trim()) this.streamContent += `\n\n[出错: ${msg}]`;
          else this.streamContent = `[出错: ${msg}]`;
          try { ElementPlus.ElMessage.error(`对话失败: ${msg}`); } catch {}
        }
      } finally {
        const finalContent = (this.streamContent || '').trim();
        if (finalContent) {
          this.messages.push({ _id: this._uid(), role: 'assistant', content: this.streamContent });
          this.messages = [...this.messages];
        }
        this.streaming = false;
        this.streamContent = '';
        this.abortController = null;
        this.scrollToBottom();
      }
    },

    stopStreaming() {
      const ctrl = this.abortController;
      this.abortController = null;
      this.streaming = false;
      try { if (ctrl && typeof ctrl.abort === 'function') ctrl.abort(); } catch {}
      if (this.streamContent && this.streamContent.trim()) {
        this.messages.push({ _id: this._uid(), role: 'assistant', content: this.streamContent + '\n\n[已停止]' });
        this.messages = [...this.messages];
      }
      this.streamContent = '';
      this.scrollToBottom();
    },

    clearChat() { this.messages = []; this.streamContent = ''; this.streaming = false; },

    scrollToBottom() {
      this.$nextTick(() => {
        const c = this.$refs.messageContainer;
        if (c) c.scrollTop = c.scrollHeight;
      });
    },

    renderMessage(content) {
      if (!content) return '';
      let html = this.escapeHtml(content);
      html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => `<pre><code>${this.escapeHtml(code)}</code></pre>`);
      html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
      html = html.replace(/\n/g, '<br>');
      return html;
    },

    escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    },
  },
};

window.ChatPanel = ChatPanel;