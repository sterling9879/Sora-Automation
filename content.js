// SORA QUEUE MANAGER v10
console.log('[SoraQM v10] Carregado!');

class SoraQueueManager {
  constructor() {
    this.queue = [];
    this.isRunning = false;
    this.completedCount = 0;
    this.sentCount = 0;
    this.timer = null;

    this.init();
  }

  init() {
    this.loadFromStorage();
    this.createPanel();

    if (this.isRunning) {
      this.log('Retomando...');
      setTimeout(() => this.checkPending(), 2000);
    }
  }

  // Checa o endpoint de pending - retorna true se vazio []
  async isPendingEmpty() {
    try {
      const response = await fetch('/backend-api/v1/draft?limit=20');
      if (response.ok) {
        const data = await response.json();
        const drafts = Array.isArray(data) ? data : (data.items || data.drafts || []);

        // Filtrar só os que estão pendentes/gerando
        const pending = drafts.filter(d => {
          const status = (d.status || '').toLowerCase();
          return ['pending', 'running', 'preprocessing', 'queued', 'processing', 'generating'].includes(status);
        });

        console.log('[SoraQM] Pending:', pending.length > 0 ? pending.length + ' tasks' : '[]');
        return pending.length === 0;
      }
    } catch (e) {
      this.log('Erro ao checar pending');
    }
    return false;
  }

  async submitPrompt(prompt) {
    this.log(`Enviando: "${prompt.substring(0, 30)}..."`);

    try {
      const textarea = document.querySelector('textarea');
      if (!textarea) throw new Error('Textarea nao encontrada');

      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(textarea, prompt);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));

      await this.sleep(500);

      const btn = this.findCreateButton();
      if (!btn) throw new Error('Botao nao encontrado');

      let tries = 0;
      while (btn.disabled && tries < 10) {
        await this.sleep(300);
        tries++;
      }

      if (btn.disabled) throw new Error('Botao desabilitado');

      btn.click();
      this.log('Enviado!');
      this.sentCount++;
      this.saveToStorage();
      this.updateUI();
      return true;

    } catch (e) {
      this.log(`Erro: ${e.message}`);
      return false;
    }
  }

  findCreateButton() {
    for (const btn of document.querySelectorAll('button')) {
      const sr = btn.querySelector('.sr-only');
      if (sr && sr.textContent.includes('Create')) return btn;
    }
    return null;
  }

  // Envia os 3 primeiros de cara
  async enviarIniciais() {
    this.log('Enviando 3 iniciais...');

    for (let i = 0; i < 3 && this.queue.length > 0; i++) {
      if (!this.isRunning) return;

      const prompt = this.queue.shift();
      this.saveToStorage();

      const ok = await this.submitPrompt(prompt);
      if (!ok) {
        this.queue.unshift(prompt);
        this.saveToStorage();
        break;
      }

      await this.sleep(2000); // espera 2s entre cada envio inicial
    }

    // Começa a checar pending
    this.log('Monitorando pending...');
    this.checkPending();
  }

  // Loop que checa o pending
  async checkPending() {
    if (!this.isRunning) return;

    // Verificar se acabou a fila
    if (this.queue.length === 0) {
      this.log('Fila vazia! Concluido.');
      this.stop();
      return;
    }

    // Checar se pending está vazio
    const isEmpty = await this.isPendingEmpty();

    if (isEmpty) {
      // Slot vazio! Espera 5s e envia
      this.log('Pending [] - Slot vazio! Aguardando 5s...');
      await this.sleep(5000);

      if (!this.isRunning || this.queue.length === 0) return;

      const prompt = this.queue.shift();
      this.saveToStorage();

      const ok = await this.submitPrompt(prompt);
      if (!ok) {
        this.queue.unshift(prompt);
        this.saveToStorage();
      }
    } else {
      this.log('Pending ativo, aguardando...');
    }

    // Continuar checando a cada 3s
    this.timer = setTimeout(() => this.checkPending(), 3000);
  }

  start() {
    if (this.isRunning) return;

    const textarea = document.getElementById('sqm-prompts');
    const prompts = textarea.value.split('\n').filter(l => l.trim());

    if (prompts.length === 0) {
      this.log('Adicione prompts!');
      return;
    }

    this.queue = prompts;
    this.sentCount = 0;
    textarea.value = '';

    this.isRunning = true;
    this.saveToStorage();
    this.log(`Iniciando com ${prompts.length} prompts...`);
    this.updateUI();

    // Envia os 3 primeiros
    this.enviarIniciais();
  }

  stop() {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.log('Parado');
    this.saveToStorage();
    this.updateUI();
  }

  clear() {
    this.stop();
    this.queue = [];
    this.sentCount = 0;
    this.saveToStorage();
    this.log('Limpo');
    this.updateUI();
  }

  saveToStorage() {
    localStorage.setItem('sora_qm', JSON.stringify({
      queue: this.queue,
      sentCount: this.sentCount,
      isRunning: this.isRunning
    }));
  }

  loadFromStorage() {
    try {
      const data = JSON.parse(localStorage.getItem('sora_qm') || '{}');
      this.queue = data.queue || [];
      this.sentCount = data.sentCount || 0;
      this.isRunning = data.isRunning || false;
    } catch (e) {}
  }

  createPanel() {
    const panel = document.createElement('div');
    panel.id = 'sora-queue-panel';
    panel.innerHTML = `
      <div class="sqm-header">
        <span>Sora Queue v10</span>
        <button id="sqm-toggle">-</button>
      </div>
      <div class="sqm-body" id="sqm-body">
        <textarea id="sqm-prompts" placeholder="Um prompt por linha..."></textarea>
        <div class="sqm-status">
          <span>Fila: <b id="sqm-queue">0</b></span>
          <span>Enviados: <b id="sqm-done">0</b></span>
        </div>
        <div class="sqm-buttons">
          <button id="sqm-start">Iniciar</button>
          <button id="sqm-stop" disabled>Parar</button>
          <button id="sqm-clear">Limpar</button>
        </div>
        <div class="sqm-log" id="sqm-log"></div>
      </div>
    `;
    document.body.appendChild(panel);

    const style = document.createElement('style');
    style.textContent = `
      #sora-queue-panel {
        position: fixed; top: 10px; right: 10px; width: 300px;
        background: #1a1a2e; border: 1px solid #4a4a6a; border-radius: 8px;
        font-family: system-ui; font-size: 13px; color: #fff; z-index: 99999;
      }
      .sqm-header {
        display: flex; justify-content: space-between; padding: 8px 12px;
        background: #667eea; border-radius: 7px 7px 0 0; font-weight: bold;
      }
      .sqm-header.running { background: #10b981; }
      .sqm-header button { background: none; border: none; color: #fff; cursor: pointer; }
      .sqm-body { padding: 10px; }
      #sqm-prompts {
        width: 100%; height: 80px; background: #252545; border: 1px solid #4a4a6a;
        border-radius: 4px; color: #fff; padding: 8px; resize: vertical; box-sizing: border-box;
      }
      .sqm-status { display: flex; justify-content: space-around; margin: 8px 0; font-size: 12px; }
      .sqm-buttons { display: flex; gap: 5px; }
      .sqm-buttons button { flex: 1; padding: 6px; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; }
      #sqm-start { background: #10b981; color: #fff; }
      #sqm-stop { background: #ef4444; color: #fff; }
      #sqm-clear { background: #6b7280; color: #fff; }
      button:disabled { opacity: 0.5; }
      .sqm-log { margin-top: 8px; height: 100px; overflow-y: auto; background: #0d0d1a; border-radius: 4px; padding: 6px; font-size: 11px; font-family: monospace; }
      .sqm-log div { margin: 2px 0; color: #a0a0c0; }
    `;
    document.head.appendChild(style);

    document.getElementById('sqm-toggle').onclick = () => {
      const body = document.getElementById('sqm-body');
      body.style.display = body.style.display === 'none' ? 'block' : 'none';
    };
    document.getElementById('sqm-start').onclick = () => this.start();
    document.getElementById('sqm-stop').onclick = () => this.stop();
    document.getElementById('sqm-clear').onclick = () => this.clear();

    this.updateUI();
  }

  updateUI() {
    const q = document.getElementById('sqm-queue');
    const d = document.getElementById('sqm-done');
    const start = document.getElementById('sqm-start');
    const stop = document.getElementById('sqm-stop');
    const header = document.querySelector('.sqm-header');

    if (q) q.textContent = this.queue.length;
    if (d) d.textContent = this.sentCount;
    if (start) start.disabled = this.isRunning;
    if (stop) stop.disabled = !this.isRunning;
    if (header) header.classList.toggle('running', this.isRunning);
  }

  log(msg) {
    console.log('[SoraQM]', msg);
    const log = document.getElementById('sqm-log');
    if (log) {
      const time = new Date().toLocaleTimeString('pt-BR');
      log.innerHTML += `<div>[${time}] ${msg}</div>`;
      log.scrollTop = log.scrollHeight;
    }
  }

  sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
}

// Iniciar
if (!window.soraQM && location.href.includes('sora.chatgpt.com')) {
  setTimeout(() => {
    window.soraQM = new SoraQueueManager();
  }, 1000);
}
