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
  let previousProcessCount = 0;
  let killingProcesses = {}; // Track processes being killed { processName: true }
  
  // Debug: Log sample process when processes array changes
  $: if (processes && processes.length > 0 && processes.length !== previousProcessCount) {
    console.log('[ProcessList] processes sample:', JSON.stringify(processes[0]));
    previousProcessCount = processes.length;
  }

  function formatFilter(filter) {
    return {
      value: filter.process,
      type: 'process',
      icon: filter.icon,
      process: filter.process,
      hwnd: filter.hwnd, // Adicionar HWND
      title: filter.title,
      className: filter.className,
      executable: filter.executable
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
    console.log('[ProcessList] handleFilterClick - filter object:', JSON.stringify(filter));
    console.log('[ProcessList] handleFilterClick - filter.hwnd:', filter.hwnd);
    console.log('[ProcessList] handleFilterClick - filter has hwnd property:', 'hwnd' in filter);
    
    if (clickTimer) {
      // Se houver um timer ativo, é um duplo clique
      clearTimeout(clickTimer);
      clickTimer = null;
      selectedFilter = filter;
      clickTimer = setTimeout(() => {
        clickTimer = null;
        const filterData = formatFilter(filter);
        console.log('[ProcessList] Dispatching filter-selected with data:', JSON.stringify(filterData));
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
    console.log('[ProcessList] handleFilterDoubleClick - filter object:', JSON.stringify(filter));
    console.log('[ProcessList] handleFilterDoubleClick - filter.hwnd:', filter.hwnd);
    clearTimeout(clickTimer);
    clickTimer = null;
    const filterData = formatFilter(filter);
    console.log('[ProcessList] Dispatching filter-selected with data:', JSON.stringify(filterData));
    dispatch('filter-selected', filterData);
  }

  function viewFilterAllow(process) {
    const compare = (a, b) => {
      if (viewFilterCaseSensitive) {
        return a.includes(b);
      }
      return a.toLowerCase().includes(b.toLowerCase());
    }
    return (!viewFilter || compare(process.process, viewFilter)) && !filterMatch(process)
  }

  function filterMatch(process) {
    return filters.filter(filter => filter.type === 'process').some(filter => process && process.process.includes(filter.value))
  }

  function normalizeToken(str) {
    if (!str || typeof str !== 'string') return '';
    return str
      .replace(/\.exe$/i, '')
      .replace(/[^a-z0-9]+/gi, ' ')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  function processBaseName(proc) {
    if (!proc || !proc.process) return '';
    return normalizeToken(proc.process);
  }

  function titleMatchesBase(base, title) {
    if (!base || !title) return false;
    const normTitle = normalizeToken(title);
    return normTitle.includes(base);
  }

  function bestTitleForProcess(processesForProc) {
    // prefer non-empty title containing common main-window words; fallback first non-empty
    const prioritized = processesForProc
      .filter(p => p.title && p.title.trim())
      .map(p => ({ title: p.title.trim(), mainHint: /\b(main|app|window|browser|editor)\b/i.test(p.title) ? 1 : 0 }));

    if (prioritized.length === 0) return null;
    prioritized.sort((a, b) => b.mainHint - a.mainHint);
    return prioritized[0].title;
  }

  function capitalizeFirstIfNoUppercase(str) {
    if (!str || typeof str !== 'string') return str;
    if (/[A-Z]/.test(str)) return str;
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  function baseProcessLabel(proc) {
    if (!proc || !proc.process) return '';
    const cleaned = proc.process.replace(/\.exe$/i, '');
    return capitalizeFirstIfNoUppercase(cleaned);
  }

  function displayName(proc, allProcesses) {
    if (!proc || !proc.process) return proc.process || 'Unknown';

    const base = processBaseName(proc);
    const baseLabel = baseProcessLabel(proc);
    const group = allProcesses
      ? allProcesses.filter(p => normalizeToken(p.process) === normalizeToken(proc.process))
      : [proc];

    const titles = group
      .map(p => p.title)
      .filter(t => t && t.trim())
      .map(t => t.trim());

    if (titles.length === 0) {
      return baseLabel;
    }
    if (titles.length === 1 && titles[0].length >=8) {
      return titles[0];
    }

    const anyMatches = titles.some(t => titleMatchesBase(base, t));
    if (anyMatches) {
      return baseLabel;
    }

    const bestTitle = bestTitleForProcess(group);
    if (bestTitle) {
      return `${baseLabel} (${bestTitle.replace(/\s+/g, ' ').trim()})`;
    }

    return baseLabel;
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

  async function handleKillProcess(event, process) {
    event.stopPropagation();
    event.preventDefault();
    
    if (!window.api || !window.api.killProcess) {
      console.error('[ProcessList] killProcess API not available');
      return;
    }

    // Prevent multiple clicks on the same process
    if (killingProcesses[process.process]) {
      return;
    }

    // Add to killing object for immediate visual feedback
    killingProcesses[process.process] = true;
    killingProcesses = killingProcesses; // Trigger reactivity

    try {
      const result = await window.api.killProcess(process.process);
      if (result.success) {
        console.log('[ProcessList] Process killed successfully:', result.message);
        // Keep it in the set so the visual feedback remains until the process disappears
      } else {
        console.error('[ProcessList] Failed to kill process:', result.message);
        // Remove from object if failed so user can try again
        delete killingProcesses[process.process];
        killingProcesses = killingProcesses;
      }
    } catch (error) {
      console.error('[ProcessList] Error killing process:', error);
      // Remove from object on error
      delete killingProcesses[process.process];
      killingProcesses = killingProcesses;
    }
  }

  function isKilling(processName) {
    return !!killingProcesses[processName];
  }

  onDestroy(() => {
    if (clickTimer) clearTimeout(clickTimer);
  });
</script>

<div>
  <div id="processes">
    {#each unique(processes, 'process') as process}
      {#if viewFilterAllow(process)}
        <div draggable="true"
          role="button"
          tabindex="0"
          class:selected={selectedFilter === process}
          on:dblclick={() => handleFilterDoubleClick(process)}
          on:click={() => handleFilterClick(process)}
          on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleFilterClick(process); } }}
          on:dragstart={(e) => handleDragStart(e, process)}
        >
          <span title={process.process}>
            {#if process.icon}
              <img src="{process.icon}" alt="Icon for {process.process}" on:error={(e) => iconFailure(e, process)} />
            {/if}
            {displayName(process, processes)}
          </span>
          <button class="add-filter-plus" title={lang.ADD_FILTER} aria-label={`${lang.ADD_FILTER} ${displayName(process, processes)}`} on:click={() => handleFilterDoubleClick(process)}>
            <span><i class="fas fa-plus" aria-hidden="true"></i></span>
          </button>
        </div>
      {/if}
    {/each}
  </div>
</div>

<style>
  div#processes {
    border-radius: 6px;
    max-height: 100%;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  div#processes div {
    background: ButtonFace;
    color: ButtonText;
    line-height: 150%;
    display: flex;
    transition: all 0.2s ease;
    cursor: pointer;
    color: var(--main-font-color);
    border-bottom: 1px solid rgba(0,0,0,0.15);
    border-top: 1px solid rgba(255,255,255,0.1);
  }

  div#processes div:hover,
  div#processes div:active,
  div#processes div:focus {
    background: Highlight;
    color: HighlightText;
  }

  /* Estilo para item selecionado */
  div#processes div.selected {
    background: Highlight;
    color: HighlightText;
    border-left: 3px solid #4CAF50;
    padding-left: 12px;
    margin-left: -6px;
  }

  div#processes div.selected:hover,
  div#processes div.selected:active,
  div#processes div.selected:focus {
    background: Highlight;
    color: HighlightText;
  }


  div#processes div button {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--main-font-color);
  }

  @keyframes pulse {
    0%, 100% {
      opacity: 0.7;
    }
    50% {
      opacity: 1;
    }
  }

  div#processes div span {
    padding: 8px;
    flex-grow: 1;
    display: flex;
    -webkit-line-clamp: 1;
    -webkit-box-orient: vertical;
    overflow: hidden;
    white-space: nowrap;
    mask-image: linear-gradient(to right, black calc(100% - 20px), transparent 100%);
    line-height: 175%;
    height: auto;
    align-content: center;
    flex-wrap: inherit;
    flex-direction: row;
  }

  div#processes div span img {
    width: 16px;
    height: 16px;
    position: relative;
    top: 0.5vh;
    margin-right: 6px;
  }

  div#processes div button span {
    font-size: 1.5rem;
    padding: 0 6px;
  }

  div#processes div button {
    padding: 2px 8px;
  }

  /* (removed legacy global override) */
</style>