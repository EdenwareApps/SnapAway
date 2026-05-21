<script>
import { createEventDispatcher, onMount } from 'svelte';

  let startupTaskState = null; // WinRT state for MSIX installs
  let isStoreInstallLocal = false;
  onMount(async () => {
    if (window.api && window.api.getStartupState) {
      try {
        const s = await window.api.getStartupState();
        isStoreInstallLocal = !!s.isStoreInstall;
        if (s.isStoreInstall) {
          startupTaskState = s.state || null;
          // Sync config.startup with the real WinRT state
          config.startup = s.isEnabled;
        }
      } catch (_) {}
    }
  });

  export let config = {};
  export let lang = {};
  export let visible = true;
  export let isPro = false;
  export let proSource = 'free';
  const dispatch = createEventDispatcher();

  let activeInput = null;
  $: canDeactivatePro = isPro && proSource === 'license-key';
  let languages = [];
  const modifiers = new Set(['Ctrl', 'Alt', 'Shift', 'Meta']);
  const pressedKeys = new Set();
  let cloakIconPreview = '';

  function showProModalFeature(feature, featureName) {
    dispatch('show-pro-modal', {
      feature,
      featureName
    });
  }

  // Values shown in the inputs while editing (allows showing "Recording...")
  let displayHide = '';
  let displayShow = '';
  async function getLanguages() {
    languages = await window.api.getLanguages();
  }

  getLanguages();

  // keep display values in sync with config when not actively recording
  $: if (activeInput !== 'hide') displayHide = config.hideKey || '';
  $: if (activeInput !== 'show') displayShow = config.showKey || '';

  function handleKeyDown(e) {
    if (!activeInput) return;

    // Try to prevent native actions while recording
    try { e.preventDefault(); e.stopPropagation(); } catch (err) {}

    // allow cancel with Escape
    if ((e.code === 'Escape' || e.key === 'Escape') && activeInput) {
      if (activeInput === 'hide') displayHide = config.hideKey || '';
      else displayShow = config.showKey || '';
      activeInput = null;
      pressedKeys.clear();
      if (window.api && window.api.resumeGlobalShortcuts) window.api.resumeGlobalShortcuts();
      return;
    }

    // Debug: show raw event info
    try {
      console.log('[ShortcutSetter] keydown event', { code: e.code, key: e.key, keyCode: e.keyCode, which: e.which, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey });
    } catch (err) {}

    // Map physical key (code) to a stable label independent of CapsLock
    const code = e.code || '';
    let keyLabel = '';

    if (code.startsWith('Control')) keyLabel = 'Ctrl';
    else if (code.startsWith('Shift')) keyLabel = 'Shift';
    else if (code.startsWith('Alt')) keyLabel = 'Alt';
    else if (code.startsWith('Meta')) keyLabel = 'Meta';
    else if (/^F\d+$/.test(code)) keyLabel = code; // F1..F12
    else if (code.startsWith('Key')) keyLabel = code.slice(3).toUpperCase(); // KeyM -> M
    else if (code.startsWith('Digit')) keyLabel = code.slice(5); // Digit1 -> 1
    else if (code === 'Space') keyLabel = 'Space';
    else keyLabel = code || e.key || '';

    // Track pressed modifiers for live display
    if (modifiers.has(keyLabel)) {
      pressedKeys.add(keyLabel);
      // show only modifiers while user holds them
      const mods = [];
      if (e.ctrlKey) mods.push('Ctrl');
      if (e.metaKey) mods.push('Meta');
      if (e.altKey) mods.push('Alt');
      if (e.shiftKey) mods.push('Shift');
      const live = mods.join('+');
      const recordingLabel = (lang && lang.RECORDING) || 'Set your SnapKey...';
      if (activeInput === 'hide') displayHide = live || recordingLabel;
      else displayShow = live || recordingLabel;
      return;
    }

    // Compose the shortcut string using current modifier state + main key
    const parts = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.metaKey) parts.push('Meta');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');

    parts.push(keyLabel);
    const combo = parts.filter(Boolean).join('+');

    // Validate shortcut complexity for Pro features
    // Show the captured combo immediately in the input
    if (activeInput === 'hide') displayHide = combo;
    else displayShow = combo;

    const previousValue = activeInput === 'hide' ? config.hideKey : config.showKey;

    const finishRecording = (persist) => {
      if (persist) {
        if (activeInput === 'hide') {
          config.hideKey = combo;
        } else {
          config.showKey = combo;
        }
        dispatch('change');
      } else {
        // restore previous display if not persisted
        if (activeInput === 'hide') displayHide = previousValue || '';
        else displayShow = previousValue || '';
      }
      activeInput = null;
      pressedKeys.clear();
      if (window.api && window.api.resumeGlobalShortcuts) window.api.resumeGlobalShortcuts();
    };

    if (window.api && window.api.validateShortcut) {
      window.api.validateShortcut(combo).then(result => {
        console.log('[ShortcutSetter] validateShortcut result', combo, result);
        if (result && result.success) {
          finishRecording(true);
        } else {
          if (!isPro && combo.split('+').length > 3) showProModalFeature('customShortcuts', lang.CUSTOM_SHORTCUTS || 'Custom keyboard shortcuts');
          finishRecording(false);
        }
      }).catch(err => {
        console.error('[ShortcutSetter] Shortcut validation error:', err);
        finishRecording(true);
      });
    } else {
      finishRecording(true);
    }
  }

  function handleKeyUp(e) {
    if (!activeInput) return;
    const code = e.code || '';
    let keyLabel = '';
    if (code.startsWith('Control')) keyLabel = 'Ctrl';
    else if (code.startsWith('Shift')) keyLabel = 'Shift';
    else if (code.startsWith('Alt')) keyLabel = 'Alt';
    else if (code.startsWith('Meta')) keyLabel = 'Meta';
    else if (code.startsWith('Key')) keyLabel = code.slice(3).toUpperCase();
    else if (code.startsWith('Digit')) keyLabel = code.slice(5);
    else if (code === 'Space') keyLabel = 'Space';
    else keyLabel = code || e.key || '';
    pressedKeys.delete(keyLabel);
  }

  function focusInput(type) {
    activeInput = type;
    pressedKeys.clear();
    if (type === 'hide') {
      displayHide = (lang && lang.RECORDING) || 'Recording...';
    } else if (type === 'show') {
      displayShow = (lang && lang.RECORDING) || 'Recording...';
    }

    // Tell main process to pause global shortcuts so renderer can capture F-keys
    try {
      if (window.api && window.api.pauseGlobalShortcuts) window.api.pauseGlobalShortcuts();
    } catch (err) {
      console.warn('[ShortcutSetter] pauseGlobalShortcuts failed:', err && err.message ? err.message : err);
    }
  }

  function handleDeactivateClick() {
    if (!canDeactivatePro) {
      alert((lang && lang.STORE_PRO_MANAGED) || 'This Pro entitlement is managed by Microsoft Store and cannot be deactivated here.');
      return;
    }
    const message = lang.CONFIRM_DEACTIVATE_LICENSE || 'Do you want to deactivate the current Pro license?';
    if (!confirm(message)) return;
    dispatch('deactivate-license');
  }

  async function handleRestoreDefaults() {
    const message = lang.CONFIRM_RESTORE_DEFAULTS || 'Restore all settings to default values?';
    if (!confirm(message)) return;

    try {
      if (!window.api || !window.api.resetConfig) {
        alert(lang.CANNOT_RESET_CONFIG || 'Unable to reset settings at this time');
        return;
      }

      const result = await window.api.resetConfig();
      if (!result || !result.success) {
        alert(result?.message || 'Failed to restore defaults');
        return;
      }

      const updatedConfig = await window.api.getConfig();
      if (updatedConfig) {
        config = updatedConfig;
      }
      try {
        localStorage.setItem('snapawayFirstRun', 'true');
      } catch (error) {
        console.warn('[ShortcutSetter] Could not set first-run flag in localStorage:', error);
      }
      dispatch('change');
    } catch (error) {
      console.error('[ShortcutSetter] Error restoring defaults:', error);
      alert('Error restoring defaults: ' + (error?.message || error));
    }
  }

  async function selectCloakIcon() {
    if (!isPro) {
      showProModalFeature('cloaking', lang.CLOAKING_LABEL || 'Cloaking');
      return;
    }

    try {
      if (!window.api || !window.api.selectCloakIcon) {
        alert('API not available');
        return;
      }
      
      const result = await window.api.selectCloakIcon();
      if (!result) {
        console.error('No result from selectCloakIcon');
        return;
      }
      
      if (result.success && !result.canceled && result.filePath) {
        if (!window.api.setCloakIcon) {
          alert('API not available');
          return;
        }
        
        const processResult = await window.api.setCloakIcon(result.filePath);
        if (!processResult) {
          console.error('No result from setCloakIcon');
          return;
        }
        
        if (processResult.success) {
          // Update preview IMMEDIATELY from result
          const previewPath = processResult.previewPath || processResult.iconPath;
          if (previewPath) {
            // Normalize path - ensure it's a proper file:// URL
            let previewUrl = previewPath;
            if (!previewUrl.startsWith('file://')) {
              // Handle Windows paths: C:\path -> file:///C:/path
              if (previewUrl.match(/^[A-Za-z]:/)) {
                previewUrl = `file:///${previewUrl.replace(/\\/g, '/')}`;
              } else {
                previewUrl = `file://${previewUrl}`;
              }
            }
            // Add cache-busting parameter to force image reload for non-data URLs
            const cacheBustedUrl = previewUrl.startsWith('data:') ? previewUrl : `${previewUrl}?t=${Date.now()}`;
            console.log('[ShortcutSetter] Setting preview to:', cacheBustedUrl, 'from path:', previewPath);
            cloakIconPreview = cacheBustedUrl;
          }
          
          // Also trigger applyCloaking to update titlebar
          if (window.api && window.api.applyCloaking) {
            try {
              await window.api.applyCloaking();
            } catch (error) {
              console.error('Error applying cloaking after icon set:', error);
            }
          }
          
          dispatch('change');
        } else {
          const errorMsg = processResult.error || 'Unknown error';
          console.error('Error processing icon:', errorMsg);
          alert('Error processing icon: ' + errorMsg);
        }
      }
    } catch (error) {
      console.error('Error selecting cloak icon:', error);
      alert('Error selecting icon: ' + (error.message || 'Unknown error'));
    }
  }

  async function clearCloakIcon() {
    if (!isPro) {
      showProModalFeature('cloaking', lang.CLOAKING_LABEL || 'Cloaking');
      return;
    }

    try {
      if (!window.api || !window.api.clearCloakIcon) {
        console.error('API not available');
        return;
      }
      
      await window.api.clearCloakIcon();
      cloakIconPreview = '';
      dispatch('change');
    } catch (error) {
      console.error('Error clearing cloak icon:', error);
      alert('Error clearing icon: ' + (error.message || 'Unknown error'));
    }
  }

  function handleCloakToggle() {
    if (!isPro) {
      showProModalFeature('cloaking', lang.CLOAKING_LABEL || 'Cloaking');
      config.cloakEnabled = false; // Reset to disabled
      return;
    }

    try {
      // Let the main process apply cloaking after config updates.
      dispatch('change');
    } catch (error) {
      console.error('Error updating cloaking setting:', error);
    }
  }

  function handleCloakNameChange() {
    if (!isPro) {
      showProModalFeature('cloaking', lang.CLOAKING_LABEL || 'Cloaking');
      return;
    }

    try {
      // Let the main process apply cloaking after config updates.
      dispatch('change');
    } catch (error) {
      console.error('Error updating cloaking name:', error);
    }
  }

  function normalizeFloatingButtonMode(value) {
    if (typeof value === 'boolean') return value ? 'always' : 'never';
    if (typeof value !== 'string') return 'always';

    const normalized = value.toLowerCase();
    if (['never', 'no', 'off', 'false'].includes(normalized)) return 'never';
    if (['visible', 'visible-only', 'only-visible', 'show', 'show-only'].includes(normalized)) return 'visible';
    if (['learning', 'aprendizado', 'adaptive', 'adaptative', 'training'].includes(normalized)) return 'learning';
    if (['always', 'yes', 'on', 'true'].includes(normalized)) return 'always';

    return 'always';
  }

  $: floatingButtonMode = normalizeFloatingButtonMode(config.showEmergencyButton);

  function setFloatingButtonMode(mode) {
    config.showEmergencyButton = mode;
    dispatch('change');
  }

  // Listen for cloak icon updates from main process
  onMount(() => {
    if (typeof window === 'undefined') return;
    
    const handleCloakIconUpdate = (e) => {
      if (e && e.detail) {
        console.log('[ShortcutSetter] Received cloak-icon-updated event:', e.detail);
        // Add cache-busting parameter to force image reload for non-data URLs
        const cacheBustedUrl = e.detail && typeof e.detail === 'string' && e.detail.startsWith('data:')
          ? e.detail
          : `${e.detail}?t=${Date.now()}`;
        console.log('[ShortcutSetter] Setting preview with cache-busting:', cacheBustedUrl);
        cloakIconPreview = cacheBustedUrl;
        // Force Svelte reactivity
        cloakIconPreview = '';
        setTimeout(() => {
          cloakIconPreview = cacheBustedUrl;
        }, 10);
      }
    };
    
    window.addEventListener('cloak-icon-updated', handleCloakIconUpdate);

    // Capture keyboard events early (use capture + passive:false so we can preventDefault when recording)
    const captureKeyDown = (ev) => handleKeyDown(ev);
    const captureKeyUp = (ev) => handleKeyUp(ev);
    try {
      window.addEventListener('keydown', captureKeyDown, { capture: true, passive: false });
      window.addEventListener('keyup', captureKeyUp, { capture: true, passive: false });
    } catch (err) {
      // Fallback for older runtimes: add without options
      window.addEventListener('keydown', captureKeyDown);
      window.addEventListener('keyup', captureKeyUp);
    }
    
    // Initialize preview if cloak icon exists
    if (config.cloakIconPath && !cloakIconPreview && config.cloakEnabled) {
      // Request preview by triggering applyCloaking which will send update-cloak-icon
      if (window.api && window.api.applyCloaking) {
        try {
          window.api.applyCloaking();
        } catch (error) {
          console.error('Error applying cloaking on mount:', error);
        }
      }
    }
    
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('cloak-icon-updated', handleCloakIconUpdate);
        try {
          window.removeEventListener('keydown', captureKeyDown, { capture: true });
          window.removeEventListener('keyup', captureKeyUp, { capture: true });
        } catch (err) {
          window.removeEventListener('keydown', captureKeyDown);
          window.removeEventListener('keyup', captureKeyUp);
        }
      }
    };
  });
</script>

<div id="shortcut-setter">
  <header class="shortcut-setter-header">
    <h2 class="select-window">{lang.SET_A_SHORTCUT} &nbsp; <i class="fas fa-chevron-down"></i></h2>
    
    <!-- Status Pro -->
    <div class="pro-status">
      {#if isPro}
        {#if canDeactivatePro}
          <span class="pro-badge" title={lang.PRO_ACTIVE || 'Pro Active'} role="button" tabindex="0" on:click={handleDeactivateClick} on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleDeactivateClick(); } }}>
            <i class="fas fa-crown"></i> Pro
          </span>
        {:else}
          <span class="pro-badge pro-badge-store" title={(lang && lang.STORE_PRO_MANAGED) || 'Managed by Microsoft Store'}>
            <i class="fas fa-crown"></i> Pro
          </span>
        {/if}
      {:else}
        <button class="upgrade-btn" title="Upgrade to Pro" on:click={() => showProModalFeature('generic', lang.PRO_FEATURE || 'Premium Feature')}>
          <i class="fas fa-star"></i> Upgrade
        </button>
      {/if}
    </div>
  </header>
  <div id="shortcut-setter-instructions">{lang.SHORTCUT_INSTRUCTIONS}</div>
  <div class="options-container">
    <div class="shortcut-container">
      <label for="hide-shortcut">{lang.HIDE_SHORTCUT}:</label>
      <input
        id="hide-shortcut"
        name="hide-shortcut"
        bind:value={displayHide}
        readonly
        on:focus={() => focusInput('hide')}
        on:click={() => focusInput('hide')}
        on:blur={() => { activeInput = null; pressedKeys.clear(); if (window.api && window.api.resumeGlobalShortcuts) window.api.resumeGlobalShortcuts(); }}
      />
    </div>
    <div class="shortcut-container">
      <label for="show-shortcut">{lang.SHOW_SHORTCUT}:</label>
      <input
        id="show-shortcut"
        name="show-shortcut"
        bind:value={displayShow}
        readonly
        on:focus={() => focusInput('show')}
        on:click={() => focusInput('show')}
        on:blur={() => { activeInput = null; pressedKeys.clear(); if (window.api && window.api.resumeGlobalShortcuts) window.api.resumeGlobalShortcuts(); }}
      />
    </div>
  </div>
  <header>
    <h2 class="select-window">{lang.OPTIONS} &nbsp; <i class="fas fa-chevron-down"></i></h2>
  </header>
  <div class="options-container">
    <div class="shortcut-container">
      <label for="language">{lang.LANGUAGE}:</label>
      <select
      id="language" 
      name="language" 
      on:change={(e) => {
        config.language = e.target.value;
        dispatch('change');
      }}
      >
        {#each Object.entries(languages) as [langKey, langValue]}
          <option value={langKey} selected={config.language === langKey}>{langValue}</option>
        {/each}
      </select>
    </div>
    <div class="shortcut-container">
      <label for="font-size">{lang.FONT_SIZE}:</label>
      <select
      id="font-size" 
      name="font-size" 
      on:change={(e) => {
        config.fontSize = e.target.value;
        dispatch('change');
      }}
      >
        <option value="small" selected={config.fontSize === 'small'}>{lang.FONT_SIZE_SMALL || 'Small'}</option>
        <option value="medium" selected={config.fontSize === 'medium'}>{lang.FONT_SIZE_MEDIUM || 'Medium'}</option>
        <option value="large" selected={config.fontSize === 'large'}>{lang.FONT_SIZE_LARGE || 'Large'}</option>
        <option value="xlarge" selected={config.fontSize === 'xlarge'}>{lang.FONT_SIZE_XLARGE || 'Extra Large'}</option>
      </select>
    </div>
    <div class="shortcut-container">
      <label for="theme">{lang.THEME || 'Theme'}:</label>
      <select
      id="theme" 
      name="theme" 
      bind:value={config.theme}
      on:change={(e) => {
        // Make a copy for reactivity contract (Svelte does not track deep property mutation reliably)
        config = { ...config, theme: e.target.value };
        dispatch('change');
      }}
      >
        <option value="auto" selected={!config.theme || config.theme === 'auto'}>{lang.THEME_AUTO || 'Auto (System)'}</option>
        <option value="light" selected={config.theme === 'light'}>{lang.THEME_LIGHT || 'Light'}</option>
        <option value="dark" selected={config.theme === 'dark'}>{lang.THEME_DARK || 'Dark'}</option>
      </select>
    </div>
    <div class="shortcut-container">
      <label for="floating-button-mode">{lang.SHOW_EMERGENCY_BUTTON}:</label>
      <select
        id="floating-button-mode"
        name="floating-button-mode"
        bind:value={floatingButtonMode}
        on:change={(e) => setFloatingButtonMode(e.target.value)}
      >
        <option value="never">{lang.FLOATING_BUTTON_MODE_NEVER || 'Never'}</option>
        <option value="visible">{lang.FLOATING_BUTTON_MODE_VISIBLE || 'Only when visible'}</option>
        <option value="learning">{lang.FLOATING_BUTTON_MODE_LEARNING || 'Learning'}</option>
        <option value="always">{lang.FLOATING_BUTTON_MODE_ALWAYS || 'Always'}</option>
      </select>
    </div>
    <div class="shortcut-container">
      <label for="show-reveal-hints">{lang.SHOW_REVEAL_HINTS || 'Show reveal hints'}:</label>
      <input
        id="show-reveal-hints"
        name="show-reveal-hints"
        type="checkbox"
        checked={!config.revealHintDismissedForever}
        on:change={(e) => {
          config = { ...config, revealHintDismissedForever: !e.target.checked };
          dispatch('change');
        }}
      />
    </div>
    <div class="shortcut-container">
      <label for="startup">{lang.STARTUP}:</label>
      <input
      id="startup"
      name="startup"
      type="checkbox"
      checked={config.startup}
      disabled={startupTaskState === 'DisabledByUser' || startupTaskState === 'DisabledByPolicy'}
      on:change={async (e) => {
        config.startup = e.target.checked;
        if (isStoreInstallLocal && window.api && window.api.setStartup) {
          const result = await window.api.setStartup(e.target.checked);
          if (result && result.startupTaskState) {
            startupTaskState = result.startupTaskState;
            config.startup = result.startupTaskState === 'Enabled' || result.startupTaskState === 'EnabledByPolicy';
          }
        } else {
          dispatch('change');
        }
      }}
      />
    </div>
    {#if startupTaskState === 'DisabledByUser'}
    <div class="shortcut-container startup-disabled-notice">
      <span style="font-size:0.85em; opacity:0.75;">
        {lang.STARTUP_DISABLED_BY_USER || 'Disabled in Windows settings.'}&nbsp;
        <button class="link-button" on:click={() => window.api && window.api.launchUrl && window.api.launchUrl('ms-settings:startupapps')}>
          {lang.OPEN_STARTUP_SETTINGS || 'Open Startup Settings'}
        </button>
      </span>
    </div>
    {/if}
    <div class="shortcut-container">
      <label for="hide-system-windows">{lang.HIDE_SYSTEM_WINDOWS}:</label>
      <input
      id="hide-system-windows" 
      name="hide-system-windows" 
      type="checkbox" 
      checked={config.hideSystemWindows} 
      on:change={(e) => {
        config.hideSystemWindows = e.target.checked;
        dispatch('change');
      }}
      />
    </div>
    <div class="shortcut-container">
      <label for="password">{lang.PASSWORD}:</label>
      {config.password ? config.password.replace(/./g, '*').slice(0, 4) : '-'}
      &nbsp;&nbsp;
      <button type="button" class="set-password" class:disabled={!visible || !isPro} title={!isPro ? (lang.PRO_FEATURE) : (visible ? lang.SET_PASSWORD : lang.CANNOT_CHANGE_PASSWORD)} on:click={() => {
        if (!isPro) {
          showProModalFeature('passwordProtection', lang.PASSWORD || 'Password protection');
          return;
        }
        if (visible) {
          window.api.send('set-password');
        }
      }}><i class="fas fa-key" aria-hidden="true"></i> {lang.SET_PASSWORD}</button>
      {#if !isPro}
        <span class="pro-indicator" on:click={() => showProModalFeature('passwordProtection', lang.PASSWORD || 'Password protection')} on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showProModalFeature('passwordProtection', lang.PASSWORD || 'Password protection'); } }} role="button" tabindex="0" title={lang.PRO_FEATURE}><i class="fas fa-star" aria-hidden="true"></i>&nbsp;{lang.PRO_FEATURE}</span>
      {/if}
    </div>
    <div class="shortcut-container">
      <label for="run-high-priority">{lang.RUN_HIGH_PRIORITY}:</label>
      <input
      id="run-high-priority" 
      name="run-high-priority" 
      type="checkbox" 
      checked={config.runHighPriority} 
      disabled={!isPro}
      on:change={(e) => {
        if (!isPro) {
          showProModalFeature('runHighPriority', lang.RUN_HIGH_PRIORITY || 'Run high priority');
          return;
        }
        config.runHighPriority = e.target.checked;
        dispatch('change');
      }}
      on:click={() => { if (!isPro) showProModalFeature('runHighPriority', lang.RUN_HIGH_PRIORITY || 'Run high priority'); }}
      />
      {#if !isPro}
        <span class="pro-indicator" on:click={() => showProModalFeature('runHighPriority', lang.RUN_HIGH_PRIORITY || 'Run high priority')} on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showProModalFeature('runHighPriority', lang.RUN_HIGH_PRIORITY || 'Run high priority'); } }} role="button" tabindex="0" title={lang.PRO_FEATURE}><i class="fas fa-star" aria-hidden="true"></i>&nbsp;{lang.PRO_FEATURE}</span>
      {/if}
    </div>
    <div class="shortcut-container">
      <label for="mute-windows">{lang.MUTE_WINDOWS}:</label>
      <input
      id="mute-windows" 
      name="mute-windows" 
      type="checkbox" 
      checked={config.muteWindows} 
      disabled={!visible || !isPro}
      on:change={(e) => {
        if (!isPro) {
          showProModalFeature('muteWindows', lang.MUTE_WINDOWS || 'Mute windows when hidden');
          return;
        }
        config.muteWindows = e.target.checked;
        dispatch('change');
      }}
      on:click={() => { if (!isPro) showProModalFeature('muteWindows', lang.MUTE_WINDOWS || 'Mute windows when hidden'); }}
      />
      {#if !isPro}
        <span class="pro-indicator" on:click={() => showProModalFeature('muteWindows', lang.MUTE_WINDOWS || 'Mute windows when hidden')} on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showProModalFeature('muteWindows', lang.MUTE_WINDOWS || 'Mute windows when hidden'); } }} role="button" tabindex="0" title={lang.PRO_FEATURE}><i class="fas fa-star" aria-hidden="true"></i>&nbsp;{lang.PRO_FEATURE}</span>
      {/if}
    </div>
    <div class="shortcut-container">
      <label for="cloak-enabled">{lang.CLOAKING_LABEL || 'Cloaking'}:</label>
      <input
        id="cloak-enabled"
        name="cloak-enabled"
        type="checkbox"
        checked={config.cloakEnabled || false}
        disabled={!isPro}
        on:change={(e) => {
          if (!isPro) {
            showProModalFeature('cloaking', lang.CLOAKING_LABEL || 'Cloaking');
            e.target.checked = false;
            return;
          }
          config.cloakEnabled = e.target.checked;
          handleCloakToggle();
        }}
        on:click={() => { if (!isPro) showProModalFeature('cloaking', lang.CLOAKING_LABEL || 'Cloaking'); }}
      />
      <span class="setting-description">{lang.CLOAKING_DESC || 'Hide app identity with custom name and icon'}</span>
      {#if !isPro}
        <span class="pro-indicator" on:click={() => showProModalFeature('cloaking', lang.CLOAKING_LABEL || 'Cloaking')} on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showProModalFeature('cloaking', lang.CLOAKING_LABEL || 'Cloaking'); } }} role="button" tabindex="0" title={lang.PRO_FEATURE}><i class="fas fa-star" aria-hidden="true"></i>&nbsp;{lang.PRO_FEATURE}</span>
      {/if}
    </div>
    {#if config.cloakEnabled}
      <div class="shortcut-container">
        <label for="cloak-name">{lang.CUSTOM_NAME || 'Custom Name'}:</label>
        <input
          id="cloak-name"
          name="cloak-name"
          type="text"
          value={config.cloakName || ''}
          placeholder="e.g., Calculator, Notepad"
          disabled={!isPro}
          on:input={(e) => {
            if (!isPro) {
              showProModalFeature('cloaking', lang.CLOAKING_LABEL || 'Cloaking');
              return;
            }
            config.cloakName = e.target.value;
            handleCloakNameChange();
          }}
        />
        {#if !isPro}
          <span class="pro-indicator" on:click={() => showProModalFeature('cloaking', lang.CLOAKING_LABEL || 'Cloaking')} on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showProModalFeature('cloaking', lang.CLOAKING_LABEL || 'Cloaking'); } }} role="button" tabindex="0" title={lang.PRO_FEATURE}><i class="fas fa-star" aria-hidden="true"></i>&nbsp;{lang.PRO_FEATURE}</span>
        {/if}
      </div>
      <div class="shortcut-container">
        <label for="cloak-icon">{lang.CUSTOM_ICON || 'Custom Icon'}:</label>
        <div class="icon-selector">
          {#if cloakIconPreview}
            <img src={cloakIconPreview} alt="Cloak Icon Preview" class="icon-preview" />
          {/if}
          <button type="button" on:click={selectCloakIcon} disabled={!isPro}>{lang.SELECT_ICON_IMAGE || 'Select Icon Image'}</button>
          {#if config.cloakIconPath}
            <button type="button" on:click={clearCloakIcon} disabled={!isPro}>{lang.CLEAR || 'Clear'}</button>
          {/if}
        </div>
        <span class="setting-description">{lang.SELECT_IMAGE_DESC || 'Select any image file. It will be automatically resized and formatted.'}</span>
        {#if !isPro}
          <span class="pro-indicator" on:click={() => showProModalFeature('cloaking', lang.CLOAKING_LABEL || 'Cloaking')} on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showProModalFeature('cloaking', lang.CLOAKING_LABEL || 'Cloaking'); } }} role="button" tabindex="0" title={lang.PRO_FEATURE}><i class="fas fa-star" aria-hidden="true"></i>&nbsp;{lang.PRO_FEATURE}</span>
        {/if}
      </div>
    {/if}
    <div class="shortcut-container">
      <label for="restore">{lang.RESTORE || 'Restore'}:</label>
      <button id="restore" type="button" on:click={handleRestoreDefaults}>
        {lang.RESTORE || 'Restore'}
      </button>
    </div>
  </div>
</div>

<!-- global window listeners are registered in onMount with capture to better catch F-keys -->

<style>
  .options-container {
    border-radius: 1vmin;
    overflow: hidden;
  }
  input, select {
    background: ButtonFace;
    border-radius: 6px;
    border-width: 0;
    padding: 4px;
  }
  .options-container label {
      display: flex;
      align-items: center;
  }
  .shortcut-container {
    background: linear-gradient(to bottom, rgba(255, 255, 255, 0.25), rgba(255, 255, 255, 0.2));
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    border-bottom: 1px solid rgba(0, 0, 0, 0.1);
    display: flex;
    padding: 1vmin;
    align-items: center;
    color: var(--main-font-color);
  }
  .shortcut-container label {
    min-width: 30vw;
  }
  .setting-description {
    font-size: 0.85rem;
    color: var(--default-font-color);
    opacity: 0.7;
    margin-left: 1vmin;
  }
  .icon-selector {
    display: flex;
    align-items: center;
    gap: 1vmin;
  }
  .icon-preview {
    width: 32px;
    height: 32px;
    object-fit: contain;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.1);
    padding: 2px;
  }
  #shortcut-setter-instructions {
    line-height: 100%;
    margin-bottom: 2.5vmin;
  }
  .set-password {
    text-decoration: none;
    background: none;
    border: none;
    cursor: pointer;
    font-size: inherit;
    font-family: inherit;
    color: inherit;
  }
  
  .set-password.disabled {
    color: #666666;
    cursor: not-allowed;
    opacity: 0.5;
  }
  
  .set-password.disabled:hover {
    color: #666666;
  }
  
  .pro-indicator {
    color: #EEEEEE;
    background: linear-gradient(135deg, #0291c6 0%, #8200de 100%);
    font-size: 0.8rem;
    margin-left: 8px;
    font-weight: 500;
    cursor: pointer;
    transition: opacity 0.2s;
    border-radius: 6px;
    display: inline-flex;
    align-items: center;
    padding: 4px 8px;
  }
  
  .pro-indicator:hover {
    opacity: 0.8;
  }
  
  .pro-indicator:active {
    opacity: 0.6;
  }

  /* Estilos para o sistema freemium */
  .shortcut-setter-header {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 12px;
  }

  .pro-status {
    display: flex;
    flex-grow: 1;
    justify-content: end;
  }
  
  .pro-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    background: linear-gradient(135deg, #0291c6 0%, #8200de 100%);
    color: #EEEEEE;
    border-radius: 20px;
    font-size: 0.85rem;
    font-weight: 600;
    text-shadow: none;
    cursor: pointer;
    user-select: none;
  }

  .pro-badge-store {
    cursor: default;
    opacity: 0.9;
  }

  .pro-badge:focus {
    outline: 2px solid rgba(0, 0, 0, 0.35);
    outline-offset: 2px;
  }
  
  .pro-badge i {
    color: #FFFFFF;
  }
  
  .upgrade-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    background: linear-gradient(135deg, #0291c6 0%, #8200de 100%);
    color: #EEEEEE;
    border: none;
    border-radius: 26px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }
  
  .upgrade-btn:hover {
    transform: translateY(-1px);
  }
</style>
