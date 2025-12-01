// ========================================
// SORA QUEUE MANAGER v3 - Content Script
// Gerenciador de fila com máximo 3 gerações simultâneas
// ========================================

console.log('%c[Sora Queue Manager] Script carregado!', 'background: #667eea; color: white; padding: 4px 8px; border-radius: 4px;');

class SoraQueueManager {
  constructor() {
    this.queue = [];
    this.isRunning = false;
    this.isPaused = false;
    this.maxConcurrent = 3;
    this.pollingInterval = 5000; // 5 segundos
    this.pollingTimer = null;

    // Tasks ativas (do endpoint)
    this.activeTasks = [];
    this.completedCount = 0;

    // Endpoints descobertos
    this.tasksEndpoint = null;

    this.init();
  }

  init() {
    console.log('[SoraQM] Inicializando...');
    this.loadFromStorage();
    this.interceptFetch();
    this.createPanel();
    this.log('Extensão iniciada');

    // Tentar descobrir endpoint de tasks
    setTimeout(() => this.discoverTasksEndpoint(), 2000);
  }

  // ========================================
  // Interceptação de Fetch
  // ========================================

  interceptFetch() {
    const originalFetch = window.fetch;
    const self = this;

    window.fetch = async function(...args) {
      const response = await originalFetch.apply(this, args);

      try {
        const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;

        if (url) {
          // Detectar endpoint de tasks (array de tasks ativas)
          if (url.includes('/video_gen/tasks') || (url.includes('/tasks') && !url.includes('drafts'))) {
            self.tasksEndpoint = url.split('?')[0];
            console.log('[SoraQM] Tasks endpoint detectado:', self.tasksEndpoint);

            // Capturar dados das tasks
            const cloned = response.clone();
            cloned.json().then(data => {
              if (Array.isArray(data)) {
                self.processTasksResponse(data);
              }
            }).catch(() => {});
          }
        }
      } catch (e) {
        console.error('[SoraQM] Erro ao interceptar:', e);
      }

      return response;
    };
  }

  async discoverTasksEndpoint() {
    this.log('Buscando endpoint de tasks...');

    // Tentar endpoints comuns
    const endpoints = [
      '/backend-api/v1/video_gen/tasks',
      '/sora/backend-api/v1/video_gen/tasks',
      '/api/v1/video_gen/tasks',
      '/v1/video_gen/tasks'
    ];

    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint);
        if (response.ok) {
          const data = await response.json();
          if (Array.isArray(data)) {
            this.tasksEndpoint = endpoint;
            this.processTasksResponse(data);
            this.log(`Endpoint encontrado: ${endpoint}`);
            return;
          }
        }
      } catch (e) {
        // Tentar próximo
      }
    }

    this.log('Aguardando detecção automática do endpoint...');
  }

  processTasksResponse(tasks) {
    // Filtrar tasks ativas (não concluídas/falhas)
    const activeStatuses = ['preprocessing', 'pending', 'running', 'queued', 'processing'];

    this.activeTasks = tasks.filter(t =>
      activeStatuses.includes(t.status?.toLowerCase())
    );

    const count = this.activeTasks.length;
    console.log(`[SoraQM] Tasks ativas: ${count}/3`, this.activeTasks.map(t => t.status));

    this.updateUI();
  }

  // ========================================
  // Monitoramento de Tasks
  // ========================================

  async fetchActiveTasks() {
    if (!this.tasksEndpoint) {
      console.log('[SoraQM] Endpoint de tasks não descoberto ainda');
      return this.activeTasks.length;
    }

    try {
      const response = await fetch(this.tasksEndpoint);
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data)) {
          this.processTasksResponse(data);
        }
      }
    } catch (e) {
      console.error('[SoraQM] Erro ao buscar tasks:', e);
    }

    return this.activeTasks.length;
  }

  getActiveCount() {
    return this.activeTasks.length;
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
        throw new Error('Textarea não encontrada');
      }

      // Preencher textarea
      this.fillReactTextarea(textarea, prompt);
      await this.sleep(1000);

      // Verificar se preencheu
      console.log('[SoraQM] Valor do textarea:', textarea.value.substring(0, 50));

      // Encontrar botão Create
      const createButton = this.findCreateButton();

      if (!createButton) {
        throw new Error('Botão Create não encontrado');
      }

      // Aguardar botão estar habilitado
      let attempts = 0;
      while (createButton.disabled && attempts < 10) {
        console.log('[SoraQM] Botão desabilitado, aguardando...');
        await this.sleep(500);
        attempts++;
      }

      if (createButton.disabled) {
        throw new Error('Botão Create continua desabilitado');
      }

      // Clicar no botão
      console.log('[SoraQM] Clicando no botão Create...');
      createButton.click();

      this.log('✓ Prompt enviado!');
      this.completedCount++;

      await this.sleep(2000);
      return true;

    } catch (error) {
      this.log(`✗ Erro: ${error.message}`);
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

    // Método 1: Procurar por sr-only com texto "Create video"
    for (const btn of buttons) {
      const srOnly = btn.querySelector('.sr-only');
      if (srOnly && srOnly.textContent.includes('Create')) {
        console.log('[SoraQM] Botão encontrado via sr-only');
        return btn;
      }
    }

    // Método 2: Botão com SVG próximo do textarea
    const textarea = document.querySelector('textarea');
    if (textarea) {
      const container = textarea.closest('form') || textarea.closest('div');
      if (container) {
        const btns = container.querySelectorAll('button');
        for (const btn of btns) {
          if (btn.querySelector('svg') && !btn.disabled) {
            console.log('[SoraQM] Botão encontrado via container');
            return btn;
          }
        }
      }
    }

    // Método 3: Qualquer botão com SVG que não esteja desabilitado
    for (const btn of buttons) {
      if (btn.querySelector('svg') && !btn.textContent.trim()) {
        console.log('[SoraQM] Botão encontrado via SVG');
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

    this.isRunning = true;
    this.isPaused = false;
    this.completedCount = 0;
    this.log('▶ Processamento iniciado');
    this.updateUI();

    // Buscar tasks atuais primeiro
    await this.fetchActiveTasks();

    // Iniciar loop
    this.processLoop();
    this.pollingTimer = setInterval(() => this.checkAndProcess(), this.pollingInterval);
  }

  async processLoop() {
    if (!this.isRunning || this.isPaused) return;

    // Buscar tasks ativas
    await this.fetchActiveTasks();
    const activeCount = this.getActiveCount();
    const slotsAvailable = this.maxConcurrent - activeCount;

    this.log(`Slots disponíveis: ${slotsAvailable}/3 | Fila: ${this.queue.length}`);
    this.updateUI();

    // Enviar prompts enquanto houver slots
    if (slotsAvailable > 0 && this.queue.length > 0) {
      const prompt = this.queue.shift();
      const success = await this.submitPrompt(prompt);

      if (!success) {
        // Devolver à fila
        this.queue.unshift(prompt);
      }

      this.saveToStorage();
      this.updateUI();
    }

    // Verificar se acabou
    if (this.queue.length === 0) {
      this.log('✓ Fila vazia!');
      // Não parar ainda - aguardar tasks terminarem
    }
  }

  async checkAndProcess() {
    if (!this.isRunning || this.isPaused) return;

    // Buscar estado atual das tasks
    await this.fetchActiveTasks();

    // Se tem slots disponíveis e fila, processar
    const activeCount = this.getActiveCount();
    const slotsAvailable = this.maxConcurrent - activeCount;

    if (slotsAvailable > 0 && this.queue.length > 0) {
      await this.processLoop();
    }

    // Verificar se tudo terminou
    if (this.queue.length === 0 && activeCount === 0 && this.isRunning) {
      this.log('✓ Todas as tasks concluídas!');
      this.stop();
    }

    this.updateUI();
  }

  pause() {
    this.isPaused = true;
    this.log('⏸ Pausado');
    this.updateUI();
  }

  resume() {
    this.isPaused = false;
    this.log('▶ Retomado');
    this.updateUI();
    this.processLoop();
  }

  stop() {
    this.isRunning = false;
    this.isPaused = false;

    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }

    this.log('⏹ Parado');
    this.updateUI();
  }

  clearQueue() {
    this.queue = [];
    this.completedCount = 0;
    this.saveToStorage();
    this.log('🗑 Fila limpa');
    this.updateUI();
  }

  // ========================================
  // Persistência
  // ========================================

  saveToStorage() {
    const data = {
      queue: this.queue,
      completedCount: this.completedCount
    };
    localStorage.setItem('sora_queue_manager', JSON.stringify(data));
  }

  loadFromStorage() {
    try {
      const data = localStorage.getItem('sora_queue_manager');
      if (data) {
        const parsed = JSON.parse(data);
        this.queue = parsed.queue || [];
        this.completedCount = parsed.completedCount || 0;

        if (this.queue.length > 0) {
          console.log(`[SoraQM] Fila restaurada: ${this.queue.length} prompts`);
        }
      }
    } catch (e) {
      this.queue = [];
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
        <span class="sqm-title">🎬 Sora Queue</span>
        <button class="sqm-toggle" id="sqm-toggle">−</button>
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
            <span class="sqm-label">Enviados</span>
            <span class="sqm-value" id="sqm-completed">0</span>
          </div>
        </div>

        <div class="sqm-buttons">
          <button class="sqm-btn sqm-btn-primary" id="sqm-start">▶ Iniciar</button>
          <button class="sqm-btn sqm-btn-secondary" id="sqm-pause" disabled>⏸ Pausar</button>
          <button class="sqm-btn sqm-btn-danger" id="sqm-stop" disabled>⏹ Parar</button>
          <button class="sqm-btn sqm-btn-secondary" id="sqm-clear">🗑 Limpar</button>
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
        toggle.textContent = '−';
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
        this.log('⚠ Adicione prompts!');
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

    // Botões
    const startBtn = document.getElementById('sqm-start');
    const pauseBtn = document.getElementById('sqm-pause');
    const stopBtn = document.getElementById('sqm-stop');

    if (startBtn && pauseBtn && stopBtn) {
      if (this.isRunning) {
        startBtn.disabled = true;
        pauseBtn.disabled = false;
        stopBtn.disabled = false;
        pauseBtn.textContent = this.isPaused ? '▶ Retomar' : '⏸ Pausar';
      } else {
        startBtn.disabled = false;
        pauseBtn.disabled = true;
        stopBtn.disabled = true;
        pauseBtn.textContent = '⏸ Pausar';
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
// Inicialização
// ========================================

function initSoraQM() {
  if (window.soraQueueManager) {
    console.log('[SoraQM] Já inicializado');
    return;
  }

  if (!window.location.href.includes('sora.chatgpt.com')) {
    console.log('[SoraQM] Não estamos no Sora');
    return;
  }

  console.log('[SoraQM] Criando instância...');
  window.soraQueueManager = new SoraQueueManager();
}

// Aguardar DOM
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initSoraQM);
} else {
  setTimeout(initSoraQM, 1000);
}

// Detectar mudanças de URL (SPA)
let lastUrl = location.href;
new MutationObserver(() => {
  const url = location.href;
  if (url !== lastUrl) {
    lastUrl = url;
    setTimeout(initSoraQM, 1000);
  }
}).observe(document, { subtree: true, childList: true });
