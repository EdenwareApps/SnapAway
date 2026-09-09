<script>
  // Modal de pedido de avaliação (review) da Microsoft Store.
  // Aparece apenas quando o main detecta usuário engajado (ver review-prompt.js)
  // e envia o evento 'show-review-prompt' para o renderer.
  import { createEventDispatcher } from 'svelte';
  const dispatch = createEventDispatcher();

  export let lang = {};
  export let busy = false;

  function t(key, fallback) {
    return (lang && lang[key]) || fallback || key;
  }

  function closeModal() {
    dispatch('close');
  }

  function rateNow() {
    if (busy) return;
    dispatch('rate');
  }

  function later() {
    dispatch('later');
  }

  function never() {
    dispatch('never');
  }
</script>

<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
<div class="modal-overlay" role="dialog" aria-modal="true" tabindex="-1" on:click={closeModal} on:keydown={(e) => { if (e.key === 'Escape') closeModal(); }}>
  <!-- svelte-ignore a11y-no-static-element-interactions --><div class="modal-content" role="document" tabindex="-1" on:click|stopPropagation on:keydown={(e) => { if (e.key !== 'Escape') e.stopPropagation(); }}>
    <div class="modal-header">
      <h2><i class="fas fa-star" aria-hidden="true"></i>&nbsp; {t('REVIEW_TITLE', 'Enjoying SnapAway?')}</h2>
      <button class="close-button" on:click={closeModal} aria-label="Close">&times;</button>
    </div>

    <div class="modal-body">
      <div class="stars" aria-hidden="true">
        <i class="fas fa-star"></i>
        <i class="fas fa-star"></i>
        <i class="fas fa-star"></i>
        <i class="fas fa-star"></i>
        <i class="fas fa-star"></i>
      </div>
      <p class="intro">{t('REVIEW_BODY', 'Your rating helps others discover SnapAway and keeps us motivated to improve it. It only takes a minute.')}</p>
    </div>

    <div class="modal-footer">
      <button class="never-button" on:click={never}>{t('REVIEW_NEVER', "Don't ask again")}</button>
      <span class="footer-spacer"></span>
      <button class="secondary-button" on:click={later} disabled={busy}>{t('REVIEW_LATER', 'Not now')}</button>
      <button class="primary-button" on:click={rateNow} disabled={busy}>
        {busy ? (t('REVIEW_OPENING', 'Opening Microsoft Store\u2026')) : (t('REVIEW_RATE_NOW', 'Rate SnapAway'))}
      </button>
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
    max-width: 460px;
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

  .modal-header h2 { margin: 0; color: #ffffff; font-size: 1.3rem; }
  .modal-header h2 i { color: #f6ad55; }

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

  .modal-body { padding: 20px 24px 8px 24px; text-align: center; }

  .stars { margin-bottom: 12px; color: #f6ad55; font-size: 1.6rem; letter-spacing: 6px; }
  .stars i { filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.3)); }

  .intro { margin: 0; line-height: 1.5; color: var(--main-font-color, #e2e8f0); }

  .modal-footer {
    display: flex;
    align-items: center;
    padding: 14px 24px 20px 24px;
    border-top: 1px solid var(--border-color, #4a5568);
  }

  .footer-spacer { flex: 1; }

  .primary-button {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    border: none;
    color: #ffffff;
    padding: 10px 18px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 0.95rem;
    font-family: inherit;
    transition: filter 0.2s, opacity 0.2s;
    white-space: nowrap;
  }
  .primary-button:hover:not(:disabled) { filter: brightness(1.1); }
  .primary-button:disabled { opacity: 0.7; cursor: default; }

  .secondary-button {
    background: transparent;
    border: 1px solid var(--border-color, #4a5568);
    color: var(--main-font-color, #e2e8f0);
    padding: 9px 16px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 0.95rem;
    font-family: inherit;
    margin-right: 10px;
    transition: background-color 0.2s, opacity 0.2s;
    white-space: nowrap;
  }
  .secondary-button:hover:not(:disabled) { background: rgba(255, 255, 255, 0.08); }
  .secondary-button:disabled { opacity: 0.7; cursor: default; }

  .never-button {
    background: none;
    border: none;
    padding: 8px 4px;
    color: var(--main-font-color, #e2e8f0);
    opacity: 0.72;
    font-size: 0.85rem;
    font-family: inherit;
    cursor: pointer;
    text-decoration: underline;
    transition: opacity 0.2s;
    white-space: nowrap;
  }
  .never-button:hover:not(:disabled) { opacity: 1; }
</style>
