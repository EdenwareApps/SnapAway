<script>
  export let lang;
  export let visible;
  export let config;

  import { createEventDispatcher, onMount } from 'svelte';
  const dispatch = createEventDispatcher();

  // Keep a reactive flag for whether windows are currently visible.
  // Using `visible` directly in the template ensures Svelte updates the UI correctly.
  $: isShowing = visible;

  let selectedFilter = null;
  let clickTimer = null;
  let showTooltip = false;

  // Log reativo para verificar mudanças no estado visible
  $: console.log('[TitleFilter] visible state changed to:', visible);

  // Listener para mudanças no caractere de máscara
  onMount(() => {
    const handleMaskCharChange = () => {
      console.log('[TitleFilter] Mask character changed, updating display');
      // Forçar reatividade do Svelte
      config = config;
    };

    const shakeListener = () => {
      const filtersEl = document.getElementById('filters');
      if (!filtersEl) return;
      filtersEl.classList.add('shake');
      setTimeout(() => filtersEl.classList.remove('shake'), 500);
    };
    
    window.addEventListener('maskCharChanged', handleMaskCharChange);
    window.addEventListener('shake-filters', shakeListener);

    if (window.api && window.api.onShakeFilters) {
      window.api.onShakeFilters(shakeListener);
    }
    
    return () => {
      window.removeEventListener('maskCharChanged', handleMaskCharChange);
      window.removeEventListener('shake-filters', shakeListener);
      // API cleanup not needed for onShakeFilters callback added via preload currently.
    };
  });

  // Função para mascarar o nome do filtro
  function maskName(name) {
    if (!name || name.length <= 2) return name;
    const first = name[0];
    const last = name[name.length - 1];
    // Usar o caractere de máscara configurado ou padrão &middot;
    const maskChar = config.maskChar || '&middot;';
    const dots = maskChar.repeat(name.length - 2);
    // Usar innerHTML no template para renderizar os caracteres de máscara
    return first + dots + last;
  }

  function formatFilter(filter, insensitive = false) {
    return {
      value: filter.value || filter.title,
      type: filter.type,
      icon: filter.icon,
      hwnd: filter.hwnd,
      process: filter.process,
      title: filter.title,
      insensitive: insensitive
    }
  }

  function handleDragStart(event, info) {
    console.log('handleDragStart', event, info);
    if (!event || !event.dataTransfer) {
      console.error('Invalid event in handleDragStart:', event);
      return;
    }
    event.dataTransfer.setData('text/plain', JSON.stringify(formatFilter(info)));
  }

  function handleFilterClick(filter) {
    if (clickTimer) {
      clearTimeout(clickTimer);
      clickTimer = null;
      selectedFilter = filter;
      clickTimer = setTimeout(() => {
        clickTimer = null;
        removeFilter(filter);
      }, 50);
    } else {
      selectedFilter = filter;
      clickTimer = setTimeout(() => {
        clickTimer = null;
      }, 300);
    }
  }

  function handleFilterDoubleClick(filter) {
    clearTimeout(clickTimer);
    clickTimer = null;
    removeFilter(filter);
  }

  function handleDrop(event, targetId) {
    console.log('handleDrop tfilter', event, targetId);
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
      dispatch('filter-selected', draggedInfo);
    } catch (error) {
      console.error('Error parsing drag data:', error);
    }
  }

  function removeFilter(filter) {
    // Bloquear remoção quando as janelas estão ocultas
    if (!isShowing) {
      console.log('[TitleFilter] Cannot remove filter while windows are hidden');
      return;
    }
    config.filters = config.filters.filter(f => f.value !== filter.value || f.type !== filter.type);
    dispatch('change');
  }

  // Função para adicionar filtro e ocultar imediatamente se necessário
  function addFilterAndHide(filter) {
    // Sempre permitir adicionar filtros
    dispatch('add-filter', filter);
    
    // Se as janelas estão ocultas, ocultar a nova janela imediatamente
    if (!visible) {
      console.log('[TitleFilter] Windows are hidden, hiding new window immediately');
      dispatch('hide-new-window', filter);
    }
  }

  function iconFailure(e, filter) {
    const img = e && e.target;
    if (!img) return;
    const originalSrc = img.getAttribute('src') || img.src || '';
    window.api.iconFailure(filter, originalSrc).catch(e => console.error(e)).finally(() => {
      if (!img) return;
      img.setAttribute('src', originalSrc.split('?')[0] + '?retry=' + Date.now());
    });
  }

  function protect() {
    // Se não houver filtros adicionados, não entra em hide-state; apenas feedback visual
    if (!config.filters || config.filters.length === 0) {
      const filtersEl = document.getElementById('filters');
      if (filtersEl) {
        filtersEl.classList.add('shake');
        setTimeout(() => filtersEl.classList.remove('shake'), 500);
      }
      return;
    }

    window.api.send('floating-button-clicked');
  }

  function restore() {
    // Use a dedicated restore event so the main process knows we want to show (not hide).
    window.api.send('floating-button-restore');
  }
</script>

<div>
    {#if isShowing}
      <h2>
        <span>
          {lang.WHAT_WILL_BE_PROTECTED}
        </span>
        <span style="position: relative;">
          <button title={lang.PROTECT} id="protect-key" on:click={() => protect()}>
            <span style="position: relative;top: -1px;left: 3px;margin-right: 3px">{lang.PROTECT}</span>
          </button>
          <div id="protect-notification-badge" style="display: none;">
            <span id="protect-count">0</span>
          </div>
        </span>
      </h2>
    {:else}
      <h2>
        <span>
          {lang.WHAT_IS_PROTECTED}
        </span>
        <span style="position: relative;">
          <button title={lang.RESTORE} id="protect-key" on:click={() => restore()}>
            <span style="position: relative;top: -1px;left: 3px;margin-right: 3px">{lang.RESTORE}</span>
          </button>
          <div id="protect-notification-badge" style="display: none;">
            <span id="protect-count">0</span>
          </div>
        </span>
      </h2>
    {/if}
    <span class="inline-tooltip protect-instructions {showTooltip ? 'inline-tooltip-show' : 'inline-tooltip-hide'}">
      <span>
        <span>
          {lang?.HOW_TO_PROTECT_INSTRUCTIONS?.replace('{0}', config.hideKey).replace('{1}', config.showKey)}
        </span>
        <button style="margin-right: 1vmin;" title={lang.OPTIONS} on:click={() => {dispatch('go-options');showTooltip = false}}>
          <i class="fas fa-cog"></i> {lang.OPTIONS}
        </button>
        <button title="OK" on:click={() => {showTooltip = false}}>
          <i class="fas fa-check"></i> OK
        </button>
      </span>
    </span>
    <!-- svelte-ignore a11y-no-static-element-interactions --><div id="filters" role="region" on:dragover={(e) => e.preventDefault()} on:drop={(e) => handleDrop(e, 'filters')}>
      {#each config.filters as filter, index}
        <div
          role="button"
          tabindex="0"
          aria-label={`${filter.type} filter ${filter.value}`}
          draggable="true"
          class:selected={selectedFilter && selectedFilter.value === filter.value && selectedFilter.type === filter.type}
          on:dblclick={() => handleFilterDoubleClick(filter)}
          on:click={() => handleFilterClick(filter)}
          on:keydown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleFilterClick(filter);
            }
          }}
          on:dragstart={(e) => handleDragStart(e, filter)}
        >
          {#if filter.icon && isShowing}
            <img src="{filter.icon}" on:error={(e) => iconFailure(e, filter)} alt="" />&nbsp;
          {:else if !isShowing}
            <i class="fas fa-shield-alt" style="width: 16px;height: 16px;position: relative;top: 0.5vh;color: #3fb49f;" aria-hidden="true"></i>&nbsp;
          {/if}
          <span>
            {#if isShowing}
              {filter.value}
            {:else}
              {@html maskName(filter.value)}
            {/if}
          </span>
          <button 
            title={isShowing ? lang.REMOVE_FILTER : 'Cannot remove while protected'} 
            on:click={() => removeFilter(filter)}
            class:disabled={!isShowing}
            disabled={!isShowing}
          >&#x2715;</button>
        </div>
      {/each}
      {#if config.filters.length == 0}
        <div class="no-filters">
          <span>
            {lang.NO_FILTERS}
          </span>
        </div>
      {/if}
    </div>
    <br />
</div>

<style>
  h2 {
    display: flex;
    flex-direction: row;
    justify-content: space-between;
  }

  div#filters {
    display: flex;
    flex-direction: column;
    border-radius: 6px;
    overflow: hidden;
  }

  div#filters div {
    background: ButtonFace;
    color: ButtonText;
    line-height: 150%;
    padding: 6px;
    transition: all 0.4s ease 0s;
    cursor: pointer;
    display: flex;
    flex-direction: row;
    justify-content: space-between;
    color: var(--main-font-color);
    border-bottom: 1px solid rgba(0,0,0,0.15);
    border-top: 1px solid rgba(255,255,255,0.1);
    align-items: center;
  }
  
  div#filters div span {
    flex-grow: 1;
    align-items: center;
    display: flex;
    margin-left: 6px;
    overflow: hidden;
    white-space: nowrap;
    mask-image: linear-gradient(to right, black calc(100% - 20px), transparent 100%);
  }

  div#filters div:hover,
  div#filters div:active,
  div#filters div:focus {
    background: Highlight;
    color: HighlightText;
  }

  div#filters div.selected {
    background: Highlight;
    color: HighlightText;
  }

  div#filters div.selected:hover,
  div#filters div.selected:active,
  div#filters div.selected:focus {
    background: Highlight;
    color: HighlightText;
  }

  div#filters div button {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 1rem;
    font-weight: bold;
    color: ButtonText;
  }

  div#filters div button.disabled {
    color: #555;
    cursor: not-allowed;
    opacity: 0.5;
  }

  div#filters div button.disabled:hover {
    color: #555;
    opacity: 0.5;
  }

  div#filters div img {
    width: 16px;
    height: 16px;
  }

  .no-filters {
    text-align: center;
  }

  .no-filters span {
    justify-content: center;
  }

  .inline-tooltip {
    transition: all 0.2s ease;
    display: flex;
  }

  .inline-tooltip > span {
    color: var(--main-font-color);
  }

  .inline-tooltip > span {    
    background: linear-gradient(to top, #47355b, #37648c);
    display: flex;
    line-height: 150%;
    padding: 1.5vmin;
    border-radius: 6px;
    margin-bottom: 3.5vmin;
  }

  .inline-tooltip button {
    background: rgba(0,0,50,0.1);
    border-width: 0;
    border-radius: 6px;
    cursor: pointer;
  }

  .inline-tooltip-show {
    height: auto;
    opacity: 1;
    pointer-events: auto;
  }

  .inline-tooltip-hide {
    height: 0;
    opacity: 0;
    pointer-events: none;
  }

  #protect-key {    
    border-radius: 9px;
    padding: 3px 11px;
    cursor: pointer;
    font-size: inherit;
    font-family: inherit;
    font-weight: inherit;
  }

</style>

