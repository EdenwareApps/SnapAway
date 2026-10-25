// Shared window-eligibility rules for SnapAway.
//
// DESIGN
// ------
// The decision is STRUCTURAL first: a window is only considered a target when
// it behaves like a normal, hideable top-level application window (not a
// child, not owned by another window, visible, not DWM-cloaked). The class
// lists below are a layer of DOCUMENTED EXCEPTIONS on top of that decision,
// never the core of the algorithm.
//
// Consumers must NOT re-implement these rules. Build a small adapter exposing
// the few Win32 queries (see `evaluateWindowEligibility`) and call it, so the
// overlay tracker, the app list and the koffi fallback always agree.
//
// GAME CLASSES (UnityWndClass, UnrealWindow, SDL_app, ...): a game class is NOT
// sufficient reason to reject a window. It is usually the game's real main
// window and SnapAway must be able to hide games. The same game may also spawn
// overlays, launchers, crash/anti-cheat dialogs and CEF/Steam/Discord helpers —
// those are rejected by the STRUCTURAL checks and the other categories, never
// by "this looks like a game".
//
// OWNER = REJECTED is a documented product decision, not an absolute truth: it
// cleanly covers menus/tooltips/dropdowns, but some apps put their only
// meaningful window in an owned top-level (modal dialogs). This needs
// real-world validation (see the diagnostics mode) before being treated as
// final.
//
// The structural filters are EXCLUSIONS, not a rigid whitelist: we keep being
// permissive on purpose, because SnapAway's differentiator is working with
// practically any Windows application without prior configuration.

const WS_CHILD = 0x40000000

// ---------------------------------------------------------------------------
// Class categories (exceptions layer). Each entry is documented so a future
// reader can tell why it is here and whether it can be removed safely.
// ---------------------------------------------------------------------------

// Desktop, taskbar and shell chrome that is never an application window.
const SYSTEM_CLASSES = new Set([
  'progman',                          // desktop
  'workerw',                          // desktop wallpaper host
  'shell_traywnd',                    // primary taskbar
  'shell_secondarytraywnd',           // secondary taskbar
  'shell_dim',                        // shell dim overlay (e.g. UAC dim)
  'sysshadow',                        // window shadow helper
  'foregroundstaging',                // foreground-lock staging window
  'tasklistthumbnailwnd',             // taskbar live preview thumbnail
  'shell_inputswitchtoplevelwindow'   // input language switcher popup
])

// Windows 10/11 shell surfaces (Start, search, task view, tab proxy...).
const SHELL_CLASSES = new Set([
  'windows.ui.core.corewindow',                 // UWP core window
  'windows.internal.shell.tabproxywindow',      // shell tab proxy
  'xamlexplorerhostislandwindow',               // Win11 shell island host
  'multitaskingviewframe',                      // task view frame
  'windows.ui.input.inputsite.windowclass'      // IME/input site surface
])

// Win32 popup surfaces: menus, tooltips and combo dropdowns. These are also
// caught structurally by the owner check, but the explicit list documents the
// intent and protects against popups that are not owned.
const POPUP_CLASSES = new Set([
  '#32768',            // popup menu (TrackPopupMenu)
  'tooltips_class32',  // tooltip
  'combolbox',         // combo box dropdown list
  'dropdown'           // dropdown list (comctl32)
])

// Input Method Editor composition / candidate windows.
const IME_CLASSES = new Set([
  'ime',
  'default ime',
  'msctfime ui'
])

// Auxiliary helper/overlay windows injected by third-party apps.
const AUXILIARY_OVERLAY_CLASSES = new Set([
  'intermediate d3d window',  // Chromium D3D/GPU helper window
  'cef-osc-widget'            // CEF overlay host (Overwolf/Discord-style)
])

// Per-process helper windows created by Chromium/CEF-based apps (Chrome, Edge,
// Electron apps, Spotify...) and by the Crashpad crash handler. They are
// top-level, unowned and sometimes have a real size, so the structural checks
// let them through — but they never present UI. The app's user-facing window is
// `Chrome_WidgetWin_1`; `Chrome_WidgetWin_0` is Chromium's hidden/utility
// window. Hiding those and restoring them later maps a blank, title-less frame
// (the "second empty window" bug seen with Spotify).
const PROCESS_HELPER_CLASSES = new Set([
  'chrome_widgetwin_0',          // Chromium hidden/utility window (per process)
  'crashpad_sessionendwatcher',  // Crashpad session-end watcher (no UI at all)
  'gdi+ hook window class',      // gdiplus.dll message hook (1x1, title "GDI+ Window (x.exe)")
  'base_powermessagewindow'      // powrprof message window (0x0, no-activate)
])

const ALL_CLASSES = new Set([
  ...SYSTEM_CLASSES,
  ...SHELL_CLASSES,
  ...POPUP_CLASSES,
  ...IME_CLASSES,
  ...AUXILIARY_OVERLAY_CLASSES,
  ...PROCESS_HELPER_CLASSES
])

// Win32 class names are compared case-insensitively by the window manager, and
// they are user-defined strings, so normalize before every comparison.
function normalizeClassName(name) {
  return String(name == null ? '' : name).trim().toLowerCase()
}

// Returns the category a blocked class belongs to, or null when it is allowed.
function getWindowClassCategory(className) {
  const key = normalizeClassName(className)
  if (!key) return null
  if (SYSTEM_CLASSES.has(key)) return 'system'
  if (SHELL_CLASSES.has(key)) return 'shell'
  if (POPUP_CLASSES.has(key)) return 'popup'
  if (IME_CLASSES.has(key)) return 'ime'
  if (AUXILIARY_OVERLAY_CLASSES.has(key)) return 'auxiliary-overlay'
  if (PROCESS_HELPER_CLASSES.has(key)) return 'process-helper'
  return null
}

function isBlockedWindowClass(className) {
  return getWindowClassCategory(className) !== null
}

function safeClassName(api, hwnd) {
  try {
    return (api.getClassName && api.getClassName(hwnd)) || ''
  } catch (_) {
    return ''
  }
}

// Decision codes for diagnostics. `reason` stays as the human-readable string
// (a few call sites branch on it), while `code` is the granular, stable id.
const CODES = {
  TARGET: 'TARGET',
  INVALID: 'IGNORE_INVALID',
  CHILD: 'IGNORE_CHILD',
  OWNER: 'IGNORE_OWNER',
  HIDDEN: 'IGNORE_HIDDEN',
  CLOAKED: 'IGNORE_CLOAKED',
  OWN_PROCESS: 'IGNORE_OWN_PROCESS',
  CLASS_SYSTEM: 'IGNORE_SYSTEM_CLASS',
  CLASS_SHELL: 'IGNORE_SHELL_CLASS',
  CLASS_POPUP: 'IGNORE_POPUP_CLASS',
  CLASS_IME: 'IGNORE_IME_CLASS',
  CLASS_AUXILIARY_OVERLAY: 'IGNORE_AUXILIARY_OVERLAY',
  CLASS_PROCESS_HELPER: 'IGNORE_PROCESS_HELPER'
}

const CATEGORY_CODES = {
  system: CODES.CLASS_SYSTEM,
  shell: CODES.CLASS_SHELL,
  popup: CODES.CLASS_POPUP,
  ime: CODES.CLASS_IME,
  'auxiliary-overlay': CODES.CLASS_AUXILIARY_OVERLAY,
  'process-helper': CODES.CLASS_PROCESS_HELPER
}

// ---------------------------------------------------------------------------
// Adapter contract.
//
// Every method is optional and guarded, so a caller can omit queries it cannot
// perform. IMPORTANT: there are NO per-consumer `checkX` flags — the concepts
// below are separate functions instead, so a caller never has to "turn off"
// part of the decision:
//
//   isWindow(hwnd)       -> bool
//   getStyle(hwnd)       -> number (GWL_STYLE)
//   getExStyle(hwnd)     -> number (GWL_EXSTYLE)      [diagnostics]
//   getOwner(hwnd)       -> hwnd|0  (GetWindow GW_OWNER)
//   getClassName(hwnd)   -> string
//   processIdOf(hwnd)    -> number
//   getProcessName(hwnd) -> string                    [diagnostics]
//   isVisible(hwnd)      -> bool
//   isCloaked(hwnd)      -> bool    (DWMWA_CLOAKED)
//   formatHwnd(hwnd)     -> string                    [diagnostics]
// ---------------------------------------------------------------------------

// ELIGIBILITY: "can this window EVER be a SnapAway target?" — existence,
// structure and the documented class exceptions. It deliberately says nothing
// about whether the window is visible right now: eligible != visible.
function evaluateWindowEligibility(api, hwnd, options = {}) {
  if (!api) return { eligible: false, code: CODES.INVALID, reason: 'no-window-api', className: '' }
  if (!hwnd) return { eligible: false, code: CODES.INVALID, reason: 'invalid-hwnd', className: '' }

  if (api.isWindow && !api.isWindow(hwnd)) {
    return { eligible: false, code: CODES.INVALID, reason: 'not-window', className: '' }
  }

  // Child windows are never targets: the root ancestor is the real window.
  if (api.getStyle) {
    const style = Number(api.getStyle(hwnd)) || 0
    if (style & WS_CHILD) {
      return { eligible: false, code: CODES.CHILD, reason: 'child-window', className: safeClassName(api, hwnd) }
    }
  }

  // Owned windows are menus, tooltips and dropdowns (and most modal dialogs).
  // This structural check removes the whole popup family without a class list.
  if (api.getOwner && api.getOwner(hwnd)) {
    return { eligible: false, code: CODES.OWNER, reason: 'owned-window', className: safeClassName(api, hwnd) }
  }

  // Documented class exceptions, on top of the structural decision.
  const className = safeClassName(api, hwnd)
  const classCategory = getWindowClassCategory(className)
  if (classCategory) {
    return {
      eligible: false,
      code: CATEGORY_CODES[classCategory] || CODES.INVALID,
      reason: 'blocked-class',
      classCategory,
      className
    }
  }

  if (typeof options.ownProcessId === 'number' && api.processIdOf) {
    if (api.processIdOf(hwnd) === options.ownProcessId) {
      return { eligible: false, code: CODES.OWN_PROCESS, reason: 'snapaway-process-window', className }
    }
  }

  return { eligible: true, code: CODES.TARGET, reason: 'eligible', className, classCategory: null }
}

// VISIBILITY is a STATE, not part of eligibility. A window can be eligible and
// hidden at the same time — that is exactly what SnapAway produces.
function evaluateWindowVisibility(api, hwnd) {
  if (!api || !hwnd) {
    return { displayable: false, code: CODES.INVALID, reason: 'invalid-hwnd', visible: null, cloaked: null }
  }

  let visible = null
  try { if (api.isVisible) visible = !!api.isVisible(hwnd) } catch (_) {}
  if (visible === false) {
    return { displayable: false, code: CODES.HIDDEN, reason: 'window-not-visible', visible, cloaked: null }
  }

  let cloaked = null
  try { if (api.isCloaked) cloaked = !!api.isCloaked(hwnd) } catch (_) {}
  if (cloaked === true) {
    return { displayable: false, code: CODES.CLOAKED, reason: 'cloaked-window', visible, cloaked }
  }

  return { displayable: true, code: CODES.TARGET, reason: 'displayable', visible, cloaked }
}

// Convenience for consumers that need both (e.g. the titlebar overlay):
// eligibility first, then visibility, returning a single decision shape.
function evaluateWindowTarget(api, hwnd, options = {}) {
  const eligibility = evaluateWindowEligibility(api, hwnd, options)
  if (!eligibility.eligible) return eligibility

  const visibility = evaluateWindowVisibility(api, hwnd)
  if (!visibility.displayable) {
    return {
      eligible: false,
      code: visibility.code,
      reason: visibility.reason,
      className: eligibility.className,
      classCategory: eligibility.classCategory,
      visible: visibility.visible,
      cloaked: visibility.cloaked
    }
  }

  return { ...eligibility, visible: visibility.visible, cloaked: visibility.cloaked }
}

// ---------------------------------------------------------------------------
// Diagnostics: local, opt-in window decision tracing (SNAPAWAY_WINDOW_DIAG=1).
// Turns "SnapAway didn't hide X" from manual investigation into a one-line log.
// ---------------------------------------------------------------------------
function isWindowDiagnosticsEnabled() {
  return process.env.SNAPAWAY_WINDOW_DIAG === '1'
}

function describeWindow(api, hwnd, options = {}) {
  const decision = evaluateWindowTarget(api, hwnd, options)
  const format = api && api.formatHwnd ? api.formatHwnd : (h) => String(h)
  const pick = (method) => {
    try { return method ? method(hwnd) : null } catch (_) { return null }
  }
  const ownerHwnd = pick(api && api.getOwner)
  const visibleRaw = pick(api && api.isVisible)
  const cloakedRaw = pick(api && api.isCloaked)
  return {
    hwnd: format(hwnd),
    root: format(hwnd), // callers pass the already-resolved root window
    className: decision.className || '',
    classCategory: decision.classCategory || null,
    process: pick(api && api.getProcessName) || '',
    pid: pick(api && api.processIdOf),
    owner: ownerHwnd ? format(ownerHwnd) : null,
    style: pick(api && api.getStyle),
    exStyle: pick(api && api.getExStyle),
    visible: visibleRaw === null ? null : !!visibleRaw,
    cloaked: cloakedRaw === null ? null : !!cloakedRaw,
    decision: decision.eligible ? 'TARGET' : 'IGNORE',
    code: decision.code,
    reason: decision.reason
  }
}

function logWindowDecision(api, hwnd, options = {}) {
  if (!isWindowDiagnosticsEnabled()) return null
  const info = describeWindow(api, hwnd, options)
  console.log('[WINDOW-DIAG]', JSON.stringify(info))
  return info
}

module.exports = {
  WS_CHILD,
  SYSTEM_CLASSES,
  SHELL_CLASSES,
  POPUP_CLASSES,
  IME_CLASSES,
  AUXILIARY_OVERLAY_CLASSES,
  PROCESS_HELPER_CLASSES,
  CODES,
  CATEGORY_CODES,
  normalizeClassName,
  getWindowClassCategory,
  isBlockedWindowClass,
  evaluateWindowEligibility,
  evaluateWindowVisibility,
  evaluateWindowTarget,
  isWindowDiagnosticsEnabled,
  describeWindow,
  logWindowDecision
}
