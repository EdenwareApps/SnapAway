const { screen } = require('electron')
const koffi = require('./koffi-wrapper')
const { detectTitlebarHover } = require('./titlebar-detector')
const {
  getApproximateTitlebarAnalysis,
  getCachedTitlebarAnalysis,
  getTitlebarAnalysisCacheState,
  warmupTitlebarAnalysis
} = require('./titlebar-screenshot-analyzer')
const {
  evaluateWindowTarget,
  isWindowDiagnosticsEnabled,
  logWindowDecision
} = require('../shared/window-eligibility')

const DWMWA_EXTENDED_FRAME_BOUNDS = 9
const DWMWA_CLOAKED = 14
const DWMWA_CAPTION_BUTTON_BOUNDS = 5
const DWMWA_CAPTION_COLOR = 35
const DWMWA_USE_IMMERSIVE_DARK_MODE = 20
const GA_ROOT = 2
const GWL_STYLE = -16
const GWL_EXSTYLE = -20
const GW_OWNER = 4
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
const PROCESS_NAME_MAX = 1024

// Window class block/allow decisions now live in the shared module
// (src/shared/window-eligibility.js), so the overlay, the app list and the
// koffi fallback all use the same rules. Game classes are intentionally NOT
// blocked there: they are usually the game's real main window.

function ptrToHwndString(hwnd) {
  if (!hwnd) return ''
  const address = koffi.address(hwnd)
  if (typeof address === 'bigint') {
    return `0x${address.toString(16)}`
  }
  if (typeof address === 'number') {
    return `0x${address.toString(16)}`
  }
  return String(address)
}

// koffi registers struct types globally by name. Register them once at module
// level and reuse, otherwise creating a second interop (e.g. re-enabling the
// overlay after disabling it) throws "Duplicate type name 'POINT'".
let sharedInteropTypes = null
function getInteropTypes() {
  if (sharedInteropTypes) return sharedInteropTypes
  const POINT = koffi.struct('POINT', {
    x: 'long',
    y: 'long'
  })

  const RECT = koffi.struct('RECT', {
    left: 'long',
    top: 'long',
    right: 'long',
    bottom: 'long'
  })
  sharedInteropTypes = { POINT, RECT }
  return sharedInteropTypes
}

function createInterop() {
  if (!koffi || process.platform !== 'win32') return null

  const { POINT, RECT } = getInteropTypes()

  const user32 = koffi.load('user32.dll')
  const dwmapi = koffi.load('dwmapi.dll')
  const kernel32 = koffi.load('kernel32.dll')

  return {
    POINT,
    RECT,
    funcs: {
      GetForegroundWindow: user32.func('void * __stdcall GetForegroundWindow()'),
      GetCursorPos: user32.func('bool __stdcall GetCursorPos(_Out_ POINT *lpPoint)'),
      WindowFromPoint: user32.func('void * __stdcall WindowFromPoint(POINT Point)'),
      GetWindowRect: user32.func('bool __stdcall GetWindowRect(void * hWnd, _Out_ RECT *lpRect)'),
      GetClassNameW: user32.func('int __stdcall GetClassNameW(void * hWnd, _Out_ char16_t *lpClassName, int nMaxCount)'),
      IsWindow: user32.func('bool __stdcall IsWindow(void * hWnd)'),
      IsWindowVisible: user32.func('bool __stdcall IsWindowVisible(void * hWnd)'),
      GetWindowThreadProcessId: user32.func('uint32_t __stdcall GetWindowThreadProcessId(void * hWnd, _Out_ uint32_t *lpdwProcessId)'),
      GetAncestor: user32.func('void * __stdcall GetAncestor(void * hWnd, uint32_t gaFlags)'),
      GetWindow: user32.func('void * __stdcall GetWindow(void * hWnd, uint32_t uCmd)'),
      GetWindowLongPtrW: user32.func('int64 __stdcall GetWindowLongPtrW(void * hWnd, int nIndex)'),
      OpenProcess: kernel32.func('void * __stdcall OpenProcess(uint32_t dwDesiredAccess, bool bInheritHandle, uint32_t dwProcessId)'),
      QueryFullProcessImageNameW: kernel32.func('bool __stdcall QueryFullProcessImageNameW(void * hProcess, uint32_t dwFlags, _Out_ char16_t *lpExeName, _Inout_ uint32_t *lpdwSize)'),
      CloseHandle: kernel32.func('bool __stdcall CloseHandle(void * hObject)'),
      DwmGetWindowAttribute: dwmapi.func('int __stdcall DwmGetWindowAttribute(void * hwnd, uint32_t dwAttribute, void * pvAttribute, uint32_t cbAttribute)')
    }
  }
}

function getClassName(funcs, hwnd) {
  try {
    const classNameBuffer = Buffer.alloc(256 * 2)
    funcs.GetClassNameW(hwnd, classNameBuffer, 256)
    return classNameBuffer.toString('utf16le').replace(/\0/g, '')
  } catch (_) {
    return ''
  }
}

function readRect(funcs, RECT, hwnd, attributeId) {
  const rectBuffer = Buffer.alloc(koffi.sizeof(RECT))
  const hr = funcs.DwmGetWindowAttribute(hwnd, attributeId, rectBuffer, rectBuffer.length)
  if (hr !== 0) return null
  const rect = {
    left: rectBuffer.readInt32LE(0),
    top: rectBuffer.readInt32LE(4),
    right: rectBuffer.readInt32LE(8),
    bottom: rectBuffer.readInt32LE(12)
  }
  if (rect.right <= rect.left || rect.bottom <= rect.top) return null
  return rect
}

function readDword(funcs, hwnd, attributeId) {
  const outBuffer = Buffer.alloc(4)
  const hr = funcs.DwmGetWindowAttribute(hwnd, attributeId, outBuffer, outBuffer.length)
  if (hr !== 0) return null
  return outBuffer.readUInt32LE(0)
}

function normalizeCaptionButtonsRect(captionRect, windowRect) {
  if (!captionRect || !windowRect) return captionRect

  const windowWidth = windowRect.right - windowRect.left
  const windowHeight = windowRect.bottom - windowRect.top
  if (windowWidth <= 0 || windowHeight <= 0) return captionRect

  // DWMWA_CAPTION_BUTTON_BOUNDS may come relative to the window origin.
  const looksRelative =
    captionRect.left >= -2 &&
    captionRect.top >= -2 &&
    captionRect.right <= windowWidth + 2 &&
    captionRect.bottom <= windowHeight + 2

  if (!looksRelative) return captionRect

  return {
    left: captionRect.left + windowRect.left,
    top: captionRect.top + windowRect.top,
    right: captionRect.right + windowRect.left,
    bottom: captionRect.bottom + windowRect.top
  }
}

function isFullscreenWindow(windowRect) {
  const display = screen.getDisplayMatching({
    x: windowRect.left,
    y: windowRect.top,
    width: Math.max(1, windowRect.right - windowRect.left),
    height: Math.max(1, windowRect.bottom - windowRect.top)
  })

  const displayBounds = display ? display.bounds : null
  if (!displayBounds) return false

  const tolerance = 2
  const widthMatches = Math.abs((windowRect.right - windowRect.left) - displayBounds.width) <= tolerance
  const heightMatches = Math.abs((windowRect.bottom - windowRect.top) - displayBounds.height) <= tolerance
  const leftMatches = Math.abs(windowRect.left - displayBounds.x) <= tolerance
  const topMatches = Math.abs(windowRect.top - displayBounds.y) <= tolerance

  return widthMatches && heightMatches && leftMatches && topMatches
}

function createWindowTracker(options = {}) {
  const interop = createInterop()
  const funcs = interop && interop.funcs
  const RECT = interop && interop.RECT

  // Adapter exposing the Win32 queries the shared eligibility decision needs.
  function pidOfHwnd(h) {
    try {
      const pid = [0]
      funcs.GetWindowThreadProcessId(h, pid)
      return Number(pid[0])
    } catch (_) {
      return 0
    }
  }

  function processNameOf(pid) {
    if (!pid || !funcs || !funcs.OpenProcess) return ''
    let handle = null
    try {
      handle = funcs.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
      if (!handle) return ''
      const buffer = Buffer.alloc(PROCESS_NAME_MAX * 2)
      const sizeHolder = [PROCESS_NAME_MAX]
      if (!funcs.QueryFullProcessImageNameW(handle, 0, buffer, sizeHolder)) return ''
      const fullPath = buffer.toString('utf16le', 0, sizeHolder[0] * 2)
      return fullPath.split('\\').pop() || fullPath
    } catch (_) {
      return ''
    } finally {
      try { if (handle) funcs.CloseHandle(handle) } catch (_) {}
    }
  }

  function longPtrOf(h, index) {
    try { return funcs.GetWindowLongPtrW(h, index) } catch (_) { return 0 }
  }

  const windowApi = {
    isWindow: (h) => !!(funcs && funcs.IsWindow(h)),
    getStyle: (h) => longPtrOf(h, GWL_STYLE),
    getExStyle: (h) => longPtrOf(h, GWL_EXSTYLE),
    getOwner: (h) => { try { return funcs.GetWindow(h, GW_OWNER) } catch (_) { return 0 } },
    isVisible: (h) => !!(funcs && funcs.IsWindowVisible(h)),
    isCloaked: (h) => { const c = readDword(funcs, h, DWMWA_CLOAKED); return !!(c && c !== 0) },
    getClassName: (h) => getClassName(funcs, h),
    processIdOf: pidOfHwnd,
    getProcessName: (h) => processNameOf(pidOfHwnd(h)),
    formatHwnd: (h) => (h ? (ptrToHwndString(h) || '0x0') : '0x0')
  }

  const state = {
    timer: null,
    running: false,
    lastHwnd: null,
    lastTick: 0,
    lastAnalysisStateKey: '',
    lastDiagKey: ''
  }

  const pollIntervalActiveMs = Number(options.pollIntervalActiveMs) || 110
  const pollIntervalIdleMs = Number(options.pollIntervalIdleMs) || 420

  function scheduleNextTick(active) {
    clearTimeout(state.timer)
    const nextIn = active ? pollIntervalActiveMs : pollIntervalIdleMs
    state.timer = setTimeout(tick, nextIn)
  }

  function buildResultSnapshot() {
    if (!funcs || !RECT) {
      return { eligible: false, reason: 'win32-interop-unavailable' }
    }

    const cursor = { x: 0, y: 0 }
    if (!funcs.GetCursorPos(cursor)) {
      return { eligible: false, reason: 'cursor-unavailable' }
    }

    const hoveredHwnd = funcs.WindowFromPoint(cursor)
    if (!hoveredHwnd || !funcs.IsWindow(hoveredHwnd)) {
      return { eligible: false, reason: 'no-hovered-window' }
    }

    const rootHwnd = funcs.GetAncestor(hoveredHwnd, GA_ROOT) || hoveredHwnd
    if (!rootHwnd || !funcs.IsWindow(rootHwnd)) {
      return { eligible: false, reason: 'invalid-root-window' }
    }

    const hwnd = ptrToHwndString(rootHwnd)
    if (!hwnd) return { eligible: false, reason: 'invalid-hwnd' }

    if (options.isOwnWindow && options.isOwnWindow(hwnd)) {
      return { eligible: false, reason: 'own-window' }
    }

    // Single structural decision (child / owner / visibility / cloaked + the
    // documented class exceptions), shared with the app list and the koffi
    // fallback so nobody re-implements "what is a target window".
    const eligibility = evaluateWindowTarget(windowApi, rootHwnd, { ownProcessId: process.pid })
    if (!eligibility.eligible) {
      if (isWindowDiagnosticsEnabled()) {
        const diagKey = `${hwnd}:${eligibility.reason}`
        if (diagKey !== state.lastDiagKey) {
          state.lastDiagKey = diagKey
          logWindowDecision(windowApi, rootHwnd, { ownProcessId: process.pid })
        }
      }
      return { eligible: false, reason: eligibility.reason, hwnd, className: eligibility.className }
    }

    // Use top-level window geometry to avoid anchoring to child controls.
    const geometryHwnd = rootHwnd

    const processIdHolder = [0]
    funcs.GetWindowThreadProcessId(geometryHwnd, processIdHolder)
    const processId = Number(processIdHolder[0])

    const className = eligibility.className || getClassName(funcs, geometryHwnd) || getClassName(funcs, rootHwnd)

    const windowRectBuffer = { left: 0, top: 0, right: 0, bottom: 0 }
    if (!funcs.GetWindowRect(geometryHwnd, windowRectBuffer) && !funcs.GetWindowRect(rootHwnd, windowRectBuffer)) {
      return { eligible: false, reason: 'window-rect-unavailable' }
    }

    if (windowRectBuffer.right <= windowRectBuffer.left || windowRectBuffer.bottom <= windowRectBuffer.top) {
      return { eligible: false, reason: 'invalid-window-rect' }
    }

    if (isFullscreenWindow(windowRectBuffer)) {
      return { eligible: false, reason: 'fullscreen-window' }
    }

    const rawCaptionButtonsRect = readRect(funcs, RECT, geometryHwnd, DWMWA_CAPTION_BUTTON_BOUNDS)
      || readRect(funcs, RECT, rootHwnd, DWMWA_CAPTION_BUTTON_BOUNDS)
    const hoverWindowRect = windowRectBuffer
    const captionButtonsRect = normalizeCaptionButtonsRect(rawCaptionButtonsRect, hoverWindowRect)
    const extendedFrameRect = readRect(funcs, RECT, geometryHwnd, DWMWA_EXTENDED_FRAME_BOUNDS)
      || readRect(funcs, RECT, rootHwnd, DWMWA_EXTENDED_FRAME_BOUNDS)

    const windowKey = [
      hwnd,
      hoverWindowRect.right - hoverWindowRect.left,
      hoverWindowRect.bottom - hoverWindowRect.top,
      captionButtonsRect ? captionButtonsRect.width : 0,
      captionButtonsRect ? captionButtonsRect.height : 0
    ].join(':')

    const cachedScreenshotAnalysis = getCachedTitlebarAnalysis(windowKey)
    const allowApproximateForWindow = !!captionButtonsRect
    const approximateScreenshotAnalysis = (!cachedScreenshotAnalysis && allowApproximateForWindow)
      ? getApproximateTitlebarAnalysis({
          windowKey,
          windowRect: hoverWindowRect,
          captionButtonsRect,
          iconSize: Number(options.iconSize) || 16
        })
      : null
    const resolvedScreenshotAnalysis = cachedScreenshotAnalysis || approximateScreenshotAnalysis
    const analysisCacheState = getTitlebarAnalysisCacheState(windowKey)

    const analysisStateLabel = analysisCacheState.hasCache
      ? `hit:${analysisCacheState.source || 'unknown'}`
      : (approximateScreenshotAnalysis
          ? 'hit:approx'
          : (analysisCacheState.pending ? 'pending' : (analysisCacheState.noResult ? 'no-result' : 'miss')))
    const analysisStateKey = `${windowKey}:${analysisStateLabel}`
    if (analysisStateKey !== state.lastAnalysisStateKey) {
      console.log('[OVERLAY] titlebar analysis cache:', {
        windowKey,
        state: analysisStateLabel
      })
      state.lastAnalysisStateKey = analysisStateKey
    }

    const hoverInfo = detectTitlebarHover({
      cursor,
      windowRect: hoverWindowRect,
      captionButtonsRect,
      iconSize: Number(options.iconSize) || 16,
      windowKey,
      screenshotAnalysis: resolvedScreenshotAnalysis
    })

    if (!cachedScreenshotAnalysis) {
      warmupTitlebarAnalysis({
        windowKey,
        windowRect: hoverWindowRect,
        captionButtonsRect,
        iconSize: Number(options.iconSize) || 16
      })
    }

    if (!hoverInfo.visible) {
      return {
        eligible: false,
        reason: hoverInfo.reason,
        hwnd,
        cursor,
        processId,
        className,
        windowRect: hoverWindowRect
      }
    }

    return {
      eligible: true,
      hwnd,
      cursor,
      processId,
      className,
      windowRect: hoverWindowRect,
      extendedFrameRect: extendedFrameRect || null,
      captionButtonsRect,
      overlayBounds: hoverInfo.overlayBounds,
      usingDwmCaptionBounds: hoverInfo.usingDwmCaptionBounds,
      screenshotAnalysisSource: resolvedScreenshotAnalysis && resolvedScreenshotAnalysis.source
        ? resolvedScreenshotAnalysis.source
        : null,
      titlebarLuma: resolvedScreenshotAnalysis && Number.isFinite(resolvedScreenshotAnalysis.titlebarLuma)
        ? resolvedScreenshotAnalysis.titlebarLuma
        : null,
      captionColorRef: readDword(funcs, geometryHwnd, DWMWA_CAPTION_COLOR)
        ?? readDword(funcs, rootHwnd, DWMWA_CAPTION_COLOR),
      immersiveDarkMode: (() => {
        const value = readDword(funcs, geometryHwnd, DWMWA_USE_IMMERSIVE_DARK_MODE)
          ?? readDword(funcs, rootHwnd, DWMWA_USE_IMMERSIVE_DARK_MODE)
        return value === null ? null : value !== 0
      })()
    }
  }

  function tick() {
    if (!state.running) return

    const snapshot = buildResultSnapshot()
    state.lastTick = Date.now()
    if (snapshot.eligible) {
      state.lastHwnd = snapshot.hwnd
    }

    if (typeof options.onUpdate === 'function') {
      try {
        options.onUpdate(snapshot)
      } catch (error) {
        console.error('[OVERLAY] tracker update failed:', error)
      }
    }

    scheduleNextTick(snapshot.eligible)
  }

  function start() {
    if (state.running) return
    state.running = true
    scheduleNextTick(false)
  }

  function stop() {
    state.running = false
    clearTimeout(state.timer)
    state.timer = null
  }

  return {
    start,
    stop
  }
}

module.exports = {
  createWindowTracker
}
