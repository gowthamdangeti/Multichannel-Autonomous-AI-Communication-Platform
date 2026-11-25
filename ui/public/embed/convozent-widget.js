/**
 * Convozent Voice Widget
 * Embeddable voice call widget for Convozent workflows
 * Version: 1.0.0
 */

(function() {
  'use strict';

  const isLocalEnvironment = (hostname) =>
    hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';

  /**
   * Resolve the backend API base URL dynamically without hardcoded static production URLs.
   * Priority:
   * 1. Explicit parameter or attribute (apiEndpoint)
   * 2. Window runtime injection (window.__CONVOZENT_API_URL__)
   * 3. Environment variable (process.env.NEXT_PUBLIC_API_URL or process.env.NEXT_PUBLIC_BACKEND_URL)
   * 4. Local development host and port detection (script origin or window origin)
   * Returns null if unconfigured (caller must display an initialization error).
   */
  const resolveApiBaseUrl = (explicitEndpoint, scriptOriginUrl) => {
    if (explicitEndpoint && typeof explicitEndpoint === 'string') {
      const trimmed = explicitEndpoint.trim();
      if (trimmed) {
        if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
          return 'https://' + trimmed.replace(/\/+$/, '');
        }
        return trimmed.replace(/\/+$/, '');
      }
    }

    if (typeof window !== 'undefined' && window.__CONVOZENT_API_URL__) {
      return String(window.__CONVOZENT_API_URL__).trim().replace(/\/+$/, '');
    }

    if (typeof process !== 'undefined' && process.env) {
      const envUrl = process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_BACKEND_URL;
      if (envUrl) {
        return String(envUrl).trim().replace(/\/+$/, '');
      }
    }

    // Local development auto-detection (routes local UI/script origin to local backend :8000)
    if (scriptOriginUrl) {
      try {
        const parsed = typeof scriptOriginUrl === 'string' ? new URL(scriptOriginUrl) : scriptOriginUrl;
        if (isLocalEnvironment(parsed.hostname)) {
          return `${parsed.protocol}//${parsed.hostname}:8000`;
        }
      } catch (e) { /* fall through */ }
    }

    if (typeof window !== 'undefined' && isLocalEnvironment(window.location.hostname)) {
      return `${window.location.protocol}//${window.location.hostname}:8000`;
    }

    return null;
  };

  // Widget configuration defaults (contains only generic layout and behavior defaults, no static API URLs)
  const DEFAULT_CONFIG = {
    position: 'bottom-right',
    autoStart: false,
  };

  // Widget state
  const state = {
    config: {},
    isInitialized: false,
    isOpen: false,
    pc: null,
    ws: null,
    stream: null,
    sessionToken: null,
    workflowRunId: null,
    pcId: null,
    connectionStatus: 'idle', // idle, connecting, connected, failed
    audioElement: null,
    turnCredentials: null, // TURN server credentials
    callStartedAt: null, // Timestamp when call connected (for duration tracking)
    gracefulDisconnect: false,
    preCallForm: null, // Public pre-call form schema from embed config
    formValues: {}, // Values collected from the pre-call form
    formErrors: {}, // Field-level errors returned by the server
    formOpen: false,
    formKeyHandler: null,
    callbacks: {
      onReady: null,
      onCallStart: null,
      onCallConnected: null,
      onCallDisconnected: null,
      onCallEnd: null,
      onError: null,
      onStatusChange: null,
      onTranscript: null,
      onFormRequired: null
    }
  };

  /**
   * Headers for public embed API requests. Free ngrok domains serve a browser
   * warning interstitial (HTTP 200 without CORS headers) unless this header is
   * present.
   */
  function publicApiHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (state.config.apiBaseUrl && state.config.apiBaseUrl.indexOf('ngrok') !== -1) {
      headers['ngrok-skip-browser-warning'] = 'true';
    }
    return headers;
  }

  /**
   * Initialize the widget
   */
  async function init() {
    if (state.isInitialized) return;

    // Get token from script URL
    const script = document.currentScript || document.querySelector('script[src*="convozent-widget.js"]');
    if (!script) {
      console.error('Convozent Widget: Script not found');
      return;
    }

    // Extract parameters from URL
    const scriptUrl = new URL(script.src);
    const token = scriptUrl.searchParams.get('token');
    const apiEndpoint = scriptUrl.searchParams.get('apiEndpoint');
    const environment = scriptUrl.searchParams.get('environment');
    // 'chat' -> the standalone chat-agent widget; anything else -> voice.
    const channel = scriptUrl.searchParams.get('channel') || 'voice';

    if (!token) {
      console.error('Convozent Widget: No token found in script URL');
      return;
    }

    // Determine API base URL dynamically
    const apiBaseUrl = resolveApiBaseUrl(
      apiEndpoint || script.getAttribute('data-api-endpoint'),
      scriptUrl
    );

    if (!apiBaseUrl) {
      const configError = new Error(
        'Convozent Widget initialization error: No API base URL configured. ' +
        'Please provide an apiEndpoint query parameter, a data-api-endpoint attribute, ' +
        'or set window.__CONVOZENT_API_URL__.'
      );
      console.error(configError.message);
      if (state.callbacks.onError) {
        state.callbacks.onError(configError);
      }
      return;
    }

    // Store base configuration
    state.config = {
      ...DEFAULT_CONFIG,
      token: token,
      apiBaseUrl: apiBaseUrl,
      environment: environment || 'production',
      channel: channel,
      // Allow data attributes to override fetched config
      contextVariables: parseContextVariables(script.getAttribute('data-convozent-context'))
    };

    // Chat agents are a fully separate widget with their own config endpoint.
    if (state.config.channel === 'chat') {
      await initChatAgent();
      return;
    }

    try {
      // Fetch configuration from API
      const configResponse = await fetch(`${state.config.apiBaseUrl}/api/v1/public/embed/config/${token}`, {
        method: 'GET',
        headers: publicApiHeaders()
      });

      if (!configResponse.ok) {
        throw new Error(`Failed to fetch config: ${configResponse.status}`);
      }

      const configData = await configResponse.json();

      // Merge fetched configuration with defaults
      state.config = {
        ...state.config,
        workflowId: configData.workflow_id,
        settings: configData.settings || {},
        embedMode: configData.settings?.embedMode || 'floating',
        containerId: configData.settings?.containerId || 'convozent-inline-container',
        position: configData.position || DEFAULT_CONFIG.position,
        buttonColor: configData.settings?.buttonColor || '#10b981',
        buttonText: configData.settings?.buttonText || 'Talk to Agent',
        callToActionText: configData.settings?.callToActionText || 'Click to start voice conversation',
        autoStart: configData.auto_start || false,
        preCallForm: configData.pre_call_form || null
      };
      state.preCallForm = state.config.preCallForm;
      state.formValues = { ...(state.config.contextVariables || {}) };
    } catch (error) {
      console.error('Convozent Widget: Failed to fetch configuration', error);
      return;
    }

    state.isInitialized = true;

    // Create widget UI based on mode
    if (state.config.embedMode === 'inline') {
      injectStyles();
      createInlineWidget();
    } else if (state.config.embedMode === 'headless') {
      createHeadlessWidget();
    } else {
      injectStyles();
      createFloatingWidget();
    }

    // Trigger ready callback
    if (state.callbacks.onReady) {
      state.callbacks.onReady();
    }

    // Auto-start if configured
    if (state.config.autoStart) {
      setTimeout(() => startCall(), 1000);
    }
  }

  /**
   * Parse context variables from JSON string
   */
  function parseContextVariables(contextStr) {
    if (!contextStr) return {};
    try {
      return JSON.parse(contextStr);
    } catch (e) {
      console.warn('Convozent Widget: Invalid context variables', e);
      return {};
    }
  }

  /**
   * Inject widget styles
   */
  function injectStyles() {
    if (document.getElementById('convozent-widget-styles')) return;

    const styles = `
      .convozent-widget-container {
        position: fixed;
        z-index: 999999;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      }

      .convozent-widget-container.bottom-right {
        bottom: 20px;
        right: 20px;
      }

      .convozent-widget-container.bottom-left {
        bottom: 20px;
        left: 20px;
      }

      .convozent-widget-container.top-right {
        top: 20px;
        right: 20px;
      }

      .convozent-widget-container.top-left {
        top: 20px;
        left: 20px;
      }

      .convozent-widget-cta {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 12px 20px;
        border: none;
        border-radius: 9999px;
        color: #ffffff;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        white-space: nowrap;
        max-width: calc(100vw - 40px);
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.2);
        transition: filter 150ms ease, transform 100ms ease, box-shadow 200ms ease;
        animation: convozent-cta-in 220ms ease-out;
      }

      .convozent-widget-cta:hover {
        filter: brightness(1.08);
        box-shadow: 0 6px 18px rgba(0, 0, 0, 0.28);
      }
      .convozent-widget-cta:active { transform: scale(0.98); }

      .convozent-widget-cta.convozent-state-connecting { background: #f59e0b !important; animation: convozent-pulse 1.6s infinite; }
      .convozent-widget-cta.convozent-state-connected  { background: #ef4444 !important; }
      .convozent-widget-cta.convozent-state-failed     { background: #ef4444 !important; opacity: 0.85; }

      @keyframes convozent-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.6; }
      }

      @keyframes convozent-cta-in {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: translateY(0); }
      }

      .convozent-pre-call-root {
        position: fixed;
        inset: 0;
        z-index: 2147483000;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
        background: rgba(15, 23, 42, 0.45);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      }

      .convozent-pre-call-card {
        width: 100%;
        max-width: 440px;
        max-height: calc(100vh - 32px);
        overflow-y: auto;
        background: #ffffff;
        color: #111827;
        border-radius: 16px;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.28);
        padding: 22px;
      }

      .convozent-pre-call-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 16px;
      }

      .convozent-pre-call-title {
        margin: 0;
        font-size: 19px;
        line-height: 1.3;
        font-weight: 700;
        color: #111827;
      }

      .convozent-pre-call-desc {
        margin: 6px 0 0;
        font-size: 13px;
        line-height: 1.5;
        color: #6b7280;
      }

      .convozent-pre-call-close {
        flex: 0 0 auto;
        width: 32px;
        height: 32px;
        border: none;
        border-radius: 8px;
        background: #f3f4f6;
        color: #4b5563;
        font-size: 22px;
        line-height: 1;
        cursor: pointer;
      }

      .convozent-pre-call-close:hover { background: #e5e7eb; }

      .convozent-pre-call-field {
        margin-bottom: 14px;
      }

      .convozent-pre-call-label {
        display: block;
        margin-bottom: 6px;
        font-size: 13px;
        font-weight: 600;
        color: #374151;
      }

      .convozent-pre-call-required {
        color: #dc2626;
        margin-left: 3px;
      }

      .convozent-pre-call-input {
        display: block;
        width: 100%;
        box-sizing: border-box;
        padding: 10px 12px;
        border: 1px solid #d1d5db;
        border-radius: 9px;
        background: #ffffff;
        color: #111827;
        font-size: 14px;
        font-family: inherit;
        outline: none;
      }

      .convozent-pre-call-input:focus {
        border-color: #2563eb;
        box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.14);
      }

      .convozent-pre-call-textarea {
        resize: vertical;
        min-height: 76px;
      }

      .convozent-pre-call-check {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 14px;
        color: #374151;
      }

      .convozent-pre-call-check input {
        width: 16px;
        height: 16px;
      }

      .convozent-pre-call-error {
        margin: 6px 0 0;
        font-size: 12px;
        color: #dc2626;
      }

      .convozent-pre-call-field-locked {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 10px 12px;
        border: 1px dashed #d1d5db;
        border-radius: 9px;
        background: #f9fafb;
      }

      .convozent-pre-call-field-locked .convozent-pre-call-label {
        margin-bottom: 0;
      }

      .convozent-pre-call-locked {
        font-size: 12px;
        font-weight: 600;
        color: #6b7280;
        white-space: nowrap;
      }

      .convozent-pre-call-submit {
        width: 100%;
        margin-top: 4px;
        padding: 12px 16px;
        border: none;
        border-radius: 10px;
        color: #ffffff;
        font-size: 15px;
        font-weight: 600;
        font-family: inherit;
        cursor: pointer;
        transition: filter 150ms ease;
      }

      .convozent-pre-call-submit:hover { filter: brightness(1.08); }

      @media (max-width: 480px) {
        .convozent-pre-call-card { padding: 18px; }
      }
    `;

    const styleSheet = document.createElement('style');
    styleSheet.id = 'convozent-widget-styles';
    styleSheet.textContent = styles;
    document.head.appendChild(styleSheet);
  }

  function ctaLabelForStatus(status) {
    switch (status) {
      case 'connecting': return 'Connecting…';
      case 'connected':  return 'End Call';
      case 'failed':     return 'Retry';
      default:           return state.config.buttonText || 'Talk to Agent';
    }
  }

  /**
   * Create floating widget UI — a single CTA pill button anchored to the
   * configured corner of the viewport.
   */
  function createFloatingWidget() {
    const container = document.createElement('div');
    container.className = `convozent-widget-container ${state.config.position}`;
    container.id = 'convozent-widget-root';

    const audio = document.createElement('audio');
    audio.id = 'convozent-widget-audio';
    audio.autoplay = true;
    audio.style.display = 'none';
    container.appendChild(audio);
    state.audioElement = audio;

    document.body.appendChild(container);
    renderFloating();
  }

  /**
   * Render the floating CTA pill. Re-renders preserve the hidden audio
   * element so an in-progress call is not interrupted on status changes.
   */
  function renderFloating() {
    const container = document.getElementById('convozent-widget-root');
    if (!container) return;

    Array.from(container.children).forEach((child) => {
      if (child !== state.audioElement) container.removeChild(child);
    });

    const status = state.connectionStatus || 'idle';

    const button = document.createElement('button');
    button.id = 'convozent-widget-cta';
    button.type = 'button';
    button.className = `convozent-widget-cta convozent-state-${status}`;
    // Idle uses configured color; status states use CSS-defined colors.
    if (status === 'idle') {
      button.style.backgroundColor = state.config.buttonColor;
    }
    button.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/>
        <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
        <line x1="12" y1="19" x2="12" y2="23"/>
        <line x1="8" y1="23" x2="16" y2="23"/>
      </svg>
      <span></span>
    `;
    button.querySelector('span').textContent = ctaLabelForStatus(status);
    button.onclick = toggleCall;

    container.appendChild(button);
  }

  /**
   * Create headless widget (no UI — host page drives everything via window.ConvozentWidget API)
   */
  function createHeadlessWidget() {
    const audio = document.createElement('audio');
    audio.id = 'convozent-widget-audio';
    audio.autoplay = true;
    audio.style.display = 'none';
    document.body.appendChild(audio);
    state.audioElement = audio;
  }

  /**
   * Toggle call (start or stop based on current state)
   */
  function toggleCall() {
    if (state.connectionStatus === 'idle' || state.connectionStatus === 'failed') {
      startCall();
    } else {
      stopCall();
    }
  }

  function updateFloatingButton(status) {
    state.connectionStatus = status;
    renderFloating();
  }

  /**
   * Create inline widget UI
   */
  function createInlineWidget() {
    // Find container element
    const container = document.getElementById(state.config.containerId);
    if (!container) {
      console.error(`Convozent Widget: Container element with id "${state.config.containerId}" not found`);
      if (state.callbacks.onError) {
        state.callbacks.onError(new Error('Container element not found'));
      }
      return;
    }

    // Clear container
    container.innerHTML = '';
    container.className = 'convozent-inline-container';

    // Add minimal inline styles
    const inlineStyles = `
      .convozent-inline-container {
        min-height: 200px;
        padding: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .convozent-inline-status {
        text-align: center;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }

      .convozent-inline-status-icon {
        width: 64px;
        height: 64px;
        margin: 0 auto 20px;
      }

      .convozent-inline-status-text {
        font-size: 18px;
        font-weight: 500;
        margin: 0 0 8px;
        color: #111827;
      }

      .convozent-inline-status-subtext {
        font-size: 14px;
        color: #6b7280;
        margin: 0 0 20px;
      }

      .convozent-inline-button-container {
        display: flex;
        gap: 12px;
        justify-content: center;
        margin-top: 20px;
      }

      .convozent-inline-btn {
        padding: 12px 32px;
        border-radius: 8px;
        border: none;
        font-size: 16px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.3s;
        color: white;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
      }

      .convozent-inline-btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
      }

      .convozent-inline-btn:active {
        transform: translateY(0);
      }

      .convozent-inline-btn-start {
        background: #10b981;
      }

      .convozent-inline-btn-start:hover {
        background: #059669;
      }

      .convozent-inline-btn-end {
        background: #ef4444;
      }

      .convozent-inline-btn-end:hover {
        background: #dc2626;
      }

      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
      }

      .convozent-inline-pulse {
        animation: pulse 2s infinite;
      }
    `;

    // Add inline styles if not already added
    if (!document.getElementById('convozent-inline-styles')) {
      const styleSheet = document.createElement('style');
      styleSheet.id = 'convozent-inline-styles';
      styleSheet.textContent = inlineStyles;
      document.head.appendChild(styleSheet);
    }

    // Create initial status display
    updateInlineStatus('idle');

    // Store audio element (hidden)
    state.audioElement = document.createElement('audio');
    state.audioElement.autoplay = true;
    state.audioElement.style.display = 'none';
    container.appendChild(state.audioElement);

    // Mark widget as open (for inline mode, it's always "open")
    state.isOpen = true;
  }

  /**
   * Update inline widget status
   */
  function updateInlineStatus(status, text, subtext) {
    const container = document.getElementById(state.config.containerId);
    if (!container) return;

    // Update state
    state.connectionStatus = status;

    // Determine display text
    const displayText = text || {
      idle: 'Ready to Connect',
      connecting: 'Connecting...',
      connected: 'Call Active',
      failed: 'Connection Failed'
    }[status];

    const displaySubtext = subtext || {
      idle: state.config.callToActionText,
      connecting: 'Please wait while we establish connection',
      connected: 'You can speak now',
      failed: 'Please check your microphone and try again'
    }[status];

    // Simple button design: green to start, red to end
    let buttonHTML = '';
    if (status === 'idle' || status === 'failed') {
      // Button to start with configured color
      buttonHTML = `
        <button class="convozent-inline-btn convozent-inline-btn-start" id="convozent-inline-start-btn" style="background: ${state.config.buttonColor};">
          ${status === 'failed' ? 'Retry' : state.config.buttonText}
        </button>
      `;
    } else if (status === 'connecting' || status === 'connected') {
      // Red button to end
      buttonHTML = `
        <button class="convozent-inline-btn convozent-inline-btn-end" id="convozent-inline-end-btn">
          End Call
        </button>
      `;
    }

    // Update container content (preserve audio element)
    const audioElement = state.audioElement;
    container.innerHTML = `
      <div class="convozent-inline-status">
        <div class="convozent-inline-status-icon ${status === 'connecting' ? 'convozent-inline-pulse' : ''}">
          ${getStatusIcon(status)}
        </div>
        <p class="convozent-inline-status-text">${displayText}</p>
        <p class="convozent-inline-status-subtext">${displaySubtext}</p>
        <div class="convozent-inline-button-container">
          ${buttonHTML}
        </div>
      </div>
    `;

    // Re-append audio element
    if (audioElement) {
      container.appendChild(audioElement);
    }

    // Attach event handlers
    const startBtn = document.getElementById('convozent-inline-start-btn');
    if (startBtn) startBtn.onclick = startCall;

    const endBtn = document.getElementById('convozent-inline-end-btn');
    if (endBtn) endBtn.onclick = stopCall;

    // Trigger status change callback
    if (state.callbacks.onStatusChange) {
      state.callbacks.onStatusChange(status, displayText, displaySubtext);
    }
  }

  /**
   * Get status icon SVG
   */
  function getStatusIcon(status) {
    const icons = {
      idle: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/>
        <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
        <line x1="12" y1="19" x2="12" y2="23"/>
        <line x1="8" y1="23" x2="16" y2="23"/>
      </svg>`,
      connecting: `<svg class="convozent-widget-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2v4"/>
        <path d="M12 18v4"/>
        <path d="M4.93 4.93l2.83 2.83"/>
        <path d="M16.24 16.24l2.83 2.83"/>
        <path d="M2 12h4"/>
        <path d="M18 12h4"/>
        <path d="M4.93 19.07l2.83-2.83"/>
        <path d="M16.24 7.76l2.83-2.83"/>
      </svg>`,
      connected: `<svg viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2">
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72"/>
        <path d="M15 7a2 2 0 0 1 2 2"/>
        <path d="M15 3a6 6 0 0 1 6 6"/>
      </svg>`,
      failed: `<svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="8" x2="12" y2="12"/>
        <line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>`
    };
    return icons[status] || icons.idle;
  }

  /**
   * Update widget status
   */
  function updateStatus(status, text, subtext) {
    state.connectionStatus = status;

    // Use appropriate update function based on mode
    if (state.config.embedMode === 'inline') {
      updateInlineStatus(status, text, subtext);
    } else if (state.config.embedMode === 'headless') {
      if (state.callbacks.onStatusChange) {
        state.callbacks.onStatusChange(status, text, subtext);
      }
    } else {
      updateFloatingButton(status);
    }
  }

  /**
   * Pre-call form helpers
   */
  function getPublicForm() {
    return state.preCallForm && state.preCallForm.enabled ? state.preCallForm : null;
  }

  function shouldShowPreCallForm() {
    const form = getPublicForm();
    if (!form) return false;
    return form.fields.length > 0 || Boolean(form.always_show);
  }

  function formHasEditableFields() {
    const form = getPublicForm();
    return Boolean(form && form.fields.some((field) => field.editable));
  }

  function getFormSchema() {
    return state.preCallForm;
  }

  function formValuesForInit() {
    const form = getPublicForm();
    const source = state.formValues || {};
    if (!form) return source;

    const known = new Set(form.fields.map((field) => field.name));
    const values = {};
    Object.keys(source).forEach((name) => {
      if (known.has(name) || form.allow_extra_context) {
        values[name] = source[name];
      }
    });
    return values;
  }

  function openPreCallForm(errors) {
    const form = getPublicForm();
    if (!form) return;
    if (state.config.embedMode === 'headless') return;

    state.formOpen = true;
    state.formErrors = errors || {};
    renderPreCallForm();
  }

  function closePreCallForm() {
    state.formOpen = false;
    state.formErrors = {};
    if (state.formKeyHandler) {
      document.removeEventListener('keydown', state.formKeyHandler);
      state.formKeyHandler = null;
    }
    const root = document.getElementById('convozent-pre-call-root');
    if (root) root.remove();
  }

  function renderPreCallForm() {
    const form = getPublicForm();
    if (!form) return;

    const existing = document.getElementById('convozent-pre-call-root');
    if (existing) existing.remove();
    if (state.formKeyHandler) {
      document.removeEventListener('keydown', state.formKeyHandler);
      state.formKeyHandler = null;
    }

    const fields = form.fields
      .map((field) => {
        const error = state.formErrors[field.name];
        const errorHtml = error
          ? `<p class="convozent-pre-call-error" data-error-for="${escapeHtml(field.name)}">${escapeHtml(error)}</p>`
          : `<p class="convozent-pre-call-error" data-error-for="${escapeHtml(field.name)}" style="display:none"></p>`;

        if (!field.editable) {
          if (!form.show_locked_fields) return '';
          return `
            <div class="convozent-pre-call-field convozent-pre-call-field-locked">
              <span class="convozent-pre-call-label">${escapeHtml(field.label)}</span>
              <span class="convozent-pre-call-locked">
                ${field.has_value ? 'Provided by the site' : 'Not provided'}
              </span>
            </div>
            ${errorHtml}
          `;
        }

        const value = state.formValues[field.name] !== undefined
          ? state.formValues[field.name]
          : field.value;
        const required = field.required ? ' required' : '';
        const placeholder = field.placeholder ? ` placeholder="${escapeHtml(field.placeholder)}"` : '';
        const maxLength = field.max_length ? ` maxlength="${field.max_length}"` : '';
        const inputId = `convozent-pre-call-${field.name}`;
        let control = '';

        if (field.type === 'textarea') {
          control = `<textarea id="${inputId}" name="${escapeHtml(field.name)}" class="convozent-pre-call-input convozent-pre-call-textarea" rows="3"${required}${placeholder}${maxLength}>${value === null || value === undefined ? '' : escapeHtml(String(value))}</textarea>`;
        } else if (field.type === 'select') {
          const options = (field.options || [])
            .map((option) => {
              const selected = String(value) === String(option) ? ' selected' : '';
              return `<option value="${escapeHtml(option)}"${selected}>${escapeHtml(option)}</option>`;
            })
            .join('');
          control = `<select id="${inputId}" name="${escapeHtml(field.name)}" class="convozent-pre-call-input"${required}>
            <option value="">Select…</option>${options}
          </select>`;
        } else if (field.type === 'checkbox') {
          const checked = value === true || value === 'true' || value === 1 ? ' checked' : '';
          control = `<label class="convozent-pre-call-check">
            <input id="${inputId}" type="checkbox" name="${escapeHtml(field.name)}"${required}${checked}>
            <span>${escapeHtml(field.placeholder || 'Yes')}</span>
          </label>`;
        } else {
          const type = field.type === 'number' ? 'number' : 'text';
          const step = field.type === 'number' ? ' step="any"' : '';
          control = `<input id="${inputId}" type="${type}" name="${escapeHtml(field.name)}" class="convozent-pre-call-input" value="${value === null || value === undefined ? '' : escapeHtml(String(value))}"${required}${placeholder}${maxLength}${step}>`;
        }

        return `
          <div class="convozent-pre-call-field">
            <label class="convozent-pre-call-label" for="${inputId}">
              ${escapeHtml(field.label)}${field.required ? '<span class="convozent-pre-call-required">*</span>' : ''}
            </label>
            ${control}
            ${errorHtml}
          </div>
        `;
      })
      .join('');

    const generalErrors = Object.entries(state.formErrors)
      .filter(([name]) => !form.fields.some((field) => field.name === name))
      .map(([, message]) => `<p class="convozent-pre-call-error">${escapeHtml(message)}</p>`)
      .join('');

    const root = document.createElement('div');
    root.id = 'convozent-pre-call-root';
    root.className = 'convozent-pre-call-root';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.innerHTML = `
      <div class="convozent-pre-call-card">
        <div class="convozent-pre-call-head">
          <div>
            <h2 class="convozent-pre-call-title">${escapeHtml(form.title || 'Before we start')}</h2>
            ${form.description ? `<p class="convozent-pre-call-desc">${escapeHtml(form.description)}</p>` : ''}
          </div>
          <button type="button" class="convozent-pre-call-close" aria-label="Close">×</button>
        </div>
        <form id="convozent-pre-call-form" novalidate>
          ${generalErrors}
          ${fields}
          <button type="submit" class="convozent-pre-call-submit" style="background-color: ${escapeHtml(state.config.buttonColor)};">
            ${escapeHtml(form.submit_label || 'Start call')}
          </button>
        </form>
      </div>
    `;

    document.body.appendChild(root);

    const formElement = root.querySelector('#convozent-pre-call-form');
    formElement.addEventListener('submit', handlePreCallSubmit);
    root.querySelector('.convozent-pre-call-close').addEventListener('click', closePreCallForm);
    root.addEventListener('click', (event) => {
      if (event.target === root) closePreCallForm();
    });
    formElement.addEventListener('input', (event) => {
      if (event.target && event.target.name) clearPreCallFieldError(event.target.name);
    });

    const keyHandler = (event) => {
      if (event.key === 'Escape') {
        closePreCallForm();
      }
    };
    state.formKeyHandler = keyHandler;
    document.addEventListener('keydown', keyHandler);

    const firstInput = formElement.querySelector(
      'input:not([type="checkbox"]), textarea, select, input[type="checkbox"]'
    );
    if (firstInput) firstInput.focus();
  }

  function clearPreCallFieldError(name) {
    if (!state.formErrors[name]) return;
    delete state.formErrors[name];
    const el = document.querySelector(
      `#convozent-pre-call-form [data-error-for="${name}"]`
    );
    if (el) {
      el.textContent = '';
      el.style.display = 'none';
    }
  }

  function handlePreCallSubmit(event) {
    event.preventDefault();
    const form = getPublicForm();
    if (!form) return;

    const values = { ...state.formValues };
    const errors = {};
    let firstInvalid = null;

    form.fields.forEach((field) => {
      if (!field.editable) return;
      const input = document.querySelector(
        `#convozent-pre-call-form [name="${field.name}"]`
      );
      if (!input) return;

      if (field.type === 'checkbox') {
        values[field.name] = input.checked;
        if (field.required && !input.checked) {
          errors[field.name] = 'This field is required.';
          firstInvalid = firstInvalid || field.name;
        }
        return;
      }

      let value = input.value;
      if (typeof value === 'string') value = value.trim();
      if (field.required && !value) {
        errors[field.name] = 'This field is required.';
        firstInvalid = firstInvalid || field.name;
        return;
      }
      if (value === '') {
        delete values[field.name];
      } else {
        values[field.name] = value;
      }
    });

    state.formValues = values;
    if (Object.keys(errors).length > 0) {
      state.formErrors = errors;
      renderPreCallForm();
      if (firstInvalid) {
        const el = document.querySelector(
          `#convozent-pre-call-form [name="${firstInvalid}"]`
        );
        if (el) el.focus();
      }
      return;
    }

    closePreCallForm();
    startCall({ skipForm: true });
  }

  /**
   * Open widget (deprecated - kept for backwards compatibility)
   */
  function openWidget() {
    if (shouldShowPreCallForm()) {
      openPreCallForm();
    }
  }

  /**
   * Close widget (deprecated - kept for backwards compatibility)
   */
  function closeWidget() {
    // Stop call if active
    if (state.connectionStatus === 'connected' || state.connectionStatus === 'connecting') {
      stopCall();
    }
  }

  /**
   * Start voice call
   */
  async function startCall(options = {}) {
    if (options.formValues) {
      state.formValues = { ...state.formValues, ...options.formValues };
    }

    if (!options.skipForm && !options.formValues && shouldShowPreCallForm()) {
      if (state.config.embedMode === 'headless' && !formHasEditableFields()) {
        // Nothing for the host page to collect; locked values are passed by
        // the server, so continue straight into the call.
      } else if (state.config.embedMode === 'headless') {
        if (state.callbacks.onFormRequired) {
          state.callbacks.onFormRequired(getFormSchema());
          return;
        }
        const error = new Error('This embed requires pre-call form values.');
        if (state.callbacks.onError) state.callbacks.onError(error);
        return;
      } else {
        openPreCallForm();
        return;
      }
    }

    state.gracefulDisconnect = false;
    if (state.audioElement) {
      state.audioElement.play().catch(() => {});
    }
    updateStatus('connecting', 'Connecting...', 'Please wait while we establish the connection');

    if (state.callbacks.onCallStart) {
      state.callbacks.onCallStart();
    }

    try {
      // Request microphone permission before creating the run so a denied
      // permission cannot leave behind an orphaned workflow run.
      try {
        const enableVideo = Boolean(state.config.enableVideo || state.config.video);
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: enableVideo });
        // Release any stream still held from a prior attempt before retaining
        // the new one, so a re-entrant start can't leak the microphone.
        if (state.stream) {
          state.stream.getTracks().forEach(track => track.stop());
        }
        state.stream = stream;
      } catch (micError) {
        // Handle specific microphone permission errors
        let errorMessage = 'Please check your microphone and try again';

        if (micError.name === 'NotAllowedError' || micError.name === 'PermissionDeniedError') {
          errorMessage = 'Microphone permission denied. Please allow microphone access to start the call.';
        } else if (micError.name === 'NotFoundError' || micError.name === 'DevicesNotFoundError') {
          errorMessage = 'No microphone found. Please connect a microphone and try again.';
        } else if (micError.name === 'NotReadableError' || micError.name === 'TrackStartError') {
          errorMessage = 'Microphone is already in use by another application.';
        }

        throw new Error(errorMessage);
      }

      // Initialize session if using embed token
      if (state.config.token) {
        await initializeEmbedSession();
      } else {
        // Direct mode with workflow and run IDs
        state.sessionToken = 'direct-mode';
        state.workflowRunId = state.config.runId;
      }

      // Create WebRTC connection
      await createWebRTCConnection();

      // Connect WebSocket
      await connectWebSocket();

      // Start negotiation
      await negotiate();

    } catch (error) {
      console.error('Convozent Widget: Failed to start call', error);

      // Release anything acquired before the failure so a retry starts clean.
      // getUserMedia may have succeeded before a later step (WebSocket /
      // negotiation) threw, which would otherwise leave the mic held and block
      // the next getUserMedia(). Null the refs before close() so the peer/ws
      // state handlers short-circuit instead of re-entering teardown.
      if (state.stream) {
        state.stream.getTracks().forEach(track => track.stop());
        state.stream = null;
      }
      if (state.pc) {
        const pc = state.pc;
        state.pc = null;
        if (pc.signalingState !== 'closed') {
          pc.close();
        }
      }
      if (state.ws) {
        const ws = state.ws;
        state.ws = null;
        if (ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) {
          ws.close();
        }
      }

      if (error.fieldErrors) {
        updateStatus('idle', 'Ready to start', state.config.callToActionText);
        if (state.config.embedMode === 'headless') {
          if (state.callbacks.onFormRequired) {
            state.callbacks.onFormRequired(getFormSchema(), error.fieldErrors);
          } else if (state.callbacks.onError) {
            state.callbacks.onError(error);
          }
          return;
        }
        openPreCallForm(error.fieldErrors);
        return;
      }

      updateStatus('failed', 'Connection failed', error.message || 'Please check your microphone and try again');

      // Trigger error callback
      if (state.callbacks.onError) {
        state.callbacks.onError(error);
      }
    }
  }

  /**
   * Initialize embed session
   */
  async function initializeEmbedSession() {
    const usesPreCallForm = Boolean(
      state.preCallForm &&
        state.preCallForm.enabled &&
        state.preCallForm.fields.length > 0
    );
    const payload = { token: state.config.token };
    if (usesPreCallForm) {
      payload.form_values = formValuesForInit();
    } else {
      payload.context_variables = state.config.contextVariables;
    }

    const response = await fetch(`${state.config.apiBaseUrl}/api/v1/public/embed/init`, {
      method: 'POST',
      headers: publicApiHeaders(),
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      let detail = null;
      try {
        const error = await response.json();
        detail = error.detail;
      } catch (_e) {
        detail = null;
      }

      if (
        response.status === 422 &&
        detail &&
        typeof detail === 'object' &&
        detail.code === 'pre_call_form_invalid'
      ) {
        const error = new Error('Please check the highlighted fields and try again.');
        error.fieldErrors = detail.fields || {};
        throw error;
      }

      const message =
        typeof detail === 'string'
          ? detail
          : detail && detail.message
            ? detail.message
            : 'Failed to initialize session';
      throw new Error(message);
    }

    const data = await response.json();
    state.sessionToken = data.session_token;
    state.workflowRunId = data.workflow_run_id;
    state.workflowId = data.config.workflow_id;

    // Fetch TURN credentials after session initialization
    await fetchTurnCredentials();
  }

  /**
   * Fetch TURN credentials for WebRTC connection
   */
  async function fetchTurnCredentials() {
    if (!state.sessionToken) {
      console.warn('Convozent Widget: No session token available for TURN credentials');
      return;
    }

    try {
      const response = await fetch(`${state.config.apiBaseUrl}/api/v1/public/embed/turn-credentials/${state.sessionToken}`, {
        method: 'GET',
        headers: publicApiHeaders()
      });

      if (response.ok) {
        state.turnCredentials = await response.json();
        console.log(`TURN credentials obtained, TTL: ${state.turnCredentials.ttl}s`);
      } else if (response.status === 503) {
        // TURN not configured on server - this is OK, we'll use STUN only
        console.log('TURN server not configured, using STUN only');
      } else {
        console.warn(`Failed to fetch TURN credentials: ${response.status}`);
      }
    } catch (error) {
      console.warn('Failed to fetch TURN credentials, continuing without TURN:', error);
    }
  }

  /**
   * Create WebRTC peer connection
   */
  function createWebRTCConnection() {
    // Standard STUN server for WebRTC candidate gathering
    const iceServers = [{ urls: ['stun:stun.l.google.com:19302'] }];

    // Add TURN server if credentials are available
    if (state.turnCredentials && state.turnCredentials.uris && state.turnCredentials.uris.length > 0) {
      iceServers.push({
        urls: state.turnCredentials.uris,
        username: state.turnCredentials.username,
        credential: state.turnCredentials.password
      });
      console.log(`TURN server configured with ${state.turnCredentials.uris.length} URIs`);
    }

    const config = {
      iceServers: iceServers
    };

    state.pc = new RTCPeerConnection(config);

    // Add audio track
    if (state.stream) {
      state.stream.getTracks().forEach(track => {
        state.pc.addTrack(track, state.stream);
      });
    }

    // Handle incoming audio
    state.pc.ontrack = (event) => {
      if (event.track.kind === 'audio' && state.audioElement) {
        state.audioElement.srcObject = event.streams[0];
        state.audioElement.play().catch((err) => {
          console.warn('Convozent Widget: Audio playback error', err);
        });
      }
    };

    // Monitor connection state
    state.pc.oniceconnectionstatechange = handlePeerConnectionStateChange;
    state.pc.onconnectionstatechange = handlePeerConnectionStateChange;
    state.pc.onicecandidate = sendIceCandidate;
  }

  function handlePeerConnectionStateChange() {
    const pc = state.pc;
    if (!pc) return;

    console.log('Peer connection state:', pc.connectionState, 'ICE:', pc.iceConnectionState);

    if (pc.connectionState === 'connected' || pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
      const wasAlreadyConnected = state.callStartedAt !== null;
      updateStatus('connected', 'Connected', 'Your voice call is now active');
      if (!wasAlreadyConnected) {
        state.callStartedAt = Date.now();
        if (state.callbacks.onCallConnected) {
          state.callbacks.onCallConnected({
            agentId: state.config.workflowId || null,
            token: state.config.token || null,
            workflowRunId: state.workflowRunId || null
          });
        }
      }
      return;
    }

    if (pc.connectionState === 'failed' || pc.iceConnectionState === 'failed') {
      stopCall({
        graceful: false,
        status: 'failed',
        text: 'Connection lost',
        subtext: 'The call has been disconnected'
      });
      return;
    }

    if (
      pc.connectionState === 'closed' ||
      pc.connectionState === 'disconnected' ||
      pc.iceConnectionState === 'closed' ||
      pc.iceConnectionState === 'disconnected'
    ) {
      stopCall({ graceful: true });
    }
  }

  function sendIceCandidate(event) {
    // Handle ICE candidates for trickling
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      const message = {
        type: 'ice-candidate',
        payload: {
          candidate: event.candidate ? {
            candidate: event.candidate.candidate,
            sdpMid: event.candidate.sdpMid,
            sdpMLineIndex: event.candidate.sdpMLineIndex
          } : null,
          pc_id: state.pcId
        }
      };
      state.ws.send(JSON.stringify(message));
    }
  }

  /**
   * Connect WebSocket for signaling
   */
  async function connectWebSocket() {
    return new Promise((resolve, reject) => {
      // Use public signaling endpoint for embed tokens
      const wsBaseUrl = state.config.apiBaseUrl.startsWith('https:')
        ? state.config.apiBaseUrl.replace(/^https:/, 'wss:')
        : state.config.apiBaseUrl.replace(/^http:/, 'ws:');
      const wsUrl = `${wsBaseUrl}/api/v1/ws/public/signaling/${state.sessionToken}`;

      state.ws = new WebSocket(wsUrl);
      state.pcId = generatePeerId();

      state.ws.onopen = () => {
        console.log('WebSocket connected');
        resolve();
      };

      state.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        reject(error);
      };

      state.ws.onclose = (event) => {
        console.log('WebSocket closed');
        state.ws = null;

        if (event.reason === 'call ended') {
          stopCall({ graceful: true, closeWebSocket: false });
          return;
        }

        if (state.connectionStatus === 'connected' && !state.gracefulDisconnect) {
          updateStatus('failed', 'Connection lost', 'The call has been disconnected');
        }
      };

      state.ws.onmessage = async (event) => {
        try {
          const message = JSON.parse(event.data);
          await handleWebSocketMessage(message);
        } catch (e) {
          console.error('Failed to handle WebSocket message:', e);
        }
      };
    });
  }

  /**
   * Forward a normalized live transcript event to the embedding page.
   * User events may be interim (`final: false`); assistant events represent
   * output-timed spoken text chunks and are always final.
   */
  function emitTranscript(role, payload, final) {
    if (!state.callbacks.onTranscript) return;

    state.callbacks.onTranscript({
      role: role,
      text: payload?.text || '',
      final: final,
      timestamp: payload?.timestamp || null,
      userId: payload?.user_id || null
    });
  }

  /**
   * Handle WebSocket messages
   */
  async function handleWebSocketMessage(message) {
    switch (message.type) {
      case 'answer':
        const answer = message.payload;
        console.log('Received answer from server');

        await state.pc.setRemoteDescription({
          type: 'answer',
          sdp: answer.sdp
        });
        break;

      case 'ice-candidate':
        const candidate = message.payload.candidate;
        if (candidate) {
          try {
            await state.pc.addIceCandidate({
              candidate: candidate.candidate,
              sdpMid: candidate.sdpMid,
              sdpMLineIndex: candidate.sdpMLineIndex
            });
            console.log('Added remote ICE candidate');
          } catch (e) {
            console.error('Failed to add ICE candidate:', e);
          }
        }
        break;

      case 'rtf-user-transcription':
        emitTranscript('user', message.payload, Boolean(message.payload?.final));
        break;

      case 'rtf-bot-text':
        emitTranscript('assistant', message.payload, true);
        break;

      case 'error':
        console.error('Server error:', message.payload);
        const errMsg = message.payload?.message || message.payload?.detail || 'An error occurred on the server';
        updateStatus('failed', 'Server error', errMsg);
        if (state.callbacks.onError) {
          state.callbacks.onError(new Error(errMsg));
        }
        break;

      case 'call-ended':
        console.log('Call ended by server:', message.payload);
        const reason = message.payload?.reason || 'server disconnect';
        stopCall({ graceful: true });
        if (state.callbacks.onError && reason !== 'user_requested' && reason !== 'peer_connection_closed') {
          state.callbacks.onError(new Error(`Call ended by server (${reason})`));
        }
        break;

      default:
        console.warn('Unknown message type:', message.type);
    }
  }

  /**
   * Negotiate WebRTC connection
   */
  async function negotiate() {
    const offer = await state.pc.createOffer();
    await state.pc.setLocalDescription(offer);

    const message = {
      type: 'offer',
      payload: {
        sdp: offer.sdp,
        type: 'offer',
        pc_id: state.pcId,
        workflow_id: parseInt(state.config.workflowId),
        workflow_run_id: parseInt(state.workflowRunId)
      }
    };

    state.ws.send(JSON.stringify(message));
    console.log('Sent offer via WebSocket');
  }

  /**
   * Stop voice call
   */
  function stopCall(options = {}) {
    const graceful = options.graceful !== false;
    const closeWebSocket = options.closeWebSocket !== false;
    const status = options.status || 'idle';
    const text = options.text || 'Call ended';
    const subtext = options.subtext || 'Click below to start a new call';

    state.gracefulDisconnect = graceful;

    // Fire onCallDisconnected only if the call had actually connected, with
    // identifiers and duration. Must run before we clear callStartedAt.
    if (state.callStartedAt && state.callbacks.onCallDisconnected) {
      const durationSeconds = Math.round((Date.now() - state.callStartedAt) / 1000);
      state.callbacks.onCallDisconnected({
        agentId: state.config.workflowId || null,
        token: state.config.token || null,
        workflowRunId: state.workflowRunId || null,
        durationSeconds
      });
    }
    state.callStartedAt = null;

    updateStatus(status, text, subtext);

    if (state.callbacks.onCallEnd) {
      state.callbacks.onCallEnd();
    }

    // Close WebSocket
    if (closeWebSocket && state.ws) {
      const ws = state.ws;
      state.ws = null;
      if (ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) {
        ws.close();
      }
    } else if (!closeWebSocket) {
      state.ws = null;
    }

    // Stop media tracks
    if (state.stream) {
      state.stream.getTracks().forEach(track => track.stop());
      state.stream = null;
    }

    // Close peer connection
    if (state.pc) {
      const pc = state.pc;
      state.pc = null;
      if (pc.signalingState !== 'closed') {
        pc.close();
      }
    }

    // Clear audio
    if (state.audioElement) {
      state.audioElement.srcObject = null;
    }
  }

  /**
   * Retry connection
   */
  function retryCall() {
    updateStatus('idle', 'Ready to start', 'Click below to begin your voice call');
    setTimeout(() => startCall(), 500);
  }

  /**
   * Generate unique peer ID
   */
  function generatePeerId() {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    return 'PC-' + Array.from(array)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  // Public API
  window.ConvozentWidget = {
    // Core methods
    init: init,
    start: startCall,
    stop: stopCall,
    end: stopCall, // Alias for stop
    retry: retryCall,

    // Pre-call form
    getFormSchema: getFormSchema,
    isFormRequired: () => Boolean(getPublicForm() && formHasEditableFields()),
    openForm: openPreCallForm,
    submitForm: (values) => {
      state.formValues = { ...state.formValues, ...(values || {}) };
      return startCall({ skipForm: true });
    },

    // Floating widget specific
    open: openWidget,
    close: closeWidget,

    // State and callbacks
    getState: () => state,
    onReady: (callback) => { state.callbacks.onReady = callback; },
    onCallStart: (callback) => { state.callbacks.onCallStart = callback; },
    onCallConnected: (callback) => { state.callbacks.onCallConnected = callback; },
    onCallDisconnected: (callback) => { state.callbacks.onCallDisconnected = callback; },
    onCallEnd: (callback) => { state.callbacks.onCallEnd = callback; },
    onError: (callback) => { state.callbacks.onError = callback; },
    onStatusChange: (callback) => { state.callbacks.onStatusChange = callback; },
    onTranscript: (callback) => { state.callbacks.onTranscript = callback; },
    onFormRequired: (callback) => { state.callbacks.onFormRequired = callback; },

    // Check if inline mode
    isInlineMode: () => state.config.embedMode === 'inline',

    // Re-render the inline widget (useful when React component remounts)
    refresh: () => {
      if (state.config.embedMode === 'inline') {
        // Re-render inline widget with current status
        updateInlineStatus(state.connectionStatus);
      }
    },

    // Initialize inline mode manually (for advanced use cases)
    initInline: (options) => {
      if (options.container) {
        state.config.containerId = options.container.id || 'convozent-inline-container';
      }
      state.config.embedMode = 'inline';

      // Set callbacks if provided
      if (options.onReady) state.callbacks.onReady = options.onReady;
      if (options.onCallStart) state.callbacks.onCallStart = options.onCallStart;
      if (options.onCallConnected) state.callbacks.onCallConnected = options.onCallConnected;
      if (options.onCallDisconnected) state.callbacks.onCallDisconnected = options.onCallDisconnected;
      if (options.onCallEnd) state.callbacks.onCallEnd = options.onCallEnd;
      if (options.onError) state.callbacks.onError = options.onError;
      if (options.onStatusChange) state.callbacks.onStatusChange = options.onStatusChange;
      if (options.onTranscript) state.callbacks.onTranscript = options.onTranscript;
      if (options.onFormRequired) state.callbacks.onFormRequired = options.onFormRequired;

      // Initialize
      if (!state.isInitialized) {
        init();
      }
    }
  };

  // ==========================================================================
  // Text-chat widget
  //
  // A fully self-contained floating chat, rendered inside a Shadow DOM so the
  // host site's CSS can never leak in or out. Talks to the token/domain-gated
  // /public/embed/chat/{init,message} endpoints.
  // ==========================================================================

  const chatState = {
    host: null,
    root: null,          // shadow root
    sessionToken: null,
    messages: [],        // [{ role, content }]
    appearance: {},      // { theme, title, subtitle, placeholder, position }
    name: '',            // agent name (fallback title)
    isOpen: false,
    isSending: false,
    hasStarted: false,   // whether /chat/init has run
    error: null,
  };

  // Fetch the chat agent's config, then render the widget. Called from init()
  // when the script tag carries channel=chat.
  async function initChatAgent() {
    try {
      const res = await fetch(
        state.config.apiBaseUrl + '/api/v1/public/embed/chat/config/' + encodeURIComponent(state.config.token),
        { method: 'GET', headers: publicApiHeaders() }
      );
      if (!res.ok) throw new Error('config ' + res.status);
      const cfg = await res.json();
      chatState.appearance = cfg.appearance || {};
      chatState.name = cfg.name || '';
    } catch (e) {
      console.error('Convozent Chat: failed to load config', e);
      return;
    }
    state.isInitialized = true;
    createChatWidget();
    if (state.callbacks.onReady) state.callbacks.onReady();
  }

  function chatSettings() {
    const a = chatState.appearance || {};
    return {
      theme: a.theme === 'light' ? 'light' : 'dark',
      title: a.title || chatState.name || 'Chat with us',
      subtitle: a.subtitle || '',
      placeholder: a.placeholder || 'Type a message…',
      launcherText: (a.button_title || '').trim(),
      brandColor: /^#[0-9a-f]{6}$/i.test(a.brand_color || '') ? a.brand_color : '',
      position: a.position || 'bottom-right',
    };
  }

  function createChatWidget() {
    if (chatState.host) return;
    const settings = chatSettings();
    const host = document.createElement('div');
    host.id = 'convozent-chat-widget';
    host.style.position = 'fixed';
    host.style.bottom = '20px';
    host.style.zIndex = '2147483000';
    if (settings.position.indexOf('left') !== -1) {
      host.style.left = '20px';
    } else {
      host.style.right = '20px';
    }
    document.body.appendChild(host);
    chatState.host = host;
    chatState.root = host.attachShadow({ mode: 'open' });
    renderChatShell();
  }

  // Monochrome palettes; the agent's appearance.theme picks one.
  const CHAT_THEMES = {
    dark: {
      bg: '#1a1a1b', fg: '#fafafa', muted: '#a1a1aa', faint: '#6b6b73', border: '#2c2c2e',
      surface: '#262628', input: '#2a2a2c', hover: '#303033', ring: '#4a4a4f', outline: '#3a3a3d',
      strong: '#f4f4f5', onStrong: '#18181b', shadow: 'rgba(0,0,0,0.45)', error: '#fca5a5',
    },
    light: {
      bg: '#ffffff', fg: '#18181b', muted: '#71717a', faint: '#a1a1aa', border: '#e4e4e7',
      surface: '#f4f4f5', input: '#f4f4f5', hover: '#e4e4e7', ring: '#a1a1aa', outline: '#d4d4d8',
      strong: '#18181b', onStrong: '#fafafa', shadow: 'rgba(0,0,0,0.18)', error: '#b42318',
    },
  };

  function chatStyles(theme, alignLeft) {
    const t = CHAT_THEMES[theme] || CHAT_THEMES.dark;
    return `
      :host { all: initial; }
      * { box-sizing: border-box; font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
      .wrap { display: flex; flex-direction: column; align-items: ${alignLeft ? 'flex-start' : 'flex-end'}; gap: 12px; }
      .panel {
        width: 360px; max-width: calc(100vw - 40px);
        height: 480px; max-height: calc(100vh - 110px);
        background: ${t.bg}; color: ${t.fg}; border: 1px solid ${t.border}; border-radius: 24px; overflow: hidden;
        box-shadow: 0 24px 64px ${t.shadow}; display: none; flex-direction: column;
        transform-origin: ${alignLeft ? 'bottom left' : 'bottom right'};
      }
      .panel.open { display: flex; animation: dg-pop 0.18s ease-out; }
      @keyframes dg-pop { from { opacity: 0; transform: translateY(8px) scale(0.98); } to { opacity: 1; transform: none; } }
      .header { padding: 12px 14px 12px 16px; display: flex; align-items: center; gap: 8px; border-bottom: 1px solid ${t.border}; }
      .header .heading { min-width: 0; flex: 1; }
      .header .title { font-size: 14px; font-weight: 600; line-height: 1.25; color: ${t.fg}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .header .subtitle { font-size: 12px; color: ${t.muted}; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .icon-btn { flex: 0 0 auto; width: 30px; height: 30px; border-radius: 50%; border: 1px solid ${t.border}; background: ${t.surface}; color: ${t.fg}; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background 0.15s ease; }
      .icon-btn:hover { background: ${t.hover}; }
      .header .close { display: none; }
      .icon-btn:focus-visible, .send:focus-visible, .plus:focus-visible, .launcher:focus-visible { outline: 2px solid ${t.fg}; outline-offset: 2px; }
      .messages { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; scrollbar-width: thin; scrollbar-color: ${t.outline} transparent; }
      .empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 20px 28px; gap: 6px; }
      .empty .badge { width: 44px; height: 44px; border-radius: 14px; background: ${t.surface}; color: ${t.muted}; display: flex; align-items: center; justify-content: center; margin-bottom: 10px; }
      .empty .greet { font-size: 18px; font-weight: 600; color: ${t.fg}; }
      .empty .hint { font-size: 13px; line-height: 1.5; color: ${t.muted}; max-width: 260px; }
      .row { display: flex; }
      .row.user { justify-content: flex-end; }
      .row.assistant { justify-content: flex-start; }
      .msg { display: flex; flex-direction: column; gap: 2px; min-width: 0; max-width: 100%; }
      .row.user .msg { flex-direction: row-reverse; align-items: center; gap: 4px; max-width: 90%; }
      .row.user .bubble { min-width: 0; }
      .bubble { max-width: 100%; padding: 8px 12px; border-radius: 16px; font-size: 13px; line-height: 1.45; white-space: pre-wrap; word-wrap: break-word; }
      .row.assistant .bubble { background: transparent; color: ${t.fg}; padding: 2px 0; border-radius: 0; white-space: normal; }
      .row.user .bubble { background: ${t.surface}; color: ${t.fg}; border-bottom-right-radius: 6px; }
      .md p { margin: 0 0 8px; } .md p:last-child, .md ul:last-child, .md ol:last-child, .md pre:last-child { margin-bottom: 0; }
      .md ul, .md ol { margin: 0 0 8px; padding-left: 18px; } .md li { margin: 2px 0; }
      .md code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; background: ${t.surface}; padding: 1px 4px; border-radius: 4px; }
      .md pre { background: ${t.surface}; padding: 8px 10px; border-radius: 8px; overflow-x: auto; margin: 0 0 8px; }
      .md pre code { background: none; padding: 0; white-space: pre; }
      .md a { color: inherit; text-decoration: underline; text-underline-offset: 2px; }
      .md strong { font-weight: 600; }
      .actions { display: flex; gap: 2px; opacity: 0; transition: opacity 0.15s ease; }
      .row:hover .actions, .row:focus-within .actions, .row.latest .actions { opacity: 1; }
      .act { position: relative; width: 24px; height: 24px; border: none; border-radius: 6px; background: transparent; color: ${t.muted}; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0; }
      .act:hover { background: ${t.hover}; color: ${t.fg}; }
      .act:focus-visible { outline: 2px solid ${t.fg}; outline-offset: 1px; }
      .act[aria-pressed="true"] { color: ${t.fg}; }
      .act[aria-pressed="true"] svg { fill: currentColor; }
      .act:disabled { opacity: 0.4; cursor: default; }
      .act[data-tip]:hover::after, .act[data-tip]:focus-visible::after { content: attr(data-tip); position: absolute; bottom: calc(100% + 4px); left: 50%; transform: translateX(-50%); background: ${t.strong}; color: ${t.onStrong}; font-size: 11px; line-height: 1.2; padding: 3px 6px; border-radius: 4px; white-space: nowrap; pointer-events: none; z-index: 2; }
      .err .retry { margin-left: 6px; border: none; background: none; color: inherit; text-decoration: underline; cursor: pointer; font: inherit; padding: 0; }
      .typing { display: inline-flex; gap: 4px; align-items: center; padding: 8px 0; background: transparent; }
      .typing span { width: 6px; height: 6px; background: ${t.muted}; border-radius: 50%; animation: dg-bounce 1.2s infinite ease-in-out; }
      .typing span:nth-child(2) { animation-delay: 0.15s; }
      .typing span:nth-child(3) { animation-delay: 0.3s; }
      @keyframes dg-bounce { 0%, 60%, 100% { transform: translateY(0); opacity: 0.5; } 30% { transform: translateY(-4px); opacity: 1; } }
      .err { color: ${t.error}; font-size: 12px; padding: 0 16px 6px; }
      .composer { display: flex; flex-direction: column; gap: 4px; margin: 0 12px 8px; padding: 10px 10px 8px 14px; background: ${t.input}; border: 1px solid ${t.border}; border-radius: 22px; transition: border-color 0.15s ease; }
      .composer:focus-within { border-color: ${t.ring}; }
      .composer .bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      .composer textarea {
        width: 100%; resize: none; border: none; background: transparent; padding: 0;
        font-size: 14px; line-height: 1.45; max-height: calc(1.45em * 3); overflow-y: hidden; outline: none; color: ${t.fg};
        scrollbar-width: thin; scrollbar-color: ${t.outline} transparent;
      }
      .composer textarea::placeholder { color: ${t.muted}; }
      .composer .send { flex: 0 0 auto; width: 30px; height: 30px; border-radius: 50%; border: none; background: ${t.strong}; color: ${t.onStrong}; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: opacity 0.15s ease, transform 0.15s ease; }
      .composer .plus { flex: 0 0 auto; width: 30px; height: 30px; border-radius: 50%; border: 1px solid ${t.outline}; background: transparent; color: ${t.muted}; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background 0.15s ease; }
      .composer .plus:hover { background: ${t.hover}; color: ${t.fg}; }
      .composer .send:hover:not(:disabled) { transform: scale(1.06); }
      .composer .send:disabled { opacity: 0.4; cursor: default; }
      .composer .send svg { width: 16px; height: 16px; }
      .composer .plus svg { width: 14px; height: 14px; }
      .footer { text-align: center; font-size: 10.5px; color: ${t.faint}; padding: 0 0 8px; }
      .footer a { color: ${t.faint}; text-decoration: none; }
      .launcher { width: 58px; height: 58px; border-radius: 50%; border: none; background: ${t.strong}; color: ${t.onStrong}; cursor: pointer; box-shadow: 0 8px 24px ${t.shadow}; display: flex; align-items: center; justify-content: center; transition: transform 0.15s ease; }
      .launcher:hover { transform: scale(1.06); }
      .launcher.has-text { width: auto; height: 44px; padding: 0 18px 0 14px; gap: 8px; border-radius: 999px; font-size: 14px; font-weight: 600; line-height: 1; white-space: nowrap; }
      .launcher.has-text svg { width: 20px; height: 20px; }
      @media (max-width: 480px) {
        .header .close { display: flex; }
        .panel { width: calc(100vw - 24px); height: min(480px, calc(100vh - 100px)); }
      }
    `;
  }

  const CHAT_ICON = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  const CLOSE_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  const EXIT_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>';
  const EMPTY_ICON = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="3 3"><path d="M21 12a8 8 0 0 1-11.5 7.2L4 20.5l1.4-4.3A8 8 0 1 1 21 12z"/></svg>';
  const PLUS_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
  const SEND_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>';

  const ICON_ATTRS = 'width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  const COPY_ICON = '<svg ' + ICON_ATTRS + '><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  const CHECK_ICON = '<svg ' + ICON_ATTRS + '><polyline points="20 6 9 17 4 12"/></svg>';
  const THUMB_UP_ICON = '<svg ' + ICON_ATTRS + '><path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/></svg>';
  const THUMB_DOWN_ICON = '<svg ' + ICON_ATTRS + '><path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"/></svg>';
  const RETRY_ICON = '<svg ' + ICON_ATTRS + '><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>';

  // Inline markdown on already-escaped text: code, bold, italic, http(s) links.
  function renderInlineMarkdown(escaped) {
    return escaped
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  }

  // A small, safe markdown renderer for agent replies: everything is escaped first,
  // then fenced code, lists and paragraphs are rebuilt. No raw HTML ever passes through.
  function renderMarkdown(text) {
    const blocks = [];
    const withoutFences = String(text).replace(/```[^\n]*\n?([\s\S]*?)```/g, function (_, code) {
      blocks.push('<pre><code>' + escapeHtml(code.replace(/\n$/, '')) + '</code></pre>');
      return '\u0000' + (blocks.length - 1) + '\u0000';
    });
    const bullet = /^\s*[-*]\s+/, numbered = /^\s*\d+[.)]\s+/;
    const inline = function (l) {
      return renderInlineMarkdown(escapeHtml(l)).replace(/\u0000(\d+)\u0000/g, function (_, i) { return blocks[Number(i)]; });
    };
    // Each blank-line block is split into runs: bullet lines, numbered lines, plain lines.
    return withoutFences.split(/\n{2,}/).map(function (para) {
      const fence = /^\u0000(\d+)\u0000$/.exec(para.trim());
      if (fence) return blocks[Number(fence[1])];
      let html = '', run = [], kind = null;
      const flush = function () {
        if (!run.length) return;
        if (kind === 'ul' || kind === 'ol') {
          const marker = kind === 'ul' ? bullet : numbered;
          html += '<' + kind + '>' + run.map(function (l) { return '<li>' + inline(l.replace(marker, '')) + '</li>'; }).join('') + '</' + kind + '>';
        } else {
          html += '<p>' + run.map(inline).join('<br>') + '</p>';
        }
        run = [];
      };
      para.split('\n').forEach(function (l) {
        const k = bullet.test(l) ? 'ul' : numbered.test(l) ? 'ol' : 'p';
        if (k !== kind) { flush(); kind = k; }
        run.push(l);
      });
      flush();
      return html;
    }).join('');
  }

  // Text colour that stays readable on a brand background (WCAG relative luminance).
  function readableOn(hex) {
    const channel = function (i) {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
    return luminance > 0.4 ? '#18181b' : '#ffffff';
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // The message box grows with its text from one row up to three rows, then scrolls.
  const COMPOSER_MAX_ROWS = 3;
  function autosizeInput(ta) {
    ta.style.height = 'auto';
    const cs = window.getComputedStyle(ta);
    const line = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.45;
    const max = line * COMPOSER_MAX_ROWS;
    ta.style.height = Math.min(ta.scrollHeight, max) + 'px';
    // 1px of slack: scrollHeight is rounded, so exactly three rows must not show a scrollbar.
    ta.style.overflowY = ta.scrollHeight > max + 1 ? 'auto' : 'hidden';
  }

  function renderChatShell() {
    const s = chatSettings();
    const alignLeft = s.position.indexOf('left') !== -1;
    chatState.root.innerHTML =
      '<style>' + chatStyles(s.theme, alignLeft) + '</style>' +
      '<div class="wrap">' +
        '<div class="panel" part="panel">' +
          '<div class="header">' +
            '<div class="heading">' +
              '<div class="title">' + escapeHtml(s.title) + '</div>' +
              '<div class="subtitle">' + escapeHtml(s.subtitle || 'How can I help you today?') + '</div>' +
            '</div>' +
            '<button class="icon-btn exit" aria-label="End chat" title="End chat">' + EXIT_ICON + '</button>' +
            '<button class="icon-btn close" aria-label="Close chat" title="Close">' + CLOSE_ICON + '</button>' +
          '</div>' +
          '<div class="messages"></div>' +
          '<div class="err" style="display:none"></div>' +
          '<div class="composer">' +
            '<textarea rows="1" placeholder="' + escapeHtml(s.placeholder) + '"></textarea>' +
            '<div class="bar"><button class="plus" aria-label="Start a new chat" title="New chat">' + PLUS_ICON + '</button>' +
            '<button class="send" aria-label="Send">' + SEND_ICON + '</button></div>' +
          '</div>' +
          '<div class="footer">Powered by Convozent</div>' +
        '</div>' +
        '<button class="launcher' + (s.launcherText ? ' has-text' : '') + '" aria-label="' + escapeHtml(s.launcherText || 'Open chat') + '"' +
          (s.brandColor ? ' style="background:' + s.brandColor + ';color:' + readableOn(s.brandColor) + '"' : '') + '>' +
          CHAT_ICON + (s.launcherText ? '<span>' + escapeHtml(s.launcherText) + '</span>' : '') + '</button>' +
      '</div>';

    const root = chatState.root;
    root.querySelector('.launcher').addEventListener('click', toggleChat);
    root.querySelector('.close').addEventListener('click', closeChat);
    root.querySelector('.exit').addEventListener('click', exitChat);
    root.querySelector('.plus').addEventListener('click', resetChat);
    const send = root.querySelector('.send');
    const ta = root.querySelector('.composer textarea');
    send.addEventListener('click', handleChatSend);
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleChatSend(); }
    });
    ta.addEventListener('input', function () { autosizeInput(ta); });
    root.querySelector('.messages').addEventListener('click', handleMessageAction);
    renderChatMessages();
  }

  function setChatError(msg, canRetry) {
    chatState.error = msg;
    const el = chatState.root && chatState.root.querySelector('.err');
    if (!el) return;
    el.textContent = msg || '';
    if (msg && canRetry) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'retry';
      btn.textContent = 'Try again';
      btn.addEventListener('click', retryReply);
      el.appendChild(btn);
    }
    el.style.display = msg ? 'block' : 'none';
  }

  function actionButton(act, i, label, icon, pressed, disabled) {
    return '<button type="button" class="act" data-act="' + act + '" data-i="' + i + '" aria-label="' + label + '" data-tip="' + label + '"' +
      (pressed === undefined ? '' : ' aria-pressed="' + pressed + '"') + (disabled ? ' disabled' : '') + '>' + icon + '</button>';
  }

  // The shadcn message pattern: visitor messages in a muted bubble with Copy; agent
  // replies as markdown with Copy, Good / Bad response and (latest reply) Retry.
  // The greeting has no actions: there is nothing to rate or retry before a question.
  function renderChatMessages() {
    const box = chatState.root && chatState.root.querySelector('.messages');
    if (!box) return;
    // Nothing yet (no greeting configured, not loading): a hint instead of a blank panel.
    if (chatState.messages.length === 0 && !chatState.isSending) {
      box.innerHTML =
        '<div class="empty"><div class="badge">' + EMPTY_ICON + '</div>' +
        '<div class="hint">Send a message to start the conversation.</div></div>';
      return;
    }
    const msgs = chatState.messages;
    const last = msgs.length - 1;
    let seenVisitor = false;
    let html = '';
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i];
      const isUser = m.role === 'user';
      const copied = chatState.copiedIndex === i;
      const copyBtn = actionButton('copy', i, copied ? 'Copied' : 'Copy', copied ? CHECK_ICON : COPY_ICON);
      let actions = '';
      if (isUser) {
        seenVisitor = true;
        // Visitor messages carry no actions.
      } else if (seenVisitor && typeof m.index === 'number') {
        const busy = chatState.isSending;
        actions = copyBtn +
          actionButton('like', i, 'Good response', THUMB_UP_ICON, m.feedback === 'like', busy) +
          actionButton('dislike', i, 'Bad response', THUMB_DOWN_ICON, m.feedback === 'dislike', busy) +
          (i === last ? actionButton('retry', i, 'Retry', RETRY_ICON, undefined, busy) : '');
      }
      const body = isUser ? escapeHtml(m.content) : renderMarkdown(m.content);
      html += '<div class="row ' + (isUser ? 'user' : 'assistant') + (i === last && !isUser ? ' latest' : '') + '">' +
        '<div class="msg"><div class="bubble' + (isUser ? '' : ' md') + '">' + body + '</div>' +
        (actions ? '<div class="actions">' + actions + '</div>' : '') + '</div></div>';
    }
    if (chatState.isSending) {
      html += '<div class="row assistant"><div class="typing"><span></span><span></span><span></span></div></div>';
    }
    box.innerHTML = html;
    box.scrollTop = box.scrollHeight;
  }

  // One listener for every message action (the list is re-rendered, so delegate).
  function handleMessageAction(e) {
    const btn = e.target.closest && e.target.closest('.act');
    if (!btn || btn.disabled) return;
    const i = Number(btn.getAttribute('data-i'));
    const m = chatState.messages[i];
    if (!m) return;
    const act = btn.getAttribute('data-act');
    if (act === 'copy') copyMessage(i, m);
    else if (act === 'like' || act === 'dislike') rateReply(m, act);
    else if (act === 'retry') retryReply();
  }

  function copyMessage(i, m) {
    const done = function () {
      chatState.copiedIndex = i;
      renderChatMessages();
      setTimeout(function () {
        if (chatState.copiedIndex === i) { chatState.copiedIndex = null; renderChatMessages(); }
      }, 2000);
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(m.content).then(done, function () {});
    } catch (err) { /* clipboard blocked by the host page */ }
  }

  // Thumbs up / down toggle; shown at once, saved on the server, undone if saving fails.
  async function rateReply(m, value) {
    const previous = m.feedback || null;
    const next = previous === value ? null : value;
    m.feedback = next;
    renderChatMessages();
    try {
      const data = await chatApi('feedback', { session_token: chatState.sessionToken, index: m.index, feedback: next });
      if (data && data.messages) chatState.messages = data.messages;
    } catch (err) {
      m.feedback = previous;
      setChatError(err.message || 'Could not save your rating.');
    }
    renderChatMessages();
  }

  // Ask for the latest reply again (or for a reply that failed). The server keeps the
  // replaced reply out of the dialogue but still counts what it cost.
  async function retryReply() {
    if (chatState.isSending || !chatState.sessionToken) return;
    const before = chatState.messages;
    const lastMsg = before[before.length - 1];
    chatState.messages = lastMsg && lastMsg.role !== 'user' ? before.slice(0, -1) : before;
    chatState.isSending = true;
    setChatError(null);
    renderChatMessages();
    try {
      const data = await chatApi('retry', { session_token: chatState.sessionToken });
      chatState.messages = data.messages || before;
    } catch (err) {
      chatState.messages = before;
      setChatError(err.message || 'Could not get a new reply.', true);
    } finally {
      chatState.isSending = false;
      renderChatMessages();
    }
  }

  function toggleChat() {
    if (chatState.isOpen) { closeChat(); } else { openChat(); }
  }

  function openChat() {
    chatState.isOpen = true;
    const panel = chatState.root.querySelector('.panel');
    panel.classList.add('open');
    if (!chatState.hasStarted) { startChatSession(); }
    const ta = chatState.root.querySelector('.composer textarea');
    if (ta) setTimeout(() => ta.focus(), 50);
  }

  function closeChat() {
    chatState.isOpen = false;
    chatState.root.querySelector('.panel').classList.remove('open');
  }

  async function chatApi(path, body) {
    const res = await fetch(state.config.apiBaseUrl + '/api/v1/public/embed/chat/' + path, {
      method: 'POST',
      headers: publicApiHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let detail = 'Request failed (' + res.status + ')';
      try { const j = await res.json(); if (j && j.detail) detail = j.detail; } catch (e) {}
      const err = new Error(detail); err.status = res.status; throw err;
    }
    return res.json();
  }

  async function startChatSession() {
    if (chatState.hasStarted) return;
    chatState.hasStarted = true;
    chatState.isSending = true;
    setChatError(null);
    renderChatMessages();
    try {
      const data = await chatApi('init', { public_key: state.config.token });
      chatState.sessionToken = data.session_token;
      chatState.messages = data.messages || [];
    } catch (err) {
      chatState.hasStarted = false; // allow a retry on next open
      setChatError(err.message || 'Could not start chat.');
    } finally {
      chatState.isSending = false;
      renderChatMessages();
    }
  }

  // Tell the server how this session ended: 'completed' (visitor exited) or
  // 'disconnected' (tab closed/refreshed). Uses sendBeacon so it survives page
  // unload; the text/plain body keeps it a CORS-simple request (no preflight).
  function reportChatEnd(reason) {
    const token = chatState.sessionToken;
    if (!token) return;
    const url = state.config.apiBaseUrl + '/api/v1/public/embed/chat/end';
    const body = JSON.stringify({ session_token: token, reason: reason });
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' }))) return;
    } catch (e) { /* fall through to fetch */ }
    try {
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: body, keepalive: true });
    } catch (e) { /* best effort */ }
  }

  // Forget the current conversation locally so the next one starts clean.
  function clearChat() {
    chatState.sessionToken = null;
    chatState.messages = [];
    chatState.hasStarted = false;
    const ta = chatState.root && chatState.root.querySelector('.composer textarea');
    if (ta) { ta.value = ''; autosizeInput(ta); }
    setChatError(null);
    renderChatMessages();
  }

  // Visitor pressed Exit: the conversation is completed, the transcript is cleared
  // and the panel closes. The next time it opens it is a brand-new chat.
  function exitChat() {
    if (chatState.sessionToken) reportChatEnd('completed');
    clearChat();
    closeChat();
  }

  // Start a new chat without exiting (the + button). Leaving a live conversation this
  // way is a disconnect, like refreshing the page; only Exit completes one.
  function resetChat() {
    if (chatState.isSending) return;
    if (chatState.sessionToken) reportChatEnd('disconnected');
    clearChat();
    startChatSession();
  }

  // Closing the tab or refreshing mid-chat ends the session as disconnected.
  window.addEventListener('pagehide', function () {
    if (chatState.sessionToken) reportChatEnd('disconnected');
  });

  async function handleChatSend() {
    const ta = chatState.root.querySelector('.composer textarea');
    const text = (ta.value || '').trim();
    if (!text || chatState.isSending) return;
    if (!chatState.sessionToken) { await startChatSession(); if (!chatState.sessionToken) return; }

    ta.value = '';
    autosizeInput(ta);
    chatState.messages.push({ role: 'user', content: text });
    chatState.isSending = true;
    setChatError(null);
    renderChatMessages();

    let startOver = false;
    try {
      const data = await chatApi('message', {
        session_token: chatState.sessionToken,
        text: text,
      });
      // The server returns the full transcript — use it as the source of truth.
      chatState.messages = data.messages || chatState.messages;
    } catch (err) {
      // 409: the server already completed this conversation, so begin a new one.
      if (err.status === 409) { startOver = true; } else { setChatError(err.message || 'Message failed to send.', err.status === 502); }
    } finally {
      chatState.isSending = false;
      renderChatMessages();
    }
    if (startOver) { clearChat(); startChatSession(); }
  }

  // Auto-initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
