// SORA QUEUE MANAGER v9
console.log('[SoraQM v9] Carregado!');

class SoraQueueManager {
  constructor() {
    this.queue = [];
    this.isRunning = false;
    this.completedCount = 0;

    this.init();
  }

  init() {
    this.loadFromStorage();
    this.createPanel();

    if (this.isRunning && this.queue.length > 0) {
      this.log('Retomando...');
      setTimeout(() => this.loop(), 2000);
    }
  }

  async getPendingCount() {
    try {
      // Precisa estar em /drafts pra funcionar
      if (!location.href.includes('/drafts')) {
        return -1; // sinaliza que precisa navegar
      }

      const response = await fetch('/backend-api/v1/draft?limit=20');
      if (response.ok) {
        const data = await response.json();
        const drafts = Array.isArray(data) ? data : (data.items || data.drafts || []);

        const pending = drafts.filter(d => {
          const status = (d.status || '').toLowerCase();
          return ['pending', 'running', 'preprocessing', 'queued', 'processing', 'generating'].includes(status);
        });

        return pending.length;
      }
    } catch (e) {
      this.log('Erro ao ler drafts');
    }
    return 0;
  }

  async submitPrompt(prompt) {
    // Precisa estar na home
    if (location.href.includes('/drafts')) {
      return false;
    }

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
      this.completedCount++;
      this.saveToStorage();
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

  async loop() {
    if (!this.isRunning || this.queue.length === 0) {
      if (this.queue.length === 0) this.log('Fila vazia!');
      this.stop();
      return;
    }

    // PASSO 1: Ir pra /drafts e ler pending
    if (!location.href.includes('/drafts')) {
      this.log('Indo para /drafts...');
      this.saveToStorage();
      location.href = 'https://sora.chatgpt.com/drafts';
      return;
    }

    const pending = await this.getPendingCount();
    this.log(`Pending: ${pending}/3 | Fila: ${this.queue.length}`);
    this.updateUI();

    // PASSO 2: Se tem slot, esperar 5s e ir enviar
    if (pending < 3) {
      this.log('Slot disponivel! Aguardando 5s...');
      await this.sleep(5000);

      if (!this.isRunning) return;

      // Pegar prompt e salvar
      const prompt = this.queue.shift();
      localStorage.setItem('sora_qm_prompt', prompt);
      this.saveToStorage();

      // Ir pra home enviar
      this.log('Indo enviar...');
      location.href = 'https://sora.chatgpt.com/';
      return;
    }

    // PASSO 3: Sem slot, esperar 5s e checar de novo
    this.log('Sem slot. Aguardando 5s...');
    await this.sleep(5000);
    this.loop();
  }

  // Chamado na home pra enviar o prompt pendente
  async enviarPendente() {
    const prompt = localStorage.getItem('sora_qm_prompt');
    if (!prompt) return;

    localStorage.removeItem('sora_qm_prompt');
    await this.sleep(1500);

    const ok = await this.submitPrompt(prompt);
    if (!ok) {
      this.queue.unshift(prompt);
      this.saveToStorage();
    }

    this.updateUI();

    // Voltar pro /drafts pra continuar o loop
    if (this.isRunning) {
      await this.sleep(1000);
      location.href = 'https://sora.chatgpt.com/drafts';
    }
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
    this.completedCount = 0;
    textarea.value = '';

    this.isRunning = true;
    this.saveToStorage();
    this.log(`Iniciando com ${prompts.length} prompts...`);
    this.updateUI();

    this.loop();
  }

  stop() {
    this.isRunning = false;
    localStorage.removeItem('sora_qm_prompt');
    this.log('Parado');
    this.saveToStorage();
    this.updateUI();
  }

  clear() {
    this.stop();
    this.queue = [];
    this.completedCount = 0;
    this.saveToStorage();
    this.log('Limpo');
    this.updateUI();
  }

  saveToStorage() {
    localStorage.setItem('sora_qm', JSON.stringify({
      queue: this.queue,
      completedCount: this.completedCount,
      isRunning: this.isRunning
    }));
  }

  loadFromStorage() {
    try {
      const data = JSON.parse(localStorage.getItem('sora_qm') || '{}');
      this.queue = data.queue || [];
      this.completedCount = data.completedCount || 0;
      this.isRunning = data.isRunning || false;
    } catch (e) {}
  }

  createPanel() {
    const panel = document.createElement('div');
    panel.id = 'sora-queue-panel';
    panel.innerHTML = `
      <div class="sqm-header">
        <span>Sora Queue v9</span>
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
    if (d) d.textContent = this.completedCount;
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

    // Se tem prompt pra enviar (veio da navegacao)
    if (!location.href.includes('/drafts') && localStorage.getItem('sora_qm_prompt')) {
      window.soraQM.enviarPendente();
    }
  }, 1000);
}
