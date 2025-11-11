// ========================================
// content.js — Sora Automation v3.1.0
// MODO HÍBRIDO: RÁPIDO NO INÍCIO + SEQUENCIAL
// 
// Fluxo:
// 1. Envia os primeiros 5 rapidamente
// 2. Depois muda para modo sequencial (2 min entre cada)
// 3. Se der erro, espera 1 min e tenta de novo
// ========================================

class SoraAutomation {
  constructor() {
    this.version = '3.1.0';
    console.log(`%c[Sora v${this.version}] ===== HYBRID MODE =====`, 'color: #00ff00; font-weight: bold');
    
    // Estado
    this.prompts = [];
    this.currentIndex = 0;
    this.isActive = false;
    this.stats = {
      sent: 0,
      errors: 0,
      startTime: null
    };
    
    // Configurações
    this.initialBurst = 5;           // Quantos enviar rapidamente no início
    this.waitBetweenBurst = 10000;   // 10 segundos entre os iniciais
    this.waitBetweenSends = 120000;  // 2 minutos após o burst inicial
    this.waitOnError = 60000;        // 1 minuto se der erro
    
    // Bind
    this.handleMessage = this.handleMessage.bind(this);
    this.processQueue = this.processQueue.bind(this);
    this.sendPrompt = this.sendPrompt.bind(this);
    
    // Listener
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      this.handleMessage(msg, sendResponse);
      return true;
    });
    
    console.log(`[Sora v${this.version}] Ready - Modo Híbrido`);
  }
  
  // ============================================================
  // MESSAGE HANDLER
  // ============================================================
  handleMessage(msg, sendResponse) {
    switch (msg.type) {
      case 'START_QUEUE':
        this.startQueue(msg.data);
        sendResponse({ success: true });
        break;
        
      case 'STOP_QUEUE':
        this.stopQueue();
        sendResponse({ success: true });
        break;
        
      case 'GET_STATUS':
        sendResponse(this.getStatus());
        break;
        
      default:
        sendResponse({ error: 'Unknown message' });
    }
  }
  
  // ============================================================
  // QUEUE MANAGEMENT
  // ============================================================
  startQueue(data) {
    if (!data?.prompts?.length) {
      this.error('❌ Sem prompts');
      return;
    }
    
    this.log('🎬 Iniciando fila HÍBRIDA', 'color: #00ffff; font-weight: bold');
    
    // Reset
    this.prompts = data.prompts;
    this.currentIndex = 0;
    this.isActive = true;
    this.stats = {
      sent: 0,
      errors: 0,
      startTime: Date.now()
    };
    
    this.log(`📋 Total de prompts: ${this.prompts.length}`);
    this.log(`⚡ Primeiros ${Math.min(this.initialBurst, this.prompts.length)} serão enviados rapidamente`);
    this.log(`🐌 Depois: 2 minutos entre cada envio`);
    
    // Começar processamento
    this.processQueue();
  }
  
  stopQueue() {
    this.log('⏹️ Parando fila', 'color: #ff0000');
    this.isActive = false;
  }
  
  // ============================================================
  // PROCESSAMENTO HÍBRIDO
  // ============================================================
  async processQueue() {
    while (this.isActive && this.currentIndex < this.prompts.length) {
      const prompt = this.prompts[this.currentIndex];
      const promptNumber = this.currentIndex + 1;
      const isInBurst = this.currentIndex < this.initialBurst;
      
      this.log('═══════════════════════════════', 'color: #ffff00');
      
      if (isInBurst) {
        this.log(`⚡ BURST [${promptNumber}/${Math.min(this.initialBurst, this.prompts.length)}]`, 'color: #00ffff; font-weight: bold');
      } else {
        this.log(`📤 SEQUENCIAL [${promptNumber}/${this.prompts.length}]`, 'color: #00ffff; font-weight: bold');
      }
      
      this.log(`   • Scene: ${prompt.scene || 'Prompt ' + promptNumber}`);
      
      // Navegar para /profile se necessário
      if (!window.location.href.includes('/profile')) {
        this.log('🚚 Indo para /profile...');
        await this.saveState();
        window.location.href = 'https://sora.chatgpt.com/profile';
        return;
      }
      
      // Tentar enviar
      const success = await this.sendPrompt(prompt.fullPrompt);
      
      if (success) {
        this.log('✅ Enviado com sucesso!', 'color: #00ff00');
        this.stats.sent++;
        this.currentIndex++;
        
        // Decidir quanto esperar
        if (this.currentIndex < this.prompts.length) {
          if (isInBurst && this.currentIndex < this.initialBurst) {
            // Ainda no burst, espera pouco
            this.log(`⚡ Aguardando 10 segundos (modo burst)...`, 'color: #00ffaa');
            await this.countdown(this.waitBetweenBurst);
          } else if (this.currentIndex === this.initialBurst) {
            // Acabou o burst, avisar mudança de modo
            this.log('═══════════════════════════════', 'color: #ff9900');
            this.log('🔄 MUDANDO PARA MODO SEQUENCIAL', 'color: #ff9900; font-weight: bold');
            this.log('⏰ A partir de agora: 2 minutos entre cada envio', 'color: #ff9900');
            this.log('═══════════════════════════════', 'color: #ff9900');
            await this.countdown(this.waitBetweenSends);
          } else {
            // Modo sequencial normal
            this.log(`⏰ Aguardando 2 minutos antes do próximo...`, 'color: #ffaa00');
            await this.countdown(this.waitBetweenSends);
          }
        }
        
      } else {
        // Detectou limite
        this.stats.errors++;
        
        if (isInBurst) {
          // Se deu erro durante burst, provavelmente atingiu limite de 5
          this.log('⚠️ Limite atingido durante BURST!', 'color: #ff0000; font-weight: bold');
          this.log('🔄 Mudando para modo SEQUENCIAL...', 'color: #ff9900');
          
          // Forçar saída do burst
          if (this.currentIndex < this.initialBurst) {
            this.initialBurst = this.currentIndex; // Ajusta o burst para onde parou
          }
          
          this.log('⏰ Aguardando 2 minutos...', 'color: #ffaa00');
          await this.countdown(this.waitBetweenSends);
        } else {
          // Erro no modo sequencial normal
          this.log('⚠️ Limite atingido! Aguardando 1 minuto...', 'color: #ff9900');
          await this.countdown(this.waitOnError);
        }
        // NÃO incrementa o index, tenta o mesmo de novo
      }
    }
    
    if (this.currentIndex >= this.prompts.length) {
      this.onComplete();
    }
  }
  
  // ============================================================
  // ENVIO INDIVIDUAL
  // ============================================================
  async sendPrompt(text) {
    try {
      // Aguardar página carregar
      await this.sleep(2000);
      
      // Buscar textarea
      const textarea = await this.findTextarea();
      if (!textarea) {
        this.error('❌ Textarea não encontrada');
        return false;
      }
      
      // Preencher
      this.log('   • Preenchendo prompt...');
      await this.fillTextarea(textarea, text);
      await this.sleep(2000);
      
      // Buscar botão
      const button = await this.findCreateButton();
      if (!button) {
        this.error('❌ Botão Create não encontrado');
        return false;
      }
      
      // Clicar
      this.log('   • Clicando em Create...');
      button.click();
      
      // Aguardar para ver se aparece erro
      await this.sleep(3000);
      
      // Verificar se apareceu mensagem de erro
      const hasError = this.checkForErrorMessage();
      
      if (hasError) {
        this.log('   ❌ Detectado: "5 videos at a time"', 'color: #ff0000');
        return false;
      }
      
      return true;
      
    } catch (err) {
      this.error('❌ Erro ao enviar:', err);
      return false;
    }
  }
  
  // ============================================================
  // DETECÇÃO DE ERRO
  // ============================================================
  checkForErrorMessage() {
    // Buscar a mensagem de erro específica
    const errorTexts = [
      'You can only generate 5 videos at a time',
      'only generate 5 videos',
      '5 videos at a time',
      'Please try again after your generations are complete'
    ];
    
    // Buscar em todos elementos
    const allElements = document.querySelectorAll('*');
    
    for (const element of allElements) {
      const text = element.textContent || '';
      for (const errorText of errorTexts) {
        if (text.includes(errorText)) {
          // Verificar se o elemento está visível
          const rect = element.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            return true;
          }
        }
      }
    }
    
    // Buscar especificamente no tooltip/popover
    const popovers = document.querySelectorAll('[data-state="delayed-open"], .surface-popover, [role="tooltip"]');
    for (const popover of popovers) {
      const text = popover.textContent || '';
      if (errorTexts.some(err => text.includes(err))) {
        return true;
      }
    }
    
    return false;
  }
  
  // ============================================================
  // DOM HELPERS
  // ============================================================
  async findTextarea() {
    const selectors = [
      'textarea[placeholder*="Describe" i]',
      'textarea[placeholder*="vídeo" i]',
      'textarea[placeholder*="video" i]',
      'textarea'
    ];
    
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && !el.disabled && el.offsetParent !== null) {
        return el;
      }
    }
    
    return null;
  }
  
  async findCreateButton() {
    const buttons = document.querySelectorAll('button');
    
    for (const btn of buttons) {
      if (btn.disabled) continue;
      
      // Buscar por span.sr-only
      const srOnly = btn.querySelector('span.sr-only');
      if (srOnly && /create video/i.test(srOnly.textContent || '')) {
        return btn;
      }
      
      // Buscar por aria-label
      const ariaLabel = btn.getAttribute('aria-label') || '';
      if (ariaLabel.toLowerCase().includes('create')) {
        return btn;
      }
    }
    
    return null;
  }
  
  async fillTextarea(textarea, text) {
    textarea.focus();
    await this.sleep(100);
    
    textarea.click();
    await this.sleep(100);
    
    // Usar setter nativo
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value'
    )?.set;
    
    if (setter) {
      setter.call(textarea, text);
    } else {
      textarea.value = text;
    }
    
    // Disparar eventos
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
    
    await this.sleep(200);
  }
  
  // ============================================================
  // COUNTDOWN COM DISPLAY
  // ============================================================
  async countdown(ms) {
    const seconds = Math.floor(ms / 1000);
    const endTime = Date.now() + ms;
    
    while (Date.now() < endTime && this.isActive) {
      const remaining = Math.ceil((endTime - Date.now()) / 1000);
      
      // Log em intervalos específicos
      if (ms >= 60000) {
        // Para esperas longas (1min+), log a cada 30s
        if (remaining % 30 === 0 || remaining <= 10) {
          const minutes = Math.floor(remaining / 60);
          const secs = remaining % 60;
          if (minutes > 0) {
            this.log(`   ⏱️ ${minutes}m ${secs}s restantes...`, 'color: #888888');
          } else {
            this.log(`   ⏱️ ${remaining}s restantes...`, 'color: #888888');
          }
        }
      } else {
        // Para esperas curtas, log a cada 5s
        if (remaining % 5 === 0 || remaining <= 3) {
          this.log(`   ⏱️ ${remaining}s restantes...`, 'color: #888888');
        }
      }
      
      await this.sleep(1000);
    }
  }
  
  // ============================================================
  // PERSISTÊNCIA SIMPLES
  // ============================================================
  async saveState() {
    try {
      await chrome.storage.local.set({
        soraHybridState: {
          prompts: this.prompts,
          currentIndex: this.currentIndex,
          initialBurst: this.initialBurst,
          isActive: this.isActive,
          stats: this.stats,
          timestamp: Date.now()
        }
      });
      this.log('💾 Estado salvo');
    } catch (e) {
      this.error('Erro ao salvar:', e);
    }
  }
  
  async restoreState() {
    try {
      const { soraHybridState } = await chrome.storage.local.get(['soraHybridState']);
      
      if (!soraHybridState) return false;
      
      // Verificar idade (máximo 5 minutos)
      if (Date.now() - soraHybridState.timestamp > 300000) {
        await chrome.storage.local.remove(['soraHybridState']);
        return false;
      }
      
      this.prompts = soraHybridState.prompts || [];
      this.currentIndex = soraHybridState.currentIndex || 0;
      this.initialBurst = soraHybridState.initialBurst || 5;
      this.isActive = soraHybridState.isActive || false;
      this.stats = soraHybridState.stats || { sent: 0, errors: 0, startTime: null };
      
      this.log('🔄 Estado restaurado');
      
      if (this.isActive && this.prompts.length > 0) {
        this.log('📍 Continuando fila...');
        await this.sleep(2000);
        this.processQueue();
      }
      
      return true;
      
    } catch (e) {
      this.error('Erro ao restaurar:', e);
      return false;
    }
  }
  
  // ============================================================
  // FINALIZAÇÃO
  // ============================================================
  onComplete() {
    const totalTime = Date.now() - this.stats.startTime;
    const minutes = Math.floor(totalTime / 60000);
    const seconds = Math.floor((totalTime % 60000) / 1000);
    
    this.log('═══════════════════════════════', 'color: #00ff00');
    this.log('🎊 FILA COMPLETA!', 'color: #00ff00; font-weight: bold; font-size: 16px');
    this.log(`   • Total enviado: ${this.stats.sent}/${this.prompts.length}`);
    this.log(`   • Erros/Retries: ${this.stats.errors}`);
    this.log(`   • Tempo total: ${minutes}m ${seconds}s`);
    this.log('═══════════════════════════════', 'color: #00ff00');
    
    this.isActive = false;
    chrome.storage.local.remove(['soraHybridState']);
    
    // Notificar popup
    chrome.runtime.sendMessage({
      type: 'QUEUE_COMPLETE',
      data: this.stats
    });
  }
  
  // ============================================================
  // STATUS
  // ============================================================
  getStatus() {
    const inBurst = this.currentIndex < this.initialBurst;
    return {
      isActive: this.isActive,
      version: this.version,
      mode: inBurst ? 'BURST' : 'SEQUENTIAL',
      total: this.prompts.length,
      current: this.currentIndex,
      sent: this.stats.sent,
      errors: this.stats.errors,
      remaining: this.prompts.length - this.currentIndex
    };
  }
  
  // ============================================================
  // LOGGING
  // ============================================================
  log(message, style = '') {
    const prefix = `[Sora v${this.version}]`;
    if (style) {
      console.log(`%c${prefix} ${message}`, style);
    } else {
      console.log(`${prefix} ${message}`);
    }
  }
  
  error(message, err = null) {
    console.error(`[Sora v${this.version}] ${message}`, err || '');
  }
  
  sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}

// ========================================
// BOOTSTRAP
// ========================================
(() => {
  console.log('%c[Sora Automation] ===== v3.1.0 HYBRID MODE =====', 'color: #00ff00; font-weight: bold; font-size: 14px');
  console.log('%c[Sora] ⚡ Primeiros 5: Modo BURST (10s entre cada)', 'color: #00ffaa');
  console.log('%c[Sora] 🐌 Depois: Modo SEQUENCIAL (2min entre cada)', 'color: #ffaa00');
  
  // Tentar restaurar estado primeiro
  const automation = new SoraAutomation();
  automation.restoreState();
  
  window._soraAutomation = automation;
})();
