// ========================================
// SORA QUEUE MANAGER - Content Script
// Gerenciador de fila com máximo 3 gerações simultâneas
// ========================================

class SoraQueueManager {
  constructor() {
    this.queue = [];
    this.isRunning = false;
    this.isPaused = false;
    this.maxConcurrent = 3;
    this.pollingInterval = 7000; // 7 segundos
    this.pollingTimer = null;
    this.tasksEndpoint = null;
    this.activeTasks = [];
    this.completedCount = 0;
    this.panelVisible = false;

    this.init();
  }

  init() {
    this.loadFromStorage();
    this.interceptFetch();
    this.createPanel();
    this.log('Extensão carregada');
  }

  // ========================================
  // Interceptação de Fetch para descobrir endpoints
  // ========================================

  interceptFetch() {
    const originalFetch = window.fetch;
    const self = this;

    window.fetch = async function(...args) {
      const response = await originalFetch.apply(this, args);

      try {
        const url = args[0]?.url || args[0];

        // Detectar endpoint de tasks
        if (typeof url === 'string' && url.includes('/tasks')) {
          self.tasksEndpoint = url.split('?')[0];
          self.log(`Endpoint detectado: ${self.tasksEndpoint}`);
        }

        // Detectar endpoint de drafts
        if (typeof url === 'string' && url.includes('/draft')) {
          // Clonar response para ler sem consumir
          const cloned = response.clone();
          cloned.json().then(data => {
            if (data.items) {
              self.log(`Drafts: ${data.items.length} itens encontrados`);
            }
          }).catch(() => {});
        }
      } catch (e) {
        // Ignorar erros de parsing
      }

      return response;
    };
  }

  // ========================================
  // Polling de Tasks
  // ========================================

  async fetchActiveTasks() {
    // Tentar buscar tasks ativas da página
    // O Sora faz polling automático, vamos interceptar ou usar os dados do DOM

    try {
      // Método 1: Buscar do endpoint se descoberto
      if (this.tasksEndpoint) {
        const response = await fetch(this.tasksEndpoint);
        const data = await response.json();

        if (Array.isArray(data)) {
          this.activeTasks = data.filter(t =>
            t.status === 'running' || t.status === 'pending'
          );
          return this.activeTasks;
        }
      }

      // Método 2: Buscar endpoint genérico de tasks
      const endpoints = [
        '/api/tasks',
        '/v1/tasks',
        '/tasks'
      ];

      for (const endpoint of endpoints) {
        try {
          const response = await fetch(endpoint);
          if (response.ok) {
            const data = await response.json();
            if (Array.isArray(data)) {
              this.activeTasks = data.filter(t =>
                t.status === 'running' || t.status === 'pending'
              );
              this.tasksEndpoint = endpoint;
              return this.activeTasks;
            }
          }
        } catch (e) {
          // Continuar tentando outros endpoints
        }
      }

      // Método 3: Verificar pelo DOM (indicadores de progresso)
      const progressIndicators = document.querySelectorAll('[class*="progress"], [class*="generating"], [class*="loading"]');
      const runningCount = progressIndicators.length;

      // Criar tasks fictícias baseadas no DOM
      this.activeTasks = [];
      for (let i = 0; i < runningCount && i < 3; i++) {
        this.activeTasks.push({
          id: `dom_task_${i}`,
          status: 'running'
        });
      }

      return this.activeTasks;

    } catch (error) {
      this.log(`Erro ao buscar tasks: ${error.message}`);
      return [];
    }
  }

  getActiveCount() {
    return this.activeTasks.filter(t =>
      t.status === 'running' || t.status === 'pending'
    ).length;
  }

  // ========================================
  // Envio de Prompts
  // ========================================

  async submitPrompt(prompt) {
    this.log(`Enviando: "${prompt.substring(0, 50)}..."`);

    try {
      // Encontrar textarea
      const textarea = await this.waitForElement('textarea[placeholder="Describe your video..."]', 5000);

      if (!textarea) {
        throw new Error('Textarea não encontrada');
      }

      // Preencher textarea (compatível com React)
      this.fillReactTextarea(textarea, prompt);
      await this.sleep(500);

      // Encontrar e clicar no botão
      const createButton = this.findCreateButton();

      if (!createButton) {
        throw new Error('Botão Create não encontrado');
      }

      if (createButton.disabled) {
        this.log('Aguardando botão habilitar...');
        await this.sleep(2000);
      }

      createButton.click();
      this.log('Prompt enviado com sucesso!');

      await this.sleep(1000);
      return true;

    } catch (error) {
      this.log(`Erro ao enviar: ${error.message}`);
      return false;
    }
  }

  fillReactTextarea(textarea, text) {
    textarea.focus();
    textarea.value = '';

    // Usar setter nativo para React detectar
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    ).set;

    nativeSetter.call(textarea, text);

    // Disparar eventos necessários
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
  }

  findCreateButton() {
    // Procurar pelo sr-only text
    const buttons = document.querySelectorAll('button');

    for (const btn of buttons) {
      const srOnly = btn.querySelector('.sr-only');
      if (srOnly && srOnly.textContent.includes('Create')) {
        return btn;
      }
    }

    // Fallback: procurar por atributos comuns
    for (const btn of buttons) {
      if (btn.querySelector('svg') && !btn.disabled) {
        const rect = btn.getBoundingClientRect();
        // Geralmente é um botão pequeno no canto
        if (rect.width < 60 && rect.height < 60) {
          return btn;
        }
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
    this.log('Processamento iniciado');
    this.updateUI();

    this.pollingTimer = setInterval(() => this.processLoop(), this.pollingInterval);

    // Executar imediatamente também
    await this.processLoop();
  }

  async processLoop() {
    if (!this.isRunning || this.isPaused) return;
    if (this.queue.length === 0) {
      this.log('Fila vazia - processamento concluído');
      this.stop();
      return;
    }

    // Buscar tasks ativas
    await this.fetchActiveTasks();
    const activeCount = this.getActiveCount();

    this.log(`Tasks ativas: ${activeCount}/3`);
    this.updateUI();

    // Enviar prompts se houver slots disponíveis
    while (activeCount + this.activeTasks.length < this.maxConcurrent && this.queue.length > 0) {
      if (!this.isRunning || this.isPaused) break;

      const prompt = this.queue.shift();
      const success = await this.submitPrompt(prompt);

      if (success) {
        this.completedCount++;
        // Adicionar task fictícia para não enviar demais
        this.activeTasks.push({
          id: `submitted_${Date.now()}`,
          status: 'pending'
        });
      } else {
        // Devolver à fila em caso de erro
        this.queue.unshift(prompt);
        break;
      }

      this.saveToStorage();
      this.updateUI();

      // Pequena pausa entre submissões
      await this.sleep(2000);
    }
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
    this.completedCount = 0;
    this.saveToStorage();
    this.log('Fila limpa');
    this.updateUI();
  }

  // ========================================
  // Persistência (localStorage)
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
          this.log(`Fila restaurada: ${this.queue.length} prompts`);
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
    // Criar container do painel
    const panel = document.createElement('div');
    panel.id = 'sora-queue-panel';
    panel.innerHTML = `
      <div class="sqm-header">
        <span class="sqm-title">🎬 Sora Queue Manager</span>
        <button class="sqm-toggle" id="sqm-toggle">−</button>
      </div>

      <div class="sqm-body" id="sqm-body">
        <div class="sqm-section">
          <label>Prompts (um por linha):</label>
          <textarea id="sqm-prompts" placeholder="Digite seus prompts aqui...&#10;Um prompt por linha&#10;Pressione Enter para nova linha"></textarea>
          <div class="sqm-prompt-count">
            <span id="sqm-count">0</span> prompts na fila
          </div>
        </div>

        <div class="sqm-status">
          <div class="sqm-status-item">
            <span class="sqm-label">Tasks ativas:</span>
            <span class="sqm-value" id="sqm-active">0/3</span>
          </div>
          <div class="sqm-status-item">
            <span class="sqm-label">Na fila:</span>
            <span class="sqm-value" id="sqm-queued">0</span>
          </div>
          <div class="sqm-status-item">
            <span class="sqm-label">Concluídos:</span>
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

    // Event listeners
    this.setupEventListeners();
    this.updateUI();
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

    // Textarea - contar prompts
    const textarea = document.getElementById('sqm-prompts');
    textarea.addEventListener('input', () => {
      const lines = textarea.value.split('\n').filter(l => l.trim());
      document.getElementById('sqm-count').textContent = lines.length;
    });

    // Botão Iniciar
    document.getElementById('sqm-start').addEventListener('click', () => {
      const textarea = document.getElementById('sqm-prompts');
      const prompts = textarea.value.split('\n').filter(l => l.trim());

      if (prompts.length === 0) {
        this.log('Adicione prompts antes de iniciar');
        return;
      }

      this.queue = prompts;
      this.completedCount = 0;
      this.saveToStorage();
      textarea.value = '';
      document.getElementById('sqm-count').textContent = '0';

      this.startProcessing();
    });

    // Botão Pausar/Retomar
    document.getElementById('sqm-pause').addEventListener('click', () => {
      if (this.isPaused) {
        this.resume();
      } else {
        this.pause();
      }
    });

    // Botão Parar
    document.getElementById('sqm-stop').addEventListener('click', () => {
      this.stop();
    });

    // Botão Limpar
    document.getElementById('sqm-clear').addEventListener('click', () => {
      this.clearQueue();
      document.getElementById('sqm-prompts').value = '';
      document.getElementById('sqm-count').textContent = '0';
    });
  }

  updateUI() {
    const activeCount = this.getActiveCount();

    // Atualizar status
    document.getElementById('sqm-active').textContent = `${activeCount}/3`;
    document.getElementById('sqm-queued').textContent = this.queue.length;
    document.getElementById('sqm-completed').textContent = this.completedCount;

    // Atualizar botões
    const startBtn = document.getElementById('sqm-start');
    const pauseBtn = document.getElementById('sqm-pause');
    const stopBtn = document.getElementById('sqm-stop');

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

    // Indicador visual de status
    const header = this.panel.querySelector('.sqm-header');
    header.classList.remove('running', 'paused');

    if (this.isRunning && !this.isPaused) {
      header.classList.add('running');
    } else if (this.isPaused) {
      header.classList.add('paused');
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

      // Limitar a 100 entradas
      while (logDiv.children.length > 100) {
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

// Aguardar DOM estar pronto
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.soraQueueManager = new SoraQueueManager();
  });
} else {
  window.soraQueueManager = new SoraQueueManager();
}
