<script>
  import { onMount, onDestroy } from 'svelte';
  export let lang;
  export let processes;
  export let viewFilter;
  export let viewFilterCaseSensitive;
  export let filters;

  import { createEventDispatcher } from 'svelte';
  const dispatch = createEventDispatcher();

  let selectedFilter = null;
  let clickTimer = null;
  
  function formatFilter(filter) {
    return {
      value: filter.value || filter.className,
      type: 'className',
      icon: filter.icon,
      hwnd: filter.hwnd,
      className: filter.className,
      process: filter.process
    }
  }
    
  function handleDragStart(event, info) {
    if (!event || !event.dataTransfer) {
      console.error('Invalid event in handleDragStart:', event);
      return;
    }
    event.dataTransfer.setData('text/plain', JSON.stringify(formatFilter(info)));
  }

  function handleFilterClick(_class, index) {
    if (clickTimer) {
      clearTimeout(clickTimer);
      clickTimer = null;
      selectedFilter = _class;
      clickTimer = setTimeout(() => {
        clickTimer = null;
        dispatch('filter-selected', formatFilter(_class));
      }, 50);
    } else {
      selectedFilter = _class;
      clickTimer = setTimeout(() => {
        clickTimer = null;
      }, 300);
    }
  }

  function handleFilterDoubleClick(_class) {
    clearTimeout(clickTimer);
    clickTimer = null;
    dispatch('filter-selected', formatFilter(_class));
  }

  function viewFilterAllow(_class) {
    const compare = (a, b) => {
      if (viewFilterCaseSensitive) {
        return a.includes(b);
      }
      return a.toLowerCase().includes(b.toLowerCase());
    }
    return _class && (!viewFilter || compare(_class, viewFilter)) && !filterMatch(_class)
  }

  function filterMatch(_class) {
    return filters.filter(filter => filter.type === 'className').some(filter => _class.includes(filter.value))
  }

  function unique(array, key) {
    // Create a map to preserve all properties when deduplicating
    const map = new Map();
    array.forEach(item => {
      const keyValue = item[key];
      if (!map.has(keyValue)) {
        map.set(keyValue, item);
      } else {
        // If we already have an item with this key, prefer the one with HWND
        const existing = map.get(keyValue);
        if (!existing.hwnd && item.hwnd) {
          map.set(keyValue, item);
        }
      }
    });
    let ret = Array.from(map.values());
    ret.sort((a, b) => a[key].localeCompare(b[key]));
    return ret;
  }

  function iconFailure(e, process) {
    const img = e && e.target;
    if (!img) return;
    const originalSrc = img.getAttribute('src') || img.src || '';
    window.api.iconFailure(process, originalSrc).catch(e => console.error(e)).finally(() => {
      if (!img) return;
      img.setAttribute('src', originalSrc.split('?')[0] + '?retry=' + Date.now());
    });
  }

  onDestroy(() => {
    if (clickTimer) clearTimeout(clickTimer);
  });
</script>

<div>
  <div id="classes">
    {#each unique(processes, 'className') as process}
      {#if viewFilterAllow(process.className)}
        <div
          draggable="true"
          role="button"
          tabindex="0"
          class:selected={selectedFilter === process.className}
          on:dblclick={() => handleFilterDoubleClick(process)}
          on:click={() => handleFilterClick(process)}
          on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleFilterClick(process); } }}
          on:dragstart={(e) => handleDragStart(e, process)}
        >
          <span title={process.className}>
            {#if process.icon}
              <img src="{process.icon}" alt="Icon for {process.className}" on:error={(e) => iconFailure(e, process)} />
            {/if}
            {process.className}
          </span>
          <button class="add-filter-plus" title={lang.ADD_FILTER} aria-label={`${lang.ADD_FILTER} ${process.className}`} on:click={() => handleFilterDoubleClick(process)}>
            <span><i class="fas fa-plus" aria-hidden="true"></i></span>
          </button>
        </div>
      {/if}
    {/each}
  </div>
</div>

<style>
  div#classes {
    border-radius: 6px;
    max-height: 100%;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  div#classes div {
    background: ButtonFace;
    line-height: 150%;
    display: flex;
    transition: all 0.2s ease;
    cursor: pointer;
    color: var(--main-font-color);
    border-bottom: 1px solid rgba(0,0,0,0.15);
    border-top: 1px solid rgba(255,255,255,0.1);
  }

  div#classes div:hover,
  div#classes div:active,
  div#classes div:focus {
    background: Highlight;
    color: HighlightText;
  }

  /* Estilo para item selecionado */
  div#classes div.selected {
    background: Highlight;
    color: HighlightText;
    border-left: 3px solid #4CAF50;
    padding-left: 12px;
    margin-left: -6px;
  }



  div#classes div button {
    background: none;
    border: none;
    cursor: pointer;
    color: ButtonText;
  }

  div#classes div span {
    flex-grow: 1;
    padding: 8px;
    display: flex;
    -webkit-line-clamp: 1;
    -webkit-box-orient: vertical;
    overflow: hidden;
    white-space: nowrap;
    mask-image: linear-gradient(to right, black calc(100% - 20px), transparent 100%);
    line-height: 175%;
    height: auto;
    align-content: center;
    flex-wrap: wrap;
  }

  div#classes div button span {
    font-size: 1.5rem;
    padding: 0 6px;
  }

  div#classes div span img {
    width: 16px;
    height: 16px;
    position: relative;
    top: 0.5vh;
    margin-right: 6px;
  }

  div#classes div button {
    padding: 2px 8px;
  }
</style>