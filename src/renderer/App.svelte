<script>

  import { onMount } from 'svelte';
  import TitleList from './components/TitleList.svelte';
  import ProcessList from './components/ProcessList.svelte';
  import ClassList from './components/ClassList.svelte';
  import ShortcutSetter from './components/ShortcutSetter.svelte';
  import TitleFilter from './components/TitleFilter.svelte';
  import TrayGuideModal from './components/TrayGuideModal.svelte';
  import ReviewModal from './components/ReviewModal.svelte';
  import ProModal from './pro/ProModal.svelte';

  let viewFilterCaseSensitive = true;
  let viewFilterFocused = false;
  // When false, the filter box is hidden and two icons (search/add) are shown;
  // clicking one opens the box. Resets when navigating to options or hiding.
  let viewFilterOpen = false;
  let lang = {}
  // Initialize state from body class if already present (helps avoid initial flicker when body is pre-styled)
  let currentState = (typeof document !== 'undefined' && document.body.classList.contains('hide-state')) ? 'hide' : 'show';
  let visible = currentState === 'show';

  // Keep visible in sync with the current show/hide state
  $: visible = currentState === 'show';
  let processes = [];
  let previousProcesses = []; // Track previous processes to detect new ones
  let currentContainer = 'filters';
  let viewFilter = '';
  let config = { hideKey: 'Ctrl+Alt+H', showKey: 'Ctrl+Alt+S', filters: [], currentContent: 'processes' };
  let selectOptions = [
    { label: 'Processes', value: 'processes' },
    { label: 'Classes', value: 'classes' },
    { label: 'Titles', value: 'titles' }
  ];
  
  // Freemium system
  let isPro = false;
  let proSource = 'free';
  let ProFeatures = {};
  let freeAppLimit = 2;
  let remainingApps = 2;
  let isAtLimit = false;
  let showProModal = false;
  let proModalFeature = '';
  let proModalFeatureName = '';
  let showTrayGuide = false;
  let showReviewPrompt = false; // Pedido de review (disparado pelo main quando engajado)
  let reviewBusy = false;
  // Faixa de upsell do Pro: só aparece a partir do segundo uso real
  // (hide+restore) e nunca para quem já é Pro.
  let proUpsell = { eligible: false, usageCount: 0, usageDayCount: 0, minUsageCount: 2, dismissed: false };
  $: showProUpsell = !isPro && !isFirstRun && proUpsell.eligible === true;
  let whatToFilterMessages = ['', ''];
  let selectElement; // Reference to the select element for width adjustment
  let ready = false; // Wait for initial state from main process before rendering
  let isFirstRun = false; // Onboarding mode for first-time users
  let onboardingStartupBusy = false;
  let onboardingStartupMessage = '';
  let appVersion = '';
  $: hideShortcut = (config && config.hideKey) ? config.hideKey : 'F6';
  $: showShortcut = (config && config.showKey) ? config.showKey : 'Ctrl+F6';
  $: aboutUrl = (config && config.aboutUrl) ? config.aboutUrl : 'https://edenware.app/snapaway';

  function t(key, params = []) {
    let value = (lang && lang[key]) || defaultWelcomeTexts[key] || key;
    params.forEach((param, idx) => {
      value = value.replace(`{${idx}}`, param);
    });
    return value;
  }

  function markFirstRunComplete() {
    if (!isFirstRun) return;
    isFirstRun = false;
    try {
      localStorage.setItem('snapawayFirstRun', 'false');
    } catch (error) {
      console.warn('[App.svelte] Could not write first run flag to localStorage:', error);
    }
    config.firstRun = false;
    if (window.api && window.api.updateConfig) {
      window.api.updateConfig({ firstRun: false });
    }
  }

  async function enableStartupFromOnboarding() {
    if (onboardingStartupBusy) return;
    onboardingStartupBusy = true;
    onboardingStartupMessage = '';
    try {
      if (!window.api || !window.api.setStartup) {
        onboardingStartupMessage = t('STARTUP_SETUP_UNAVAILABLE') || 'Startup setup is unavailable in this build.';
        return;
      }

      const result = await window.api.setStartup(true);
      if (!result || result.success === false) {
        onboardingStartupMessage = t('STARTUP_SETUP_FAILED') || 'Could not enable startup automatically.';
        return;
      }

      if (result.startupTaskState === 'DisabledByUser') {
        onboardingStartupMessage = t('STARTUP_DISABLED_BY_USER') || 'Disabled in Windows settings.';
        if (window.api.launchUrl) {
          window.api.launchUrl('ms-settings:startupapps');
        }
        return;
      }

      config.startup = !!result.isEnabled;
      onboardingStartupMessage = t('STARTUP_SETUP_ENABLED') || 'Startup with Windows enabled.';
      markFirstRunComplete();
    } catch (error) {
      onboardingStartupMessage = t('STARTUP_SETUP_FAILED') || 'Could not enable startup automatically.';
      console.error('[App.svelte] Error enabling startup from onboarding:', error);
    } finally {
      onboardingStartupBusy = false;
    }
  }

  async function loadProStatus() {
    if (window.api && window.api.getProStatus) {
      try {
        const status = await window.api.getProStatus();
        isPro = status.isPro;
        proSource = status.proSource || 'free';
        ProFeatures = status.features;
        freeAppLimit = status.freeAppLimit;
        remainingApps = status.remainingApps;
        isAtLimit = status.isAtLimit;
        console.info(`[App.svelte] Pro boot source: ${status.proSource || 'unknown'} (isPro=${!!status.isPro}, storeInstall=${!!status.isStoreInstall}, storePro=${!!status.isStorePro}, licenseKeyPro=${!!status.isLicenseKeyPro})`);
        console.log('[App.svelte] Pro status loaded:', status);
      } catch (error) {
        console.error('[App.svelte] Error loading Pro status:', error);
      }
    }
  }

  async function refreshProcesses() {
    console.log('refreshProcesses');
    const classList = document.getElementById('refresh-button')?.classList;
    classList && classList.add('fa-spin');
    
    // Store previous processes before getting new ones
    previousProcesses = [...processes];
    
    if (window.api && window.api.getProcesses) {
      try {
        processes = await window.api.getProcesses();
        console.log(`[App.svelte] Retrieved ${processes.length} processes`);
      } catch (error) {
        console.error('[App.svelte] Error getting processes:', error);
      }
    }
    // Debug: Check if processes have HWND
    if (processes && processes.length > 0) {
      console.log('First process HWND:', processes[0].hwnd);
      console.log('First process has HWND property:', 'hwnd' in processes[0]);
    }

    // Enrich filters that are missing icons (e.g. added via overlay before icons were extracted)
    if (config && Array.isArray(config.filters) && processes && processes.length > 0) {
      let changed = false;
      config.filters.forEach(filter => {
        if (filter.icon) return;
        const match = processes.find(p =>
          (filter.hwnd && p.hwnd == filter.hwnd) ||
          (filter.executable && p.executable && filter.executable.toLowerCase() === p.executable.toLowerCase())
        );
        if (match && match.icon) {
          filter.icon = match.icon;
          if (!filter.executable && match.executable) filter.executable = match.executable;
          if (!filter.process && match.process) filter.process = match.process;
          changed = true;
        }
      });
      if (changed) config.filters = config.filters;
    }

    // Learn/refresh filter bindings (best effort) before deciding what to hide.
    syncFiltersWithWindows();
    
    // Check for new processes that match filters during hide-state
    if (!visible && previousProcesses.length > 0) {
      checkForNewFilteredProcesses();
    }
    
    classList && setTimeout(() => classList.remove('fa-spin'), 1000);
  }

  function ensureThemeSync() {
    // Keep the global renderer theme helper in sync with Svelte config updates.
    if (window.config !== config) {
      window.config = config;
    }

    console.log('[App.svelte] ensureThemeSync', {
      configTheme: config?.theme,
      windowConfigTheme: window.config?.theme,
      windowUpdateThemeExists: typeof window.updateTheme === 'function',
      windowUpdateFontSizeExists: typeof window.updateFontSize === 'function'
    });

    if (typeof window.updateTheme === 'function') {
      window.updateTheme();
    }
    if (typeof window.updateFontSize === 'function') {
      window.updateFontSize();
    }
  }

  function updateConfig() {
    setTimeout(() => refreshProcesses(), 250);

    // Immediately keep global window.config in sync for legacy theme handling
    if (window.config !== config) {
      window.config = config;
    }

    if (window.api && window.api.updateConfig) {
      window.api.updateConfig(config);
    }

    // Also force local theme refresh so option changes are instant
    ensureThemeSync();

    // Update Pro status after config changes
    loadProStatus();
  }

  function hasFilter(filter) {
    return config.filters.some(f => f.value == filter.value && f.type == filter.type);
  }

  function launchUrl(url) {
    if (window.api && window.api.launchUrl) {
      window.api.launchUrl(url);
    }
  }

  async function addFilter(filter) {
    if (!filter) return;
    if (config.filters.some(f => f.value == filter.value && f.type == filter.type)) return;
    
    // Security: Always check with main process, never trust local state
    if (window.api && window.api.checkAppLimit) {
      try {
        const result = await window.api.checkAppLimit(config.filters.length);
        if (!result.canAdd) {
          showProModalFor('appLimit', lang.FREE_APP_LIMIT ? lang.FREE_APP_LIMIT.replace('{0}', freeAppLimit) : `Free version limited to ${freeAppLimit} applications`);
          return;
        }
        
        // Double-check with main process before adding
        const status = await window.api.getProStatus();
        if (!status.isPro && config.filters.length >= status.freeAppLimit) {
          showProModalFor('appLimit', lang.FREE_APP_LIMIT ? lang.FREE_APP_LIMIT.replace('{0}', freeAppLimit) : `Free version limited to ${freeAppLimit} applications`);
          return;
        }
      } catch (error) {
        console.error('[App.svelte] Error checking app limit:', error);
        // Fallback to local check
        if (!isPro && config.filters.length >= freeAppLimit) {
          showProModal = true;
          return;
        }
      }
    } else {
      // Fallback: Check app limit for free version (local)
      if (!isPro && config.filters.length >= freeAppLimit) {
        showProModalFor('appLimit', lang.FREE_APP_LIMIT ? lang.FREE_APP_LIMIT.replace('{0}', freeAppLimit) : `Free version limited to ${freeAppLimit} applications`);
        return;
      }
    }

    // Additional validation for Pro features
    if (!isPro && config.filters.length >= freeAppLimit - 1) {
      // Show warning when approaching limit
      console.log('[App.svelte] Approaching free app limit');
    }
    
    if (typeof filter.insensitive !== 'boolean') filter.insensitive = false;
    if (filter.hwnd) {
      const process = processes.find(p => p.hwnd == filter.hwnd);
      if (process) {
        if (!filter.process && process.process) {
          filter.process = process.process;
        }
        if (!filter.className && process.className) {
          filter.className = process.className;
        }
        if (!filter.executable && process.executable) {
          filter.executable = process.executable;
        }
        if (!filter.icon && process.icon) {
          filter.icon = process.icon;
        }
      }
    }
    console.log('[App.svelte] Adding filter:', filter);
    console.log('[App.svelte] Filter HWND:', filter.hwnd);
    console.log('[App.svelte] Current visible state:', visible);
    config.filters.push(filter);
    config.filters = config.filters; // force svelte to update
    markFirstRunComplete();
    updateConfig();
    
    // Se as janelas estão ocultas, ocultar todas as janelas correspondentes ao filtro imediatamente
    if (!visible) {
      console.log('[App.svelte] Windows are hidden, hiding all matching windows immediately');
      hideMatchingWindows(filter);
    } else {
      console.log('[App.svelte] Windows are visible, not hiding windows immediately');
    }
  }

  // Counts how many windows each executable has in the provided list. Mirrors
  // buildExecutableWindowCounts() in src/system/system.js so the renderer can
  // treat single-window processes as process-identified (HWND recovery).
  function buildWindowCounts(procs) {
    const counts = new Map();
    (procs || []).forEach(proc => {
      if (!proc || !proc.executable) return;
      const key = String(proc.executable).toLowerCase();
      // Prefer the authoritative count computed by the main process; the local
      // process list may omit hidden windows and undercount multi-window apps.
      const known = Number(proc.windowCount);
      if (Number.isFinite(known) && known > 0) {
        counts.set(key, Math.max(counts.get(key) || 0, known));
      } else {
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    });
    return counts;
  }

  // Maximum number of learned title tokens kept per filter. Tokens are a
  // best-effort memory of drifted titles, never a requirement for a match.
  const MAX_TITLE_TOKENS = 8;

  // Same window KIND + executable as the filter. An empty className on the
  // filter means "no constraint" (elevated windows where GetClassName fails).
  function sameWindowIdentity(filter, proc) {
    if (!filter || !proc) return false;
    const execKey = filter.executable ? String(filter.executable).toLowerCase() : '';
    const procExecKey = proc.executable ? String(proc.executable).toLowerCase() : '';
    if (!execKey || !procExecKey || execKey !== procExecKey) return false;
    return !filter.className || filter.className === proc.className;
  }

  function titleTokens(filter) {
    return filter && Array.isArray(filter.tokens) ? filter.tokens : [];
  }

  // True when `title` matches the filter's original value OR any learned token.
  // Tokens only widen the match; they never gate it.
  function titleMatchesFilter(filter, title) {
    if (!filter || !title) return false;
    const compare = (a = '', b = '') => filter.insensitive
      ? String(a).toLowerCase().includes(String(b).toLowerCase())
      : String(a).includes(String(b));
    if (filter.value && compare(title, filter.value)) return true;
    return titleTokens(filter).some(token => token && compare(title, token));
  }

  // Best-effort learning/persistence of filter bindings, run after each process
  // refresh. The renderer owns config writes, so anything learned here survives
  // (main-side mutations would be overwritten by the next updateConfig).
  //   1. Learn: the stored HWND still points at a live window of the same
  //      identity -> remember its (possibly drifted) title as a token.
  //   2. Rebind: exactly one live window of the same identity matches the
  //      filter's title (or the process owns a single window) -> move the
  //      stored HWND to it. Additive: never unmatches anything.
  let syncingFilters = false;
  function syncFiltersWithWindows() {
    if (syncingFilters) return;
    if (!config || !Array.isArray(config.filters) || config.filters.length === 0) return;
    if (!Array.isArray(processes) || processes.length === 0) return;

    syncingFilters = true;
    try {
      const windowCounts = buildWindowCounts(processes);
      let changed = false;

      for (const filter of config.filters) {
        if (!filter || filter.type !== 'title' || !filter.executable) continue;

        const execKey = String(filter.executable).toLowerCase();

        // 1) Learn the drifted title of the window this filter is bound to.
        if (filter.hwnd) {
          const live = processes.find(p => p && p.hwnd === filter.hwnd);
          if (live && sameWindowIdentity(filter, live) && live.title && live.title !== filter.value) {
            const tokens = titleTokens(filter);
            if (!tokens.includes(live.title)) {
              filter.tokens = [...tokens, live.title].slice(-MAX_TITLE_TOKENS);
              changed = true;
            }
          }
        }

        // 2) Rebind the stored HWND when the target window is unambiguous.
        const titleCandidates = processes.filter(p => p && sameWindowIdentity(filter, p) && titleMatchesFilter(filter, p.title));
        let target = titleCandidates.length === 1 ? titleCandidates[0] : null;
        if (!target && windowCounts.get(execKey) === 1) {
          const sole = processes.filter(p => p && sameWindowIdentity(filter, p));
          if (sole.length === 1) target = sole[0];
        }
        if (target && filter.hwnd !== target.hwnd) {
          filter.hwnd = target.hwnd;
          if (target.title) filter.title = target.title;
          changed = true;
        }
      }

      if (changed) {
        config.filters = config.filters;
        if (window.api && window.api.updateConfig) window.api.updateConfig(config);
      }
    } catch (error) {
      console.warn('[App.svelte] syncFiltersWithWindows failed:', error);
    } finally {
      syncingFilters = false;
    }
  }

  // Shared matcher that mirrors matchesFilter() in src/system/system.js:
  //   1. overlay-hwnd filters stay bound to their session HWND;
  //   2. a stored HWND that is still the same window AND belongs to the same
  //      executable matches (guards against recycled HWNDs);
  //   3. single-window processes can be re-resolved by executable after a
  //      restart or a title change;
  //   4. fallback: original type-based comparison (title/process/className).
  function matchesFilter(proc, filter, windowCounts) {
    if (!proc || !filter) return false;

    if (filter.type === 'overlay-hwnd') {
      return !!filter.hwnd && proc.hwnd === filter.hwnd;
    }

    const execKey = filter.executable ? String(filter.executable).toLowerCase() : '';
    const procExecKey = proc.executable ? String(proc.executable).toLowerCase() : '';
    const execMatch = !!execKey && !!procExecKey && execKey === procExecKey;
    const processMatch = !execMatch && !!filter.process && !!proc.process &&
      String(filter.process).toLowerCase() === String(proc.process).toLowerCase();

    // Same window class as the filtered one (empty on the filter = no
    // constraint, e.g. elevated windows where GetClassName fails).
    const classMatch = !filter.className || filter.className === proc.className;

    if (filter.hwnd && proc.hwnd === filter.hwnd && (execMatch || processMatch)) {
      return true;
    }

    // Identity could not be resolved (no executable/process info): fall back to
    // a pure HWND match so explicitly-bound filters keep working.
    if (filter.hwnd && proc.hwnd === filter.hwnd && !procExecKey && !proc.process) {
      return true;
    }

    if (execMatch && classMatch && windowCounts && windowCounts.get(execKey) === 1) {
      return true;
    }

    const compare = (a = '', b = '') => {
      if (filter.insensitive) {
        return a.toLowerCase().includes(b.toLowerCase());
      }
      return a.includes(b);
    };

    switch (filter.type) {
      case 'title':
        return titleMatchesFilter(filter, proc.title);
      case 'process':
        return proc.process && compare(proc.process, filter.value);
      case 'className':
        return proc.className && compare(proc.className, filter.value);
      default:
        return false;
    }
  }

  // Função para ocultar todas as janelas visÃ­veis que correspondem a um filtro
  async function hideMatchingWindows(filter) {
    if (!filter || !window.api || !window.api.hideSpecificWindow) return;

    const windowCounts = buildWindowCounts(processes);
    const matching = processes.filter(proc => matchesFilter(proc, filter, windowCounts));
    if (matching.length === 0) {
      console.log('[App.svelte] No matching windows found to hide for filter:', filter);
      return;
    }

    console.log('[App.svelte] Hiding', matching.length, 'windows matching filter:', filter);
    for (const proc of matching) {
      if (!proc.hwnd) continue;
      try {
        await window.api.hideSpecificWindow(proc.hwnd);
        console.log('[App.svelte] Hidden window HWND:', proc.hwnd);
      } catch (error) {
        console.error('[App.svelte] Error hiding window HWND', proc.hwnd, ':', error);
      }
    }
  }

  // Função para mostrar todas as janelas que correspondem a um filtro
  async function showMatchingWindows(filter) {
    if (!filter || !window.api || !window.api.showSpecificWindow) return;

    // We request all processes, including hidden ones, so we can unhide them
    let allProcesses = [];
    try {
      // eslint-disable-next-line no-undef
      allProcesses = await window.api.getProcesses(true);
    } catch (error) {
      console.error('[App.svelte] Error fetching processes to show windows:', error);
    }

    const windowCounts = buildWindowCounts(allProcesses);
    const matching = allProcesses.filter(proc => matchesFilter(proc, filter, windowCounts));
    if (matching.length === 0) {
      console.log('[App.svelte] No matching windows found to show for filter:', filter);
      return;
    }

    console.log('[App.svelte] Showing', matching.length, 'windows matching filter:', filter);
    for (const proc of matching) {
      if (!proc.hwnd) continue;
      try {
        await window.api.showSpecificWindow(proc.hwnd);
        console.log('[App.svelte] Showed window HWND:', proc.hwnd);
      } catch (error) {
        console.error('[App.svelte] Error showing window HWND', proc.hwnd, ':', error);
      }
    }
  }

  // Função para ocultar uma janela especÃ­fica imediatamente
  function hideNewWindow(filter) {
    if (filter.hwnd && window.api && window.api.hideSpecificWindow) {
      console.log('[App.svelte] Hiding window with HWND:', filter.hwnd);
      window.api.hideSpecificWindow(filter.hwnd).then(() => {
        console.log('[App.svelte] Window hidden successfully');
      }).catch(error => {
        console.error('[App.svelte] Error hiding window:', error);
      });
    } else {
      console.log('[App.svelte] No HWND found in filter or API not available, cannot hide window');
    }
  }

// Function to hide any visible processes that match the configured filters while in hide-state
  async function checkForNewFilteredProcesses() {
    if (visible || !config.filters || config.filters.length === 0) {
      return;
    }

    console.log('[App.svelte] Ensuring all filtered windows are hidden during hide-state');

    // Build a unique set of windows that match any filter
    const windowCounts = buildWindowCounts(processes);
    const toHide = new Map();
    processes.forEach(proc => {
      if (!proc || !proc.hwnd) return;
      const matches = config.filters.some(filter => matchesFilter(proc, filter, windowCounts));
      if (matches) {
        toHide.set(proc.hwnd, proc);
      }
    });

    if (toHide.size === 0) {
      return;
    }

    console.log('[App.svelte] Auto-hiding', toHide.size, 'filtered windows');
    for (const proc of toHide.values()) {
      try {
        await window.api.hideSpecificWindow(proc.hwnd);
        console.log('[App.svelte] Auto-hidden window HWND:', proc.hwnd, 'process:', proc.process);
      } catch (error) {
        console.error('[App.svelte] Error auto-hiding window HWND', proc.hwnd, error);
      }
    }
  }

  // Handler para o evento add-filter do TitleFilter
  function handleAddFilter(event) {
    const filter = event.detail;
    addFilter(filter);
  }

  // Handler para o evento hide-new-window do TitleFilter
  function handleHideNewWindow(event) {
    const filter = event.detail;
    hideNewWindow(filter);
  }

  function handleProModalClose() {
    showProModal = false;
    proModalFeature = '';
    proModalFeatureName = '';
  }

  function handleTrayGuideClose() {
    showTrayGuide = false;
  }

  // --- Pedido de review (avaliação na Microsoft Store) ---
  // O main decide a elegibilidade (usuário engajado) e envia 'show-review-prompt'.
  function handleReviewPromptRequest(payload) {
    if (showReviewPrompt) return; // já aberto
    if (isFirstRun) return;       // nunca durante o onboarding
    if (showProModal || showTrayGuide) return; // não empilhar modais
    if (currentState === 'hide') return;
    showReviewPrompt = true;
    if (window.api && window.api.trackEvent) {
      window.api.trackEvent('retention.review_offered_ui', {
        source: (payload && payload.source) || 'post-show'
      });
    }
  }

  async function handleReviewRateNow() {
    if (reviewBusy) return;
    reviewBusy = true;
    try {
      if (window.api && window.api.requestRatingReview) {
        const result = await window.api.requestRatingReview();
        console.log('[App.svelte] requestRatingReview result:', result);
      }
    } catch (error) {
      console.error('[App.svelte] Error requesting rating review:', error);
    } finally {
      reviewBusy = false;
      showReviewPrompt = false;
    }
  }

  function handleReviewLater() {
    if (window.api && window.api.reviewDecision) {
      window.api.reviewDecision('later');
    }
    showReviewPrompt = false;
  }

  function handleReviewNever() {
    if (window.api && window.api.reviewDecision) {
      window.api.reviewDecision('never');
    }
    showReviewPrompt = false;
  }

  // Fechar via X/overlay conta como "agora não" (respeita o anti-nagging).
  function handleReviewModalClose() {
    handleReviewLater();
  }
  
  function showProModalFor(feature, featureName, source) {
    proModalFeature = feature || '';
    proModalFeatureName = featureName || '';
    showProModal = true;
    if (window.api && window.api.trackEvent) {
      window.api.trackEvent('retention.pro_modal_viewed', {
        feature: feature || 'generic',
        source: source || 'generic'
      });
    }
  }

  // --- Faixa de upsell do Pro ---
  // O main decide a elegibilidade (a partir do 2º uso real: ocultar + restaurar).
  async function loadProUpsell() {
    if (!window.api || !window.api.getProUpsell) return;
    try {
      const state = await window.api.getProUpsell();
      if (state) proUpsell = state;
    } catch (error) {
      console.error('[App.svelte] Error loading Pro upsell state:', error);
    }
  }

  function handleProUpsellOpen() {
    const usageCount = proUpsell.usageCount || 0;
    if (window.api && window.api.trackEvent) {
      // O Partner Center só recebe o NOME do evento (details são descartados),
      // por isso a faixa tem um evento próprio além do `source` no modal.
      window.api.trackEvent('retention.pro_upsell_modal_opened', { usageCount });
      window.api.trackEvent('retention.pro_upsell_clicked', { usageCount });
    }
    // Sem `feature`: o modal abre como upsell genérico (sem bloco de aviso).
    showProModalFor('', '', 'pro_upsell');
  }

  function handleProUpsellDismiss() {
    proUpsell = { ...proUpsell, eligible: false, dismissed: true };
    if (window.api && window.api.dismissProUpsell) {
      window.api.dismissProUpsell();
    }
  }

  function handleLicenseActivated() {
    // Reload Pro status after license activation
    loadProStatus();
    showProModal = false;
  }

  async function handleLicenseDeactivated() {
    if (window.api && window.api.deactivateLicense) {
      try {
        const status = window.api.getProStatus ? await window.api.getProStatus() : null;
        const activeSource = status?.proSource || proSource;

        if (activeSource === 'store') {
          alert((lang && lang.STORE_PRO_MANAGED) || 'This Pro entitlement is managed by Microsoft Store and cannot be deactivated here.');
          await loadProStatus();
          return;
        }

        const result = await window.api.deactivateLicense();
        if (result && result.reason === 'store-managed') {
          alert((lang && lang.STORE_PRO_MANAGED) || 'This Pro entitlement is managed by Microsoft Store and cannot be deactivated here.');
        }
        loadProStatus();
      } catch (error) {
        console.error('[App.svelte] Error deactivating license:', error);
      }
    }
  }

  function handleShowProModal() {
    showProModal = true;
  }

  function addViewFilter(value) {
    if (!value) return;
    let type;
    switch (config.currentContent) {
      case 'titles':
        type = 'title';
        break;
      case 'processes':
        type = 'process';
        break;
      case 'classes':
        type = 'className';
        break;
    }
    const process = processes.find(p => p[type].includes(value)) || {};
    const {icon, executable} = process;
    const filter = { value, type, icon, executable, insensitive: !viewFilterCaseSensitive };
    addFilter(filter);
  }

  async function removeFilter(filter) {
    console.log('removeFilter', filter, JSON.stringify(config.filters));

    // Attempt to unhide any windows that were hidden by this filter
    await showMatchingWindows(filter);

    config.filters = config.filters.filter(f => f.value != filter.value || f.type != filter.type);
    updateConfig();
  }

  function handleFilterSelected(filter) {
    if (filter.detail) {
      filter = filter.detail;
    }
    if (!filter.value) {
      switch (filter.type) {
        case 'className':
          filter.value = filter.className;
          break;
        case 'process':
          filter.value = filter.process;
          break;
        default:
          filter.value = filter.title;
          break;
      }
    }
    console.log('handleFilterSelected - original filter:', filter);
    console.log('handleFilterSelected - HWND present:', !!filter.hwnd, 'HWND value:', filter.hwnd);
    
    if (hasFilter(filter)) {
      removeFilter(filter);
    } else {
      // Preservar o HWND se disponÃ­vel
      const newFilter = {
        value: filter.value,
        type: filter.type,
        icon: filter.icon,
        executable: filter.executable,
        insensitive: filter.insensitive || false,
        hwnd: filter.hwnd, // Preservar HWND
        title: filter.title,
        process: filter.process,
        className: filter.className
      };
      console.log('handleFilterSelected - new filter created:', newFilter);
      console.log('handleFilterSelected - new filter HWND:', newFilter.hwnd);
      addFilter(newFilter);
    }
  }

  function handleDrop(event, targetId) {
    console.log('handleDrop app', event, targetId);
    if (!event || typeof event.preventDefault !== 'function') {
      console.error('Invalid event in handleDrop:', event);
      return;
    }
    event.preventDefault();
    if (!event.dataTransfer) {
      console.error('No dataTransfer in event:', event);
      return;
    }
    try {
      const draggedInfo = JSON.parse(event.dataTransfer.getData('text/plain'));
      console.log('draggedInfo', draggedInfo, targetId);
      removeFilter(draggedInfo);
    } catch (error) {
      console.error('Error parsing drag data:', error);
    }
  }

  function toggleContent(content) {
    if (content.detail) {
      content = content.detail;
    }
    config.currentContent = content;
    updateConfig();
  }

  // Function to adjust select width based on selected text
  function adjustSelectWidth() {
    if (!selectElement) return;
    
    // Create a temporary element to measure text width
    const tempElement = document.createElement('span');
    tempElement.style.visibility = 'hidden';
    tempElement.style.position = 'absolute';
    tempElement.style.whiteSpace = 'nowrap';
    tempElement.style.fontSize = window.getComputedStyle(selectElement).fontSize;
    tempElement.style.fontFamily = window.getComputedStyle(selectElement).fontFamily;
    tempElement.style.fontWeight = window.getComputedStyle(selectElement).fontWeight;
    tempElement.style.textTransform = window.getComputedStyle(selectElement).textTransform;
    
    // Get the selected option text
    const selectedOption = selectOptions.find(opt => opt.value === config.currentContent);
    if (selectedOption) {
      tempElement.textContent = selectedOption.label;
      document.body.appendChild(tempElement);
      
      // Measure width and add padding
      const width = tempElement.offsetWidth;
      const padding = 40; // Add padding for dropdown arrow and spacing
      selectElement.style.width = `${width + padding}px`;
      
      document.body.removeChild(tempElement);
    }
  }

  // Reactive statement to adjust width when content or options change
  $: if (config.currentContent && selectOptions.length > 0 && selectElement) {
    adjustSelectWidth();
  }

  // Also adjust when language changes (selectOptions updates)
  $: if (selectOptions.length > 0 && selectElement) {
    adjustSelectWidth();
  }

  function toggleContainer(container) {
    currentContainer = container;
    // Reset the collapsed filter box whenever navigating (e.g. going to options)
    viewFilterOpen = false;
    const icon = document.querySelector('.cet-icon-options');
    // Guard (fix ELECTRON-11): titlebar custom pode não estar no DOM ainda — o
    // estado de navegação já foi atualizado acima; só o ícone é opcional.
    if (!icon) return;
    if (container === 'options') {
      icon.innerHTML = '<i class="fas fa-chevron-left"></i><span>'+ lang.BACK +'</span>';
      icon.title = lang.BACK;
    } else {
      icon.innerHTML = '<i class="fas fa-cog"></i><span>'+ lang.OPTIONS +'</span>';
      icon.title = lang.OPTIONS;
    }
  }

  function updateSelectOptions() {
    selectOptions = [
      { label: lang.PROCESSES, value: 'processes' },
      { label: lang.CLASSES, value: 'classes' },
      { label: lang.TITLES, value: 'titles' }
    ];
    whatToFilterMessages = [
      lang.WHAT_TO_PROTECT.split('{0}')[0],
      lang.WHAT_TO_PROTECT.split('{0}')[1] || ''
    ];
  }

  function syncBodyState(state) {
    if (!state) return;
    const body = document.body;
    if (!body) return;

    const floatingButton = document.getElementById('floating-button');

    if (state === 'hide') {
      body.classList.remove('show-state');
      body.classList.add('hide-state');
      if (floatingButton) floatingButton.classList.add('hidden-state');
    } else {
      body.classList.remove('hide-state');
      body.classList.add('show-state');
      if (floatingButton) floatingButton.classList.remove('hidden-state');
    }

    // Guarantee correct icon if this is the startup path
    if (typeof window !== 'undefined' && typeof window.updateFloatingButtonDisplay === 'function') {
      window.updateFloatingButtonDisplay();
    }
  }

  if (window.api && window.api.onStateChange) {
    window.api.onStateChange((_, state) => {
      console.log('[App.svelte] State changed from', currentState, 'to', state);
      currentState = state || 'show';
      // Reset the collapsed filter box when the window is hidden
      if (state === 'hide') {
        viewFilterOpen = false;
      }
      // O main acabou de registrar o dia de uso (se houve janelas restauradas);
      // recarrega o estado da faixa de upsell.
      if (state === 'show') {
        loadProUpsell();
      }
      syncBodyState(currentState);
    });
  }

  // Reset the collapsed filter box whenever the window enters float-mode or the
  // hide-state (body classes are managed by inline scripts in index.html, so a
  // MutationObserver catches all paths regardless of which code toggled them).
  function watchBodyModeForFilterReset() {
    const body = document.body;
    if (!body) return;
    const observer = new MutationObserver(() => {
      if (body.classList.contains('float-mode') || body.classList.contains('hide-state')) {
        viewFilterOpen = false;
      }
    });
    observer.observe(body, { attributes: true, attributeFilter: ['class'] });
    return observer;
  }
  const bodyModeObserver = watchBodyModeForFilterReset();

  // Set up API event listeners
  let apiRetryCount = 0;
  function setupAPIEventListeners() {
    if (!window.api) {
      apiRetryCount++;
      // Only log every 10th attempt to reduce spam
      if (apiRetryCount % 10 === 0) {
        console.log(`[App.svelte] API not available yet, retrying... (attempt ${apiRetryCount})`);
      }
      setTimeout(setupAPIEventListeners, 100);
      return;
    }

    if (window.api.onPreviousWindowStateChange) {
    window.api.onPreviousWindowStateChange((_, previousState) => {
      console.log('[MAIN WINDOW] Previous window state changed:', previousState);
    });
  }

  if (window.api.onGoHome) {
    window.api.onGoHome((_, payload) => {
      console.log('[MAIN WINDOW] go-home event received from main', payload);
      toggleContainer('filters');
    });
  }

  if (window.api.onGoOptions) {
    window.api.onGoOptions((_, payload) => {
      console.log('[MAIN WINDOW] go-options event received from main', payload);
      toggleContainer('options');
    });
  }

  if (window.api.onShakeFilters) {
    window.api.onShakeFilters((_, payload) => {
      console.log('[MAIN WINDOW] shake-filters event received from main', payload);
      // If the user is in options view, go back to filter view so shake animation is visible.
      if (currentContainer === 'options') {
        toggleContainer('filters');

        // Dispatch extra custom event after view switch so TitleFilter (mounted on filters) can animate.
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('shake-filters'));
        }, 0);

        return;
      }

      // Otherwise, TitleFilter handles the event via its own onShakeFilters registration.
    });
  }

    if (window.api.onIcon) {
    window.api.onIcon((_, icons) => {
      refreshProcesses();
    });
  }
  
    if (window.api.onUpdateAvailable) {
    window.api.onUpdateAvailable((_, update, currentVersion) => {
      if (confirm(lang.UPDATE_AVAILABLE)) {
        window.api.launchUrl(update.url);
      }
    });
  }

    if (window.api.onLanguageChange) {
    window.api.onLanguageChange((_, language) => {
      lang = language;
      window.lang = language; // Keep legacy auth mode helper in sync
      updateSelectOptions();
    });
  }
  
    if (window.api.onConfigChange) {
      window.api.onConfigChange((_, c) => {
        config = c;
        window.config = c;

        // Enrich filters that arrived without an icon (e.g. added via the
        // titlebar overlay) using the current process list, when a match exists.
        if (c && Array.isArray(c.filters) && processes && processes.length > 0) {
          let changed = false;
          c.filters.forEach(filter => {
            if (filter.icon) return;
            const match = processes.find(p =>
              (filter.hwnd && p.hwnd == filter.hwnd) ||
              (filter.executable && p.executable && filter.executable.toLowerCase() === p.executable.toLowerCase())
            );
            if (match && match.icon) {
              filter.icon = match.icon;
              if (!filter.executable && match.executable) filter.executable = match.executable;
              if (!filter.process && match.process) filter.process = match.process;
              changed = true;
            }
          });
          if (changed) config = c;
        }

        ensureThemeSync();

        const localFirstRun = (() => {
          try { return localStorage.getItem('snapawayFirstRun'); } catch (_) { return null; }
        })();

        const configFirstRun = c && typeof c.firstRun !== 'undefined' ? c.firstRun : undefined;
        if (localFirstRun === 'true') {
          isFirstRun = true;
        } else if (localFirstRun === 'false') {
          isFirstRun = false;
        } else if (typeof configFirstRun !== 'undefined') {
          isFirstRun = configFirstRun !== false;
        } else {
          isFirstRun = true;
        }

        if (isFirstRun && c && Array.isArray(c.filters) && c.filters.length > 0) {
          isFirstRun = false;
        }

        // Ensure derived freemium state updates immediately when main process changes config
        try {
          isPro = !!c.isPro;
          if (!c.isPro) {
            proSource = 'free';
          }
          ProFeatures = c.ProFeatures || {};
          freeAppLimit = c.freeAppLimit || 2;
          remainingApps = typeof c.remainingApps === 'number' ? c.remainingApps : Math.max(0, (freeAppLimit || 2) - (c.filters ? c.filters.length : 0));
          isAtLimit = !!c.isAtLimit;
        } catch (err) {
          console.warn('[App.svelte] Failed to apply config-derived pro state:', err);
        }
      });
  }

  // Pedido de review: o main avisa o renderer quando o usuário está engajado.
  if (window.api.onReviewPrompt) {
    window.api.onReviewPrompt((_, payload) => {
      handleReviewPromptRequest(payload);
    });
  }

    console.log('[App.svelte] API event listeners set up successfully');
  }

  // Initialize API event listeners
  setupAPIEventListeners();

  onMount(async () => {
    // Wait for API to be available
    let waitCount = 0;
    while (!window.api) {
      waitCount++;
      // Only log every 10th attempt to reduce spam
      if (waitCount % 10 === 0) {
        console.log(`[App.svelte] Waiting for API to be available... (attempt ${waitCount})`);
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }

      try {
        config = await window.api.getConfig();
        lang = await window.api.getLanguage();
        if (window.api.getVersion) {
          try {
            appVersion = await window.api.getVersion();
          } catch (versionError) {
            console.warn('[App.svelte] Error loading app version:', versionError);
          }
        }
        window.lang = lang; // expose to global auth-mode helper script
        window.config = config;
        ensureThemeSync();

        const localFirstRun = (() => {
          try { return localStorage.getItem('snapawayFirstRun'); } catch (_) { return null; }
        })();

        const configFirstRun = config && typeof config.firstRun !== 'undefined' ? config.firstRun : undefined;
        if (localFirstRun === 'true') {
          isFirstRun = true;
        } else if (localFirstRun === 'false') {
          isFirstRun = false;
        } else if (typeof configFirstRun !== 'undefined') {
          isFirstRun = configFirstRun !== false;
        } else {
          isFirstRun = true;
        }

        if (isFirstRun && config && Array.isArray(config.filters) && config.filters.length > 0) {
          isFirstRun = false;
        }

        // Obter o estado atual para inicializar a variável de estado
        const stateResponse = await window.api.getCurrentState();
        const state = (stateResponse && stateResponse.state) ? stateResponse.state : 'show';
        currentState = state;
        syncBodyState(currentState);
        
        // Load Pro status
        await loadProStatus();
        await loadProUpsell();
      } catch (error) {
        console.error('[App.svelte] Error initializing API:', error);
      }

      ready = true;
    
    refreshProcesses();
    updateSelectOptions();

    // Aguarda o DOM estar pronto
    await new Promise(resolve => setTimeout(resolve, 0));

    const controlsContainer = document.querySelector('.cet-controls-container');
    if (controlsContainer) {
      // Ensure we only add the options icon once (avoid duplicates on re-renders)
      let titleBarIcon = document.querySelector('.cet-icon-options');
      if (!titleBarIcon) {
        titleBarIcon = document.createElement('div');
        titleBarIcon.classList.add('cet-icon');
        titleBarIcon.classList.add('cet-icon-options');
        titleBarIcon.addEventListener('click', () => toggleContainer(currentContainer === 'options' ? 'filters' : 'options'));
        controlsContainer.prepend(titleBarIcon);
      }

      // Update the icon title and content based on current view
      titleBarIcon.title = lang.OPTIONS;
      titleBarIcon.innerHTML = '<i class="fas fa-cog"></i><span>'+ lang.OPTIONS +'</span>';
    }

    const footerLinks = document.querySelectorAll('a[target="_system"]');
    footerLinks.forEach(link => {
      link.addEventListener('click', e => {
        e.preventDefault();
        if (window.api && window.api.launchUrl) {
          window.api.launchUrl(link.href);
        }
      });
    });

    // Listen for auto-refresh events from the renderer
    window.addEventListener('autoRefreshProcesses', () => {
      console.log('[App.svelte] Auto-refresh triggered');
      refreshProcesses();
    });

    // Adjust select width after mount
    setTimeout(() => {
      adjustSelectWidth();
    }, 100);
  });

</script>

{#if ready}
  <main class="ghostly-theme">
    {#if isFirstRun}
      <div class="onboarding-overlay" role="dialog" aria-modal="true" aria-label="First time user guide">
        <div class="onboarding-card">
          <h2>{t('WELCOME_TO_SNAPAWAY')}</h2>
          <p>{t('ONBOARDING_STEP_1')}</p>
          <ol>
            <li>{t('ONBOARDING_STEP_2')}</li>
            <li>{t('ONBOARDING_STEP_3', [hideShortcut])}</li>
            <li>{t('ONBOARDING_STEP_4', [showShortcut])}</li>
          </ol>
          <p class="onboarding-startup-copy">{t('ONBOARDING_STARTUP_HINT') || 'If you want, SnapAway can start with Windows.'}</p>
          {#if onboardingStartupMessage}
            <p class="onboarding-startup-status">{onboardingStartupMessage}</p>
          {/if}
          <div class="onboarding-actions">
            <button class="onboarding-action onboarding-action-secondary" on:click={markFirstRunComplete}>{t('NOT_NOW') || 'Not now'}</button>
            <button class="onboarding-action" on:click={enableStartupFromOnboarding} disabled={onboardingStartupBusy}>
              {onboardingStartupBusy ? (t('LOADING') || 'Please wait...') : (t('ENABLE_STARTUP_WITH_WINDOWS') || 'Enable startup with Windows')}
            </button>
          </div>
        </div>
      </div>
    {/if}
    {#if currentContainer === 'options'}
    <div class="flex-container container container-options">
      <ShortcutSetter 
        bind:lang 
        bind:config={config} 
        {visible} 
        {isPro}
        {proSource}
        {ProFeatures}
        on:change={updateConfig} 
        on:go-process-list={() => toggleContainer('filters')}
        on:show-pro-modal={(e) => showProModalFor(e.detail?.feature, e.detail?.featureName)}
        on:show-tray-guide={() => (showTrayGuide = true)}
        on:deactivate-license={handleLicenseDeactivated}
      />
      <div class="container-back-button footer mini-about">
        <button on:click={() => toggleContainer('filters')}>
          <i class="fas fa-chevron-left"></i>&nbsp;&nbsp;{lang.BACK_TO_WINDOW_LIST}
        </button>
        <span style="flex-grow: 1;"></span>  
        <span class="mini-about-copy">
          <strong>
            SnapAway
            {#if appVersion}v{appVersion}{/if}
          </strong>
          &middot; 
          <a href={aboutUrl} on:click|preventDefault={() => launchUrl(aboutUrl)}><i class="fas fa-question-circle" aria-hidden="true"></i>&nbsp;{lang.HELP}</a>
        </span>
      </div>
    </div>
  {:else if currentContainer === 'filters'}
    <div class="flex-container container container-filters">
      <TitleFilter 
        bind:lang 
        visible={visible} 
        bind:config 
        bind:filters={config.filters} 
        on:change={updateConfig} 
        on:go-options={() => toggleContainer('options')} 
        on:go-home={() => toggleContainer('filters')} 
        on:filter-selected={handleFilterSelected}
        on:add-filter={handleAddFilter}
        on:hide-new-window={handleHideNewWindow}
      />
      {#if showProUpsell}
        <div class="pro-upsell-banner">
          <span class="pro-upsell-copy">
            <i class="fas fa-bolt" aria-hidden="true"></i>
            {t('PRO_UPSELL_TITLE') || 'Hide even faster with Pro'}
          </span>
          <button class="pro-upsell-cta" on:click={handleProUpsellOpen}>
            {t('PRO_UPSELL_CTA') || 'I want it'}
          </button>
          <button
            class="pro-upsell-dismiss"
            title={t('PRO_UPSELL_DISMISS') || 'Dismiss'}
            aria-label={t('PRO_UPSELL_DISMISS') || 'Dismiss'}
            on:click={handleProUpsellDismiss}
          >&#x2715;</button>
        </div>
      {/if}
      <header>
        <h2 class="select-window">
          {whatToFilterMessages[0]}            
          <span id="filter-selector">
            <select 
              class="select" 
              bind:this={selectElement}
              bind:value={config.currentContent} 
              on:change={e => {
                console.log('e', e); 
                toggleContent(e.target.value);
                adjustSelectWidth(); // Adjust width when selection changes
              }}>
              {#each selectOptions as option}
                <option value={option.value}>{option.label}</option>
              {/each}
            </select>
          </span>
          {whatToFilterMessages[1] || ''}
        </h2>
        <span style="display: flex; flex-grow: 1;" class="view-filter {viewFilterFocused ? 'focused' : ''}">
          <button title={lang.REFRESH} aria-label={lang.REFRESH} class="header-item" id="refresh-button" on:click={refreshProcesses} on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); refreshProcesses(); } }}>
            <i class="fas fa-sync-alt" aria-hidden="true"></i>
          </button>
          {#if viewFilterOpen}
            <span class="view-filter-box">
              <input type="search" placeholder={lang.FILTER} bind:value={viewFilter} on:focus={() => viewFilterFocused = true} on:blur={() => viewFilterFocused = false} />
              <button id="font-case-button" class:sensitive={viewFilterCaseSensitive} title={lang.FONT_CASE} aria-label={lang.FONT_CASE} on:click={() => viewFilterCaseSensitive = !viewFilterCaseSensitive}>
                <i class="fas fa-font-case" aria-hidden="true"></i>
              </button>
              <button id="add-filter-button" title={lang.ADD_FILTER} aria-label={lang.ADD_FILTER} on:click={() => addViewFilter(viewFilter)} style="border-radius: 0;line-height: 138%;">
                <i class="fas fa-plus" aria-hidden="true"></i>
              </button>
            </span>
          {:else}
            <span class="view-filter-box view-filter-icons">
              <button id="view-filter-search-button" title={lang.FILTER} aria-label={lang.FILTER} on:click={() => { viewFilterOpen = true; setTimeout(() => { const el = document.querySelector('.view-filter-box input'); if (el) el.focus(); }, 0); }}>
                <i class="fas fa-search" aria-hidden="true"></i>
              </button>
              <button id="view-filter-add-button" title={lang.ADD_FILTER} aria-label={lang.ADD_FILTER} on:click={() => { viewFilterOpen = true; }}>
                <i class="fas fa-plus" aria-hidden="true"></i>
              </button>
            </span>
          {/if}
        </span>
      </header>
      <div class="content" role="region" aria-label="Application content area" on:dragover={(e) => e.preventDefault()} on:drop={(e) => handleDrop(e, 'content')}>
        {#if config.currentContent === 'titles'}
          <TitleList bind:lang bind:processes bind:viewFilter bind:viewFilterCaseSensitive bind:filters={config.filters} on:filter-selected={handleFilterSelected} />
        {:else if config.currentContent === 'processes'}
          <ProcessList bind:lang bind:processes bind:viewFilter bind:viewFilterCaseSensitive bind:filters={config.filters} on:filter-selected={handleFilterSelected} />
        {:else if config.currentContent === 'classes'}
          <ClassList bind:lang bind:processes bind:viewFilter bind:viewFilterCaseSensitive bind:filters={config.filters} on:filter-selected={handleFilterSelected} />
        {/if}
      </div>
    </div>
  {/if}
  
  <!-- Freemium system modals -->
  {#if showProModal}
    <ProModal 
      {lang}
      {isPro}
      currentAppCount={config.filters.length}
      {freeAppLimit}
      feature={proModalFeature}
      featureName={proModalFeatureName}
      on:close={handleProModalClose}
      on:activated={handleLicenseActivated}
    />
  {/if}
  {#if showTrayGuide}
    <TrayGuideModal {lang} on:close={handleTrayGuideClose} />
  {/if}
  {#if showReviewPrompt}
    <ReviewModal
      {lang}
      busy={reviewBusy}
      on:rate={handleReviewRateNow}
      on:later={handleReviewLater}
      on:never={handleReviewNever}
      on:close={handleReviewModalClose}
    />
  {/if}
</main>
{/if}

<style>
  .footer {
    display: flex;
    justify-content: center;
    height: 2.625rem;
  }
  .mini-about {
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    min-height: 2.625rem;
    height: auto;
    padding: 0.5rem 0.25rem 0;
    font-size: 0.85rem;
    opacity: 0.82;
  }
  .mini-about .mini-about-copy {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .footer a {
    color: var(--default-font-color);
    text-decoration: none;
    border-bottom: 1px solid var(--default-font-color);
  }
  .footer a:hover, .footer a:focus {
    color: var(--main-font-color);
    border-bottom: 1px solid var(--main-font-color);
  }
  button, select {
    color: ButtonText;
    border: 0px solid #232127;
    padding: 5px;
    cursor: pointer;
  }
  select option {
    background: white;
    color: black;
    outline: none;
  }
  select:focus {
    outline: none;
  }
  .header-item {
    color: ButtonText;
    font-size: 1rem;
    padding: 8px 10px;
    padding-top: 0.45em;
    border-width: 0;
  }
  #refresh-button {
    font-weight: bolder;
    border-width: 0;
    background: transparent;
    margin: 2px 0.75em 0 -0.5em;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 !important;
  }
  main {
    padding: 0;
  }
  main div.container {
    padding: 0 2vmin 2vmin 2vmin;
    height: calc(100vh - 30px); /* 30px is the height of the title bar */
  }
  main div header {
    display: flex;
  }

  .onboarding-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,.6);
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem;
  }

  .onboarding-card {
    background: Canvas;
    border: 1px solid ButtonBorder;
    border-radius: 12px;
    max-width: 450px;
    width: 100%;
    padding: 1.25rem;
    box-shadow: 0 0 25px rgba(0,0,0,.35);
    color: CanvasText;
  }

  .onboarding-card h2 {
    margin-top: 0;
    margin-bottom: .75rem;
  }

  .onboarding-card p,
  .onboarding-card ol {
    margin-bottom: .75rem;
    line-height: 1.4;
    list-style: none;
  }

  .onboarding-card .onboarding-action {
    margin-top: .5rem;
    width: 100%;
    border-radius: 6px;
    background: Highlight;
    color: HighlightText;
    font-weight: 600;
    padding: .5rem;
  }

  .onboarding-card .onboarding-action:hover {
    background: HighlightText;
    color: Highlight;
  }

  .onboarding-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.6rem;
    margin-top: 0.25rem;
  }

  .onboarding-card .onboarding-action-secondary {
    background: transparent;
    color: ButtonText;
    border: 1px solid ButtonBorder;
  }

  .onboarding-startup-copy {
    margin-top: 0.35rem;
    margin-bottom: 0.45rem;
    opacity: 0.9;
  }

  .onboarding-startup-status {
    margin-top: 0;
    margin-bottom: 0.5rem;
    font-size: 0.92rem;
    opacity: 0.85;
  }

  main div header {
    display: flex;
    flex-direction: row;
    align-items: center;
  }
  button:hover, button:focus {
    color: #ddd;
  }
  main > div.container {
    min-width: -webkit-fill-available;
    overflow-y: auto;
    overflow-x: hidden;
    box-sizing: border-box;
  }
  .view-filter {
    justify-content: right;
    padding-right: 0.35rem;
  }
  .view-filter input {
    border-bottom-left-radius: 6px;
    border-top-left-radius: 6px;
    width: 10vw;
    display: inline-flex;
    outline: none !important;
    border-width: 0;
    padding-left: 6px;
  }
  .view-filter button {
    border-bottom-right-radius: 6px;
    border-top-right-radius: 6px;
  }
  .view-filter-box {
    box-shadow: 0 0 1px ButtonBorder;
    background: ButtonFace;
    border-radius: 6px;
    display: flex;
    flex-direction: row;
    overflow: hidden;
  }
  .view-filter-box.view-filter-icons {
    background: transparent;
    box-shadow: none;
  }
  .view-filter-box.view-filter-icons button {
    border-width: 0;
    background: transparent;
    padding: 4px 10px;
    cursor: pointer;
    font-size: inherit;
    font-family: inherit;
  }
  .view-filter-box.view-filter-icons button:hover,
  .view-filter-box.view-filter-icons button:focus {
    background: transparent;
    box-shadow: none;
    border-radius: 0;
  }
  #filter-selector {
    display: inline-flex;
    border-radius: 6px;
    box-shadow: 0 0 1px ButtonBorder;
    overflow: hidden;
  }
  #filter-selector select {
    font-size: inherit;
    font-weight: inherit;
    text-transform: lowercase;
  }
  #filter-selector select option {
    text-transform: lowercase;
  }
  #font-case-button {
    border-width: 0;
    position: relative;
    z-index: 1;
  }
  #font-case-button.sensitive {
    color: #aea6b7;
  }
  #font-case-button i {
    color: inherit;
  }

  .pro-upsell-banner {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0.6rem 0 0.6rem 0;
    padding: 0.5rem 0.75rem;
    border: 1px solid #3fb49f;
    border-radius: 6px;
    background: rgba(63, 180, 159, 0.12);
    color: CanvasText;
    font-size: 0.92rem;
  }
  .pro-upsell-copy {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex: 1;
    min-width: 0;
  }
  .pro-upsell-copy i {
    color: #3fb49f;
  }
  .pro-upsell-cta {
    border-width: 0;
    border-radius: 4px;
    padding: 0.25rem 0.7rem;
    background: #3fb49f;
    color: #fff;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
  }
  .pro-upsell-cta:hover,
  .pro-upsell-cta:focus {
    background: #35a08c;
    color: #fff;
  }
  .pro-upsell-dismiss {
    border-width: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
    opacity: 0.7;
    padding: 0 0.15rem;
    line-height: 1;
  }
  .pro-upsell-dismiss:hover,
  .pro-upsell-dismiss:focus {
    opacity: 1;
  }
  
</style>