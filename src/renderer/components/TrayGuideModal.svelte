<script>
  // Guia por-app: como ocultar o ícone da bandeja de aplicativos de terceiros.
  // O Windows não expõe API para um app ocultar o ícone de bandeja de outro app;
  // este guia lista as formas nativas recomendadas (universal + por-app).
  import { createEventDispatcher } from 'svelte';
  const dispatch = createEventDispatcher();

  export let lang = {};

  function t(key, fallback) {
    return (lang && lang[key]) || fallback || key;
  }

  function closeModal() {
    dispatch('close');
  }
</script>

<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
<div class="modal-overlay" role="dialog" aria-modal="true" tabindex="-1" on:click={closeModal} on:keydown={(e) => { if (e.key === 'Escape') closeModal(); }}>
  <!-- svelte-ignore a11y-no-static-element-interactions --><div class="modal-content" role="document" tabindex="-1" on:click|stopPropagation on:keydown={(e) => { if (e.key !== 'Escape') e.stopPropagation(); }}>
    <div class="modal-header">
      <h2><i class="fas fa-inbox" aria-hidden="true"></i>&nbsp; {t('TRAY_GUIDE_TITLE', 'Hide tray icons')}</h2>
      <button class="close-button" on:click={closeModal} aria-label="Close">&times;</button>
    </div>

    <div class="modal-body">
      <p class="intro">{t('TRAY_GUIDE_INTRO', 'SnapAway hides an app\u2019s windows, but some apps keep their own icon in the system tray. Windows does not allow one app to hide another app\u2019s tray icon, so here are the recommended ways.')}</p>

      <section>
        <h3><i class="fas fa-th" aria-hidden="true"></i>&nbsp; {t('TRAY_GUIDE_UNIVERSAL_TITLE', 'Universal: hide any app into the overflow area')}</h3>
        <ol class="steps">
          <li>{t('TRAY_GUIDE_UNIVERSAL_STEP1', 'Click the chevron (^) next to the clock to open the hidden-icons area.')}</li>
          <li>{t('TRAY_GUIDE_UNIVERSAL_STEP2', 'Drag the app\u2019s icon from the taskbar into the overflow area \u2014 or')}</li>
          <li>{t('TRAY_GUIDE_UNIVERSAL_STEP3', 'Right-click the taskbar \u2192 Taskbar settings \u2192 Taskbar corner overflow \u2192 turn the app OFF.')}</li>
        </ol>
        <p class="note">{t('TRAY_GUIDE_UNIVERSAL_NOTE', 'This works for any app, no matter what. The icon stops showing next to the clock and moves to the hidden overflow.')}</p>
      </section>

      <section>
        <h3><i class="fas fa-list-ul" aria-hidden="true"></i>&nbsp; {t('TRAY_GUIDE_APPS_TITLE', 'Apps with a native option to hide their tray icon')}</h3>
        <ul class="apps">
          <li><strong>Telegram Desktop</strong> — {t('TRAY_GUIDE_APPS_TELEGRAM', 'Settings \u2192 Advanced \u2192 untick \u201cKeep tray icon\u201d.')}</li>
        </ul>
        <p class="note">{t('TRAY_GUIDE_APPS_NOTE', 'Apps without a native option (Discord, Slack, WhatsApp, etc.): use the universal method above.')}</p>
      </section>

      <p class="snapaway-note">
        <i class="fas fa-info-circle" aria-hidden="true"></i>&nbsp;
        {t('TRAY_GUIDE_SNAPAWAY_NOTE', 'SnapAway\u2019s own tray icon can be hidden automatically with the \u201cHide tray icon when hidden\u201d option (Pro).')}
      </p>
    </div>

    <div class="modal-footer">
      <button class="primary-button" on:click={closeModal}>{t('TRAY_GUIDE_CLOSE', 'Close')}</button>
    </div>
  </div>
</div>

<style>
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 1000;
  }

  .modal-content {
    background: var(--background-color, #2d3748);
    border-radius: 12px;
    max-width: 520px;
    width: 92%;
    max-height: 90vh;
    overflow-y: auto;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
    color: var(--main-font-color, #e2e8f0);
    scrollbar-width: thin;
    scrollbar-color: var(--border-color, #4a5568) transparent;
  }

  .modal-content::-webkit-scrollbar { width: 8px; }
  .modal-content::-webkit-scrollbar-thumb {
    background: var(--border-color, #4a5568);
    border-radius: 4px;
    border: 2px solid transparent;
    background-clip: padding-box;
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 18px 24px;
    border-bottom: 1px solid var(--border-color, #4a5568);
  }

  .modal-header h2 { margin: 0; color: #ffffff; font-size: 1.35rem; }

  .close-button {
    background: none;
    border: none;
    font-size: 24px;
    color: #e2e8f0;
    cursor: pointer;
    padding: 0;
    width: 30px;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    transition: background-color 0.2s;
    line-height: 30px;
  }
  .close-button:hover { background: var(--hover-color, #4a5568); }

  .modal-body { padding: 16px 24px; }

  .intro { margin: 0 0 14px 0; line-height: 1.45; }

  section { margin-bottom: 14px; }
  section h3 {
    margin: 0 0 8px 0;
    font-size: 1rem;
    color: #ffffff;
  }

  .steps { margin: 0 0 8px 0; padding-left: 20px; line-height: 1.45; }
  .steps li { margin-bottom: 4px; }

  .apps { margin: 0 0 8px 0; padding-left: 20px; line-height: 1.45; }
  .apps li { margin-bottom: 4px; }

  .note {
    font-size: 0.9rem;
    opacity: 0.8;
    margin: 6px 0 0 0;
    line-height: 1.4;
  }

  .snapaway-note {
    margin: 12px 0 0 0;
    padding: 10px 12px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid var(--border-color, #4a5568);
    font-size: 0.9rem;
    line-height: 1.4;
  }

  .modal-footer {
    padding: 14px 24px 20px 24px;
    border-top: 1px solid var(--border-color, #4a5568);
    text-align: right;
  }

  .primary-button {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    border: none;
    color: #ffffff;
    padding: 10px 22px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 1rem;
    font-family: inherit;
    transition: filter 0.2s;
  }
  .primary-button:hover { filter: brightness(1.1); }
</style>
