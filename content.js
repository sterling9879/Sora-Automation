// ========================================
// SORA QUEUE MANAGER v2 - Content Script
// Gerenciador de fila com máximo 3 gerações simultâneas
// ========================================

console.log('%c[Sora Queue Manager] Script carregado!', 'background: #667eea; color: white; padding: 4px 8px; border-radius: 4px;');

class SoraQueueManager {
  constructor() {
    this.queue = [];
    this.isRunning = false;
    this.isPaused = false;
    this.maxConcurrent = 3;
    this.pollingInterval = 7000;
    this.pollingTimer = null;

    // Rastrear tasks enviadas
    this.submittedTasks = []; // {prompt, submittedAt, taskId}
    this.knownDraftIds = new Set();
    this.completedCount = 0;

    // Endpoints descobertos
    this.draftsEndpoint = null;
    this.tasksEndpoint = null;

    this.init();
  }

  init() {
    console.log('[SoraQM] Inicializando...');
    this.loadFromStorage();
    this.interceptFetch();
    this.createPanel();
    this.log('Extensão iniciada');

    // Buscar drafts iniciais para conhecer os IDs existentes
    setTimeout(() => this.initializeDrafts(), 2000);
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
          // Detectar endpoint de tasks
          if (url.includes('/video_gen/tasks') || url.includes('/tasks')) {
            self.tasksEndpoint = url.split('?')[0];
            console.log('[SoraQM] Tasks endpoint:', self.tasksEndpoint);
          }

          // Detectar endpoint de drafts
          if (url.includes('/draft') && url.includes('limit')) {
            self.draftsEndpoint = url.split('?')[0];
            console.log('[SoraQM] Drafts endpoint:', self.draftsEndpoint);

            // Capturar dados dos drafts
            const cloned = response.clone();
            cloned.json().then(data => {
              if (data.items) {
                self.processDraftsResponse(data.items);
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

  async initializeDrafts() {
    this.log('Carregando drafts existentes...');

    // Tentar buscar drafts via API
    const endpoints = [
      '/sora/backend-api/v1/draft?limit=20',
      '/backend-api/v1/draft?limit=20',
      '/api/draft?limit=20'
    ];

    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint);
        if (response.ok) {
          const data = await response.json();
          if (data.items) {
            this.draftsEndpoint = endpoint.split('?')[0];
            this.processDraftsResponse(data.items);
            this.log(`${data.items.length} drafts carregados`);
            return;
          }
        }
      } catch (e) {
        // Tentar próximo
      }
    }

    this.log('Aguardando descoberta do endpoint de drafts...');
  }

  processDraftsResponse(items) {
    // Atualizar conjunto de IDs conhecidos
    const newIds = new Set();

    items.forEach(item => {
      newIds.add(item.id);

      // Verificar se é um draft novo (task concluída)
      if (!this.knownDraftIds.has(item.id) && this.knownDraftIds.size > 0) {
        // Encontrar task correspondente pelo prompt
        const taskIndex = this.submittedTasks.findIndex(t =>
          t.prompt === item.prompt && !t.completed
        );

        if (taskIndex !== -1) {
          this.submittedTasks[taskIndex].completed = true;
          this.submittedTasks[taskIndex].draftId = item.id;
          this.completedCount++;
          this.log(`Concluído: "${item.prompt.substring(0, 30)}..."`);
          this.updateUI();
        }
      }
    });

    // Atualizar IDs conhecidos
    this.knownDraftIds = newIds;
  }

  // ========================================
  // Gerenciamento de Tasks
  // ========================================

  getActiveTasks() {
    // Tasks ativas = enviadas mas não concluídas
    return this.submittedTasks.filter(t => !t.completed);
  }

  getActiveCount() {
    return this.getActiveTasks().length;
  }

  // ========================================
  // Envio de Prompts
  // ========================================

  async submitPrompt(prompt) {
    this.log(`Enviando: "${prompt.substring(0, 40)}..."`);

    try {
      // Encontrar textarea
      const textarea = await this.waitForElement('textarea[placeholder="Describe your video..."]', 5000);

      if (!textarea) {
        // Tentar outros seletores
        const altTextarea = document.querySelector('textarea') ||
                           document.querySelector('[contenteditable="true"]');
        if (!altTextarea) {
          throw new Error('Textarea não encontrada');
        }
      }

      const targetTextarea = textarea || document.querySelector('textarea');

      // Preencher textarea
      this.fillReactTextarea(targetTextarea, prompt);
      await this.sleep(800);

      // Verificar se preencheu
      if (targetTextarea.value !== prompt) {
        this.log('Tentando método alternativo de preenchimento...');
        targetTextarea.value = prompt;
        targetTextarea.dispatchEvent(new Event('input', { bubbles: true }));
        await this.sleep(500);
      }

      // Encontrar botão Create
      const createButton = this.findCreateButton();

      if (!createButton) {
        throw new Error('Botão Create não encontrado');
      }

      // Aguardar botão estar habilitado
      let attempts = 0;
      while (createButton.disabled && attempts < 10) {
        await this.sleep(500);
        attempts++;
      }

      if (createButton.disabled) {
        throw new Error('Botão Create continua desabilitado');
      }

      // Clicar no botão
      createButton.click();

      // Registrar task enviada
      this.submittedTasks.push({
        prompt: prompt,
        submittedAt: Date.now(),
        completed: false
      });

      this.log('Prompt enviado!');
      await this.sleep(1500);

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
    // Método 1: Procurar por sr-only com texto "Create video"
    const buttons = document.querySelectorAll('button');

    for (const btn of buttons) {
      const srOnly = btn.querySelector('.sr-only');
      if (srOnly && srOnly.textContent.includes('Create')) {
        return btn;
      }
    }

    // Método 2: Procurar por aria-label
    for (const btn of buttons) {
      const ariaLabel = btn.getAttribute('aria-label');
      if (ariaLabel && ariaLabel.toLowerCase().includes('create')) {
        return btn;
      }
    }

    // Método 3: Botão com SVG perto do textarea
    const textarea = document.querySelector('textarea');
    if (textarea) {
      const container = textarea.closest('form') || textarea.parentElement?.parentElement;
      if (container) {
        const btn = container.querySelector('button:not([disabled])');
        if (btn && btn.querySelector('svg')) {
          return btn;
        }
      }
    }

    // Método 4: Qualquer botão submit
    const submitBtn = document.querySelector('button[type="submit"]');
    if (submitBtn) return submitBtn;

    return null;
  }

  // ========================================
  // Loop Principal
  // ========================================

  async startProcessing() {
    if (this.isRunning) return;

    this.isRunning = true;
    this.isPaused = false;
    this.log('Processamento iniciado');
    this.updateUI();

    // Limpar tasks antigas
    this.submittedTasks = [];

    // Iniciar loop
    this.processLoop();
    this.pollingTimer = setInterval(() => this.checkAndProcess(), this.pollingInterval);
  }

  async processLoop() {
    if (!this.isRunning || this.isPaused) return;

    const activeCount = this.getActiveCount();
    const slotsAvailable = this.maxConcurrent - activeCount;

    this.log(`Slots: ${slotsAvailable}/3 disponíveis, Fila: ${this.queue.length}`);
    this.updateUI();

    // Enviar prompts enquanto houver slots e fila
    for (let i = 0; i < slotsAvailable && this.queue.length > 0; i++) {
      if (!this.isRunning || this.isPaused) break;

      const prompt = this.queue.shift();
      const success = await this.submitPrompt(prompt);

      if (!success) {
        // Devolver à fila
        this.queue.unshift(prompt);
        break;
      }

      this.saveToStorage();
      this.updateUI();

      // Pausa entre submissões
      if (this.queue.length > 0 && i < slotsAvailable - 1) {
        await this.sleep(3000);
      }
    }

    // Verificar se acabou
    if (this.queue.length === 0 && this.getActiveCount() === 0) {
      this.log('Fila concluída!');
      this.stop();
    }
  }

  async checkAndProcess() {
    if (!this.isRunning || this.isPaused) return;

    // Buscar drafts para verificar conclusões
    if (this.draftsEndpoint) {
      try {
        const response = await fetch(`${this.draftsEndpoint}?limit=20`);
        if (response.ok) {
          const data = await response.json();
          if (data.items) {
            this.processDraftsResponse(data.items);
          }
        }
      } catch (e) {
        // Ignorar erros
      }
    }

    // Limpar tasks muito antigas (>10min sem conclusão = provavelmente falhou)
    const now = Date.now();
    this.submittedTasks = this.submittedTasks.filter(t => {
      if (!t.completed && (now - t.submittedAt) > 600000) {
        this.log(`Timeout: "${t.prompt.substring(0, 30)}..."`);
        return false;
      }
      return true;
    });

    // Processar fila se houver slots
    await this.processLoop();
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

    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }

    this.log('Parado');
    this.updateUI();
  }

  clearQueue() {
    this.queue = [];
    this.submittedTasks = [];
    this.completedCount = 0;
    this.saveToStorage();
    this.log('Fila limpa');
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
            <span class="sqm-label">Pronto</span>
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

    console.log('[SoraQM] Painel criado com sucesso!');
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
        this.log('Adicione prompts!');
        return;
      }

      this.queue = prompts;
      this.completedCount = 0;
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

  async waitForElement(selector, timeout = 10000) {
    const start = Date.now();

    while (Date.now() - start < timeout) {
      const element = document.querySelector(selector);
      if (element) return element;
      await this.sleep(200);
    }

    return null;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ========================================
// Inicialização
// ========================================

function initSoraQM() {
  // Verificar se já existe
  if (window.soraQueueManager) {
    console.log('[SoraQM] Já inicializado');
    return;
  }

  // Verificar se estamos na página certa
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
  // Pequeno delay para garantir que a página carregou
  setTimeout(initSoraQM, 1000);
}

// Também tentar quando a página mudar (SPA)
let lastUrl = location.href;
new MutationObserver(() => {
  const url = location.href;
  if (url !== lastUrl) {
    lastUrl = url;
    setTimeout(initSoraQM, 1000);
  }
}).observe(document, { subtree: true, childList: true });
