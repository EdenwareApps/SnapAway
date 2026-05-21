const { contextBridge, ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const rendererTelemetry = require('./renderer-telemetry');

rendererTelemetry.initRendererTelemetry();

function initializeCustomTitlebar() {
  try {
    const { Titlebar, Color } = require('custom-electron-titlebar');
    const path = require('path');
    const fs = require('fs');
    const isFileProtocol = window.location.protocol === 'file:';

    let titlebarIcon;

    const preferDarkIcon = (() => {
      try {
        const electron = require('electron');
        if (electron && electron.nativeTheme && typeof electron.nativeTheme.shouldUseDarkColors === 'boolean') {
          return electron.nativeTheme.shouldUseDarkColors;
        }
        return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      } catch (_) {
        return false;
      }
    })();

    const preferredThemeIcon = preferDarkIcon ? 'tray-white.png' : 'tray-black.png';
    const alternateThemeIcon = preferDarkIcon ? 'tray-black.png' : 'tray-white.png';

    // Helper to build data URL from a file path (works inside asar)
    const tryBuildDataUrl = (filePath) => {
      try {
        if (filePath && fs.existsSync(filePath)) {
          const buf = fs.readFileSync(filePath);
          const ext = (path.extname(filePath) || '').toLowerCase();
          let mime = 'application/octet-stream';
          if (ext === '.png') mime = 'image/png';
          else if (ext === '.jpg' || ext === '.jpeg') mime = 'image/jpeg';
          else if (ext === '.svg') mime = 'image/svg+xml';
          else if (ext === '.ico') mime = 'image/x-icon';
          return `data:${mime};base64,${buf.toString('base64')}`;
        }
      } catch (err) {
        // ignore and return null
      }
      return null;
    };

    if (isFileProtocol) {
      // Packaged app fallbacks for installed paths and asar layouts.
      const decodedPathname = decodeURIComponent((window.location && window.location.pathname) || '');
      const sideBySidePath = /^\/[A-Za-z]:/.test(decodedPathname) ? decodedPathname.slice(1) : decodedPathname;

      const projectRoot = path.resolve(__dirname, '..', '..');
      const preferredIcon = preferredThemeIcon.replace('tray-', '');
      const alternateIcon = alternateThemeIcon.replace('tray-', '');
      const candidates = [
        path.join(process.resourcesPath || '', 'app.asar', 'out', 'renderer', 'assets', 'images', preferredThemeIcon),
        path.join(process.resourcesPath || '', 'app.asar', 'out', 'renderer', 'assets', 'images', alternateThemeIcon),
        path.join(process.resourcesPath || '', 'app.asar', 'out', 'renderer', preferredThemeIcon),
        path.join(process.resourcesPath || '', 'app.asar', 'out', 'renderer', alternateThemeIcon),
        path.join(process.resourcesPath || '', 'app.asar', 'out', 'renderer', 'assets', 'images', preferredIcon),
        path.join(process.resourcesPath || '', 'app.asar', 'out', 'renderer', 'assets', 'images', alternateIcon),
        path.join(process.resourcesPath || '', 'app.asar.unpacked', 'out', 'renderer', 'assets', 'images', preferredThemeIcon),
        path.join(process.resourcesPath || '', 'app.asar.unpacked', 'out', 'renderer', 'assets', 'images', alternateThemeIcon),
        path.join(process.resourcesPath || '', 'app.asar.unpacked', 'out', 'renderer', preferredThemeIcon),
        path.join(process.resourcesPath || '', 'app.asar.unpacked', 'out', 'renderer', alternateThemeIcon),
        path.join(process.resourcesPath || '', 'app.asar.unpacked', 'out', 'renderer', 'assets', 'images', preferredIcon),
        path.join(process.resourcesPath || '', 'app.asar.unpacked', 'out', 'renderer', 'assets', 'images', alternateIcon),
        path.join(projectRoot, 'renderer', 'assets', 'images', preferredThemeIcon),
        path.join(projectRoot, 'renderer', 'assets', 'images', alternateThemeIcon),
        path.join(projectRoot, 'renderer', 'assets', 'images', preferredIcon),
        path.join(projectRoot, 'renderer', 'assets', 'images', alternateIcon),
        path.join(projectRoot, 'src', 'renderer', 'assets', 'images', preferredThemeIcon),
        path.join(projectRoot, 'src', 'renderer', 'assets', 'images', alternateThemeIcon),
        path.join(projectRoot, 'src', 'renderer', 'assets', 'images', preferredIcon),
        path.join(projectRoot, 'src', 'renderer', 'assets', 'images', alternateIcon),
        sideBySidePath ? path.join(path.dirname(sideBySidePath), preferredThemeIcon) : null,
        sideBySidePath ? path.join(path.dirname(sideBySidePath), alternateThemeIcon) : null,
        sideBySidePath ? path.join(path.dirname(sideBySidePath), preferredIcon) : null,
        sideBySidePath ? path.join(path.dirname(sideBySidePath), alternateIcon) : null
      ].filter(Boolean);

      // Prefer data URL to avoid file:// handling differences on Windows installs.
      for (const candidate of candidates) {
        titlebarIcon = tryBuildDataUrl(candidate);
        if (titlebarIcon) break;
      }

      if (!titlebarIcon) {
        const existing = candidates.find((candidate) => {
          try {
            return fs.existsSync(candidate);
          } catch (_) {
            return false;
          }
        });

        if (existing) {
          titlebarIcon = pathToFileURL(existing).toString();
        }
      }
    } else {
      // dev server: use theme icon path served by Vite
      titlebarIcon = preferDarkIcon ? '/assets/images/tray-white.png' : '/assets/images/tray-black.png';
    }

    const titlebar = new Titlebar({
      backgroundColor: Color.fromHex('transparent'),
      containerOverflow: 'hidden',
      titleHorizontalAlignment: 'left',
      menu: null,
      icon: titlebarIcon,
      iconSize: 26
    });

    // Expose the titlebar instance to renderer for icon updates
    window.cetTitlebar = titlebar;
    window.cetTitlebarReady = true;
    window.dispatchEvent(new CustomEvent('cetTitlebarReady'));

    console.log('[PRELOAD] custom-electron-titlebar initialized');
  } catch (error) {
    console.error('[PRELOAD] Failed to initialize custom-electron-titlebar:', error?.message || error);
  }
}

// Function to initialize the titlebar wrapper (DOM manipulation only)
function initializeTitlebarWrapper() {
  // Wait for titlebar to be created and add wrapper
  setTimeout(() => {
    const titlebar = document.querySelector('.cet-titlebar');
    const container = document.querySelector('.cet-container');

    if (titlebar && container) {
      // Check if wrapper already exists
      if (!document.querySelector('.cet-wrapper')) {
        // Create wrapper element
        const wrapper = document.createElement('div');
        wrapper.className = 'cet-wrapper';

        // Insert wrapper before titlebar
        titlebar.parentNode.insertBefore(wrapper, titlebar);

        // Move titlebar and container into wrapper
        wrapper.appendChild(titlebar);
        wrapper.appendChild(container);

        console.log('[PRELOAD] cet-wrapper created and elements moved');
      } else {
        console.log('[PRELOAD] cet-wrapper already exists');
      }
    } else {
      console.warn('[PRELOAD] Titlebar or container not found, retrying...');
      // Retry after a longer delay
      setTimeout(() => {
        const retryTitlebar = document.querySelector('.cet-titlebar');
        const retryContainer = document.querySelector('.cet-container');
        if (retryTitlebar && retryContainer && !document.querySelector('.cet-wrapper')) {
          const wrapper = document.createElement('div');
          wrapper.className = 'cet-wrapper';
          retryTitlebar.parentNode.insertBefore(wrapper, retryTitlebar);
          wrapper.appendChild(retryTitlebar);
          wrapper.appendChild(retryContainer);
          console.log('[PRELOAD] cet-wrapper created on retry');
        }
      }, 500);
    }
  }, 100);
}

// Initialize titlebar wrapper when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initializeCustomTitlebar();
    initializeTitlebarWrapper();
  });
} else {
  initializeCustomTitlebar();
  initializeTitlebarWrapper();
}

let lastMousemoveSend = 0;
const MOUSEMOVE_IPC_THROTTLE_MS = 200;

window.addEventListener('mousemove', () => {
  const now = Date.now();
  if (now - lastMousemoveSend >= MOUSEMOVE_IPC_THROTTLE_MS) {
    lastMousemoveSend = now;
    ipcRenderer.send('window-mousemove');
  }
}, { passive: true });

// Prevent geolocation access (if not already defined)
if (!window.navigator.geolocation) {
  Object.defineProperty(window.navigator, 'geolocation', {
    get: () => undefined
  });
}

// Expose API to renderer
contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  getState: () => ipcRenderer.invoke('get-state'),
  getCurrentState: () => ipcRenderer.invoke('get-current-state'),
  getProcesses: (includeHidden = false) => ipcRenderer.invoke('get-processes', includeHidden),
  killProcess: processName => ipcRenderer.invoke('kill-process', processName),
  updateConfig: config => ipcRenderer.send('update-config', config),
  onStateChange: callback => ipcRenderer.on('state-changed', callback),
  onUpdateAvailable: callback => ipcRenderer.on('update-available', callback),
  onIcon: callback => ipcRenderer.on('icon', callback),
  send: (evtName, ...args) => ipcRenderer.send(evtName, ...args),
  launchUrl: url => ipcRenderer.invoke('launch-url', url),
  getLanguage: () => ipcRenderer.invoke('get-language'),
  getLanguages: () => ipcRenderer.invoke('get-languages'),
  onLanguageChange: callback => ipcRenderer.on('language-change', callback),
  onAuthRequest: callback => ipcRenderer.on('auth-request', callback),
  isPackaged: () => ipcRenderer.invoke('is-packaged'),
  onAuthInput: callback => ipcRenderer.on('auth-input', callback),
  onAuthCheck: callback => ipcRenderer.on('auth-check', callback),
  onPasswordSet: callback => ipcRenderer.on('password-set', callback),
  onConfigChange: callback => ipcRenderer.on('config-change', callback),
  iconFailure: (process, src) => ipcRenderer.invoke('icon-failure', process, src),
  hashPin: pin => ipcRenderer.invoke('hash-pin', pin),
  onPreviousWindowStateChange: callback => ipcRenderer.on('previous-window-state-changed', callback),
  onGoHome: callback => ipcRenderer.on('go-home', callback),
  onGoOptions: callback => ipcRenderer.on('go-options', callback),
  onToggleTitlebar: callback => ipcRenderer.on('toggle-titlebar', callback),
  onResizeWindow: callback => ipcRenderer.on('resize-window', callback),
  onShakeFilters: callback => ipcRenderer.on('shake-filters', callback),
  onAuthCanceled: callback => ipcRenderer.on('auth-canceled', callback),
  onWindowMove: callback => ipcRenderer.on('window-move', callback),
  onWindowMaximizedChanged: callback => ipcRenderer.on('window-maximized-changed', callback),
  hideSpecificWindow: hwnd => ipcRenderer.invoke('hide-specific-window', hwnd),
  showSpecificWindow: hwnd => ipcRenderer.invoke('show-specific-window', hwnd),
  setMaskChar: charOrHTMLEntity => ipcRenderer.invoke('set-mask-char', charOrHTMLEntity),
  onUpdateNotificationBadge: callback => ipcRenderer.on('update-notification-badge', callback),
  onRevealHint: callback => ipcRenderer.on('show-reveal-hint', callback),
  // License system APIs
  getProStatus: () => ipcRenderer.invoke('get-pro-status'),
  activateLicense: licenseKey => ipcRenderer.invoke('activate-license', licenseKey),
  deactivateLicense: () => ipcRenderer.invoke('deactivate-license'),
  checkAppLimit: currentCount => ipcRenderer.invoke('check-app-limit', currentCount),
  openPaymentPage: () => ipcRenderer.invoke('open-payment-page'),

  // Microsoft Store IAP APIs
  checkPro: () => ipcRenderer.invoke('check-pro'),
  getLicenseInfo: () => ipcRenderer.invoke('get-license-info'),
  requestPurchase: (productId) => ipcRenderer.invoke('request-purchase', productId),
  getIapProducts: () => ipcRenderer.invoke('get-iap-products'),
  initStoreContext: () => ipcRenderer.invoke('init-store-context'),
  getIapStatus: () => ipcRenderer.invoke('get-iap-status'),
  getPremiumCapabilities: () => ipcRenderer.invoke('get-premium-capabilities'),
  generateIapDiagnosticReport: () => ipcRenderer.invoke('generate-iap-diagnostic-report'),

  // Proture APIs
  setPassword: password => ipcRenderer.invoke('set-password', password),
  muteApplicationAudio: (processIds, mute) => ipcRenderer.invoke('mute-application-audio', processIds, mute),
  validateShortcut: shortcut => ipcRenderer.invoke('validate-shortcut', shortcut),
  setStartup: enable => ipcRenderer.invoke('set-startup', enable),
  getStartupState: () => ipcRenderer.invoke('get-startup-state'),
  setHighPriority: enable => ipcRenderer.invoke('set-high-priority', enable),
  resetConfig: () => ipcRenderer.invoke('reset-config'),

  // Allow renderer to temporarily pause/resume global shortcuts (used while recording shortcuts)
  pauseGlobalShortcuts: () => ipcRenderer.invoke('pause-global-shortcuts'),
  resumeGlobalShortcuts: () => ipcRenderer.invoke('resume-global-shortcuts'),
  pauseAutoFloat: () => ipcRenderer.send('pause-auto-float'),
  resumeAutoFloat: () => ipcRenderer.send('resume-auto-float'),

  // Cloaking APIs
  selectCloakIcon: () => ipcRenderer.invoke('select-cloak-icon'),
  setCloakIcon: iconPath => ipcRenderer.invoke('set-cloak-icon', iconPath),
  applyCloaking: () => ipcRenderer.invoke('apply-cloaking'),
  clearCloakIcon: () => ipcRenderer.invoke('clear-cloak-icon'),
  onUpdateCloakIcon: callback => {
    ipcRenderer.on('update-cloak-icon', (event, iconPath) => {
      (async () => {
        try {
          if (!iconPath) {
            callback(event, null);
            return;
          }

          // Normalize file:// URIs to local paths
          let filePath = iconPath;
          if (typeof filePath === 'string' && filePath.startsWith('file://')) {
            // Remove file:// prefix. Handle file:///C:/... and file://C:/...
            filePath = filePath.replace(/^file:\/\//, '');
            // On Windows there may be a leading slash before drive letter
            if (/^\/[A-Za-z]:/.test(filePath)) filePath = filePath.substring(1);
          }

          // If renderer is served over http(s), loading file:// is blocked by Chromium.
          // In that case, read the file here in preload and convert to a data URL.
          if (window.location && window.location.protocol && window.location.protocol !== 'file:') {
            try {
              if (filePath && fs.existsSync(filePath)) {
                const buf = fs.readFileSync(filePath);
                const ext = (path.extname(filePath) || '').toLowerCase();
                let mime = 'application/octet-stream';
                if (ext === '.png') mime = 'image/png';
                else if (ext === '.jpg' || ext === '.jpeg') mime = 'image/jpeg';
                else if (ext === '.svg') mime = 'image/svg+xml';
                else if (ext === '.ico') mime = 'image/x-icon';

                const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;
                callback(event, dataUrl);
                return;
              }
            } catch (readErr) {
              console.warn('[PRELOAD] Could not read cloak icon file to convert to data URL:', readErr && readErr.message ? readErr.message : readErr);
              // fallthrough to send original path
            }
          }

          // Fallback: send original path (may be file:// or http(s) URL)
          callback(event, iconPath);
        } catch (err) {
          console.error('[PRELOAD] Error in onUpdateCloakIcon handler:', err && err.message ? err.message : err);
          callback(event, iconPath);
        }
      })();
    });
  },
  onUpdateCloakTitle: callback => {
    ipcRenderer.on('update-cloak-title', (event, title) => callback(event, title));
  },

  // Window controls
  minimize: () => ipcRenderer.invoke('minimize-window'),
  maximize: () => ipcRenderer.invoke('maximize-window'),
  close: () => ipcRenderer.invoke('close-window'),
  toggleMaximize: () => ipcRenderer.invoke('toggle-maximize'),
  getVersion: () => ipcRenderer.invoke('get-version'),
  getPlatform: () => ipcRenderer.invoke('get-platform')
});