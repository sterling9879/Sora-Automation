// SORA QUEUE MANAGER v11
console.log('[SoraQM v11] Carregado!');

class SoraQueueManager {
  constructor() {
    this.queue = [];
    this.isRunning = false;
    this.sentCount = 0;
    this.timer = null;

    this.init();
  }

  init() {
    this.loadFromStorage();
    this.createPanel();
    this.log('Pronto!');

    if (this.isRunning && this.queue.length > 0) {
      this.log('Retomando...');
      setTimeout(() => this.monitorPending(), 3000);
    }
  }

  async getPendingCount() {
    try {
      const response = await fetch('/backend-api/v1/draft?limit=20');
      const data = await response.json();
      const drafts = Array.isArray(data) ? data : (data.items || []);

      const pending = drafts.filter(d => {
        const s = (d.status || '').toLowerCase();
        return s.includes('pending') || s.includes('running') || s.includes('process') || s.includes('generat');
      });

      return pending.length;
    } catch (e) {
      console.log('[SoraQM] Erro fetch:', e);
      return -1;
    }
  }

  async enviar(prompt) {
    this.log(`Enviando: "${prompt.substring(0, 25)}..."`);

    const textarea = document.querySelector('textarea');
    if (!textarea) {
      this.log('ERRO: Textarea nao encontrada!');
      return false;
    }

    // Focar e preencher
    textarea.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (setter) {
      setter.call(textarea, prompt);
    } else {
      textarea.value = prompt;
    }
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));

    await this.sleep(1000);

    // Achar botao - tentar varios metodos
    let btn = null;

    // Metodo 1: sr-only com Create
    for (const b of document.querySelectorAll('button')) {
      const sr = b.querySelector('.sr-only');
      if (sr && sr.textContent.includes('Create')) {
        btn = b;
        break;
      }
    }

    // Metodo 2: botao com SVG perto do textarea
    if (!btn) {
      const form = textarea.closest('form') || textarea.parentElement?.parentElement;
      if (form) {
        const btns = form.querySelectorAll('button');
        for (const b of btns) {
          if (b.querySelector('svg')) {
            btn = b;
            break;
          }
        }
      }
    }

    // Metodo 3: qualquer botao com SVG
    if (!btn) {
      for (const b of document.querySelectorAll('button')) {
        if (b.querySelector('svg') && !b.textContent.trim()) {
          btn = b;
          break;
        }
      }
    }

    if (!btn) {
      this.log('ERRO: Botao nao encontrado!');
      return false;
    }

    // Esperar habilitar
    for (let i = 0; i < 15 && btn.disabled; i++) {
      await this.sleep(200);
    }

    if (btn.disabled) {
      this.log('ERRO: Botao desabilitado!');
      return false;
    }

    btn.click();
    this.log('OK - Enviado!');
    this.sentCount++;
    this.saveToStorage();
    this.updateUI();
    return true;
  }

  async start() {
    if (this.isRunning) return;

    const ta = document.getElementById('sqm-prompts');
    const prompts = ta.value.split('\n').filter(l => l.trim());

    if (!prompts.length) {
      this.log('Adicione prompts!');
      return;
    }

    this.queue = prompts;
    this.sentCount = 0;
    ta.value = '';

    this.isRunning = true;
    this.saveToStorage();
    this.updateUI();

    this.log(`Iniciando ${prompts.length} prompts...`);

    // Envia 3 de cara
    for (let i = 0; i < 3 && this.queue.length > 0 && this.isRunning; i++) {
      const p = this.queue.shift();
      this.saveToStorage();
      this.updateUI();

      const ok = await this.enviar(p);
      if (!ok) {
        this.queue.unshift(p);
        this.saveToStorage();
        break;
      }
      await this.sleep(2000);
    }

    // Comecar monitoramento
    if (this.isRunning && this.queue.length > 0) {
      this.log('Monitorando pending...');
      this.monitorPending();
    } else if (this.queue.length === 0) {
      this.log('Todos enviados!');
      this.stop();
    }
  }

  async monitorPending() {
    if (!this.isRunning) return;

    if (this.queue.length === 0) {
      this.log('Fila vazia!');
      this.stop();
      return;
    }

    const pending = await this.getPendingCount();
    this.log(`Pending: ${pending === 0 ? '[]' : pending}`);

    if (pending === 0) {
      // Vazio! Espera 5s e envia
      this.log('Slot livre! Aguardando 5s...');
      await this.sleep(5000);

      if (!this.isRunning || this.queue.length === 0) return;

      const p = this.queue.shift();
      this.saveToStorage();
      this.updateUI();

      const ok = await this.enviar(p);
      if (!ok) {
        this.queue.unshift(p);
        this.saveToStorage();
      }
    }

    // Proximo check em 3s
    if (this.isRunning && this.queue.length > 0) {
      this.timer = setTimeout(() => this.monitorPending(), 3000);
    } else if (this.queue.length === 0) {
      this.log('Todos enviados!');
      this.stop();
    }
  }

  stop() {
    this.isRunning = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.saveToStorage();
    this.updateUI();
    this.log('Parado');
  }

  clear() {
    this.stop();
    this.queue = [];
    this.sentCount = 0;
    this.saveToStorage();
    this.updateUI();
    this.log('Limpo');
  }

  saveToStorage() {
    localStorage.setItem('sora_qm', JSON.stringify({
      queue: this.queue, sentCount: this.sentCount, isRunning: this.isRunning
    }));
  }

  loadFromStorage() {
    try {
      const d = JSON.parse(localStorage.getItem('sora_qm') || '{}');
      this.queue = d.queue || [];
      this.sentCount = d.sentCount || 0;
      this.isRunning = d.isRunning || false;
    } catch (e) {}
  }

  createPanel() {
    const p = document.createElement('div');
    p.id = 'sora-queue-panel';
    p.innerHTML = `
      <div class="sqm-header"><span>Sora Queue v11</span><button id="sqm-toggle">-</button></div>
      <div class="sqm-body" id="sqm-body">
        <textarea id="sqm-prompts" placeholder="Um prompt por linha..."></textarea>
        <div class="sqm-status"><span>Fila: <b id="sqm-queue">0</b></span><span>Enviados: <b id="sqm-done">0</b></span></div>
        <div class="sqm-buttons">
          <button id="sqm-start">Iniciar</button>
          <button id="sqm-stop" disabled>Parar</button>
          <button id="sqm-clear">Limpar</button>
        </div>
        <div class="sqm-log" id="sqm-log"></div>
      </div>`;
    document.body.appendChild(p);

    const s = document.createElement('style');
    s.textContent = `
      #sora-queue-panel{position:fixed;top:10px;right:10px;width:300px;background:#1a1a2e;border:1px solid #4a4a6a;border-radius:8px;font-family:system-ui;font-size:13px;color:#fff;z-index:99999}
      .sqm-header{display:flex;justify-content:space-between;padding:8px 12px;background:#667eea;border-radius:7px 7px 0 0;font-weight:bold}
      .sqm-header.running{background:#10b981}
      .sqm-header button{background:none;border:none;color:#fff;cursor:pointer}
      .sqm-body{padding:10px}
      #sqm-prompts{width:100%;height:80px;background:#252545;border:1px solid #4a4a6a;border-radius:4px;color:#fff;padding:8px;resize:vertical;box-sizing:border-box}
      .sqm-status{display:flex;justify-content:space-around;margin:8px 0;font-size:12px}
      .sqm-buttons{display:flex;gap:5px}
      .sqm-buttons button{flex:1;padding:6px;border:none;border-radius:4px;cursor:pointer;font-weight:bold}
      #sqm-start{background:#10b981;color:#fff}
      #sqm-stop{background:#ef4444;color:#fff}
      #sqm-clear{background:#6b7280;color:#fff}
      button:disabled{opacity:0.5}
      .sqm-log{margin-top:8px;height:100px;overflow-y:auto;background:#0d0d1a;border-radius:4px;padding:6px;font-size:11px;font-family:monospace}
      .sqm-log div{margin:2px 0;color:#a0a0c0}`;
    document.head.appendChild(s);

    const self = this;
    document.getElementById('sqm-toggle').onclick = function() {
      const b = document.getElementById('sqm-body');
      b.style.display = b.style.display === 'none' ? 'block' : 'none';
    };
    document.getElementById('sqm-start').onclick = function() {
      console.log('[SoraQM] Botao Iniciar clicado!');
      self.start();
    };
    document.getElementById('sqm-stop').onclick = function() { self.stop(); };
    document.getElementById('sqm-clear').onclick = function() { self.clear(); };
    this.updateUI();
    console.log('[SoraQM] Painel criado com sucesso!');
  }

  updateUI() {
    const q = document.getElementById('sqm-queue');
    const d = document.getElementById('sqm-done');
    const st = document.getElementById('sqm-start');
    const sp = document.getElementById('sqm-stop');
    const h = document.querySelector('.sqm-header');
    if (q) q.textContent = this.queue.length;
    if (d) d.textContent = this.sentCount;
    if (st) st.disabled = this.isRunning;
    if (sp) sp.disabled = !this.isRunning;
    if (h) h.classList.toggle('running', this.isRunning);
  }

  log(m) {
    console.log('[SoraQM]', m);
    const l = document.getElementById('sqm-log');
    if (l) {
      l.innerHTML += `<div>[${new Date().toLocaleTimeString('pt-BR')}] ${m}</div>`;
      l.scrollTop = l.scrollHeight;
    }
  }

  sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
}

if (!window.soraQM && location.href.includes('sora.chatgpt.com')) {
  setTimeout(() => { window.soraQM = new SoraQueueManager(); }, 1000);
}
