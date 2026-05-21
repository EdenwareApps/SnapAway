<script>
  import { onMount, onDestroy } from 'svelte';
  export let lang;
  export let viewFilter;
  export let viewFilterCaseSensitive;
  export let processes;
  export let filters;
  import { createEventDispatcher } from 'svelte';
  const dispatch = createEventDispatcher();

  let selectedFilter = null;
  let clickTimer = null;  
  let previousProcessCount = 0;
  let killingProcesses = {};
  
  // Debug: Log sample process when processes array changes
  $: if (processes && processes.length > 0 && processes.length !== previousProcessCount) {
    console.log('[TitleList] processes sample:', JSON.stringify(processes[0]));
    previousProcessCount = processes.length;
  }
    
  function handleDragStart(event, info) {
    console.log('handleDragStart', event, info);
    if (!event || !event.dataTransfer) {
      console.error('Invalid event in handleDragStart:', event);
      return;
    }
    event.dataTransfer.setData('text/plain', JSON.stringify(info));
  }

  function handleFilterClick(filter) {
    console.log('[TitleList] handleFilterClick - filter object:', JSON.stringify(filter));
    console.log('[TitleList] handleFilterClick - filter.hwnd:', filter.hwnd);
    console.log('[TitleList] handleFilterClick - filter has hwnd property:', 'hwnd' in filter);
    
    if (clickTimer) {
      // Se houver um timer ativo, é um duplo clique
      clearTimeout(clickTimer);
      clickTimer = null;
      selectedFilter = filter;
      clickTimer = setTimeout(() => {
        clickTimer = null;
        const filterData = {value: filter.title, icon: filter.icon, type: 'title', hwnd: filter.hwnd, title: filter.title, process: filter.process};
        console.log('[TitleList] Dispatching filter-selected with data:', filterData);
        dispatch('filter-selected', filterData);
      }, 50);
    } else {
      // Primeiro clique: inicia o timer
      selectedFilter = filter;
      clickTimer = setTimeout(() => {
        clickTimer = null;
      }, 300); // Ajuste o tempo conforme necessário
    }
  }

  function handleFilterDoubleClick(filter) {
    console.log('[TitleList] handleFilterDoubleClick - filter object:', JSON.stringify(filter));
    console.log('[TitleList] handleFilterDoubleClick - filter.hwnd:', filter.hwnd);
    clearTimeout(clickTimer);
    clickTimer = null;
    const filterData = {value: filter.title, icon: filter.icon, type: 'title', hwnd: filter.hwnd, title: filter.title, process: filter.process};
    console.log('[TitleList] Dispatching filter-selected with data:', JSON.stringify(filterData));
    dispatch('filter-selected', filterData);
  }

  function viewFilterAllow(process) {
    const compare = (a, b) => {
      if (viewFilterCaseSensitive) {
        return a.includes(b);
      }
      return a.toLowerCase().includes(b.toLowerCase());
    }
    return process.title && (!viewFilter || compare(process.title, viewFilter)) && !filterMatch(process)
  }

  function filterMatch(process) {
    return filters.filter(filter => filter.type === 'title').some(filter => process && process.title.includes(filter.value))
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

  async function handleKillProcess(event, process) {
    event.stopPropagation();
    event.preventDefault();

    if (!window.api || !window.api.killProcess) {
      console.error('[TitleList] killProcess API not available');
      return;
    }

    if (killingProcesses[process.process]) return;

    killingProcesses[process.process] = true;
    killingProcesses = killingProcesses;

    try {
      const result = await window.api.killProcess(process.process);
      if (!result.success) {
        console.error('[TitleList] Failed to kill process:', result.message);
        delete killingProcesses[process.process];
        killingProcesses = killingProcesses;
      } else {
        console.log('[TitleList] Process killed successfully:', process.process);
      }
    } catch (error) {
      console.error('[TitleList] Error killing process:', error);
      delete killingProcesses[process.process];
      killingProcesses = killingProcesses;
    }
  }

  function isKilling(processName) {
    return !!killingProcesses[processName];
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

  // Limpa o timer ao destruir o componente
  onDestroy(() => {
    if (clickTimer) clearTimeout(clickTimer);
  });
</script>

<div>
  <div id="titles">
    {#each processes as process}
      {#if viewFilterAllow(process)}
        <div
          draggable="true"
          class:selected={selectedFilter === process}
          tabindex="0"
          role="button"
          aria-label={`Select ${process.title}`}
          on:dblclick={() => handleFilterDoubleClick(process)}
          on:click={() => handleFilterClick(process)}
          on:keydown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleFilterClick(process);
            }
          }}
          on:dragstart={(e) => handleDragStart(e, process)}
        >         
          <span title={process.title}>
            {#if process.icon}
              <img src="{process.icon}" alt="Icon for {process.title}" on:error={(e) => iconFailure(e, process)} />
            {/if}
            {process.title}
          </span>
          <button class="add-filter-plus" title={lang.ADD_FILTER} aria-label={`${lang.ADD_FILTER} ${process.title}`} on:click={() => handleFilterDoubleClick(process)}>
            <span><i class="fas fa-plus" aria-hidden="true"></i></span>
          </button>
        </div>
      {/if}
    {/each}
  </div>
</div>

<style>
  div#titles {
    border-radius: 6px;
    max-height: 100%;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  div#titles div {
    background: ButtonFace;
    line-height: 150%;
    display: flex;
    transition: all 0.2s ease;
    cursor: pointer;
    color: ButtonText;
    border-bottom: 1px solid rgba(0,0,0,0.15);
    border-top: 1px solid rgba(255,255,255,0.1);
  }

  div#titles div:hover,
  div#titles div:active,
  div#titles div:focus {
    background: Highlight;
    color: HighlightText;
  }

  /* Estilo para item selecionado */
  div#titles div.selected {
    background: Highlight;
    color: HighlightText;
    border-left: 3px solid #4CAF50;
    padding-left: 12px;
    margin-left: -6px;
  }

  div#titles div button {
    background: none;
    border: none;
    cursor: pointer;
    color: ButtonText;
  }

  div#titles div span {
    padding: 8px;
    flex-grow: 1;
    display: flex;
    -webkit-line-clamp: 1;
    -webkit-box-orient: vertical;
    overflow: hidden;
    white-space: nowrap;
        mask-image: linear-gradient(to right, black calc(100% - 20px), transparent 100%);
    line-height: 150%;
    flex-direction: row;
    align-items: center;
  }

  div#titles div span img {
    width: 16px;
    height: 16px;
    position: relative;
    margin-right: 6px;
  }

  div#titles div button span {
    font-size: 1.5rem;
    padding: 0 6px;
  }

  @keyframes pulse {
    0%, 100% {
      opacity: 0.7;
    }
    50% {
      opacity: 1;
    }
  }
</style>