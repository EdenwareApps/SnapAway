const { BrowserWindow, screen } = require('electron')
const fs = require('fs')
const { createWindowTracker } = require('./window-tracker')
const { pickOverlayIconPath, detectOverlayIconTheme } = require('./theme-detector')
const { installNavigationGuards } = require('./navigation-guard')

function fileToDataUrl(filePath) {
  if (!filePath) return null
  try {
    const image = fs.readFileSync(filePath)
    return `data:image/png;base64,${image.toString('base64')}`
  } catch (_) {
    return null
  }
}

function createOverlayHtml() {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body {
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    background: transparent;
    overflow: hidden;
    user-select: none;
  }
  #overlay-btn {
    width: 100%;
    height: 100%;
    display: block;
    box-sizing: border-box;
    border: 0;
    margin: 0;
    padding: 0;
    border-radius: 50%;
    background: transparent;
    /* No opacity transition: a hover-driven opacity fade right after the window
       appears under the cursor reads as a second fade-in. Keep it static. */
    opacity: 1;
    -webkit-app-region: no-drag;
    cursor: pointer;
  }
  #overlay-btn.no-icon {
    background: rgba(255, 70, 70, .45);
  }
  #overlay-btn.managed {
    filter: brightness(1.14);
    box-shadow: 0 0 0 1px rgba(255,255,255,.34), 0 0 5px rgba(255,255,255,.22);
  }
  #overlay-icon {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: contain;
    cursor: pointer;
  }
</style>
</head>
<body>
<button id="overlay-btn" aria-label="SnapAway overlay action">
  <img id="overlay-icon" alt="SnapAway" />
</button>
<script>
  const { ipcRenderer } = require('electron')
  const button = document.getElementById('overlay-btn')
  const icon = document.getElementById('overlay-icon')

  button.addEventListener('mouseenter', () => {
    button.classList.add('hovered')
    ipcRenderer.send('snapaway-overlay-hover', true)
  })

  button.addEventListener('mouseleave', () => {
    button.classList.remove('hovered')
    ipcRenderer.send('snapaway-overlay-hover', false)
  })

  button.addEventListener('click', (event) => {
    event.preventDefault()
    ipcRenderer.send('snapaway-overlay-click')
  })

  ipcRenderer.on('snapaway-overlay-state', (_, payload) => {
    if (!payload) return
    if (payload.iconDataUrl) {
      icon.src = payload.iconDataUrl
      button.classList.remove('no-icon')
    } else {
      icon.removeAttribute('src')
      button.classList.add('no-icon')
    }

    if (payload.managed) {
      button.classList.add('managed')
    } else {
      button.classList.remove('managed')
    }
  })
</script>
</body>
</html>`
}

function createOverlayManager(options = {}) {
  const iconSize = 16
  const hideDelayMs = Number(options.hideDelayMs) || 400
  // Once a show (hidden → shown transition) is initiated, ignore further show
  // triggers during this window so the display transition/animation isn't
  // restarted. Slightly longer than the tracker poll (~110ms).
  const showCooldownMs = 150
  const state = {
    window: null,
    tracker: null,
    hideTimer: null,
    hoveringOverlay: false,
    hoveredHwnd: null,
    iconDataCache: new Map(),
    lastBoundsKey: '',
    lastShapeKey: '',
    lastPayloadKey: '',
    lastPhysicalBounds: null,
    pendingPayload: null,
    lastReason: '',
    lastEligibleHwnd: '',
    ipcHandlers: null,
    lastWindowRect: null,
    suppressUntilTs: 0,
    lastActiveAt: 0,
    showCooldownUntil: 0,
    contentReady: false,
    pendingShow: false,
    showing: false,
    // Streak de falhas consecutivas do renderer sem load bem-sucedido (usada
    // pelo backoff escalonado do render-process-gone — ver ELECTRON-8).
    rendererCrashStreak: 0,
    disabledUntilTs: 0
  }

  // Marks the moment the overlay was last considered "active" (cursor over a
  // valid titlebar, near the overlay, or over the overlay itself). Used so the
  // hide timer only fires after `hideDelayMs` of continuous absence — if the
  // cursor returns to the titlebar within the delay, the timer is cancelled.
  function markActive() {
    state.lastActiveAt = Date.now()
  }

  function getIconDataUrl(snapshot) {
    const iconPath = pickOverlayIconPath(snapshot)
    if (!iconPath) return null

    if (state.iconDataCache.has(iconPath)) {
      return state.iconDataCache.get(iconPath)
    }

    const dataUrl = fileToDataUrl(iconPath)
    if (dataUrl) {
      state.iconDataCache.set(iconPath, dataUrl)
    }
    return dataUrl
  }

  function createWindow() {
    if (state.window && !state.window.isDestroyed()) return state.window

    console.log('[OVERLAY] creating overlay window')

    const win = new BrowserWindow({
      width: iconSize,
      height: iconSize,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      fullscreenable: false,
      hasShadow: false,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        sandbox: false,
        devTools: false
      }
    })

    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false })
    win.setAlwaysOnTop(true, 'screen-saver')
    win.setIgnoreMouseEvents(true, { forward: true })
    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(createOverlayHtml())}`)

    // Guarda de navegação: o overlay só deve carregar conteúdo fixo (data:).
    // Deny-all — bloqueia qualquer navegação renderer-initiated.
    installNavigationGuards(win)

    win.webContents.once('did-finish-load', () => {
      console.log('[OVERLAY] overlay content loaded')
      // Renderer iniciou com sucesso: zera a streak de falhas e reabilita o
      // overlay (só falhas SEM load entre elas escalam o backoff).
      state.rendererCrashStreak = 0
      state.disabledUntilTs = 0
      state.contentReady = true
      if (state.pendingPayload) {
        win.webContents.send('snapaway-overlay-state', state.pendingPayload)
      }
      // If a show was requested before the content loaded, perform it now so
      // the window fades in with the icon already present (single fade-in).
      if (state.pendingShow) {
        state.pendingShow = false
        console.log('[OVERLAY] performing deferred show after content load')
        performShow()
      }
    })

    // Resiliência (fix 1.1.2): se o renderer do overlay morrer (ex.: falha
    // transitória de GPU/launch em builds empacotados, reportada pelo Sentry
    // como "renderer process exited with launch-failed"), não derrubamos o app:
    // registramos, destruímos a janela quebrada e deixamos o próximo showAt()
    // recriá-la. Backoff ESCALONADO evita martelar o launch: o backoff antigo
    // ("3 crashes em 8s") nunca engatava porque a recriação é gated pelo hover
    // do cursor — crashes espaçados >8s resetavam o contador (ELECTRON-8, 197
    // eventos). Agora a streak só zera com um load bem-sucedido.
    win.webContents.on('render-process-gone', (_event, details) => {
      const reason = details && details.reason ? details.reason : 'unknown'
      const exitCode = details && details.exitCode !== undefined ? details.exitCode : '?'
      console.error(`[OVERLAY] overlay renderer gone: ${reason} (exitCode ${exitCode})`)
      const now = Date.now()

      // Streak de falhas consecutivas sem load bem-sucedido entre elas.
      state.rendererCrashStreak = (state.rendererCrashStreak || 0) + 1

      // Escalada exponencial: 1º registra (pode ser transitório); 2º+ desliga
      // com backoff crescente para reduzir os eventos/ruído no Sentry.
      const delayByStreak = [0, 60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000, 60 * 60 * 1000]
      const idx = Math.min(state.rendererCrashStreak - 1, delayByStreak.length - 1)
      const delay = delayByStreak[idx]
      if (delay > 0) {
        state.disabledUntilTs = now + delay
        console.warn(`[OVERLAY] renderer crash streak ${state.rendererCrashStreak} — overlay disabled for ${Math.round(delay / 1000)}s`)
      }

      state.contentReady = false
      state.showing = false
      state.pendingShow = false
      state.pendingPayload = null

      try {
        if (state.window === win && !win.isDestroyed()) {
          win.destroy()
        }
      } catch (_) {
        // ignore
      }
      state.window = null
    })

    // Safety net: if did-finish-load never fires (e.g. on a recreated window
    // after disabling/re-enabling the overlay), force contentReady so the
    // overlay is not permanently blocked by the content-ready gate.
    setTimeout(() => {
      if (!state.contentReady && state.window && state.window === win && !win.isDestroyed()) {
        console.warn('[OVERLAY] content load timeout — forcing contentReady')
        state.contentReady = true
        if (state.pendingShow) {
          state.pendingShow = false
          performShow()
        }
      }
    }, 3000)

    win.on('show', () => {
      // The window finished being shown — the show cycle is complete. Clear the
      // flag so a subsequent hide→show can run again.
      state.showing = false
    })

    win.on('closed', () => {
      state.window = null
      state.lastBoundsKey = ''
      state.lastShapeKey = ''
      state.lastPayloadKey = ''
      state.lastPhysicalBounds = null
      state.showCooldownUntil = 0
      state.contentReady = false
      state.pendingShow = false
      state.showing = false
    })

    state.window = win
    return win
  }

  function clearHideTimer() {
    clearTimeout(state.hideTimer)
    state.hideTimer = null
  }

  // Returns true when the given physical cursor position is still inside (or
  // immediately adjacent to) the overlay window's own square bounds. Used for
  // edge-hysteresis: at the circular hit-area boundary the tracker oscillates
  // between `own-window` and ineligible/moved, which would otherwise rapidly
  // hide/show the overlay (flicker).
  function isCursorNearOverlay(cursor) {
    if (!cursor) return false
    const bounds = state.lastPhysicalBounds
    if (!bounds) return false
    // Generous tolerance: covers the caption-button gap (~6px) to the right of
    // the icon and the titlebar-edge jitter, so the overlay doesn't hide/show
    // rapidly when the cursor approaches its boundary.
    const tolerance = 8
    return (
      cursor.x >= bounds.x - tolerance &&
      cursor.x <= bounds.x + bounds.width + tolerance &&
      cursor.y >= bounds.y - tolerance &&
      cursor.y <= bounds.y + bounds.height + tolerance
    )
  }

  function hideNow() {
    const win = state.window
    if (!win || win.isDestroyed()) return
    // A deliberate hide resets the show cooldown, so the next show trigger
    // (e.g. the cursor returning to the titlebar) can display again at once.
    state.showCooldownUntil = 0
    state.showing = false
    win.setIgnoreMouseEvents(true, { forward: true })
    if (win.isVisible()) {
      win.hide()
    }
  }

  // Atomic, idempotent hidden → shown transition. Never shows a window that is
  // already visible, and ignores repeated triggers while a show is settling so
  // the display fade-in is not restarted. The `state.showing` flag is cleared
  // only when the window's `show` event fires, guaranteeing a single
  // showInactive() per show cycle.
  function performShow() {
    const win = state.window
    if (!win || win.isDestroyed()) return
    if (state.showing) {
      console.log('[OVERLAY] show ignored (already showing)')
      return // show already in progress — ignore new triggers
    }
    if (win.isVisible()) return // already visible — don't restart
    if (Date.now() < state.showCooldownUntil) return // settle guard
    state.showing = true
    state.showCooldownUntil = Date.now() + showCooldownMs
    win.setIgnoreMouseEvents(false)
    win.showInactive()
  }

  function hideWithDelay() {
    clearHideTimer()
    state.hideTimer = setTimeout(() => {
      // Only hide after `hideDelayMs` of continuous absence. If the cursor came
      // back to the titlebar/overlay area within the delay, `markActive()` was
      // called and the elapsed time since the last active moment is < delay.
      if (state.hoveringOverlay) return
      if (Date.now() - state.lastActiveAt < hideDelayMs) return
      hideNow()
    }, hideDelayMs)
  }

  function physicalRectToDipBounds(rect) {
    if (!rect) return null
    if (typeof screen.screenToDipPoint !== 'function') return rect

    const topLeft = screen.screenToDipPoint({
      x: Math.round(rect.x),
      y: Math.round(rect.y)
    })
    const bottomRight = screen.screenToDipPoint({
      x: Math.round(rect.x + rect.width),
      y: Math.round(rect.y + rect.height)
    })
    const x = Math.min(topLeft.x, bottomRight.x)
    const y = Math.min(topLeft.y, bottomRight.y)
    const right = Math.max(topLeft.x, bottomRight.x)
    const bottom = Math.max(topLeft.y, bottomRight.y)

    return {
      x: Math.floor(x),
      y: Math.floor(y),
      width: Math.max(1, Math.round(right - x)),
      height: Math.max(1, Math.round(bottom - y))
    }
  }

  // Approximates a circle inscribed in a W x H window using horizontal strips,
  // so the hit/click area matches the visible circular icon instead of the
  // whole square window (which would otherwise block target-window elements
  // in the transparent corners, especially to the right and below).
  function buildCircularShape(width, height) {
    if (typeof width !== 'number' || typeof height !== 'number' || width <= 0 || height <= 0) {
      return null
    }
    const cx = width / 2
    const cy = height / 2
    const radius = Math.min(width, height) / 2
    const shape = []
    for (let y = 0; y < height; y++) {
      const dy = y + 0.5 - cy
      if (Math.abs(dy) >= radius) continue
      const half = Math.sqrt(Math.max(0, radius * radius - dy * dy))
      const x0 = Math.max(0, Math.floor(cx - half))
      const x1 = Math.min(width, Math.ceil(cx + half))
      if (x1 > x0) {
        shape.push({ x: x0, y, width: x1 - x0, height: 1 })
      }
    }
    return shape
  }

  function applyCircularShape(bounds) {
    const win = state.window
    if (!win || win.isDestroyed()) return
    if (typeof win.setShape !== 'function') return
    try {
      const shape = buildCircularShape(bounds.width, bounds.height)
      if (shape && shape.length > 0) {
        win.setShape(shape)
      }
    } catch (error) {
      // setShape can throw on some platforms; fall back to the square window.
    }
  }

  function showAt(bounds, payload, convertToDip) {
    // Período de desativação após crashes repetidos do renderer: não criar nem
    // mostrar o overlay até que o backoff expire (evita loop de recriação).
    if (state.disabledUntilTs && Date.now() < state.disabledUntilTs) {
      return
    }

    const win = createWindow()
    if (!bounds) return

    const normalized = {
      x: Number(bounds.x),
      y: Number(bounds.y),
      width: Number(bounds.width),
      height: Number(bounds.height)
    }

    if (
      !Number.isFinite(normalized.x) ||
      !Number.isFinite(normalized.y) ||
      !Number.isFinite(normalized.width) ||
      !Number.isFinite(normalized.height) ||
      normalized.width <= 0 ||
      normalized.height <= 0
    ) {
      console.log('[OVERLAY] skipping invalid bounds:', bounds)
      return
    }

    // Store physical bounds for edge-hysteresis: keep the overlay visible while
    // the cursor is still inside its own (square) area, even when the tracker
    // momentarily reports ineligible at the circular hit-area boundary.
    state.lastPhysicalBounds = {
      x: normalized.x,
      y: normalized.y,
      width: normalized.width,
      height: normalized.height
    }

    let target = {
      x: normalized.x,
      y: normalized.y,
      width: normalized.width,
      height: normalized.height
    }

    if (convertToDip) {
      const dipBounds = physicalRectToDipBounds(normalized)
      if (dipBounds) {
        target = dipBounds
      }
    }

    console.log('[OVERLAY] showAt transform:', {
      convertToDip: !!convertToDip,
      input: normalized,
      transformed: target
    })

    const display = screen.getDisplayNearestPoint({
      x: Math.round(target.x),
      y: Math.round(target.y)
    })
    const displayBounds = display && display.bounds ? display.bounds : null

    const clamped = {
      x: Math.round(target.x),
      y: Math.round(target.y),
      width: Math.round(target.width),
      height: Math.round(target.height)
    }

    if (displayBounds) {
      const maxX = displayBounds.x + displayBounds.width - clamped.width
      const maxY = displayBounds.y + displayBounds.height - clamped.height
      clamped.x = Math.max(displayBounds.x, Math.min(clamped.x, maxX))
      clamped.y = Math.max(displayBounds.y, Math.min(clamped.y, maxY))
    }

    clearHideTimer()

    const nextKey = `${clamped.x}:${clamped.y}:${clamped.width}:${clamped.height}`
    if (nextKey !== state.lastBoundsKey) {
      win.setBounds(clamped, false)
      console.log('[OVERLAY] setBounds applied:', clamped)
      state.lastBoundsKey = nextKey
    }

    // Only re-apply the circular shape when the window SIZE changes, never on
    // position-only moves. Re-applying win.setShape() (SetWindowRgn) on every
    // pixel of movement triggers a repaint flash on transparent Windows and
    // causes the appear/disappear/appear flicker.
    const shapeKey = `${clamped.width}:${clamped.height}`
    if (shapeKey !== state.lastShapeKey) {
      applyCircularShape(clamped)
      state.lastShapeKey = shapeKey
    }

    // Only push the payload to the DOM when it actually changes. When the
    // cursor hovers the edge of the circular hit area, the tracker oscillates
    // between `own-window` and the target window, causing showAt() to run on
    // every tick (~110ms). Re-sending the payload re-assigns `icon.src`, which
    // re-decodes/re-paints the image on each tick and reads as a flicker.
    const iconDataUrl = (payload && payload.iconDataUrl) || ''
    const payloadKey = `${iconDataUrl}|${payload && payload.managed ? 1 : 0}`
    if (payloadKey !== state.lastPayloadKey) {
      state.lastPayloadKey = payloadKey
      state.pendingPayload = payload
      win.webContents.send('snapaway-overlay-state', payload)
    }

    // Wait for the window content (the icon) to be loaded before showing, so
    // the user sees a single fade-in — not an empty window fade-in followed by
    // the icon popping in (which reads as two fades).
    if (!state.contentReady) {
      state.pendingShow = true
      return
    }

    // Atomic, idempotent show: `performShow()` never restarts an ongoing show
    // (visible check + cooldown) and won't re-trigger the fade-in.
    performShow()
  }

  function onTrackerUpdate(snapshot) {
    // While the app is in the "hide" state (windows hidden), never show the
    // overlay icon. If it was visible, hide it immediately.
    if (options.shouldShowOverlay && !options.shouldShowOverlay()) {
      if (state.window && state.window.isVisible()) {
        hideNow()
      }
      state.hoveredHwnd = null
      state.lastWindowRect = null
      return
    }

    if (!snapshot || !snapshot.eligible) {
      const reason = snapshot && snapshot.reason ? snapshot.reason : 'unknown'
      if (reason !== state.lastReason) {
        console.log('[OVERLAY] tracker ineligible:', reason)
        state.lastReason = reason
      }

      // When cursor is over the overlay itself, keep current target visible.
      if (reason === 'own-window') {
        markActive()
        return
      }

      // Edge hysteresis: if the cursor is still within (or near) the overlay
      // window's own square bounds, keep it visible. At the circular hit-area
      // boundary the tracker oscillates between `own-window` and ineligible,
      // which would otherwise hide/show the overlay rapidly (flicker).
      if (isCursorNearOverlay(snapshot && snapshot.cursor)) {
        markActive()
        return
      }

      state.hoveredHwnd = null
      state.lastWindowRect = null
      if (!state.hoveringOverlay) {
        hideWithDelay()
      }
      return
    }

    state.lastReason = ''

    // Cursor is over a valid titlebar — the overlay is active. Mark it before
    // the suppress gate so even suppressed ticks (during a brief window move)
    // keep the hide timer from firing if the cursor is still present.
    markActive()

    state.hoveredHwnd = snapshot.hwnd
    if (snapshot.hwnd !== state.lastEligibleHwnd) {
      console.log('[OVERLAY] tracker eligible window:', snapshot.hwnd)
      state.lastEligibleHwnd = snapshot.hwnd
    }

    const now = Date.now()
    if (snapshot.windowRect) {
      const rect = snapshot.windowRect
      const prev = state.lastWindowRect
      if (prev && prev.hwnd === snapshot.hwnd) {
        const moved =
          Math.abs(prev.left - rect.left) > 1 ||
          Math.abs(prev.top - rect.top) > 1 ||
          Math.abs(prev.right - rect.right) > 1 ||
          Math.abs(prev.bottom - rect.bottom) > 1

        if (moved) {
          // Keep overlay hidden briefly while the window is moving to avoid
          // drag trails — but never hide while the cursor is still over (or
          // near) the overlay, otherwise a tiny rect jitter (>1px) from DWM /
          // rounded corners would rapidly hide and re-show the overlay.
          if (isCursorNearOverlay(snapshot && snapshot.cursor)) {
            // Keep visible; still refresh the reference rect below.
          } else {
            state.suppressUntilTs = now + 220
            if (!state.hoveringOverlay) {
              hideNow()
            }
          }
        }
      }

      state.lastWindowRect = {
        hwnd: snapshot.hwnd,
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom
      }
    }

    if (now < state.suppressUntilTs) {
      return
    }

    const managed = !!(options.isWindowManaged && options.isWindowManaged(snapshot.hwnd))
    const payload = {
      iconDataUrl: getIconDataUrl(snapshot),
      managed
    }

    console.log('[OVERLAY] showing overlay:', {
      hwnd: snapshot.hwnd,
      bounds: snapshot.overlayBounds,
      usingDwmCaptionBounds: snapshot.usingDwmCaptionBounds,
      screenshotAnalysisSource: snapshot.screenshotAnalysisSource,
      theme: detectOverlayIconTheme(snapshot),
      captionColorRef: snapshot.captionColorRef,
      immersiveDarkMode: snapshot.immersiveDarkMode,
      titlebarLuma: snapshot.titlebarLuma,
      hasIcon: !!payload.iconDataUrl,
      managed
    })

    showAt(snapshot.overlayBounds, payload, true)
  }

  function bindIpc() {
    const ipcMain = options.ipcMain
    if (!ipcMain) return

    if (state.ipcHandlers) return

    const onHover = (_event, hovered) => {
      state.hoveringOverlay = !!hovered
      if (state.hoveringOverlay) {
        clearHideTimer()
        return
      }

      // Do not hide immediately on mouseleave. If the cursor is still over a valid
      // titlebar zone, the next tracker tick will keep the overlay visible.
      clearHideTimer()
    }

    const onClick = async () => {
      const hwnd = state.hoveredHwnd
      if (!hwnd || !options.onClick) return
      try {
        await options.onClick(hwnd)
      } catch (error) {
        console.error('[OVERLAY] click handling failed:', error)
      }
      hideWithDelay()
    }

    ipcMain.on('snapaway-overlay-hover', onHover)
    ipcMain.on('snapaway-overlay-click', onClick)

    state.ipcHandlers = {
      onHover,
      onClick
    }
  }

  function unbindIpc() {
    const ipcMain = options.ipcMain
    if (!ipcMain || !state.ipcHandlers) return

    ipcMain.removeListener('snapaway-overlay-hover', state.ipcHandlers.onHover)
    ipcMain.removeListener('snapaway-overlay-click', state.ipcHandlers.onClick)
    state.ipcHandlers = null
  }

  function start() {
    if (process.platform !== 'win32') return
    console.log('[OVERLAY] manager start()')
    state.disabledUntilTs = 0
    state.rendererCrashStreak = 0
    createWindow()
    bindIpc()

    state.tracker = createWindowTracker({
      iconSize,
      isOwnWindow: options.isOwnWindow,
      onUpdate: onTrackerUpdate
    })

    state.tracker.start()
    console.log('[OVERLAY] manager started, tracker running')
  }

  function stop() {
    clearHideTimer()
    unbindIpc()

    if (state.tracker) {
      state.tracker.stop()
      state.tracker = null
    }

    if (state.window && !state.window.isDestroyed()) {
      state.window.destroy()
    }

    state.window = null
    state.hoveredHwnd = null
    state.lastBoundsKey = ''
    state.showing = false
    state.contentReady = false
    state.pendingShow = false
  }

  return {
    start,
    stop
  }
}

module.exports = {
  createOverlayManager
}
