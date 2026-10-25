// Verifies the hide/show transition timing instrumentation (no Win32 involved).
//
// Run: npm run test:transition-trace   (or: node scripts/test-window-transition-trace.js)
const assert = require('assert')
const {
  createTransitionTrace,
  markTransitionStep,
  markTransitionWindow,
  summarizeTransitionTrace,
  logTransitionTrace
} = require('../src/shared/window-transition-trace')

const results = []
function check(name, fn) {
  try {
    fn()
    results.push(['PASS', name])
  } catch (error) {
    results.push(['FAIL', `${name} — ${error.message}`])
  }
}

function withCapturedLogs(fn) {
  const lines = []
  const original = console.log
  console.log = (...args) => lines.push(args.join(' '))
  try {
    const value = fn()
    return { lines, value }
  } finally {
    console.log = original
  }
}

check('createTransitionTrace defaults', () => {
  const hide = createTransitionTrace('hide', 'shortcut')
  assert.strictEqual(hide.kind, 'hide')
  assert.strictEqual(hide.source, 'shortcut')
  assert.deepStrictEqual(hide.windows, [])
  assert.deepStrictEqual(hide.steps, {})

  const show = createTransitionTrace('show')
  assert.strictEqual(show.kind, 'show')
  assert.strictEqual(show.source, 'unknown')

  const bogus = createTransitionTrace('nonsense')
  assert.strictEqual(bogus.kind, 'hide', 'unknown kind falls back to hide')
})

check('steps and window marks are recorded in order', () => {
  const trace = createTransitionTrace('hide', 'shortcut')
  const stepMs = markTransitionStep(trace, 'snapshot')
  assert.ok(typeof stepMs === 'number' && stepMs >= 0)
  assert.strictEqual(trace.steps.snapshot, stepMs)

  markTransitionWindow(trace, 0x1234, 'chrome.exe', 'hidden')
  markTransitionWindow(trace, 0x5678, 'chrome.exe', 'elevated-pending')
  markTransitionWindow(trace, 0x9abc, 'wmp.exe', 'queued-hung')

  assert.strictEqual(trace.windows.length, 3)
  assert.strictEqual(trace.windows[0].hwnd, '4660')
  assert.strictEqual(trace.windows[0].outcome, 'hidden')
  assert.strictEqual(trace.windows[0].process, 'chrome.exe')
  assert.ok(trace.windows.every(w => typeof w.ms === 'number' && w.ms >= 0))
})

check('summarize aggregates outcomes and finds the slowest window', () => {
  const trace = createTransitionTrace('hide', 'shortcut')
  markTransitionWindow(trace, 1, 'chrome.exe', 'hidden')
  markTransitionWindow(trace, 2, 'chrome.exe', 'hidden')
  // Spin briefly so the elevated mark is unambiguously the slowest: marks made
  // back-to-back can round to the same 0.1 ms bucket.
  const spinUntil = Date.now() + 5
  while (Date.now() < spinUntil) { /* deterministic-enough delay */ }
  markTransitionWindow(trace, 3, 'roblox.exe', 'elevated-pending')

  const summary = summarizeTransitionTrace(trace)
  assert.strictEqual(summary.kind, 'hide')
  assert.strictEqual(summary.source, 'shortcut')
  assert.deepStrictEqual(summary.byOutcome, { hidden: 2, 'elevated-pending': 1 })
  assert.ok(summary.slowest, 'slowest must be present')
  assert.strictEqual(summary.slowest.outcome, 'elevated-pending')
  assert.ok(summary.elapsedMs >= summary.windows[summary.windows.length - 1].ms,
    'elapsed must be >= the last window mark')
})

check('mark helpers are null-safe (hide path may run without a trace)', () => {
  assert.strictEqual(markTransitionStep(null, 'x'), null)
  assert.strictEqual(markTransitionWindow(null, 1, 'a.exe', 'hidden'), null)
  assert.strictEqual(summarizeTransitionTrace(null), null)
  assert.strictEqual(logTransitionTrace(null), null)
})

check('logTransitionTrace emits one summary line by default', () => {
  delete process.env.SNAPAWAY_TRACE_DIAG
  delete process.env.SNAPAWAY_WINDOW_DIAG

  const trace = createTransitionTrace('hide', 'shortcut')
  markTransitionStep(trace, 'snapshot')
  markTransitionWindow(trace, 1, 'chrome.exe', 'hidden')
  markTransitionWindow(trace, 2, 'roblox.exe', 'elevated-pending')

  const { lines, value } = withCapturedLogs(() => logTransitionTrace(trace))
  assert.strictEqual(lines.length, 1, 'summary only')
  assert.ok(lines[0].startsWith('[TRACE-HIDE] source=shortcut total='), lines[0])
  assert.ok(lines[0].includes('hidden=1'), lines[0])
  assert.ok(lines[0].includes('elevated-pending=1'), lines[0])
  assert.ok(lines[0].includes('slowest='), lines[0])
  assert.ok(lines[0].includes('snapshot='), lines[0])
  assert.ok(value && value.kind === 'hide')
})

check('logTransitionTrace emits per-window lines when detail is enabled', () => {
  process.env.SNAPAWAY_TRACE_DIAG = '1'
  try {
    const trace = createTransitionTrace('show', 'floating-button')
    markTransitionWindow(trace, 1, 'chrome.exe', 'shown')
    markTransitionWindow(trace, 2, 'wmp.exe', 'still-hidden')

    const { lines } = withCapturedLogs(() => logTransitionTrace(trace))
    assert.strictEqual(lines.length, 3, 'summary + 2 windows')
    assert.ok(lines[0].startsWith('[TRACE-SHOW] source=floating-button'))
    assert.ok(lines[1].includes('shown chrome.exe'))
    assert.ok(lines[2].includes('still-hidden wmp.exe'))
  } finally {
    delete process.env.SNAPAWAY_TRACE_DIAG
  }
})

let failed = 0
for (const [status, name] of results) {
  if (status === 'FAIL') failed += 1
  console.log(`${status}  ${name}`)
}
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
