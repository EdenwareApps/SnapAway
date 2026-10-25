// Timing instrumentation for the hide/show transitions ("time to disappear").
//
// t0 is taken as close as possible to the user gesture (the hide/show toggle in
// the main process) and every window records its own delta. A one-line summary
// is always logged; per-window detail is opt-in via SNAPAWAY_WINDOW_DIAG=1 or
// SNAPAWAY_TRACE_DIAG=1.
//
// Goal: an objective number (perceptually instant is ~50-150 ms) and visibility
// into windows that resist (elevated processes) or are left behind.

const round1 = (value) => Math.round(value * 10) / 10

// Captured once on purpose: several call sites below have a local variable
// named `process` (the executable basename), so this must not resolve `process`
// lazily inside those scopes.
const monotonicNowMs = () => Number(process.hrtime.bigint()) / 1e6

function createTransitionTrace(kind, source) {
  return {
    kind: kind === 'show' ? 'show' : 'hide',
    source: source || 'unknown',
    t0: monotonicNowMs(),
    steps: {},
    windows: []
  }
}

function markTransitionStep(trace, step) {
  if (!trace || !step) return null
  const ms = round1(monotonicNowMs() - trace.t0)
  trace.steps[step] = ms
  return ms
}

function markTransitionWindow(trace, hwnd, processName, outcome) {
  if (!trace) return null
  const ms = round1(monotonicNowMs() - trace.t0)
  trace.windows.push({
    hwnd: hwnd == null ? '' : String(hwnd),
    process: processName || '',
    outcome: outcome || 'unknown',
    ms
  })
  return ms
}

function summarizeTransitionTrace(trace) {
  if (!trace) return null
  const byOutcome = {}
  let slowest = null
  for (const window of trace.windows) {
    byOutcome[window.outcome] = (byOutcome[window.outcome] || 0) + 1
    if (!slowest || window.ms > slowest.ms) slowest = window
  }
  return {
    kind: trace.kind,
    source: trace.source,
    elapsedMs: round1(monotonicNowMs() - trace.t0),
    byOutcome,
    slowest,
    steps: { ...trace.steps },
    windows: trace.windows
  }
}

function isTransitionTraceDetailEnabled() {
  return process.env.SNAPAWAY_WINDOW_DIAG === '1' || process.env.SNAPAWAY_TRACE_DIAG === '1'
}

// Always logs one summary line; logs a line per window when detail is enabled.
function logTransitionTrace(trace, extra = {}) {
  if (!trace) return null
  const summary = summarizeTransitionTrace(trace)
  const tag = `[TRACE-${summary.kind.toUpperCase()}]`
  const outcomes = Object.entries(summary.byOutcome).map(([key, count]) => `${key}=${count}`).join(' ')
  const steps = Object.entries(summary.steps).map(([key, ms]) => `${key}=${ms}ms`).join(' ')
  const slowest = summary.slowest
    ? `slowest=${summary.slowest.ms}ms(${summary.slowest.process || summary.slowest.hwnd}:${summary.slowest.outcome})`
    : 'slowest=n/a'
  const note = extra.note ? ` note=${extra.note}` : ''

  console.log(`${tag} source=${summary.source} total=${summary.elapsedMs}ms ${slowest}${outcomes ? ' ' + outcomes : ''}${steps ? ' ' + steps : ''}${note}`)

  if (isTransitionTraceDetailEnabled()) {
    for (const window of summary.windows) {
      console.log(`${tag} ${window.ms}ms ${window.outcome} ${window.process || '?'} ${window.hwnd}`)
    }
  }
  return summary
}

module.exports = {
  monotonicNowMs,
  createTransitionTrace,
  markTransitionStep,
  markTransitionWindow,
  summarizeTransitionTrace,
  logTransitionTrace,
  isTransitionTraceDetailEnabled
}
