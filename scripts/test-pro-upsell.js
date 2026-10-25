// Verifica a elegibilidade da faixa de upsell do Pro (src/main/pro-upsell.js).
// Lógica pura (config falso), sem dependências de Electron/nativo.
//
// Regra atual: a faixa aparece a partir do SEGUNDO uso real — cada ciclo de
// ocultar + restaurar janelas conta como um uso.
//
// Run: npm run test:pro-upsell   (ou: node scripts/test-pro-upsell.js)
const assert = require('assert')
const { createProUpsell, todayKey, MIN_USAGE_COUNT, MAX_TRACKED_DAYS } = require('../src/main/pro-upsell')

let passed = 0
let failed = 0

function check(name, condition, detail) {
  if (condition) {
    passed += 1
    console.log(`PASS  ${name}`)
    return
  }
  failed += 1
  console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
}

function makeConfig(overrides = {}) {
  return Object.assign({
    isPro: false,
    proUpsellUsageCount: 0,
    proUpsellUsageDays: []
  }, overrides)
}

function makeUpsell(config, today = '2025-01-01', events = []) {
  return createProUpsell({
    config,
    now: () => new Date(`${today}T12:00:00`),
    track: (name, details) => events.push({ name, details })
  })
}

// --- todayKey -----------------------------------------------------------
check('todayKey uses the local calendar date (zero-padded)', todayKey(new Date(2025, 0, 5, 23, 30)) === '2025-01-05', todayKey(new Date(2025, 0, 5, 23, 30)))
check('todayKey pads single-digit month and day', todayKey(new Date(2025, 8, 9, 0, 5)) === '2025-09-09', todayKey(new Date(2025, 8, 9, 0, 5)))

// --- contagem de usos ---------------------------------------------------
check('threshold is the second use', MIN_USAGE_COUNT === 2, String(MIN_USAGE_COUNT))

{
  const config = makeConfig()
  const upsell = makeUpsell(config, '2025-01-01')
  const first = upsell.recordUsage()
  check('first use is counted', first.added === true && first.usageCount === 1, JSON.stringify(first))
  check('counter is persisted in config', config.proUpsellUsageCount === 1, JSON.stringify(config.proUpsellUsageCount))
  check('first usage day is tracked', Array.isArray(config.proUpsellUsageDays) && config.proUpsellUsageDays[0] === '2025-01-01', JSON.stringify(config.proUpsellUsageDays))
  check('one use is not enough to be eligible', upsell.isEligible() === false)
}

{
  const config = makeConfig()
  const upsell = makeUpsell(config, '2025-01-01')
  upsell.recordUsage()
  const second = upsell.recordUsage()
  check('two uses on the same day make the user eligible', second.added === true && second.usageCount === 2 && upsell.isEligible() === true, JSON.stringify(second))
  check('same day is not duplicated in the day list', config.proUpsellUsageDays.length === 1 && second.usageDayAdded === false, JSON.stringify(config.proUpsellUsageDays))
}

{
  const config = makeConfig()
  const first = makeUpsell(config, '2025-01-01')
  first.recordUsage()
  const second = makeUpsell(config, '2025-01-02')
  check('state reports the usage count', second.getState().usageCount === 1, JSON.stringify(second.getState()))
  check('state keeps the day count for diagnostics', second.getState().usageDayCount === 1, JSON.stringify(second.getState()))
  second.recordUsage()
  check('uses across different days also reach the threshold', second.isEligible() === true)
  check('two different days are tracked', config.proUpsellUsageDays.length === 2, JSON.stringify(config.proUpsellUsageDays))
}

{
  const config = makeConfig()
  const events = []
  const upsell = makeUpsell(config, '2025-01-01', events)
  upsell.recordUsage()
  check('eligibility is not tracked before the threshold', events.filter(e => e.name === 'retention.pro_upsell_eligible').length === 0, JSON.stringify(events))
  upsell.recordUsage()
  upsell.recordUsage()
  const eligible = events.filter(e => e.name === 'retention.pro_upsell_eligible')
  check('eligibility is tracked once at the threshold', eligible.length === 1, JSON.stringify(events))
  check('eligibility event carries usageCount', eligible[0] && eligible[0].details.usageCount === 2, JSON.stringify(eligible[0]))
}

{
  const config = makeConfig()
  const upsell = makeUpsell(config, '2025-01-01')
  const state = upsell.getState()
  check('state exposes eligible + minUsageCount', state.eligible === false && state.minUsageCount === MIN_USAGE_COUNT, JSON.stringify(state))
  check('state does not use the old minUsageDays field', state.minUsageDays === undefined, JSON.stringify(state))
}

// --- Migração de builds 1.2.x (só dias distintos) -----------------------
{
  const config = makeConfig({ proUpsellUsageCount: undefined, proUpsellUsageDays: ['2025-01-01', '2025-01-02'] })
  const upsell = makeUpsell(config, '2025-01-03')
  check('legacy day list seeds the usage count', upsell.getState().usageCount === 2, JSON.stringify(upsell.getState()))
  check('legacy day list keeps the user eligible', upsell.isEligible() === true)
  check('seeded count is written to the config', config.proUpsellUsageCount === 2, JSON.stringify(config.proUpsellUsageCount))
}

{
  const config = makeConfig({ proUpsellUsageCount: undefined, proUpsellUsageDays: ['2025-01-01', '2025-01-02', '2025-01-03'] })
  const upsell = makeUpsell(config, '2025-01-04')
  check('users with 3 legacy days stay eligible', upsell.isEligible() === true)
  upsell.recordUsage()
  check('new usage keeps incrementing from the seed', config.proUpsellUsageCount === 4, JSON.stringify(config.proUpsellUsageCount))
}

{
  const config = makeConfig({ proUpsellUsageCount: 'corrupted', proUpsellUsageDays: ['2025-01-01'] })
  const upsell = makeUpsell(config, '2025-01-02')
  check('corrupted counter falls back to the day list', upsell.getState().usageCount === 1, JSON.stringify(upsell.getState()))
}

// --- Usuários Pro nunca veem a faixa ------------------------------------
{
  const config = makeConfig({ isPro: true, proUpsellUsageCount: 10 })
  const upsell = makeUpsell(config, '2025-01-04')
  check('Pro users are never eligible', upsell.isEligible() === false)
  check('Pro users still get state without eligible flag', upsell.getState().eligible === false)
}

// --- Dispensa (só na execução atual) ------------------------------------
{
  const config = makeConfig({ proUpsellUsageCount: 2 })
  const events = []
  const upsell = makeUpsell(config, '2025-01-04', events)
  check('eligible before dismissal', upsell.isEligible() === true)
  upsell.markDismissed()
  check('dismissal hides the banner right away', upsell.isEligible() === false)
  check('state reports dismissed', upsell.getState().dismissed === true, JSON.stringify(upsell.getState()))
  check('dismissal is not persisted in config', config.proUpsellDismissedForever === undefined, JSON.stringify(config))
  check('dismissal is tracked', events.some(e => e.name === 'retention.pro_upsell_dismissed'))
  upsell.recordUsage()
  check('dismissal survives further usage in the same run', upsell.isEligible() === false)

  const nextRun = makeUpsell(config, '2025-01-05')
  check('banner comes back on the next app run', nextRun.isEligible() === true)
  check('next run starts with dismissed=false', nextRun.getState().dismissed === false)
}

// A flag legada `proUpsellDismissedForever` de builds antigos é ignorada.
{
  const config = makeConfig({ proUpsellUsageCount: 2, proUpsellDismissedForever: true })
  const upsell = makeUpsell(config, '2025-01-04')
  check('legacy permanent dismissal is ignored', upsell.isEligible() === true)
}

// --- Clique no CTA ------------------------------------------------------
{
  const config = makeConfig({ proUpsellUsageCount: 3 })
  const events = []
  makeUpsell(config, '2025-01-04', events).markClicked()
  const click = events.find(e => e.name === 'retention.pro_upsell_clicked')
  check('CTA click is tracked', !!click, JSON.stringify(events))
  check('CTA click carries usageCount', click && click.details.usageCount === 3, JSON.stringify(click))
}

// --- Cap da lista de dias -----------------------------------------------
{
  const config = makeConfig()
  const days = []
  for (let i = 0; i < MAX_TRACKED_DAYS + 10; i += 1) {
    days.push(todayKey(new Date(2025, 0, 1 + i)))
  }
  days.forEach(key => {
    createProUpsell({ config, now: () => new Date(`${key}T10:00:00`), track: () => {} }).recordUsage()
  })
  check('tracked days are capped', config.proUpsellUsageDays.length === MAX_TRACKED_DAYS, `length=${config.proUpsellUsageDays.length}`)
  check('cap keeps the most recent days', config.proUpsellUsageDays[config.proUpsellUsageDays.length - 1] === days[days.length - 1], JSON.stringify(config.proUpsellUsageDays.slice(-1)))
  check('usage count is not capped by the day list', config.proUpsellUsageCount === MAX_TRACKED_DAYS + 10, JSON.stringify(config.proUpsellUsageCount))
  check('still eligible after the cap', makeUpsell(config, '2026-01-01').isEligible() === true)
}

// --- Config quebrado não derruba a lógica --------------------------------
{
  const config = makeConfig({ proUpsellUsageDays: null })
  const upsell = makeUpsell(config, '2025-01-01')
  check('missing day list is treated as empty', upsell.getState().usageDayCount === 0)
  check('missing day list is not eligible', upsell.isEligible() === false)
  upsell.recordUsage()
  check('missing day list becomes a valid list', Array.isArray(config.proUpsellUsageDays) && config.proUpsellUsageDays.length === 1)
  check('usage count works without a day list', config.proUpsellUsageCount === 1, JSON.stringify(config.proUpsellUsageCount))
}

assert.ok(passed > 0)
console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
