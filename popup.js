// ========================================
// POPUP.JS - Interface Principal
// ========================================

class TemplateManager {
  constructor() {
    this.templates = [];
    this.currentEditingId = null;
  }

  async loadTemplates() {
    const result = await chrome.storage.local.get(['templates']);
    this.templates = result.templates || [];
    return this.templates;
  }

  async saveTemplates() {
    await chrome.storage.local.set({ templates: this.templates });
  }

  create(templateData) {
    const template = {
      id: this.generateId(),
      name: templateData.name,
      description: templateData.description || '',
      category: templateData.category || 'custom',
      prefix: templateData.prefix || '',
      variable: '{scene}',
      suffix: templateData.suffix || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      usageCount: 0,
      favorite: templateData.favorite || false,
      exampleInput: templateData.exampleInput || '',
      exampleOutput: this.generatePrompt(templateData.prefix, templateData.exampleInput, templateData.suffix),
      imageData: templateData.imageData || null // Add image data
    };

    this.templates.push(template);
    this.saveTemplates();
    return template;
  }

  update(id, changes) {
    const index = this.templates.findIndex(t => t.id === id);
    if (index === -1) return null;

    this.templates[index] = {
      ...this.templates[index],
      ...changes,
      updatedAt: new Date().toISOString()
    };

    if (changes.prefix || changes.suffix || changes.exampleInput) {
      const t = this.templates[index];
      t.exampleOutput = this.generatePrompt(t.prefix, t.exampleInput, t.suffix);
    }

    this.saveTemplates();
    return this.templates[index];
  }

  delete(id) {
    const index = this.templates.findIndex(t => t.id === id);
    if (index === -1) return false;
    
    this.templates.splice(index, 1);
    this.saveTemplates();
    return true;
  }

  get(id) {
    return this.templates.find(t => t.id === id);
  }

  getAll(filter = {}) {
    let filtered = [...this.templates];

    if (filter.category) {
      filtered = filtered.filter(t => t.category === filter.category);
    }

    if (filter.search) {
      const search = filter.search.toLowerCase();
      filtered = filtered.filter(t => 
        t.name.toLowerCase().includes(search) ||
        t.description.toLowerCase().includes(search)
      );
    }

    if (filter.favorite) {
      filtered = filtered.filter(t => t.favorite);
    }

    return filtered;
  }

  duplicate(id) {
    const template = this.get(id);
    if (!template) return null;

    const duplicated = {
      ...template,
      id: this.generateId(),
      name: `${template.name} (cópia)`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      usageCount: 0
    };

    this.templates.push(duplicated);
    this.saveTemplates();
    return duplicated;
  }

  generatePrompt(prefix, scene, suffix) {
    return `${prefix}${scene}${suffix}`.trim();
  }

  applyToScene(templateId, sceneText) {
    const template = this.get(templateId);
    if (!template) return sceneText;

    template.usageCount++;
    this.saveTemplates();

    return this.generatePrompt(template.prefix, sceneText, template.suffix);
  }

  generateId() {
    return 'template_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  exportTemplates() {
    return JSON.stringify(this.templates, null, 2);
  }

  importTemplates(jsonString) {
    try {
      const imported = JSON.parse(jsonString);
      if (!Array.isArray(imported)) throw new Error('Invalid format');
      
      imported.forEach(t => {
        t.id = this.generateId(); // Gera novos IDs
        this.templates.push(t);
      });
      
      this.saveTemplates();
      return true;
    } catch (error) {
      console.error('Error importing templates:', error);
      return false;
    }
  }
}

// ========================================
// UI Manager
// ========================================

class UIManager {
  constructor() {
    this.templateManager = new TemplateManager();
    this.currentTab = 'scenes';
    this.selectedTemplateId = null;
    this.scenes = [];
    this.processingState = null;
    
    this.initElements();
    this.initEventListeners();
    this.init();
  }

  initElements() {
    // Tabs
    this.tabButtons = document.querySelectorAll('.tab-btn');
    this.tabContents = document.querySelectorAll('.tab-content');

    // Scenes tab
    this.templateSelect = document.getElementById('template-select');
    this.scenesInput = document.getElementById('scenes-input');
    this.sceneCounter = document.getElementById('scene-counter');
    this.templateInfo = document.getElementById('template-info');
    this.previewPromptsBtn = document.getElementById('preview-prompts-btn');
    this.startGenerationBtn = document.getElementById('start-generation-btn');
    this.statusDisplay = document.getElementById('status-display');
    this.progressContainer = document.getElementById('progress-container');
    this.queueList = document.getElementById('queue-list');
    this.controlButtons = document.getElementById('control-buttons');
    this.pauseBtn = document.getElementById('pause-btn');
    this.stopBtn = document.getElementById('stop-btn');

    // Templates tab
    this.newTemplateBtn = document.getElementById('new-template-btn');
    this.templatesList = document.getElementById('templates-list');
    this.templateSearch = document.getElementById('template-search');
    this.categoryFilter = document.getElementById('category-filter');
    this.manageTemplatesBtn = document.getElementById('manage-templates-btn');

    // Template modal
    this.templateModal = document.getElementById('template-modal');
    this.modalTitle = document.getElementById('modal-title');
    this.templateNameInput = document.getElementById('template-name-input');
    this.templateDescriptionInput = document.getElementById('template-description-input');
    this.templateCategoryInput = document.getElementById('template-category-input');
    this.templateImageInput = document.getElementById('template-image-input');
    this.templateImagePreview = document.getElementById('template-image-preview');
    this.templateImagePreviewImg = document.getElementById('template-image-preview-img');
    this.removeImageBtn = document.getElementById('remove-image-btn');
    this.templatePrefixInput = document.getElementById('template-prefix-input');
    this.templateSuffixInput = document.getElementById('template-suffix-input');
    this.templateExampleInput = document.getElementById('template-example-input');
    this.templateResultDisplay = document.getElementById('template-result-display');
    this.templateStats = document.getElementById('template-stats');
    this.templateFavoriteInput = document.getElementById('template-favorite-input');
    this.saveTemplateBtn = document.getElementById('save-template-btn');
    this.cancelTemplateBtn = document.getElementById('cancel-template-btn');

    // Store current image data
    this.currentImageData = null;

    // Preview modal
    this.previewModal = document.getElementById('preview-modal');
    this.previewList = document.getElementById('preview-list');
    this.confirmPreviewBtn = document.getElementById('confirm-preview-btn');
    this.backPreviewBtn = document.getElementById('back-preview-btn');

    // Settings
    this.autoDownloadCheckbox = document.getElementById('auto-download');
    this.notificationsCheckbox = document.getElementById('notifications');
    this.showPreviewCheckbox = document.getElementById('show-preview');
    this.retryOnErrorCheckbox = document.getElementById('retry-on-error');
    this.maxRetriesInput = document.getElementById('max-retries');
    this.exportTemplatesBtn = document.getElementById('export-templates-btn');
    this.importTemplatesBtn = document.getElementById('import-templates-btn');
    this.importFileInput = document.getElementById('import-file-input');

    // Modal close buttons
    this.modalCloseButtons = document.querySelectorAll('.modal-close');
  }

  initEventListeners() {
    // Tabs
    this.tabButtons.forEach(btn => {
      btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
    });

    // Scenes input
    this.scenesInput.addEventListener('input', () => this.updateSceneCount());
    this.templateSelect.addEventListener('change', () => this.onTemplateSelect());
    this.manageTemplatesBtn.addEventListener('click', () => this.switchTab('templates'));
    
    // Buttons
    this.previewPromptsBtn.addEventListener('click', () => this.showPreviewModal());
    this.startGenerationBtn.addEventListener('click', () => this.startGeneration());
    this.pauseBtn.addEventListener('click', () => this.pauseGeneration());
    this.stopBtn.addEventListener('click', () => this.stopGeneration());

    // Templates
    this.newTemplateBtn.addEventListener('click', () => this.openTemplateModal());
    this.templateSearch.addEventListener('input', () => this.renderTemplates());
    this.categoryFilter.addEventListener('change', () => this.renderTemplates());
    
    // Template modal
    this.saveTemplateBtn.addEventListener('click', () => this.saveTemplate());
    this.cancelTemplateBtn.addEventListener('click', () => this.closeTemplateModal());
    this.templateImageInput.addEventListener('change', (e) => this.handleImageUpload(e));
    this.removeImageBtn.addEventListener('click', () => this.removeImage());
    this.templatePrefixInput.addEventListener('input', () => this.updateTemplatePreview());
    this.templateSuffixInput.addEventListener('input', () => this.updateTemplatePreview());
    this.templateExampleInput.addEventListener('input', () => this.updateTemplatePreview());

    // Preview modal
    this.confirmPreviewBtn.addEventListener('click', () => this.confirmAndStart());
    this.backPreviewBtn.addEventListener('click', () => this.closePreviewModal());

    // Settings
    this.autoDownloadCheckbox.addEventListener('change', () => this.saveSettings());
    this.notificationsCheckbox.addEventListener('change', () => this.saveSettings());
    this.showPreviewCheckbox.addEventListener('change', () => this.saveSettings());
    this.retryOnErrorCheckbox.addEventListener('change', () => this.saveSettings());
    this.maxRetriesInput.addEventListener('change', () => this.saveSettings());
    
    this.exportTemplatesBtn.addEventListener('click', () => this.exportTemplates());
    this.importTemplatesBtn.addEventListener('click', () => this.importFileInput.click());
    this.importFileInput.addEventListener('change', (e) => this.importTemplates(e));

    // Modal close
    this.modalCloseButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        this.closeTemplateModal();
        this.closePreviewModal();
      });
    });

    // Close modals only with close button (not on outside click)

    // Listen for messages from background/content script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'QUEUE_UPDATE') {
        this.updateQueueDisplay(message.data);
      } else if (message.type === 'STATUS_UPDATE') {
        this.updateStatusDisplay(message.data);
      }
    });
  }

  async init() {
    console.log('[Popup] Initializing...');
    
    await this.templateManager.loadTemplates();
    console.log('[Popup] Templates loaded');
    
    await this.loadSettings();
    console.log('[Popup] Settings loaded');
    
    this.renderTemplates();
    this.populateTemplateSelect();
    this.checkProcessingState();
    
    console.log('[Popup] Initialization complete');
    
    // Não abrir janela automaticamente pois fecha o popup
    // A janela será aberta quando o usuário iniciar a geração
  }

  async openSoraWindow() {
    console.log('[Popup] openSoraWindow called');
    
    try {
      // Verificar se a configuração está ativada
      const settings = await this.getSettings();
      console.log('[Popup] Settings loaded:', settings);
      
      if (settings.autoOpenSora === false) {
        console.log('[Popup] Auto-open Sora is disabled in settings');
        return;
      }
      
      console.log('[Popup] Auto-open is enabled, sending message to background...');
      
      // Enviar mensagem para o background script fazer a abertura
      chrome.runtime.sendMessage({
        type: 'OPEN_SORA_WINDOW'
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('[Popup] Error sending message:', chrome.runtime.lastError);
        } else {
          console.log('[Popup] Background response:', response);
        }
      });
      
    } catch (error) {
      console.error('[Popup] ❌ Error in openSoraWindow:', error);
      console.error('[Popup] Error details:', error.message, error.stack);
    }
  }

  // ========================================
  // Tab Management
  // ========================================

  switchTab(tabName) {
    this.currentTab = tabName;
    
    this.tabButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    this.tabContents.forEach(content => {
      content.classList.toggle('active', content.id === `${tabName}-tab`);
    });

    if (tabName === 'templates') {
      this.renderTemplates();
    }
  }

  // ========================================
  // Scenes Management
  // ========================================

  updateSceneCount() {
    const text = this.scenesInput.value.trim();
    const lines = text.split('\n').filter(line => line.trim());
    this.scenes = lines;
    this.sceneCounter.textContent = `${lines.length} cena${lines.length !== 1 ? 's' : ''} detectada${lines.length !== 1 ? 's' : ''}`;
    
    // Enable/disable buttons
    const hasScenes = lines.length > 0;
    this.previewPromptsBtn.disabled = !hasScenes;
    this.startGenerationBtn.disabled = !hasScenes;
  }

  onTemplateSelect() {
    this.selectedTemplateId = this.templateSelect.value;
    
    if (this.selectedTemplateId) {
      const template = this.templateManager.get(this.selectedTemplateId);
      if (template) {
        this.templateInfo.style.display = 'block';
        document.getElementById('template-name').textContent = template.name;
        document.getElementById('template-description').textContent = template.description || 'Sem descrição';
      }
    } else {
      this.templateInfo.style.display = 'none';
    }
  }

  // ========================================
  // Preview Modal
  // ========================================

  showPreviewModal() {
    if (this.scenes.length === 0) return;

    const template = this.selectedTemplateId ? this.templateManager.get(this.selectedTemplateId) : null;
    
    // Show template info
    const previewInfo = document.getElementById('preview-template-info');
    if (template) {
      previewInfo.innerHTML = `
        <strong>Template: ${template.name}</strong>
        <p>${template.description || ''}</p>
      `;
    } else {
      previewInfo.innerHTML = '<p><em>Nenhum template selecionado - usando texto original</em></p>';
    }

    // Generate previews
    this.previewList.innerHTML = '';
    this.scenes.forEach((scene, index) => {
      const fullPrompt = template 
        ? this.templateManager.generatePrompt(template.prefix, scene, template.suffix)
        : scene;

      const previewItem = document.createElement('div');
      previewItem.className = 'preview-item fade-in';
      previewItem.innerHTML = `
        <div class="preview-item-header">Cena ${index + 1}</div>
        <div class="preview-item-input">
          <label>Entrada:</label>
          <div class="text">${this.escapeHtml(scene)}</div>
        </div>
        <div class="preview-item-output">${this.escapeHtml(fullPrompt)}</div>
        <div class="preview-item-actions">
          <button class="btn-secondary" onclick="uiManager.editScenePrompt(${index})">✏️ Editar</button>
          <button class="btn-secondary" onclick="uiManager.copyPrompt('${this.escapeHtml(fullPrompt)}')">📋 Copiar</button>
        </div>
      `;
      this.previewList.appendChild(previewItem);
    });

    this.previewModal.classList.add('active');
  }

  closePreviewModal() {
    this.previewModal.classList.remove('active');
  }

  confirmAndStart() {
    this.closePreviewModal();
    this.startGeneration();
  }

  editScenePrompt(index) {
    const newText = prompt('Edite a cena:', this.scenes[index]);
    if (newText !== null && newText.trim()) {
      this.scenes[index] = newText.trim();
      const lines = this.scenesInput.value.split('\n');
      lines[index] = newText.trim();
      this.scenesInput.value = lines.join('\n');
      this.showPreviewModal(); // Refresh
    }
  }

  copyPrompt(text) {
    navigator.clipboard.writeText(text);
    this.showNotification('Prompt copiado!', 'success');
  }

  // ========================================
  // Generation Management
  // ========================================

  async startGeneration() {
    console.log('[Popup] startGeneration called');
    
    if (this.scenes.length === 0) {
      this.showNotification('Adicione pelo menos uma cena!', 'error');
      return;
    }

    // Check if should show preview
    const settings = await this.getSettings();
    if (settings.showPreview && !confirm('Iniciar geração de ' + this.scenes.length + ' vídeos?')) {
      console.log('[Popup] User cancelled');
      return;
    }

    // Abrir/focar janela do Sora ANTES de enviar
    console.log('[Popup] ===== SENDING OPEN_SORA_WINDOW MESSAGE =====');
    
    chrome.runtime.sendMessage(
      { type: 'OPEN_SORA_WINDOW' }, 
      async (response) => {
        if (chrome.runtime.lastError) {
          console.error('[Popup] Error sending OPEN_SORA_WINDOW:', chrome.runtime.lastError);
          return;
        }
        
        console.log('[Popup] ===== SORA WINDOW RESPONSE =====');
        console.log('[Popup] Response:', response);
        
        // Aguardar um pouco para a janela abrir/focar
        console.log('[Popup] Waiting 1000ms for window to open...');
        await this.sleep(1000);
        console.log('[Popup] Wait complete, preparing prompts...');
        
        // Prepare prompts
        const template = this.selectedTemplateId ? this.templateManager.get(this.selectedTemplateId) : null;
        const prompts = this.scenes.map(scene => {
          return {
            scene: scene,
            fullPrompt: template
              ? this.templateManager.generatePrompt(template.prefix, scene, template.suffix)
              : scene,
            imageData: template ? template.imageData : null // Include image data
          };
        });

        console.log('[Popup] Prepared', prompts.length, 'prompts');
        console.log('[Popup] Sending START_GENERATION message...');

        // Send to background script
        chrome.runtime.sendMessage({
          type: 'START_GENERATION',
          data: {
            prompts: prompts,
            templateId: this.selectedTemplateId,
            settings: settings
          }
        }, (startResponse) => {
          if (chrome.runtime.lastError) {
            console.error('[Popup] Error sending START_GENERATION:', chrome.runtime.lastError);
          } else {
            console.log('[Popup] START_GENERATION response:', startResponse);
          }
        });

        this.showNotification('Geração iniciada!', 'success');
        this.updateUIForProcessing();
      }
    );
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  pauseGeneration() {
    chrome.runtime.sendMessage({ type: 'PAUSE_GENERATION' });
    this.pauseBtn.textContent = '▶️ Retomar';
    this.pauseBtn.onclick = () => this.resumeGeneration();
  }

  resumeGeneration() {
    chrome.runtime.sendMessage({ type: 'RESUME_GENERATION' });
    this.pauseBtn.textContent = '⏸️ Pausar';
    this.pauseBtn.onclick = () => this.pauseGeneration();
  }

  stopGeneration() {
    if (confirm('Tem certeza que deseja parar a geração?')) {
      chrome.runtime.sendMessage({ type: 'STOP_GENERATION' });
      this.updateUIForIdle();
    }
  }

  updateUIForProcessing() {
    this.statusDisplay.innerHTML = '<p class="status-processing">⚙️ Processando...</p>';
    this.progressContainer.style.display = 'block';
    this.queueList.style.display = 'block';
    this.controlButtons.style.display = 'flex';
    this.startGenerationBtn.disabled = true;
  }

  updateUIForIdle() {
    this.statusDisplay.innerHTML = '<p class="status-idle">Aguardando início...</p>';
    this.progressContainer.style.display = 'none';
    this.queueList.style.display = 'none';
    this.controlButtons.style.display = 'none';
    this.startGenerationBtn.disabled = false;
  }

  updateQueueDisplay(queueData) {
    this.queueList.innerHTML = '';
    
    queueData.items.forEach(item => {
      const queueItem = document.createElement('div');
      queueItem.className = `queue-item ${item.status}`;
      
      let statusBadge = '';
      let statusIcon = '';
      
      switch(item.status) {
        case 'completed':
          statusBadge = 'status-badge-completed';
          statusIcon = '✅ Completo';
          break;
        case 'processing':
          statusBadge = 'status-badge-processing';
          statusIcon = '⏳ Gerando...';
          break;
        case 'failed':
          statusBadge = 'status-badge-failed';
          statusIcon = '❌ Erro';
          break;
        default:
          statusBadge = 'status-badge-pending';
          statusIcon = '⏸️ Aguardando';
      }
      
      queueItem.innerHTML = `
        <div class="queue-item-text">${this.escapeHtml(item.scene)}</div>
        <div class="queue-item-status ${statusBadge}">${statusIcon}</div>
      `;
      
      this.queueList.appendChild(queueItem);
    });

    // Update progress
    const completed = queueData.items.filter(i => i.status === 'completed').length;
    const total = queueData.items.length;
    const percentage = (completed / total) * 100;
    
    document.getElementById('progress-text').textContent = `Processando ${completed}/${total}`;
    document.getElementById('processing-count').textContent = `${queueData.currentProcessing} gerando`;
    document.getElementById('progress-fill').style.width = `${percentage}%`;
  }

  updateStatusDisplay(statusData) {
    if (statusData.type === 'complete') {
      this.updateUIForIdle();
      this.showNotification('Todas as gerações foram concluídas!', 'success');
    } else if (statusData.type === 'error') {
      this.showNotification('Erro: ' + statusData.message, 'error');
    }
  }

  async checkProcessingState() {
    // Check if there's an ongoing process
    const result = await chrome.storage.local.get(['processingState']);
    if (result.processingState && result.processingState.status === 'processing') {
      this.updateUIForProcessing();
      // Request update from background
      chrome.runtime.sendMessage({ type: 'GET_QUEUE_STATUS' });
    }
  }

  // ========================================
  // Template Management
  // ========================================

  async renderTemplates() {
    const search = this.templateSearch.value;
    const category = this.categoryFilter.value;
    
    const templates = this.templateManager.getAll({ search, category });
    
    if (templates.length === 0) {
      this.templatesList.innerHTML = `
        <div class="empty-state">
          <p>📭 Nenhum template encontrado</p>
          <p class="small">Tente outra busca ou crie um novo template</p>
        </div>
      `;
      return;
    }

    this.templatesList.innerHTML = '';
    templates.forEach(template => {
      const card = this.createTemplateCard(template);
      this.templatesList.appendChild(card);
    });
  }

  createTemplateCard(template) {
    const card = document.createElement('div');
    card.className = 'template-card fade-in';
    
    const categoryIcons = {
      'animation-2d': '🎨',
      'animation-3d': '🎭',
      'realistic': '📷',
      'artistic': '🖼️',
      'music-video': '🎵',
      'custom': '✨'
    };

    const categoryNames = {
      'animation-2d': 'Animação 2D',
      'animation-3d': 'Animação 3D',
      'realistic': 'Realista',
      'artistic': 'Artístico',
      'music-video': 'Videoclipe',
      'custom': 'Personalizado'
    };

    card.innerHTML = `
      <div class="template-card-header">
        <div class="template-card-title">
          ${template.favorite ? '⭐ ' : ''}${this.escapeHtml(template.name)}${template.imageData ? ' 🖼️' : ''}
        </div>
        <div class="template-card-actions">
          <button class="btn-secondary" onclick="uiManager.editTemplate('${template.id}')">✏️</button>
          <button class="btn-danger" onclick="uiManager.deleteTemplate('${template.id}')">🗑️</button>
        </div>
      </div>
      <div class="template-card-meta">
        ${categoryIcons[template.category]} ${categoryNames[template.category]} • Usado ${template.usageCount} vezes${template.imageData ? ' • Com imagem' : ''}
      </div>
      ${template.description ? `<div class="template-card-description">${this.escapeHtml(template.description)}</div>` : ''}
      <div class="template-card-preview">${this.escapeHtml(template.prefix)}{scene}${this.escapeHtml(template.suffix)}</div>
      <div class="template-card-footer">
        <button class="btn-secondary" onclick="uiManager.viewTemplate('${template.id}')">👁️ Ver completo</button>
        <button class="btn-secondary" onclick="uiManager.duplicateTemplate('${template.id}')">📋 Duplicar</button>
      </div>
    `;
    
    return card;
  }

  openTemplateModal(templateId = null) {
    this.templateManager.currentEditingId = templateId;

    if (templateId) {
      const template = this.templateManager.get(templateId);
      if (!template) return;

      this.modalTitle.textContent = '✏️ Editar Template';
      this.templateNameInput.value = template.name;
      this.templateDescriptionInput.value = template.description;
      this.templateCategoryInput.value = template.category;
      this.templatePrefixInput.value = template.prefix;
      this.templateSuffixInput.value = template.suffix;
      this.templateExampleInput.value = template.exampleInput;
      this.templateFavoriteInput.checked = template.favorite;

      // Load image if exists
      if (template.imageData) {
        this.currentImageData = template.imageData;
        this.showImagePreview(template.imageData);
      } else {
        this.currentImageData = null;
        this.hideImagePreview();
      }
    } else {
      this.modalTitle.textContent = '✨ Criar Novo Template';
      this.templateNameInput.value = '';
      this.templateDescriptionInput.value = '';
      this.templateCategoryInput.value = 'custom';
      this.templatePrefixInput.value = '';
      this.templateSuffixInput.value = '';
      this.templateExampleInput.value = '';
      this.templateFavoriteInput.checked = false;
      this.currentImageData = null;
      this.hideImagePreview();
    }

    this.updateTemplatePreview();
    this.templateModal.classList.add('active');
  }

  async handleImageUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      this.showNotification('Por favor, selecione um arquivo de imagem válido!', 'error');
      return;
    }

    // Validate file size (max 5MB)
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      this.showNotification('A imagem é muito grande! Tamanho máximo: 5MB', 'error');
      return;
    }

    try {
      const base64 = await this.imageToBase64(file);
      this.currentImageData = base64;
      this.showImagePreview(base64);
    } catch (error) {
      console.error('Error processing image:', error);
      this.showNotification('Erro ao processar a imagem!', 'error');
    }
  }

  imageToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  showImagePreview(base64Data) {
    this.templateImagePreviewImg.src = base64Data;
    this.templateImagePreview.style.display = 'flex';
  }

  hideImagePreview() {
    this.templateImagePreview.style.display = 'none';
    this.templateImagePreviewImg.src = '';
  }

  removeImage() {
    this.currentImageData = null;
    this.templateImageInput.value = '';
    this.hideImagePreview();
  }

  closeTemplateModal() {
    this.templateModal.classList.remove('active');
    this.templateManager.currentEditingId = null;
  }

  updateTemplatePreview() {
    const prefix = this.templatePrefixInput.value;
    const suffix = this.templateSuffixInput.value;
    const example = this.templateExampleInput.value;
    
    if (!example) {
      this.templateResultDisplay.textContent = 'Digite um exemplo acima para ver o resultado';
      this.templateStats.textContent = '';
      return;
    }
    
    const result = this.templateManager.generatePrompt(prefix, example, suffix);
    this.templateResultDisplay.textContent = result;
    
    const words = result.split(/\s+/).length;
    const chars = result.length;
    this.templateStats.textContent = `📊 ${words} palavras, ~${chars} caracteres`;
  }

  async saveTemplate() {
    const name = this.templateNameInput.value.trim();
    const prefix = this.templatePrefixInput.value;
    const suffix = this.templateSuffixInput.value;

    if (!name) {
      this.showNotification('Nome do template é obrigatório!', 'error');
      return;
    }

    if (!prefix && !suffix) {
      this.showNotification('Template deve ter pelo menos um prefixo ou sufixo!', 'error');
      return;
    }

    const templateData = {
      name: name,
      description: this.templateDescriptionInput.value.trim(),
      category: this.templateCategoryInput.value,
      prefix: prefix,
      suffix: suffix,
      exampleInput: this.templateExampleInput.value.trim(),
      favorite: this.templateFavoriteInput.checked,
      imageData: this.currentImageData // Add image data
    };

    if (this.templateManager.currentEditingId) {
      this.templateManager.update(this.templateManager.currentEditingId, templateData);
      this.showNotification('Template atualizado!', 'success');
    } else {
      this.templateManager.create(templateData);
      this.showNotification('Template criado!', 'success');
    }

    this.closeTemplateModal();
    this.renderTemplates();
    this.populateTemplateSelect();
  }

  editTemplate(id) {
    this.openTemplateModal(id);
  }

  deleteTemplate(id) {
    const template = this.templateManager.get(id);
    if (!template) return;
    
    if (confirm(`Tem certeza que deseja excluir "${template.name}"?`)) {
      this.templateManager.delete(id);
      this.renderTemplates();
      this.populateTemplateSelect();
      this.showNotification('Template excluído!', 'success');
    }
  }

  viewTemplate(id) {
    const template = this.templateManager.get(id);
    if (!template) return;
    
    alert(`Template: ${template.name}\n\nPrefixo:\n${template.prefix}\n\nVariável: {scene}\n\nSufixo:\n${template.suffix}\n\nExemplo:\n${template.exampleOutput}`);
  }

  duplicateTemplate(id) {
    const duplicated = this.templateManager.duplicate(id);
    if (duplicated) {
      this.renderTemplates();
      this.populateTemplateSelect();
      this.showNotification('Template duplicado!', 'success');
    }
  }

  populateTemplateSelect() {
    const templates = this.templateManager.getAll();
    const currentValue = this.templateSelect.value;
    
    this.templateSelect.innerHTML = '<option value="">Sem template</option>';
    
    templates.forEach(template => {
      const option = document.createElement('option');
      option.value = template.id;
      option.textContent = `${template.favorite ? '⭐ ' : ''}${template.name}`;
      this.templateSelect.appendChild(option);
    });
    
    // Restore selection if still exists
    if (currentValue && templates.find(t => t.id === currentValue)) {
      this.templateSelect.value = currentValue;
    }
  }

  exportTemplates() {
    const json = this.templateManager.exportTemplates();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sora-templates-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    this.showNotification('Templates exportados!', 'success');
  }

  async importTemplates(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
      const success = this.templateManager.importTemplates(e.target.result);
      if (success) {
        this.renderTemplates();
        this.populateTemplateSelect();
        this.showNotification('Templates importados!', 'success');
      } else {
        this.showNotification('Erro ao importar templates!', 'error');
      }
    };
    reader.readAsText(file);
    
    // Reset input
    event.target.value = '';
  }

  // ========================================
  // Settings
  // ========================================

  async loadSettings() {
    const result = await chrome.storage.local.get(['settings']);
    const settings = result.settings || {
      autoDownload: false,
      notifications: true,
      showPreview: true,
      retryOnError: true,
      maxRetries: 3
    };
    
    this.autoDownloadCheckbox.checked = settings.autoDownload;
    this.notificationsCheckbox.checked = settings.notifications;
    this.showPreviewCheckbox.checked = settings.showPreview;
    this.retryOnErrorCheckbox.checked = settings.retryOnError;
    this.maxRetriesInput.value = settings.maxRetries;
  }

  async saveSettings() {
    const settings = {
      autoDownload: this.autoDownloadCheckbox.checked,
      notifications: this.notificationsCheckbox.checked,
      showPreview: this.showPreviewCheckbox.checked,
      retryOnError: this.retryOnErrorCheckbox.checked,
      maxRetries: parseInt(this.maxRetriesInput.value)
    };
    
    await chrome.storage.local.set({ settings });
  }

  async getSettings() {
    const result = await chrome.storage.local.get(['settings']);
    return result.settings || {};
  }

  // ========================================
  // Utilities
  // ========================================

  showNotification(message, type = 'info') {
    // You can implement a toast notification here
    console.log(`[${type.toUpperCase()}] ${message}`);
    
    // For now, just use browser notification if enabled
    this.getSettings().then(settings => {
      if (settings.notifications) {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon48.png',
          title: 'Sora Automation',
          message: message
        });
      }
    });
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Initialize
let uiManager;
document.addEventListener('DOMContentLoaded', () => {
  uiManager = new UIManager();
});
