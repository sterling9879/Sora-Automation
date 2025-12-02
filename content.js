// ========================================
// SORA QUEUE MANAGER v4 - Content Script
// Gerenciador de fila usando endpoint de DRAFTS
// ========================================

console.log('%c[Sora Queue Manager v4] Script carregado!', 'background: #667eea; color: white; padding: 4px 8px; border-radius: 4px;');

class SoraQueueManager {
  constructor() {
    this.queue = [];
    this.isRunning = false;
    this.isPaused = false;
    this.maxConcurrent = 3;
    this.pollingInterval = 5000; // 5 segundos
    this.pollingTimer = null;

    // Prompts enviados mas ainda não apareceram nos drafts
    this.submittedPrompts = [];

    // Endpoint de drafts
    this.draftsEndpoint = '/backend-api/v1/draft?limit=20';

    // Prompts já vistos nos drafts (para comparar)
    this.knownDraftPrompts = new Set();

    this.completedCount = 0;

    this.init();
  }

  init() {
    console.log('[SoraQM] Inicializando v4...');
    this.loadFromStorage();
    this.interceptFetch();
    this.createPanel();
    this.log('Extensao iniciada v4');

    // Descobrir endpoint de drafts automaticamente
    this.discoverDraftsEndpoint();
  }

  // ========================================
  // Interceptacao de Fetch para descobrir endpoint
  // ========================================

  interceptFetch() {
    const originalFetch = window.fetch;
    const self = this;

    window.fetch = async function(...args) {
      const response = await originalFetch.apply(this, args);

      try {
        const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;

        if (url && url.includes('/draft')) {
          // Capturar endpoint de drafts
          const baseUrl = url.split('?')[0];
          self.draftsEndpoint = url;
          console.log('[SoraQM] Drafts endpoint detectado:', url);

          // Capturar dados dos drafts
          const cloned = response.clone();
          cloned.json().then(data => {
            self.processDraftsResponse(data);
          }).catch(() => {});
        }
      } catch (e) {
        console.error('[SoraQM] Erro ao interceptar:', e);
      }

      return response;
    };
  }

  async discoverDraftsEndpoint() {
    this.log('Detectando endpoint de drafts...');

    // Verificar se estamos na pagina de drafts
    if (!window.location.href.includes('/drafts')) {
      this.log('Navegue para /drafts antes de iniciar');
    }

    // Tentar buscar drafts
    const endpoints = [
      '/backend-api/v1/draft?limit=20',
      '/sora/backend-api/v1/draft?limit=20',
      '/api/v1/draft?limit=20'
    ];

    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint);
        if (response.ok) {
          const data = await response.json();
          if (data && (Array.isArray(data) || data.items)) {
            this.draftsEndpoint = endpoint;
            this.processDraftsResponse(data);
            this.log('Endpoint de drafts OK!');
            return;
          }
        }
      } catch (e) {
        // Tentar proximo
      }
    }
  }

  processDraftsResponse(data) {
    // Extrair prompts dos drafts
    let drafts = [];

    if (Array.isArray(data)) {
      drafts = data;
    } else if (data.items && Array.isArray(data.items)) {
      drafts = data.items;
    } else if (data.drafts && Array.isArray(data.drafts)) {
      drafts = data.drafts;
    }

    // Guardar prompts conhecidos
    const currentPrompts = new Set();

    drafts.forEach(draft => {
      const prompt = draft.prompt || draft.text || draft.description;
      if (prompt) {
        currentPrompts.add(prompt.trim().toLowerCase());
      }
    });

    // Verificar se algum prompt enviado agora aparece nos drafts
    const stillPending = [];

    for (const submitted of this.submittedPrompts) {
      const normalizedSubmitted = submitted.trim().toLowerCase();

      if (currentPrompts.has(normalizedSubmitted)) {
        // Prompt apareceu nos drafts = concluido!
        this.log(`Concluido: "${submitted.substring(0, 30)}..."`);
        this.completedCount++;
      } else {
        // Ainda pendente
        stillPending.push(submitted);
      }
    }

    this.submittedPrompts = stillPending;
    this.knownDraftPrompts = currentPrompts;

    console.log(`[SoraQM] Drafts processados. Pendentes: ${this.submittedPrompts.length}`);
    this.updateUI();
  }

  // ========================================
  // Monitoramento via Drafts
  // ========================================

  async fetchDrafts() {
    try {
      const response = await fetch(this.draftsEndpoint);
      if (response.ok) {
        const data = await response.json();
        this.processDraftsResponse(data);
      }
    } catch (e) {
      console.error('[SoraQM] Erro ao buscar drafts:', e);
    }
  }

  getActiveCount() {
    // Quantidade de prompts enviados que ainda nao apareceram nos drafts
    return this.submittedPrompts.length;
  }

  getAvailableSlots() {
    return this.maxConcurrent - this.getActiveCount();
  }

  // ========================================
  // Envio de Prompts
  // ========================================

  async submitPrompt(prompt) {
    this.log(`Enviando: "${prompt.substring(0, 40)}..."`);

    try {
      // Encontrar textarea
      let textarea = document.querySelector('textarea[placeholder="Describe your video..."]');

      if (!textarea) {
        textarea = document.querySelector('textarea');
      }

      if (!textarea) {
        throw new Error('Textarea nao encontrada');
      }

      // Preencher textarea
      this.fillReactTextarea(textarea, prompt);
      await this.sleep(1000);

      // Verificar se preencheu
      console.log('[SoraQM] Valor do textarea:', textarea.value.substring(0, 50));

      // Encontrar botao Create
      const createButton = this.findCreateButton();

      if (!createButton) {
        throw new Error('Botao Create nao encontrado');
      }

      // Aguardar botao estar habilitado
      let attempts = 0;
      while (createButton.disabled && attempts < 10) {
        console.log('[SoraQM] Botao desabilitado, aguardando...');
        await this.sleep(500);
        attempts++;
      }

      if (createButton.disabled) {
        throw new Error('Botao Create continua desabilitado');
      }

      // Clicar no botao
      console.log('[SoraQM] Clicando no botao Create...');
      createButton.click();

      // Adicionar aos prompts enviados (para tracking)
      this.submittedPrompts.push(prompt);

      this.log('Prompt enviado! Aguardando aparecer nos drafts...');
      this.saveToStorage();

      await this.sleep(2000);
      return true;

    } catch (error) {
      this.log(`Erro: ${error.message}`);
      return false;
    }
  }

  fillReactTextarea(textarea, text) {
    // Focar
    textarea.focus();
    textarea.click();

    // Limpar
    textarea.value = '';

    // Usar setter nativo para React
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    )?.set;

    if (nativeSetter) {
      nativeSetter.call(textarea, text);
    } else {
      textarea.value = text;
    }

    // Disparar eventos
    textarea.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));

    // Eventos de teclado para React
    textarea.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a' }));
    textarea.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a' }));
  }

  findCreateButton() {
    const buttons = document.querySelectorAll('button');

    // Metodo 1: Procurar por sr-only com texto "Create video"
    for (const btn of buttons) {
      const srOnly = btn.querySelector('.sr-only');
      if (srOnly && srOnly.textContent.includes('Create')) {
        console.log('[SoraQM] Botao encontrado via sr-only');
        return btn;
      }
    }

    // Metodo 2: Botao com SVG proximo do textarea
    const textarea = document.querySelector('textarea');
    if (textarea) {
      const container = textarea.closest('form') || textarea.closest('div');
      if (container) {
        const btns = container.querySelectorAll('button');
        for (const btn of btns) {
          if (btn.querySelector('svg') && !btn.disabled) {
            console.log('[SoraQM] Botao encontrado via container');
            return btn;
          }
        }
      }
    }

    // Metodo 3: Qualquer botao com SVG que nao esteja desabilitado
    for (const btn of buttons) {
      if (btn.querySelector('svg') && !btn.textContent.trim()) {
        console.log('[SoraQM] Botao encontrado via SVG');
        return btn;
      }
    }

    return null;
  }

  // ========================================
  // Loop Principal
  // ========================================

  async startProcessing() {
    if (this.isRunning) return;

    // Verificar se estamos na pagina correta
    if (!window.location.href.includes('sora.chatgpt.com')) {
      this.log('Erro: Nao estamos no Sora');
      return;
    }

    // Navegar para drafts para garantir acesso ao endpoint
    if (!window.location.href.includes('/drafts')) {
      this.log('Navegando para /drafts...');
      window.location.href = 'https://sora.chatgpt.com/drafts';
      return;
    }

    this.isRunning = true;
    this.isPaused = false;
    this.log('Processamento iniciado!');
    this.updateUI();

    // Buscar estado inicial dos drafts
    await this.fetchDrafts();

    // Esperar um pouco para garantir que estamos prontos
    await this.sleep(1000);

    // Navegar para a pagina principal para criar videos
    this.log('Indo para pagina principal...');
    window.location.href = 'https://sora.chatgpt.com/';

    // O loop sera retomado apos a navegacao
    this.saveToStorage();
  }

  async continueProcessing() {
    if (!this.isRunning || this.isPaused) return;

    this.log('Continuando processamento...');

    // Iniciar loop
    this.processLoop();
    this.pollingTimer = setInterval(() => this.checkAndProcess(), this.pollingInterval);
  }

  async processLoop() {
    if (!this.isRunning || this.isPaused) return;

    // Buscar estado atual dos drafts
    await this.fetchDrafts();

    const activeCount = this.getActiveCount();
    const slotsAvailable = this.getAvailableSlots();

    this.log(`Slots: ${slotsAvailable}/${this.maxConcurrent} | Fila: ${this.queue.length} | Gerando: ${activeCount}`);
    this.updateUI();

    // Enviar prompts enquanto houver slots
    if (slotsAvailable > 0 && this.queue.length > 0) {
      const prompt = this.queue.shift();
      const success = await this.submitPrompt(prompt);

      if (!success) {
        // Devolver a fila
        this.queue.unshift(prompt);
      }

      this.saveToStorage();
      this.updateUI();
    }

    // Verificar se acabou
    if (this.queue.length === 0 && this.getActiveCount() === 0) {
      this.log('Todas as tarefas concluidas!');
      this.stop();
    }
  }

  async checkAndProcess() {
    if (!this.isRunning || this.isPaused) return;

    // Buscar estado atual dos drafts
    await this.fetchDrafts();

    // Se tem slots disponiveis e fila, processar
    const slotsAvailable = this.getAvailableSlots();

    if (slotsAvailable > 0 && this.queue.length > 0) {
      await this.processLoop();
    }

    // Verificar se tudo terminou
    if (this.queue.length === 0 && this.getActiveCount() === 0 && this.isRunning) {
      this.log('Todas as tarefas concluidas!');
      this.stop();
    }

    this.updateUI();
  }

  pause() {
    this.isPaused = true;
    this.log('Pausado');
    this.updateUI();
  }

  resume() {
    this.isPaused = false;
    this.log('Retomado');
    this.updateUI();
    this.processLoop();
  }

  stop() {
    this.isRunning = false;
    this.isPaused = false;
    this.submittedPrompts = [];

    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }

    this.log('Parado');
    this.saveToStorage();
    this.updateUI();
  }

  clearQueue() {
    this.queue = [];
    this.submittedPrompts = [];
    this.completedCount = 0;
    this.saveToStorage();
    this.log('Fila limpa');
    this.updateUI();
  }

  // ========================================
  // Persistencia
  // ========================================

  saveToStorage() {
    const data = {
      queue: this.queue,
      submittedPrompts: this.submittedPrompts,
      completedCount: this.completedCount,
      isRunning: this.isRunning
    };
    localStorage.setItem('sora_queue_manager', JSON.stringify(data));
  }

  loadFromStorage() {
    try {
      const data = localStorage.getItem('sora_queue_manager');
      if (data) {
        const parsed = JSON.parse(data);
        this.queue = parsed.queue || [];
        this.submittedPrompts = parsed.submittedPrompts || [];
        this.completedCount = parsed.completedCount || 0;

        // Se estava rodando, continuar
        if (parsed.isRunning) {
          this.isRunning = true;
          console.log('[SoraQM] Retomando processamento...');
          setTimeout(() => this.continueProcessing(), 2000);
        }

        if (this.queue.length > 0) {
          console.log(`[SoraQM] Fila restaurada: ${this.queue.length} prompts`);
        }
      }
    } catch (e) {
      this.queue = [];
      this.submittedPrompts = [];
      this.completedCount = 0;
    }
  }

  // ========================================
  // UI - Painel Flutuante
  // ========================================

  createPanel() {
    console.log('[SoraQM] Criando painel...');

    const panel = document.createElement('div');
    panel.id = 'sora-queue-panel';
    panel.innerHTML = `
      <div class="sqm-header">
        <span class="sqm-title">Sora Queue v4</span>
        <button class="sqm-toggle" id="sqm-toggle">-</button>
      </div>

      <div class="sqm-body" id="sqm-body">
        <div class="sqm-section">
          <label>Prompts (um por linha):</label>
          <textarea id="sqm-prompts" placeholder="Cole seus prompts aqui...&#10;Um prompt por linha"></textarea>
          <div class="sqm-prompt-count">
            <span id="sqm-count">0</span> prompts
          </div>
        </div>

        <div class="sqm-status">
          <div class="sqm-status-item">
            <span class="sqm-label">Gerando</span>
            <span class="sqm-value" id="sqm-active">0/3</span>
          </div>
          <div class="sqm-status-item">
            <span class="sqm-label">Fila</span>
            <span class="sqm-value" id="sqm-queued">0</span>
          </div>
          <div class="sqm-status-item">
            <span class="sqm-label">Concluidos</span>
            <span class="sqm-value" id="sqm-completed">0</span>
          </div>
        </div>

        <div class="sqm-buttons">
          <button class="sqm-btn sqm-btn-primary" id="sqm-start">Iniciar</button>
          <button class="sqm-btn sqm-btn-secondary" id="sqm-pause" disabled>Pausar</button>
          <button class="sqm-btn sqm-btn-danger" id="sqm-stop" disabled>Parar</button>
          <button class="sqm-btn sqm-btn-secondary" id="sqm-clear">Limpar</button>
        </div>

        <div class="sqm-log-section">
          <label>Log:</label>
          <div class="sqm-log" id="sqm-log"></div>
        </div>
      </div>
    `;

    document.body.appendChild(panel);
    this.panel = panel;

    this.setupEventListeners();
    this.updateUI();

    console.log('[SoraQM] Painel criado!');
  }

  setupEventListeners() {
    // Toggle minimizar
    document.getElementById('sqm-toggle').addEventListener('click', () => {
      const body = document.getElementById('sqm-body');
      const toggle = document.getElementById('sqm-toggle');

      if (body.style.display === 'none') {
        body.style.display = 'block';
        toggle.textContent = '-';
      } else {
        body.style.display = 'none';
        toggle.textContent = '+';
      }
    });

    // Textarea
    const textarea = document.getElementById('sqm-prompts');
    textarea.addEventListener('input', () => {
      const lines = textarea.value.split('\n').filter(l => l.trim());
      document.getElementById('sqm-count').textContent = lines.length;
    });

    // Iniciar
    document.getElementById('sqm-start').addEventListener('click', () => {
      const textarea = document.getElementById('sqm-prompts');
      const prompts = textarea.value.split('\n').filter(l => l.trim());

      if (prompts.length === 0) {
        this.log('Adicione prompts primeiro!');
        return;
      }

      this.queue = prompts;
      this.saveToStorage();
      textarea.value = '';
      document.getElementById('sqm-count').textContent = '0';

      this.startProcessing();
    });

    // Pausar/Retomar
    document.getElementById('sqm-pause').addEventListener('click', () => {
      if (this.isPaused) {
        this.resume();
      } else {
        this.pause();
      }
    });

    // Parar
    document.getElementById('sqm-stop').addEventListener('click', () => {
      this.stop();
    });

    // Limpar
    document.getElementById('sqm-clear').addEventListener('click', () => {
      this.clearQueue();
      document.getElementById('sqm-prompts').value = '';
      document.getElementById('sqm-count').textContent = '0';
    });
  }

  updateUI() {
    const activeCount = this.getActiveCount();

    // Status
    const activeEl = document.getElementById('sqm-active');
    const queuedEl = document.getElementById('sqm-queued');
    const completedEl = document.getElementById('sqm-completed');

    if (activeEl) activeEl.textContent = `${activeCount}/3`;
    if (queuedEl) queuedEl.textContent = this.queue.length;
    if (completedEl) completedEl.textContent = this.completedCount;

    // Botoes
    const startBtn = document.getElementById('sqm-start');
    const pauseBtn = document.getElementById('sqm-pause');
    const stopBtn = document.getElementById('sqm-stop');

    if (startBtn && pauseBtn && stopBtn) {
      if (this.isRunning) {
        startBtn.disabled = true;
        pauseBtn.disabled = false;
        stopBtn.disabled = false;
        pauseBtn.textContent = this.isPaused ? 'Retomar' : 'Pausar';
      } else {
        startBtn.disabled = false;
        pauseBtn.disabled = true;
        stopBtn.disabled = true;
        pauseBtn.textContent = 'Pausar';
      }
    }

    // Header status
    if (this.panel) {
      const header = this.panel.querySelector('.sqm-header');
      if (header) {
        header.classList.remove('running', 'paused');
        if (this.isRunning && !this.isPaused) {
          header.classList.add('running');
        } else if (this.isPaused) {
          header.classList.add('paused');
        }
      }
    }
  }

  // ========================================
  // Utilidades
  // ========================================

  log(message) {
    const timestamp = new Date().toLocaleTimeString('pt-BR');
    const logEntry = `[${timestamp}] ${message}`;

    console.log(`[SoraQM] ${message}`);

    const logDiv = document.getElementById('sqm-log');
    if (logDiv) {
      const entry = document.createElement('div');
      entry.className = 'sqm-log-entry';
      entry.textContent = logEntry;
      logDiv.appendChild(entry);
      logDiv.scrollTop = logDiv.scrollHeight;

      while (logDiv.children.length > 50) {
        logDiv.removeChild(logDiv.firstChild);
      }
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ========================================
// Inicializacao
// ========================================

function initSoraQM() {
  if (window.soraQueueManager) {
    console.log('[SoraQM] Ja inicializado');
    return;
  }

  if (!window.location.href.includes('sora.chatgpt.com')) {
    console.log('[SoraQM] Nao estamos no Sora');
    return;
  }

  console.log('[SoraQM] Criando instancia...');
  window.soraQueueManager = new SoraQueueManager();
}

// Aguardar DOM
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initSoraQM);
} else {
  setTimeout(initSoraQM, 1000);
}

// Detectar mudancas de URL (SPA)
let lastUrl = location.href;
new MutationObserver(() => {
  const url = location.href;
  if (url !== lastUrl) {
    lastUrl = url;
    setTimeout(initSoraQM, 1000);
  }
}).observe(document, { subtree: true, childList: true });
