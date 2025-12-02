// SORA QUEUE MANAGER v5 - Simples
console.log('[SoraQM v5] Carregado!');

class SoraQueueManager {
  constructor() {
    this.queue = [];
    this.isRunning = false;
    this.maxConcurrent = 3;
    this.activePrompts = []; // prompts enviados aguardando conclusao
    this.completedCount = 0;
    this.pollingTimer = null;

    this.init();
  }

  init() {
    this.loadFromStorage();
    this.createPanel();
    this.log('Pronto!');
  }

  // Busca drafts e retorna array de prompts
  async getDrafts() {
    try {
      const response = await fetch('/backend-api/v1/draft?limit=20');
      if (response.ok) {
        const data = await response.json();
        // Extrair prompts dos drafts
        const drafts = Array.isArray(data) ? data : (data.items || data.drafts || []);
        return drafts.map(d => (d.prompt || d.text || '').trim().toLowerCase());
      }
    } catch (e) {
      console.error('[SoraQM] Erro fetch drafts:', e);
    }
    return [];
  }

  // Verifica quantos dos prompts ativos ja apareceram nos drafts
  async checkCompleted() {
    const drafts = await this.getDrafts();

    if (drafts.length === 0) {
      this.log('Nenhum draft encontrado');
      return;
    }

    // Verificar cada prompt ativo
    const stillActive = [];
    for (const prompt of this.activePrompts) {
      const normalized = prompt.trim().toLowerCase();
      if (drafts.includes(normalized)) {
        // Apareceu nos drafts = concluiu!
        this.log(`Concluido: "${prompt.substring(0, 30)}..."`);
        this.completedCount++;
      } else {
        stillActive.push(prompt);
      }
    }

    this.activePrompts = stillActive;
    this.saveToStorage();
    this.updateUI();
  }

  async submitPrompt(prompt) {
    this.log(`Enviando: "${prompt.substring(0, 35)}..."`);

    try {
      // Encontrar textarea
      const textarea = document.querySelector('textarea');
      if (!textarea) throw new Error('Textarea nao encontrada');

      // Preencher
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(textarea, prompt);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));

      await this.sleep(800);

      // Encontrar botao
      const btn = this.findCreateButton();
      if (!btn) throw new Error('Botao nao encontrado');

      // Esperar habilitar
      let tries = 0;
      while (btn.disabled && tries < 10) {
        await this.sleep(300);
        tries++;
      }

      if (btn.disabled) throw new Error('Botao desabilitado');

      btn.click();
      this.activePrompts.push(prompt);
      this.log('Enviado!');
      this.saveToStorage();

      await this.sleep(1500);
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

  async processLoop() {
    if (!this.isRunning) return;

    // Verificar conclusoes
    await this.checkCompleted();

    const slots = this.maxConcurrent - this.activePrompts.length;
    this.log(`Slots: ${slots}/3 | Fila: ${this.queue.length}`);

    // Enviar se tem slot
    if (slots > 0 && this.queue.length > 0) {
      const prompt = this.queue.shift();
      const ok = await this.submitPrompt(prompt);
      if (!ok) this.queue.unshift(prompt);
      this.saveToStorage();
    }

    // Verificar fim
    if (this.queue.length === 0 && this.activePrompts.length === 0) {
      this.log('Tudo concluido!');
      this.stop();
    }

    this.updateUI();
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
    this.activePrompts = [];
    this.completedCount = 0;
    textarea.value = '';

    this.isRunning = true;
    this.saveToStorage();
    this.log('Iniciando...');
    this.updateUI();

    // Loop a cada 5s
    this.processLoop();
    this.pollingTimer = setInterval(() => this.processLoop(), 5000);
  }

  stop() {
    this.isRunning = false;
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
    this.log('Parado');
    this.saveToStorage();
    this.updateUI();
  }

  clear() {
    this.queue = [];
    this.activePrompts = [];
    this.completedCount = 0;
    this.saveToStorage();
    this.log('Limpo');
    this.updateUI();
  }

  saveToStorage() {
    localStorage.setItem('sora_qm', JSON.stringify({
      queue: this.queue,
      activePrompts: this.activePrompts,
      completedCount: this.completedCount,
      isRunning: this.isRunning
    }));
  }

  loadFromStorage() {
    try {
      const data = JSON.parse(localStorage.getItem('sora_qm') || '{}');
      this.queue = data.queue || [];
      this.activePrompts = data.activePrompts || [];
      this.completedCount = data.completedCount || 0;

      if (data.isRunning) {
        this.isRunning = true;
        setTimeout(() => {
          this.processLoop();
          this.pollingTimer = setInterval(() => this.processLoop(), 5000);
        }, 2000);
      }
    } catch (e) {}
  }

  createPanel() {
    const panel = document.createElement('div');
    panel.id = 'sora-queue-panel';
    panel.innerHTML = `
      <div class="sqm-header">
        <span>Sora Queue v5</span>
        <button id="sqm-toggle">-</button>
      </div>
      <div class="sqm-body" id="sqm-body">
        <textarea id="sqm-prompts" placeholder="Um prompt por linha..."></textarea>
        <div class="sqm-status">
          <span>Gerando: <b id="sqm-active">0</b>/3</span>
          <span>Fila: <b id="sqm-queue">0</b></span>
          <span>Pronto: <b id="sqm-done">0</b></span>
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

    // Estilos
    const style = document.createElement('style');
    style.textContent = `
      #sora-queue-panel {
        position: fixed;
        top: 10px;
        right: 10px;
        width: 300px;
        background: #1a1a2e;
        border: 1px solid #4a4a6a;
        border-radius: 8px;
        font-family: system-ui;
        font-size: 13px;
        color: #fff;
        z-index: 99999;
        box-shadow: 0 4px 20px rgba(0,0,0,0.5);
      }
      .sqm-header {
        display: flex;
        justify-content: space-between;
        padding: 8px 12px;
        background: #667eea;
        border-radius: 7px 7px 0 0;
        font-weight: bold;
      }
      .sqm-header.running { background: #10b981; }
      .sqm-header button {
        background: none;
        border: none;
        color: #fff;
        cursor: pointer;
        font-size: 16px;
      }
      .sqm-body { padding: 10px; }
      #sqm-prompts {
        width: 100%;
        height: 80px;
        background: #252545;
        border: 1px solid #4a4a6a;
        border-radius: 4px;
        color: #fff;
        padding: 8px;
        resize: vertical;
        box-sizing: border-box;
      }
      .sqm-status {
        display: flex;
        justify-content: space-between;
        margin: 8px 0;
        font-size: 12px;
      }
      .sqm-buttons {
        display: flex;
        gap: 5px;
      }
      .sqm-buttons button {
        flex: 1;
        padding: 6px;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-weight: bold;
      }
      #sqm-start { background: #10b981; color: #fff; }
      #sqm-stop { background: #ef4444; color: #fff; }
      #sqm-clear { background: #6b7280; color: #fff; }
      button:disabled { opacity: 0.5; cursor: not-allowed; }
      .sqm-log {
        margin-top: 8px;
        height: 100px;
        overflow-y: auto;
        background: #0d0d1a;
        border-radius: 4px;
        padding: 6px;
        font-size: 11px;
        font-family: monospace;
      }
      .sqm-log div { margin: 2px 0; color: #a0a0c0; }
    `;
    document.head.appendChild(style);

    // Eventos
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
    const a = document.getElementById('sqm-active');
    const q = document.getElementById('sqm-queue');
    const d = document.getElementById('sqm-done');
    const start = document.getElementById('sqm-start');
    const stop = document.getElementById('sqm-stop');
    const header = document.querySelector('.sqm-header');

    if (a) a.textContent = this.activePrompts.length;
    if (q) q.textContent = this.queue.length;
    if (d) d.textContent = this.completedCount;

    if (start) start.disabled = this.isRunning;
    if (stop) stop.disabled = !this.isRunning;

    if (header) {
      header.classList.toggle('running', this.isRunning);
    }
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

  sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}

// Iniciar
if (!window.soraQM && location.href.includes('sora.chatgpt.com')) {
  setTimeout(() => {
    window.soraQM = new SoraQueueManager();
  }, 1000);
}
