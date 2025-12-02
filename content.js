// ========================================
// SORA PROMPT AUTOMATION - Content Script
// Automacao de envio de prompts com maximo 3 geracoes simultaneas
// v3.1.0 - Suporte a envio via DOM e API
// ========================================

console.log('%c[Sora Automation] Script carregado v3.1.0', 'background: #667eea; color: white; padding: 4px 8px; border-radius: 4px;');

class SoraPromptAutomation {
  constructor() {
    // Configuracoes
    this.config = {
      orientation: 'portrait',  // portrait, landscape, square
      duration: 300,            // 150 = 5s, 300 = 10s, 450 = 20s
      model: 'sy_8',
      submitMode: 'dom'         // 'dom' ou 'api'
    };

    // Estado
    this.queue = [];
    this.isRunning = false;
    this.isPaused = false;
    this.maxConcurrent = 3;
    this.pollingInterval = 5000; // 5 segundos
    this.submitDelay = 3000;     // 3 segundos entre envios
    this.pollingTimer = null;
    this.activeTasks = [];
    this.completedCount = 0;
    this.errorCount = 0;

    // Headers de autenticacao
    this.authHeaders = null;

    // Endpoints da API
    this.API = {
      create: 'https://sora.chatgpt.com/backend/nf/create',
      pending: 'https://sora.chatgpt.com/backend/nf/pending',
      drafts: 'https://sora.chatgpt.com/backend/project_y/profile/drafts'
    };

    // Seletores DOM do Sora
    this.SELECTORS = {
      textarea: 'textarea[placeholder="Describe your video..."]',
      createButton: 'button .sr-only',
      createButtonAlt: 'button[data-state]'
    };

    this.init();
  }

  async init() {
    await this.loadFromStorage();
    this.interceptFetch();
    this.setupMessageListener();
    this.createPanel();
    await this.requestHeaders();
    this.log('Extensao iniciada v3.1.0');
    this.log(`Modo de envio: ${this.config.submitMode.toUpperCase()}`);
  }

  // ========================================
  // Interceptacao de Fetch para capturar tokens
  // ========================================

  interceptFetch() {
    const originalFetch = window.fetch;
    const self = this;

    window.fetch = async function(...args) {
      const response = await originalFetch.apply(this, args);

      try {
        const url = args[0]?.url || args[0];
        const options = args[1] || {};

        // Captura headers de requisicoes para o backend
        if (typeof url === 'string' && url.includes('/backend/')) {
          const headers = options.headers || {};

          // Tenta extrair o sentinel token
          if (headers['openai-sentinel-token'] && !self.authHeaders?.['openai-sentinel-token']) {
            self.updateHeader('openai-sentinel-token', headers['openai-sentinel-token']);
          }

          // Tenta extrair authorization
          if (headers['authorization'] && !self.authHeaders?.authorization) {
            self.updateHeader('authorization', headers['authorization']);
          }
        }
      } catch (e) {
        // Ignorar erros
      }

      return response;
    };
  }

  updateHeader(name, value) {
    if (!this.authHeaders) {
      this.authHeaders = {};
    }
    this.authHeaders[name] = value;
    this.log(`Header capturado: ${name.substring(0, 15)}...`);
    this.updateAuthStatus();
  }

  // ========================================
  // Comunicacao com Background Script
  // ========================================

  setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'HEADERS_UPDATED') {
        this.authHeaders = message.headers;
        this.log('Headers atualizados pelo background');
        this.updateAuthStatus();
      }
    });
  }

  async requestHeaders() {
    try {
      const headers = await chrome.runtime.sendMessage({ type: 'GET_HEADERS' });
      if (headers && headers.authorization) {
        this.authHeaders = headers;
        this.log('Headers restaurados do storage');
        this.updateAuthStatus();
      }
    } catch (e) {
      // Background script pode nao estar pronto
    }

    // Tenta obter device ID do cookie
    try {
      const deviceId = await chrome.runtime.sendMessage({ type: 'GET_DEVICE_ID' });
      if (deviceId && this.authHeaders) {
        this.authHeaders['oai-device-id'] = deviceId;
      }
    } catch (e) {
      // Ignorar
    }
  }

  updateAuthStatus() {
    const statusEl = document.getElementById('sqm-auth-status');
    if (!statusEl) return;

    const hasAuth = this.authHeaders?.authorization;

    if (hasAuth) {
      statusEl.textContent = 'Autenticado';
      statusEl.className = 'sqm-auth-badge sqm-auth-ok';
    } else {
      statusEl.textContent = 'Aguardando...';
      statusEl.className = 'sqm-auth-badge sqm-auth-pending';
    }
  }

  // ========================================
  // Envio via DOM (textarea + botao)
  // ========================================

  findTextarea() {
    // Busca pelo placeholder especifico
    let textarea = document.querySelector(this.SELECTORS.textarea);
    if (textarea) return textarea;

    // Fallback: busca qualquer textarea visivel
    const textareas = document.querySelectorAll('textarea');
    for (const ta of textareas) {
      if (ta.offsetParent !== null && ta.placeholder.includes('video')) {
        return ta;
      }
    }

    return null;
  }

  findCreateButton() {
    // Metodo 1: Busca pelo sr-only com texto "Create"
    const srOnlyElements = document.querySelectorAll('button .sr-only');
    for (const el of srOnlyElements) {
      if (el.textContent.includes('Create')) {
        return el.closest('button');
      }
    }

    // Metodo 2: Busca botao redondo proximo ao textarea
    const textarea = this.findTextarea();
    if (textarea) {
      const container = textarea.closest('div[class*="flex"]')?.parentElement;
      if (container) {
        const buttons = container.querySelectorAll('button');
        for (const btn of buttons) {
          // Botao de criar geralmente tem SVG de seta
          if (btn.querySelector('svg path[d*="5.293"]')) {
            return btn;
          }
        }
      }
    }

    // Metodo 3: Busca qualquer botao com SVG de seta para cima
    const allButtons = document.querySelectorAll('button[data-state]');
    for (const btn of allButtons) {
      const path = btn.querySelector('svg path');
      if (path && path.getAttribute('d')?.includes('5.293')) {
        return btn;
      }
    }

    return null;
  }

  fillTextareaReact(textarea, text) {
    // Foca no elemento
    textarea.focus();

    // Limpa o conteudo atual
    textarea.value = '';

    // Usa o setter nativo para compatibilidade com React
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value'
    )?.set;

    if (nativeSetter) {
      nativeSetter.call(textarea, text);
    } else {
      textarea.value = text;
    }

    // Dispara eventos para React detectar a mudanca
    textarea.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));

    // Dispara evento de teclado para simular digitacao
    textarea.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
  }

  async submitViaDOM(prompt) {
    this.log('Enviando via DOM...');

    try {
      // 1. Encontra o textarea
      const textarea = this.findTextarea();
      if (!textarea) {
        throw new Error('Textarea nao encontrada na pagina');
      }

      // 2. Preenche o textarea
      this.fillTextareaReact(textarea, prompt);
      this.log('Prompt inserido no textarea');

      // 3. Aguarda um pouco para React processar
      await this.sleep(800);

      // 4. Encontra o botao de criar
      const createButton = this.findCreateButton();
      if (!createButton) {
        throw new Error('Botao Create nao encontrado');
      }

      // 5. Verifica se o botao esta habilitado
      const isDisabled = createButton.disabled ||
                         createButton.getAttribute('data-disabled') === 'true' ||
                         createButton.getAttribute('aria-disabled') === 'true';

      if (isDisabled) {
        this.log('Botao desabilitado, aguardando...');
        await this.sleep(1500);

        // Verifica novamente
        const stillDisabled = createButton.disabled ||
                              createButton.getAttribute('data-disabled') === 'true';
        if (stillDisabled) {
          throw new Error('Botao permanece desabilitado - verifique o prompt');
        }
      }

      // 6. Clica no botao
      createButton.click();
      this.log('Botao Create clicado');

      // 7. Aguarda processamento
      await this.sleep(1000);

      return { success: true };

    } catch (error) {
      this.log(`Erro DOM: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  // ========================================
  // API - Requisicoes diretas
  // ========================================

  getRequestHeaders() {
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };

    if (this.authHeaders) {
      if (this.authHeaders.authorization) {
        headers['Authorization'] = this.authHeaders.authorization;
      }
      if (this.authHeaders['oai-device-id']) {
        headers['oai-device-id'] = this.authHeaders['oai-device-id'];
      }
      if (this.authHeaders['openai-sentinel-token']) {
        headers['openai-sentinel-token'] = this.authHeaders['openai-sentinel-token'];
      }
    }

    return headers;
  }

  async fetchPendingTasks() {
    try {
      const response = await fetch(this.API.pending, {
        method: 'GET',
        headers: this.getRequestHeaders(),
        credentials: 'include'
      });

      if (!response.ok) {
        if (response.status === 401) {
          this.log('Erro 401 - Token expirado, navegue pelo site');
          this.authHeaders = null;
          this.updateAuthStatus();
        }
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      // API retorna array de tasks pendentes/rodando
      if (Array.isArray(data)) {
        this.activeTasks = data;
        return data;
      }

      // Se retornar objeto com items
      if (data.items && Array.isArray(data.items)) {
        this.activeTasks = data.items;
        return data.items;
      }

      return [];

    } catch (error) {
      // Nao loga erro se for problema de rede comum
      if (!error.message.includes('Failed to fetch')) {
        this.log(`Erro ao buscar tasks: ${error.message}`);
      }
      return this.activeTasks; // Retorna ultimo estado conhecido
    }
  }

  async submitViaAPI(prompt) {
    this.log('Enviando via API...');

    const payload = {
      kind: 'video',
      prompt: prompt,
      title: null,
      orientation: this.config.orientation,
      size: 'small',
      n_frames: this.config.duration,
      inpaint_items: [],
      remix_target_id: null,
      metadata: null,
      cameo_ids: null,
      cameo_replacements: null,
      model: this.config.model,
      style_id: null,
      audio_caption: null,
      audio_transcript: null,
      video_caption: null,
      storyboard_id: null
    };

    try {
      const response = await fetch(this.API.create, {
        method: 'POST',
        headers: this.getRequestHeaders(),
        credentials: 'include',
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));

        if (response.status === 401) {
          this.log('Erro 401 - Token expirado');
          this.authHeaders = null;
          this.updateAuthStatus();
          throw new Error('Token expirado - navegue pelo site para renovar');
        }

        if (response.status === 429) {
          throw new Error('Rate limit - aguarde alguns segundos');
        }

        if (response.status === 400) {
          const msg = errorData.detail || errorData.message || 'Erro de validacao';
          throw new Error(`Moderacao/Validacao: ${msg}`);
        }

        throw new Error(`HTTP ${response.status}: ${JSON.stringify(errorData)}`);
      }

      const data = await response.json();
      return { success: true, data };

    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ========================================
  // Metodo principal de envio (com fallback)
  // ========================================

  async submitPrompt(prompt) {
    let result;

    if (this.config.submitMode === 'dom') {
      // Tenta via DOM primeiro
      result = await this.submitViaDOM(prompt);

      // Se falhar, tenta via API
      if (!result.success && this.authHeaders?.authorization) {
        this.log('DOM falhou, tentando via API...');
        result = await this.submitViaAPI(prompt);
      }
    } else {
      // Tenta via API primeiro
      result = await this.submitViaAPI(prompt);

      // Se falhar, tenta via DOM
      if (!result.success) {
        this.log('API falhou, tentando via DOM...');
        result = await this.submitViaDOM(prompt);
      }
    }

    return result;
  }

  // ========================================
  // Loop Principal de Processamento
  // ========================================

  async startProcessing() {
    if (this.isRunning) return;

    // Se modo API, verifica headers
    if (this.config.submitMode === 'api' && !this.authHeaders?.authorization) {
      this.log('Modo API: Headers nao capturados');
      this.log('Mudando para modo DOM ou navegue pelo site');
      // Muda para DOM automaticamente
      this.config.submitMode = 'dom';
      document.getElementById('sqm-submit-mode').value = 'dom';
    }

    if (this.queue.length === 0) {
      this.log('Adicione prompts antes de iniciar');
      return;
    }

    // Verifica se textarea existe (para modo DOM)
    if (this.config.submitMode === 'dom') {
      const textarea = this.findTextarea();
      if (!textarea) {
        this.log('ERRO: Textarea nao encontrada!');
        this.log('Navegue para /profile ou /explore primeiro');
        return;
      }
    }

    this.isRunning = true;
    this.isPaused = false;
    this.log(`Iniciando processamento de ${this.queue.length} prompts`);
    this.log(`Modo: ${this.config.submitMode.toUpperCase()}`);
    this.updateUI();

    // Executa loop imediatamente
    await this.processLoop();

    // Inicia polling
    this.pollingTimer = setInterval(() => this.processLoop(), this.pollingInterval);
  }

  async processLoop() {
    if (!this.isRunning || this.isPaused) return;

    // Verifica se ainda ha prompts
    if (this.queue.length === 0) {
      this.log('Fila vazia - processamento concluido!');
      this.stop();
      return;
    }

    // Busca tasks ativas
    await this.fetchPendingTasks();
    const activeCount = this.activeTasks.length;

    this.log(`Polling: ${activeCount}/3 ativas, ${this.queue.length} na fila`);
    this.updateUI();

    // Envia prompts se houver slots disponiveis
    while (this.activeTasks.length < this.maxConcurrent && this.queue.length > 0 && this.isRunning && !this.isPaused) {
      const prompt = this.queue[0]; // Pega primeiro sem remover ainda
      const shortPrompt = prompt.substring(0, 40) + (prompt.length > 40 ? '...' : '');

      this.log(`Enviando: "${shortPrompt}"`);

      const result = await this.submitPrompt(prompt);

      if (result.success) {
        this.queue.shift(); // Remove da fila apenas se sucesso
        this.completedCount++;
        this.log('Sucesso! Geracao iniciada');

        // Adiciona task ficticia para controle
        this.activeTasks.push({
          id: `local_${Date.now()}`,
          status: 'pending'
        });
      } else {
        this.errorCount++;
        this.log(`Erro: ${result.error}`);

        // Se for erro de moderacao, remove o prompt
        if (result.error.includes('Moderacao') || result.error.includes('Validacao')) {
          this.queue.shift();
          this.log('Prompt removido (erro de moderacao)');
        } else if (result.error.includes('Textarea') || result.error.includes('Botao')) {
          // Erro de DOM - pausa para usuario verificar
          this.log('Verifique se esta na pagina correta');
          this.pause();
          break;
        } else {
          // Outros erros: pausa e deixa usuario decidir
          this.pause();
          break;
        }
      }

      this.saveToStorage();
      this.updateUI();

      // Delay entre submissoes para evitar rate limiting
      if (this.queue.length > 0 && this.activeTasks.length < this.maxConcurrent) {
        this.log(`Aguardando ${this.submitDelay / 1000}s...`);
        await this.sleep(this.submitDelay);
      }
    }
  }

  pause() {
    this.isPaused = true;
    this.log('Processamento pausado');
    this.updateUI();
  }

  resume() {
    if (!this.isRunning) {
      this.startProcessing();
      return;
    }

    this.isPaused = false;
    this.log('Processamento retomado');
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

    this.log('Processamento parado');
    this.updateUI();
  }

  clearQueue() {
    this.queue = [];
    this.completedCount = 0;
    this.errorCount = 0;
    this.saveToStorage();
    this.log('Fila limpa');
    this.updateUI();
  }

  // ========================================
  // Persistencia
  // ========================================

  async saveToStorage() {
    const data = {
      queue: this.queue,
      completedCount: this.completedCount,
      errorCount: this.errorCount,
      config: this.config
    };

    try {
      await chrome.storage.local.set({ soraAutomation: data });
    } catch (e) {
      // Fallback para localStorage
      localStorage.setItem('sora_automation', JSON.stringify(data));
    }
  }

  async loadFromStorage() {
    try {
      const result = await chrome.storage.local.get('soraAutomation');
      if (result.soraAutomation) {
        const data = result.soraAutomation;
        this.queue = data.queue || [];
        this.completedCount = data.completedCount || 0;
        this.errorCount = data.errorCount || 0;
        this.config = { ...this.config, ...data.config };

        if (this.queue.length > 0) {
          this.log(`Fila restaurada: ${this.queue.length} prompts`);
        }
        return;
      }
    } catch (e) {
      // Chrome storage falhou
    }

    // Fallback para localStorage
    try {
      const data = localStorage.getItem('sora_automation');
      if (data) {
        const parsed = JSON.parse(data);
        this.queue = parsed.queue || [];
        this.completedCount = parsed.completedCount || 0;
        this.errorCount = parsed.errorCount || 0;
        this.config = { ...this.config, ...parsed.config };
      }
    } catch (e) {
      // Ignorar
    }
  }

  // ========================================
  // UI - Painel Flutuante
  // ========================================

  createPanel() {
    const panel = document.createElement('div');
    panel.id = 'sora-queue-panel';
    panel.innerHTML = `
      <div class="sqm-header">
        <span class="sqm-title">Sora Automation</span>
        <div class="sqm-header-controls">
          <span id="sqm-auth-status" class="sqm-auth-badge sqm-auth-pending">Aguardando...</span>
          <button class="sqm-toggle" id="sqm-toggle">-</button>
        </div>
      </div>

      <div class="sqm-body" id="sqm-body">
        <!-- Modo de Envio -->
        <div class="sqm-config sqm-config-single">
          <div class="sqm-config-row sqm-config-full">
            <label>Modo de Envio:</label>
            <select id="sqm-submit-mode">
              <option value="dom">DOM (Textarea + Botao)</option>
              <option value="api">API Direta</option>
            </select>
          </div>
        </div>

        <!-- Configuracoes -->
        <div class="sqm-config">
          <div class="sqm-config-row">
            <label>Orientacao:</label>
            <select id="sqm-orientation">
              <option value="portrait">Retrato (9:16)</option>
              <option value="landscape">Paisagem (16:9)</option>
              <option value="square">Quadrado (1:1)</option>
            </select>
          </div>
          <div class="sqm-config-row">
            <label>Duracao:</label>
            <select id="sqm-duration">
              <option value="150">5 segundos</option>
              <option value="300" selected>10 segundos</option>
              <option value="450">20 segundos</option>
            </select>
          </div>
        </div>

        <!-- Textarea de Prompts -->
        <div class="sqm-section">
          <label>Prompts (um por linha):</label>
          <textarea id="sqm-prompts" placeholder="Cole seus prompts aqui...&#10;Um prompt por linha&#10;&#10;Exemplo:&#10;A cat playing piano in a jazz club&#10;Sunset over mountains with flying birds"></textarea>
          <div class="sqm-prompt-actions">
            <span class="sqm-prompt-count"><span id="sqm-input-count">0</span> prompts</span>
            <button class="sqm-btn-small" id="sqm-add-btn">+ Adicionar a fila</button>
          </div>
        </div>

        <!-- Status -->
        <div class="sqm-status">
          <div class="sqm-status-item">
            <span class="sqm-label">Ativas</span>
            <span class="sqm-value" id="sqm-active">0/3</span>
          </div>
          <div class="sqm-status-item">
            <span class="sqm-label">Na Fila</span>
            <span class="sqm-value" id="sqm-queued">0</span>
          </div>
          <div class="sqm-status-item">
            <span class="sqm-label">Enviados</span>
            <span class="sqm-value" id="sqm-completed">0</span>
          </div>
          <div class="sqm-status-item">
            <span class="sqm-label">Erros</span>
            <span class="sqm-value sqm-value-error" id="sqm-errors">0</span>
          </div>
        </div>

        <!-- Botoes de Controle -->
        <div class="sqm-buttons">
          <button class="sqm-btn sqm-btn-primary" id="sqm-start">Iniciar</button>
          <button class="sqm-btn sqm-btn-secondary" id="sqm-pause" disabled>Pausar</button>
          <button class="sqm-btn sqm-btn-danger" id="sqm-stop" disabled>Parar</button>
          <button class="sqm-btn sqm-btn-secondary" id="sqm-clear">Limpar</button>
        </div>

        <!-- Fila Atual -->
        <div class="sqm-queue-section">
          <label>Fila atual (<span id="sqm-queue-count">0</span>):</label>
          <div class="sqm-queue-list" id="sqm-queue-list">
            <span class="sqm-empty">Fila vazia</span>
          </div>
        </div>

        <!-- Log -->
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

    // Tornar arrastavel
    this.makeDraggable(panel);
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

    // Modo de envio
    document.getElementById('sqm-submit-mode').addEventListener('change', (e) => {
      this.config.submitMode = e.target.value;
      this.saveToStorage();
      this.log(`Modo de envio: ${e.target.value.toUpperCase()}`);

      // Mostra aviso se API selecionada sem headers
      if (e.target.value === 'api' && !this.authHeaders?.authorization) {
        this.log('AVISO: Headers nao capturados para modo API');
        this.log('Navegue pelo site para capturar tokens');
      }
    });

    // Seletores de configuracao
    document.getElementById('sqm-orientation').addEventListener('change', (e) => {
      this.config.orientation = e.target.value;
      this.saveToStorage();
      this.log(`Orientacao: ${e.target.value}`);
    });

    document.getElementById('sqm-duration').addEventListener('change', (e) => {
      this.config.duration = parseInt(e.target.value);
      this.saveToStorage();
      const seconds = { '150': '5s', '300': '10s', '450': '20s' }[e.target.value];
      this.log(`Duracao: ${seconds}`);
    });

    // Restaura config nos selects
    document.getElementById('sqm-submit-mode').value = this.config.submitMode;
    document.getElementById('sqm-orientation').value = this.config.orientation;
    document.getElementById('sqm-duration').value = this.config.duration.toString();

    // Textarea - contar prompts
    const textarea = document.getElementById('sqm-prompts');
    textarea.addEventListener('input', () => {
      const lines = textarea.value.split('\n').filter(l => l.trim());
      document.getElementById('sqm-input-count').textContent = lines.length;
    });

    // Botao Adicionar
    document.getElementById('sqm-add-btn').addEventListener('click', () => {
      const textarea = document.getElementById('sqm-prompts');
      const prompts = textarea.value.split('\n').filter(l => l.trim());

      if (prompts.length === 0) {
        this.log('Nenhum prompt para adicionar');
        return;
      }

      this.queue.push(...prompts);
      this.saveToStorage();
      this.log(`${prompts.length} prompts adicionados a fila`);

      textarea.value = '';
      document.getElementById('sqm-input-count').textContent = '0';
      this.updateUI();
    });

    // Botao Iniciar
    document.getElementById('sqm-start').addEventListener('click', () => {
      // Se textarea tem conteudo, adiciona a fila primeiro
      const textarea = document.getElementById('sqm-prompts');
      const prompts = textarea.value.split('\n').filter(l => l.trim());

      if (prompts.length > 0) {
        this.queue.push(...prompts);
        textarea.value = '';
        document.getElementById('sqm-input-count').textContent = '0';
      }

      this.startProcessing();
    });

    // Botao Pausar/Retomar
    document.getElementById('sqm-pause').addEventListener('click', () => {
      if (this.isPaused) {
        this.resume();
      } else {
        this.pause();
      }
    });

    // Botao Parar
    document.getElementById('sqm-stop').addEventListener('click', () => {
      this.stop();
    });

    // Botao Limpar
    document.getElementById('sqm-clear').addEventListener('click', () => {
      if (this.isRunning) {
        this.stop();
      }
      this.clearQueue();
      document.getElementById('sqm-prompts').value = '';
      document.getElementById('sqm-input-count').textContent = '0';
    });
  }

  updateUI() {
    const activeCount = this.activeTasks.length;

    // Status
    document.getElementById('sqm-active').textContent = `${activeCount}/3`;
    document.getElementById('sqm-queued').textContent = this.queue.length;
    document.getElementById('sqm-completed').textContent = this.completedCount;
    document.getElementById('sqm-errors').textContent = this.errorCount;
    document.getElementById('sqm-queue-count').textContent = this.queue.length;

    // Botoes
    const startBtn = document.getElementById('sqm-start');
    const pauseBtn = document.getElementById('sqm-pause');
    const stopBtn = document.getElementById('sqm-stop');

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

    // Header status
    const header = this.panel.querySelector('.sqm-header');
    header.classList.remove('running', 'paused');

    if (this.isRunning && !this.isPaused) {
      header.classList.add('running');
    } else if (this.isPaused) {
      header.classList.add('paused');
    }

    // Lista da fila
    this.updateQueueList();
  }

  updateQueueList() {
    const listEl = document.getElementById('sqm-queue-list');
    if (!listEl) return;

    if (this.queue.length === 0) {
      listEl.innerHTML = '<span class="sqm-empty">Fila vazia</span>';
      return;
    }

    // Mostra ate 5 primeiros prompts
    const items = this.queue.slice(0, 5).map((prompt, i) => {
      const short = prompt.length > 50 ? prompt.substring(0, 50) + '...' : prompt;
      return `<div class="sqm-queue-item">${i + 1}. ${this.escapeHtml(short)}</div>`;
    });

    if (this.queue.length > 5) {
      items.push(`<div class="sqm-queue-more">... e mais ${this.queue.length - 5} prompts</div>`);
    }

    listEl.innerHTML = items.join('');
  }

  makeDraggable(element) {
    const header = element.querySelector('.sqm-header');
    let isDragging = false;
    let offsetX = 0;
    let offsetY = 0;

    header.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return;

      isDragging = true;
      offsetX = e.clientX - element.offsetLeft;
      offsetY = e.clientY - element.offsetTop;
      header.style.cursor = 'grabbing';
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;

      const x = e.clientX - offsetX;
      const y = e.clientY - offsetY;

      // Limita aos bounds da janela
      const maxX = window.innerWidth - element.offsetWidth;
      const maxY = window.innerHeight - element.offsetHeight;

      element.style.left = Math.max(0, Math.min(x, maxX)) + 'px';
      element.style.top = Math.max(0, Math.min(y, maxY)) + 'px';
      element.style.right = 'auto';
    });

    document.addEventListener('mouseup', () => {
      isDragging = false;
      header.style.cursor = 'move';
    });
  }

  // ========================================
  // Utilidades
  // ========================================

  log(message) {
    const timestamp = new Date().toLocaleTimeString('pt-BR');
    const logEntry = `[${timestamp}] ${message}`;

    console.log(`[Sora Automation] ${message}`);

    const logDiv = document.getElementById('sqm-log');
    if (logDiv) {
      const entry = document.createElement('div');
      entry.className = 'sqm-log-entry';
      entry.textContent = logEntry;
      logDiv.appendChild(entry);
      logDiv.scrollTop = logDiv.scrollHeight;

      // Limita a 100 entradas
      while (logDiv.children.length > 100) {
        logDiv.removeChild(logDiv.firstChild);
      }
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// ========================================
// Inicializacao
// ========================================

// Aguarda DOM estar pronto
function initExtension() {
  // Verifica se ja existe
  if (window.soraAutomation) {
    console.log('[Sora Automation] Ja inicializado');
    return;
  }

  window.soraAutomation = new SoraPromptAutomation();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initExtension);
} else {
  initExtension();
}
