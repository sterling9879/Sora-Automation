// ========================================
// CONTENT.JS - Interage com a página do Sora
// ========================================

class SoraAutomation {
  constructor() {
    console.log('[Sora Automation] ===== CONSTRUCTOR CALLED =====');
    console.log('[Sora Automation] URL:', window.location.href);
    console.log('[Sora Automation] Initializing...');
    
    this.isMonitoring = false;
    this.currentlyProcessing = [];
    this.queue = [];
    this.completedVideos = [];
    this.maxConcurrent = 3;
    this.checkInterval = 3000; // Check every 3 seconds
    this.monitoringInterval = null;
    
    this.init();
    console.log('[Sora Automation] Constructor complete');
  }

  init() {
    console.log('[Sora Automation] ===== INIT CALLED =====');
    console.log('[Sora Automation] Extension loaded on:', window.location.href);
    
    // Listen for messages from popup/background
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      console.log('[Sora Automation] ===== MESSAGE RECEIVED =====');
      console.log('[Sora Automation] Message type:', message.type);
      console.log('[Sora Automation] Message data:', message.data);
      this.handleMessage(message, sendResponse);
      return true; // Keep channel open for async response
    });

    // Check if we're on the right page
    this.checkPage();
    
    console.log('[Sora Automation] Init complete, ready to receive messages');
  }

  handleMessage(message, sendResponse) {
    switch (message.type) {
      case 'START_QUEUE':
        this.startQueue(message.data);
        sendResponse({ success: true });
        break;
        
      case 'PAUSE_QUEUE':
        this.pauseQueue();
        sendResponse({ success: true });
        break;
        
      case 'RESUME_QUEUE':
        this.resumeQueue();
        sendResponse({ success: true });
        break;
        
      case 'STOP_QUEUE':
        this.stopQueue();
        sendResponse({ success: true });
        break;
        
      case 'GET_STATUS':
        sendResponse(this.getStatus());
        break;
        
      case 'CHECK_PAGE':
        sendResponse({ isValidPage: this.isValidPage() });
        break;
        
      default:
        sendResponse({ error: 'Unknown message type' });
    }
  }

  checkPage() {
    const url = window.location.href;
    if (url.includes('sora.chatgpt.com')) {
      console.log('[Sora Automation] On Sora page');
      this.isValidPage = () => true;
    } else {
      this.isValidPage = () => false;
    }
  }

  isValidPage() {
    return window.location.href.includes('sora.chatgpt.com');
  }

  // ========================================
  // Queue Management
  // ========================================

  startQueue(data) {
    console.log('[Sora Automation] ===== START QUEUE CALLED =====');
    console.log('[Sora Automation] Received data:', data);
    console.log('[Sora Automation] Number of prompts:', data.prompts ? data.prompts.length : 0);
    
    if (!data.prompts || data.prompts.length === 0) {
      console.error('[Sora Automation] ❌ No prompts received!');
      return;
    }
    
    console.log('[Sora Automation] First prompt:', data.prompts[0]);
    
    this.queue = data.prompts.map((prompt, index) => {
      const video = {
        id: `video_${Date.now()}_${index}`,
        scene: prompt.scene,
        fullPrompt: prompt.fullPrompt,
        imageData: prompt.imageData || null,
        status: 'pending',
        retries: 0,
        maxRetries: data.settings.maxRetries || 3
      };
      console.log(`[Sora Automation] Video ${index + 1}:`, {
        scene: video.scene,
        fullPromptLength: video.fullPrompt ? video.fullPrompt.length : 0,
        fullPromptPreview: video.fullPrompt ? video.fullPrompt.substring(0, 50) + '...' : 'EMPTY',
        hasImage: !!video.imageData
      });
      return video;
    });

    this.settings = data.settings;
    this.currentlyProcessing = [];
    this.completedVideos = [];
    
    console.log('[Sora Automation] Queue initialized with', this.queue.length, 'videos');
    
    this.isMonitoring = true;
    this.startMonitoring();
    
    // Process queue - this will send the first video
    console.log('[Sora Automation] Starting to process queue...');
    this.processQueue();
  }

  pauseQueue() {
    console.log('[Sora Automation] Pausing queue');
    this.isMonitoring = false;
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
  }

  resumeQueue() {
    console.log('[Sora Automation] Resuming queue');
    this.isMonitoring = true;
    this.startMonitoring();
    this.processQueue();
  }

  stopQueue() {
    console.log('[Sora Automation] Stopping queue');
    this.isMonitoring = false;
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    this.queue = [];
    this.currentlyProcessing = [];
    this.sendStatusUpdate();
  }

  async processQueue() {
    if (!this.isMonitoring) return;

    console.log('[Sora Automation] Processing queue...', {
      currentProcessing: this.currentlyProcessing.length,
      pending: this.queue.filter(v => v.status === 'pending').length,
      completed: this.queue.filter(v => v.status === 'completed').length
    });

    // Process ONE video at a time sequentially
    if (this.currentlyProcessing.length === 0) {
      const pending = this.queue.filter(v => v.status === 'pending');
      
      if (pending.length > 0) {
        const video = pending[0];
        console.log('[Sora Automation] Processing next video:', video.scene);
        
        // Generate the video
        await this.generateVideo(video);
        
        // Navigate to drafts to monitor
        console.log('[Sora Automation] Navigating to drafts to monitor...');
        await this.sleep(2000);
        window.location.href = 'https://sora.chatgpt.com/drafts';
        await this.waitForPageLoad();
        await this.sleep(3000);
        
        // Monitoring will detect completion and call processQueue again
      }
    }

    // Check if queue is complete
    if (this.queue.length > 0 && 
        this.queue.every(v => v.status === 'completed' || v.status === 'failed') &&
        this.currentlyProcessing.length === 0) {
      this.onQueueComplete();
    }
  }

  async generateVideo(video) {
    console.log('[Sora Automation] ===== GENERATING VIDEO =====');
    console.log('[Sora Automation] Scene:', video.scene);
    console.log('[Sora Automation] Full prompt:', video.fullPrompt);
    console.log('[Sora Automation] Has image:', !!video.imageData);

    video.status = 'processing';
    this.currentlyProcessing.push(video.id);
    this.sendStatusUpdate();

    try {
      // ALWAYS navigate to profile page
      console.log('[Sora Automation] Navigating to profile page...');
      window.location.href = 'https://sora.chatgpt.com/profile';
      await this.waitForPageLoad();
      console.log('[Sora Automation] Page loaded, waiting 3s for React...');
      await this.sleep(3000);

      // Upload image if present
      if (video.imageData && video.imageData !== null && video.imageData.length > 0) {
        console.log('[Sora Automation] Uploading image...');
        try {
          await this.uploadImage(video.imageData);
          console.log('[Sora Automation] ✅ Image uploaded successfully');
          await this.sleep(2000); // Wait for image to process
        } catch (uploadError) {
          console.error('[Sora Automation] ⚠️ Image upload failed, continuing without image:', uploadError.message);
          // Continue without image - don't fail the entire video generation
        }
      } else {
        console.log('[Sora Automation] No image to upload, proceeding with text only');
      }

      // Find textarea - usando o placeholder exato do HTML
      console.log('[Sora Automation] Looking for textarea...');
      
      let textarea = document.querySelector('textarea[placeholder="Describe your video..."]');
      
      if (!textarea) {
        console.log('[Sora Automation] Exact selector failed, trying alternatives...');
        // Alternativas
        const selectors = [
          'textarea[placeholder*="Describe"]',
          'textarea[placeholder*="video"]',
          'textarea',
          '[contenteditable="true"]'
        ];
        
        for (const selector of selectors) {
          console.log('[Sora Automation] Trying:', selector);
          textarea = document.querySelector(selector);
          if (textarea) {
            console.log('[Sora Automation] ✅ Found with:', selector);
            break;
          }
        }
      } else {
        console.log('[Sora Automation] ✅ Found textarea with exact selector');
      }
      
      if (!textarea) {
        console.log('[Sora Automation] Waiting 5s more...');
        await this.sleep(5000);
        textarea = document.querySelector('textarea[placeholder="Describe your video..."]');
      }
      
      if (!textarea) {
        const allTextareas = document.querySelectorAll('textarea');
        console.log('[Sora Automation] Total textareas found:', allTextareas.length);
        allTextareas.forEach((ta, i) => {
          console.log(`[Sora Automation] Textarea ${i}:`, {
            placeholder: ta.placeholder,
            classes: ta.className,
            visible: ta.offsetParent !== null
          });
        });
        throw new Error('Textarea not found');
      }

      // Fill the prompt
      console.log('[Sora Automation] Filling textarea...');
      await this.fillTextareaReact(textarea, video.fullPrompt);
      
      // Verify
      console.log('[Sora Automation] Verifying fill...');
      await this.sleep(1000);
      console.log('[Sora Automation] Current value length:', textarea.value.length);
      console.log('[Sora Automation] First 50 chars:', textarea.value.substring(0, 50));

      // Wait for button to enable
      console.log('[Sora Automation] Waiting for Create button to enable...');
      await this.sleep(2000);

      // Find Create button - procurar pelo SVG path ou sr-only text
      const buttons = document.querySelectorAll('button');
      let createButton = null;
      
      for (const btn of buttons) {
        const srOnly = btn.querySelector('.sr-only');
        if (srOnly && srOnly.textContent === 'Create video') {
          createButton = btn;
          console.log('[Sora Automation] ✅ Found Create button via sr-only');
          break;
        }
      }
      
      if (!createButton) {
        // Procurar por botão com SVG de seta para cima
        for (const btn of buttons) {
          const svg = btn.querySelector('svg path[d*="M11.293"]');
          if (svg) {
            createButton = btn;
            console.log('[Sora Automation] ✅ Found Create button via SVG');
            break;
          }
        }
      }

      if (!createButton) {
        throw new Error('Create button not found');
      }

      // Check if button is enabled
      const isDisabled = createButton.hasAttribute('disabled') || createButton.dataset.disabled === 'true';
      console.log('[Sora Automation] Button disabled:', isDisabled);
      
      if (isDisabled) {
        console.log('[Sora Automation] Button still disabled, waiting 3s more...');
        await this.sleep(3000);
      }

      console.log('[Sora Automation] Clicking Create button...');
      createButton.click();
      
      console.log('[Sora Automation] ✅ Video generation started!');
      await this.sleep(2000);

    } catch (error) {
      console.error('[Sora Automation] ❌ Error:', error);
      this.onVideoError(video, error);
    }
  }

  // ========================================
  // Monitoring
  // ========================================

  startMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }

    this.monitoringInterval = setInterval(() => {
      this.checkVideosStatus();
    }, this.checkInterval);

    // Also check immediately
    this.checkVideosStatus();
  }

  async checkVideosStatus() {
    if (!this.isMonitoring) return;
    if (this.currentlyProcessing.length === 0) return;

    console.log('[Sora Automation] Checking videos status...', {
      currentlyProcessing: this.currentlyProcessing.length,
      completedVideos: this.completedVideos.length
    });

    // Navigate to drafts page if needed
    if (!window.location.href.includes('/drafts')) {
      window.location.href = 'https://sora.chatgpt.com/drafts';
      await this.waitForPageLoad();
    }

    // Find all video thumbnails in drafts
    const videos = await this.findDraftVideos();
    
    // Check which ones are complete (not blurred)
    const completedVideos = videos.filter(v => !this.isVideoBlurred(v));
    
    console.log(`[Sora Automation] Found ${videos.length} total videos, ${completedVideos.length} completed`);

    // Count newly completed videos since last check
    const newlyCompletedCount = completedVideos.length - this.completedVideos.length;
    
    if (newlyCompletedCount > 0) {
      console.log(`[Sora Automation] ${newlyCompletedCount} new video(s) completed`);
      
      // Mark videos as completed (process each newly completed video)
      for (let i = 0; i < newlyCompletedCount && this.currentlyProcessing.length > 0; i++) {
        const videoId = this.currentlyProcessing.shift();
        const video = this.queue.find(v => v.id === videoId);
        
        if (video) {
          video.status = 'completed';
          this.completedVideos.push(videoId);
          console.log('[Sora Automation] Video completed:', video.scene);
          
          // Auto-download if enabled
          if (this.settings.autoDownload) {
            // TODO: Implement auto-download
            console.log('[Sora Automation] Auto-download not yet implemented');
          }
        }
      }

      this.sendStatusUpdate();
      
      // IMPORTANT: Process next video from queue (one at a time)
      setTimeout(() => {
        this.processQueue();
      }, 2000); // Wait 2 seconds before processing next video
    }
  }

  async findDraftVideos() {
    // The drafts page shows videos as thumbnails
    // We need to find all video containers
    // Based on the screenshots, videos are in a grid layout
    
    const videoContainers = document.querySelectorAll('[class*="draft"], [class*="video"], video, img[src*="blob"]');
    return Array.from(videoContainers);
  }

  isVideoBlurred(element) {
    // Check if video thumbnail is blurred (indicating it's still generating)
    // This is based on the information that blurred = generating, clear = complete
    
    const style = window.getComputedStyle(element);
    const filter = style.filter;
    
    // Check for blur filter
    if (filter && filter.includes('blur')) {
      return true;
    }

    // Check opacity (generating videos might have lower opacity)
    const opacity = parseFloat(style.opacity);
    if (opacity < 0.8) {
      return true;
    }

    // Check for loading classes
    const classList = element.classList.toString().toLowerCase();
    if (classList.includes('loading') || 
        classList.includes('generating') || 
        classList.includes('processing')) {
      return true;
    }

    // Check if parent has loading indicator
    const parent = element.parentElement;
    if (parent) {
      const parentClass = parent.classList.toString().toLowerCase();
      if (parentClass.includes('loading') || 
          parentClass.includes('generating')) {
        return true;
      }
    }

    return false;
  }

  onVideoError(video, error) {
    console.error('[Sora Automation] Video error:', error);
    
    const index = this.currentlyProcessing.indexOf(video.id);
    if (index > -1) {
      this.currentlyProcessing.splice(index, 1);
    }

    // Retry logic
    if (this.settings.retryOnError && video.retries < video.maxRetries) {
      video.retries++;
      video.status = 'pending';
      console.log(`[Sora Automation] Retrying video (${video.retries}/${video.maxRetries})`);
      
      // Try again after a delay
      setTimeout(() => {
        this.processQueue();
      }, 5000);
    } else {
      video.status = 'failed';
      video.error = error.message;
    }

    this.sendStatusUpdate();
  }

  onQueueComplete() {
    console.log('[Sora Automation] Queue complete!');
    this.isMonitoring = false;
    
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    chrome.runtime.sendMessage({
      type: 'QUEUE_COMPLETE',
      data: {
        total: this.queue.length,
        completed: this.queue.filter(v => v.status === 'completed').length,
        failed: this.queue.filter(v => v.status === 'failed').length
      }
    });

    this.sendStatusUpdate();
  }

  // ========================================
  // DOM Helpers
  // ========================================

  async uploadImage(base64Data) {
    console.log('[Sora Automation] uploadImage called');

    try {
      // Convert base64 to blob
      const blob = await this.base64ToBlob(base64Data);
      console.log('[Sora Automation] Blob created:', blob.type, blob.size);

      // Look for file input or upload button
      // Try multiple selectors
      const selectors = [
        'input[type="file"]',
        'input[accept*="image"]',
        '[data-testid*="upload"]',
        'button[aria-label*="upload"]',
        'button[aria-label*="image"]'
      ];

      let fileInput = null;
      for (const selector of selectors) {
        console.log('[Sora Automation] Trying selector:', selector);
        fileInput = document.querySelector(selector);
        if (fileInput) {
          console.log('[Sora Automation] Found file input with:', selector);
          break;
        }
      }

      if (!fileInput) {
        // Look for buttons that might trigger file input
        const buttons = document.querySelectorAll('button');
        for (const btn of buttons) {
          const ariaLabel = btn.getAttribute('aria-label') || '';
          const title = btn.getAttribute('title') || '';
          if (ariaLabel.toLowerCase().includes('image') ||
              ariaLabel.toLowerCase().includes('upload') ||
              title.toLowerCase().includes('image') ||
              title.toLowerCase().includes('upload')) {
            console.log('[Sora Automation] Found potential upload button');
            btn.click();
            await this.sleep(1000);

            // Try to find file input again
            fileInput = document.querySelector('input[type="file"]');
            if (fileInput) break;
          }
        }
      }

      if (!fileInput) {
        throw new Error('File input not found');
      }

      // Create a File from the blob
      const file = new File([blob], 'image.png', { type: blob.type });
      console.log('[Sora Automation] File created:', file.name, file.type);

      // Create a DataTransfer to simulate file selection
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      fileInput.files = dataTransfer.files;

      // Trigger change event
      const changeEvent = new Event('change', { bubbles: true });
      fileInput.dispatchEvent(changeEvent);

      console.log('[Sora Automation] File input updated and change event dispatched');

    } catch (error) {
      console.error('[Sora Automation] Error uploading image:', error);
      throw error;
    }
  }

  async base64ToBlob(base64Data) {
    // Remove data:image/xxx;base64, prefix if present
    const base64String = base64Data.split(',')[1] || base64Data;
    const mimeMatch = base64Data.match(/data:([^;]+);/);
    const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';

    // Decode base64
    const byteCharacters = atob(base64String);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);

    return new Blob([byteArray], { type: mimeType });
  }

  async waitForElement(selector, timeout = 10000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const element = document.querySelector(selector);
      if (element) return element;
      await this.sleep(100);
    }

    return null;
  }

  async findCreateButton() {
    // Try multiple selectors
    const selectors = [
      'button[type="submit"]',
      'button:has-text("Create video")',
      'button[class*="create"]',
      'button[class*="generate"]'
    ];

    for (const selector of selectors) {
      try {
        const element = document.querySelector(selector);
        if (element && element.textContent.toLowerCase().includes('create')) {
          return element;
        }
      } catch (e) {
        // Invalid selector, continue
      }
    }

    // Fallback: find by text content
    const buttons = document.querySelectorAll('button');
    for (const button of buttons) {
      if (button.textContent.toLowerCase().includes('create video')) {
        return button;
      }
    }

    return null;
  }

  async fillTextareaReact(textarea, text) {
    console.log('[Sora Automation] fillTextareaReact - text length:', text.length);
    
    // Focus the textarea
    textarea.focus();
    textarea.click();
    
    // Clear existing value
    textarea.value = '';
    
    // Use React's native value setter
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value'
    ).set;
    
    nativeInputValueSetter.call(textarea, text);
    
    // Dispatch input event (React listens to this)
    const inputEvent = new Event('input', { bubbles: true, cancelable: true });
    textarea.dispatchEvent(inputEvent);
    
    // Also dispatch change event
    const changeEvent = new Event('change', { bubbles: true, cancelable: true });
    textarea.dispatchEvent(changeEvent);
    
    // Simulate typing for extra React detection
    const keydownEvent = new KeyboardEvent('keydown', { 
      bubbles: true, 
      cancelable: true,
      key: 'a',
      code: 'KeyA'
    });
    textarea.dispatchEvent(keydownEvent);
    
    const keyupEvent = new KeyboardEvent('keyup', { 
      bubbles: true, 
      cancelable: true,
      key: 'a',
      code: 'KeyA'
    });
    textarea.dispatchEvent(keyupEvent);
    
    // Wait a bit for React to process
    await this.sleep(500);
    
    console.log('[Sora Automation] fillTextareaReact - value after fill:', textarea.value.substring(0, 50));
  }

  fillTextarea(textarea, text) {
    console.log('[Sora Automation] fillTextarea called with text length:', text.length);
    
    // Focus first
    textarea.focus();
    
    // Method 1: Clear existing value
    textarea.value = '';
    
    // Method 2: Use native setter (for React)
    try {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value'
      ).set;
      nativeInputValueSetter.call(textarea, text);
      console.log('[Sora Automation] Native setter called');
    } catch (e) {
      console.warn('[Sora Automation] Native setter failed:', e);
    }
    
    // Method 3: Direct assignment
    textarea.value = text;
    
    // Method 4: Simulate typing (for contenteditable)
    if (textarea.getAttribute('contenteditable') === 'true') {
      textarea.textContent = text;
      textarea.innerText = text;
    }
    
    // Trigger ALL possible events for React
    const events = [
      new Event('input', { bubbles: true, cancelable: true }),
      new Event('change', { bubbles: true, cancelable: true }),
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'a' }),
      new KeyboardEvent('keyup', { bubbles: true, cancelable: true, key: 'a' }),
      new Event('blur', { bubbles: true, cancelable: true })
    ];
    
    events.forEach(event => {
      textarea.dispatchEvent(event);
    });
    
    console.log('[Sora Automation] All events dispatched');
    console.log('[Sora Automation] Final textarea value:', textarea.value.substring(0, 50) + '...');
  }

  async waitForPageLoad() {
    return new Promise(resolve => {
      if (document.readyState === 'complete') {
        resolve();
      } else {
        window.addEventListener('load', resolve);
      }
    });
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ========================================
  // Status Updates
  // ========================================

  getStatus() {
    return {
      isMonitoring: this.isMonitoring,
      queue: this.queue,
      currentlyProcessing: this.currentlyProcessing,
      completedVideos: this.completedVideos,
      stats: {
        total: this.queue.length,
        pending: this.queue.filter(v => v.status === 'pending').length,
        processing: this.currentlyProcessing.length,
        completed: this.queue.filter(v => v.status === 'completed').length,
        failed: this.queue.filter(v => v.status === 'failed').length
      }
    };
  }

  sendStatusUpdate() {
    const status = this.getStatus();
    
    // Send to background script
    chrome.runtime.sendMessage({
      type: 'STATUS_UPDATE',
      data: status
    });
  }
}

// Initialize
console.log('[Sora Automation] ===== SCRIPT LOADED =====');
console.log('[Sora Automation] Creating SoraAutomation instance...');
const soraAutomation = new SoraAutomation();
console.log('[Sora Automation] ===== READY =====');
