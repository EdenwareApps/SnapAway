// Verifies the shared window-eligibility decision WITHOUT touching Win32.
// The decision is pure: it only calls the adapter methods we provide here.
//
// Run: npm run test:window-eligibility   (or: node scripts/test-window-eligibility.js)
const assert = require('assert')
const {
  evaluateWindowEligibility,
  evaluateWindowVisibility,
  evaluateWindowTarget,
  describeWindow,
  isBlockedWindowClass,
  normalizeClassName,
  getWindowClassCategory,
  CODES
} = require('../src/shared/window-eligibility')

const WS_CHILD = 0x40000000

function makeApi(overrides = {}) {
  return {
    isWindow: () => true,
    getStyle: () => 0x00cf0000,
    getExStyle: () => 0,
    getOwner: () => 0,
    getClassName: () => 'MyAppWindow',
    processIdOf: () => 1234,
    getProcessName: () => 'myapp.exe',
    isVisible: () => true,
    isCloaked: () => false,
    formatHwnd: (h) => `0x${Number(h).toString(16)}`,
    ...overrides
  }
}

const results = []
function check(name, fn) {
  try {
    fn()
    results.push(['PASS', name])
  } catch (error) {
    results.push(['FAIL', `${name} — ${error.message}`])
  }
}

// --- eligibility (structure + class), independent of visibility ------------

check('normal app window is eligible', () => {
  const r = evaluateWindowEligibility(makeApi(), 1, { ownProcessId: 999 })
  assert.strictEqual(r.eligible, true)
  assert.strictEqual(r.code, CODES.TARGET)
})

check('owned window (menu) is rejected structurally', () => {
  const r = evaluateWindowEligibility(makeApi({ getClassName: () => '#32768', getOwner: () => 42 }), 1, { ownProcessId: 999 })
  assert.strictEqual(r.eligible, false)
  assert.strictEqual(r.code, CODES.OWNER)
  assert.strictEqual(r.reason, 'owned-window')
})

check('unowned menu class is rejected by documented exception', () => {
  const r = evaluateWindowEligibility(makeApi({ getClassName: () => '#32768' }), 1, { ownProcessId: 999 })
  assert.strictEqual(r.eligible, false)
  assert.strictEqual(r.code, CODES.CLASS_POPUP)
  assert.strictEqual(r.classCategory, 'popup')
})

check('tooltip / combo dropdown rejected', () => {
  assert.strictEqual(evaluateWindowEligibility(makeApi({ getClassName: () => 'tooltips_class32' }), 1).code, CODES.CLASS_POPUP)
  assert.strictEqual(evaluateWindowEligibility(makeApi({ getClassName: () => 'ComboLBox' }), 1).code, CODES.CLASS_POPUP)
})

check('shell / system / IME / auxiliary-overlay classes are categorized', () => {
  assert.strictEqual(evaluateWindowEligibility(makeApi({ getClassName: () => 'Windows.UI.Core.CoreWindow' }), 1).code, CODES.CLASS_SHELL)
  assert.strictEqual(evaluateWindowEligibility(makeApi({ getClassName: () => 'Shell_TrayWnd' }), 1).code, CODES.CLASS_SYSTEM)
  assert.strictEqual(evaluateWindowEligibility(makeApi({ getClassName: () => 'MSCTFIME UI' }), 1).code, CODES.CLASS_IME)
  assert.strictEqual(evaluateWindowEligibility(makeApi({ getClassName: () => 'Intermediate D3D Window' }), 1).code, CODES.CLASS_AUXILIARY_OVERLAY)
})

// Evidence (Spotify, live): the process owns a Chrome_WidgetWin_0 at 1440x753
// and a crashpad_SessionEndWatcher; both are top-level and unowned, so without
// this exception they were hidden and later restored as an empty window.
check('chromium / crashpad helper windows are rejected', () => {
  for (const cls of ['Chrome_WidgetWin_0', 'crashpad_SessionEndWatcher']) {
    const r = evaluateWindowEligibility(makeApi({ getClassName: () => cls }), 1)
    assert.strictEqual(r.eligible, false, `${cls} must be rejected`)
    assert.strictEqual(r.code, CODES.CLASS_PROCESS_HELPER, `${cls} code`)
    assert.strictEqual(r.classCategory, 'process-helper', `${cls} category`)
  }
})

check('the real Chromium app window class stays eligible', () => {
  for (const cls of ['Chrome_WidgetWin_1', 'Chrome_WidgetWin_2']) {
    assert.strictEqual(evaluateWindowEligibility(makeApi({ getClassName: () => cls }), 1).eligible, true, `${cls} must stay eligible`)
  }
})

check('class match is case-insensitive / trimmed', () => {
  assert.ok(isBlockedWindowClass('SHELL_TRAYWND'))
  assert.ok(isBlockedWindowClass('  Shell_TrayWnd  '))
  assert.strictEqual(getWindowClassCategory('SHELL_TRAYWND'), 'system')
})

check('child window is rejected', () => {
  const r = evaluateWindowEligibility(makeApi({ getStyle: () => WS_CHILD }), 1)
  assert.strictEqual(r.code, CODES.CHILD)
})

check('own process is rejected when ownProcessId is provided', () => {
  const r = evaluateWindowEligibility(makeApi({ processIdOf: () => 4242 }), 1, { ownProcessId: 4242 })
  assert.strictEqual(r.code, CODES.OWN_PROCESS)
})

check('game classes are NOT sufficient reason to reject a window', () => {
  for (const cls of ['UnityWndClass', 'UnrealWindow', 'SDL_app', 'PX_WINDOW_CLASS']) {
    const r = evaluateWindowEligibility(makeApi({ getClassName: () => cls }), 1)
    assert.strictEqual(r.eligible, true, `${cls} should be eligible`)
  }
})

check('eligibility ignores visibility (eligible != visible)', () => {
  assert.strictEqual(evaluateWindowEligibility(makeApi({ isVisible: () => false }), 1).eligible, true)
  assert.strictEqual(evaluateWindowEligibility(makeApi({ isCloaked: () => true }), 1).eligible, true)
})

// --- visibility (state), a separate concept --------------------------------

check('visibility reports hidden and cloaked', () => {
  const hidden = evaluateWindowVisibility(makeApi({ isVisible: () => false }), 1)
  assert.strictEqual(hidden.displayable, false)
  assert.strictEqual(hidden.code, CODES.HIDDEN)

  const cloaked = evaluateWindowVisibility(makeApi({ isCloaked: () => true }), 1)
  assert.strictEqual(cloaked.displayable, false)
  assert.strictEqual(cloaked.code, CODES.CLOAKED)

  const ok = evaluateWindowVisibility(makeApi(), 1)
  assert.strictEqual(ok.displayable, true)
  assert.strictEqual(ok.visible, true)
  assert.strictEqual(ok.cloaked, false)
})

// --- combined target (eligibility first, then visibility) -------------------

check('target: hidden eligible window -> IGNORE_HIDDEN', () => {
  const r = evaluateWindowTarget(makeApi({ isVisible: () => false }), 1)
  assert.strictEqual(r.eligible, false)
  assert.strictEqual(r.code, CODES.HIDDEN)
})

check('target: blocked class wins over hidden state', () => {
  const r = evaluateWindowTarget(makeApi({ getClassName: () => 'Shell_TrayWnd', isVisible: () => false }), 1)
  assert.strictEqual(r.code, CODES.CLASS_SYSTEM)
})

// --- diagnostics ------------------------------------------------------------

check('describeWindow exposes the full decision trace', () => {
  const info = describeWindow(makeApi({ getClassName: () => 'Chrome_WidgetWin_1', processIdOf: () => 777 }), 1)
  assert.strictEqual(info.decision, 'TARGET')
  assert.strictEqual(info.code, CODES.TARGET)
  assert.strictEqual(info.className, 'Chrome_WidgetWin_1')
  assert.strictEqual(info.process, 'myapp.exe')
  assert.strictEqual(info.pid, 777)
  assert.strictEqual(info.visible, true)
  assert.strictEqual(info.cloaked, false)
  assert.ok(Object.prototype.hasOwnProperty.call(info, 'style'))
  assert.ok(Object.prototype.hasOwnProperty.call(info, 'exStyle'))
  assert.ok(Object.prototype.hasOwnProperty.call(info, 'root'))
})

check('normalizeClassName handles null and casing', () => {
  assert.strictEqual(normalizeClassName(null), '')
  assert.strictEqual(normalizeClassName('  Chrome_WidgetWin_1 '), 'chrome_widgetwin_1')
})

let failed = 0
for (const [status, name] of results) {
  if (status === 'FAIL') failed += 1
  console.log(`${status}  ${name}`)
}
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
