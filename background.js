// ========================================
// SORA PROMPT AUTOMATION - Background Script
// Intercepta headers de autenticacao das requisicoes
// ========================================

console.log('[Sora Automation] Background script carregado');

// Armazena os headers capturados
let capturedHeaders = {
  authorization: null,
  'oai-device-id': null,
  'openai-sentinel-token': null,
  'oai-language': 'pt-BR',
  lastUpdate: null
};

// Lista de endpoints que queremos monitorar para capturar headers
const MONITORED_ENDPOINTS = [
  '/backend/nf/',
  '/backend/project_y/',
  '/backend/api/'
];

// Listener para requisicoes - captura headers
chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    // Verifica se e uma requisicao para endpoints do Sora
    const isMonitored = MONITORED_ENDPOINTS.some(endpoint =>
      details.url.includes(endpoint)
    );

    if (!isMonitored) return;

    // Extrai headers importantes
    const headers = {};
    for (const header of details.requestHeaders || []) {
      const name = header.name.toLowerCase();
      headers[name] = header.value;
    }

    // Atualiza headers capturados
    let updated = false;

    if (headers['authorization'] && headers['authorization'].startsWith('Bearer ')) {
      capturedHeaders.authorization = headers['authorization'];
      updated = true;
    }

    if (headers['oai-device-id']) {
      capturedHeaders['oai-device-id'] = headers['oai-device-id'];
      updated = true;
    }

    if (headers['openai-sentinel-token']) {
      capturedHeaders['openai-sentinel-token'] = headers['openai-sentinel-token'];
      updated = true;
    }

    if (updated) {
      capturedHeaders.lastUpdate = Date.now();

      // Salva no storage
      chrome.storage.local.set({ capturedHeaders });

      console.log('[Sora Automation] Headers capturados:', {
        hasAuth: !!capturedHeaders.authorization,
        hasDeviceId: !!capturedHeaders['oai-device-id'],
        hasSentinel: !!capturedHeaders['openai-sentinel-token']
      });

      // Notifica content scripts
      chrome.tabs.query({ url: 'https://sora.chatgpt.com/*' }, (tabs) => {
        for (const tab of tabs) {
          chrome.tabs.sendMessage(tab.id, {
            type: 'HEADERS_UPDATED',
            headers: capturedHeaders
          }).catch(() => {});
        }
      });
    }
  },
  { urls: ['https://sora.chatgpt.com/*'] },
  ['requestHeaders']
);

// Handler para mensagens do content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_HEADERS') {
    // Retorna headers capturados
    chrome.storage.local.get('capturedHeaders', (result) => {
      sendResponse(result.capturedHeaders || capturedHeaders);
    });
    return true; // Indica resposta assincrona
  }

  if (message.type === 'GET_DEVICE_ID') {
    // Tenta pegar o device ID do cookie
    chrome.cookies.get({
      url: 'https://sora.chatgpt.com',
      name: 'oai-did'
    }, (cookie) => {
      sendResponse(cookie ? cookie.value : null);
    });
    return true;
  }

  if (message.type === 'MANUAL_HEADERS') {
    // Permite atualizar headers manualmente
    capturedHeaders = { ...capturedHeaders, ...message.headers };
    capturedHeaders.lastUpdate = Date.now();
    chrome.storage.local.set({ capturedHeaders });
    sendResponse({ success: true });
    return true;
  }
});

// Restaura headers do storage ao iniciar
chrome.storage.local.get('capturedHeaders', (result) => {
  if (result.capturedHeaders) {
    capturedHeaders = result.capturedHeaders;
    console.log('[Sora Automation] Headers restaurados do storage');
  }
});
