// Verifica o casamento entre aceleradores do Electron (ex.: "Ctrl+F6") e eventos
// de teclado do DOM, usado pelo passo de prática do onboarding.
//
// Run: npm run test:accelerator   (ou: node scripts/test-accelerator.mjs)
import assert from 'node:assert'
import {
  KEYBOARD_ROWS,
  acceleratorKeyLabels,
  matchesAccelerator,
  normalizeEventKey,
  normalizeKeyName,
  parseAccelerator
} from '../src/renderer/utils/accelerator.mjs'

let passed = 0
let failed = 0

function check (name, condition, detail = '') {
  if (condition) {
    passed++
    console.log(`PASS  ${name}`)
    return
  }
  failed++
  console.error(`FAIL  ${name}${detail ? ` -> ${detail}` : ''}`)
}

function keyEvent (init) {
  return {
    key: 'Unidentified',
    code: '',
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...init
  }
}

// --- parseAccelerator -------------------------------------------------------
check('parseAccelerator("Ctrl+F6") key', parseAccelerator('Ctrl+F6').key === 'F6')
check('parseAccelerator("Ctrl+F6") modifiers', JSON.stringify(parseAccelerator('Ctrl+F6').modifiers) === '["ctrl"]',
  JSON.stringify(parseAccelerator('Ctrl+F6').modifiers))
check('parseAccelerator("F6") sem modificadores', parseAccelerator('F6').modifiers.length === 0)
check('parseAccelerator("CommandOrControl+Alt+H") normaliza', JSON.stringify(parseAccelerator('CommandOrControl+Alt+H').modifiers) === '["ctrl","alt"]',
  JSON.stringify(parseAccelerator('CommandOrControl+Alt+H').modifiers))
check('parseAccelerator("Shift+Ctrl+F6") ordem preservada', JSON.stringify(parseAccelerator('Shift+Ctrl+F6').modifiers) === '["shift","ctrl"]',
  JSON.stringify(parseAccelerator('Shift+Ctrl+F6').modifiers))
check('parseAccelerator("") vazio', parseAccelerator('').key === '' && parseAccelerator('').modifiers.length === 0)
check('parseAccelerator(null) não lança', parseAccelerator(null).key === '')
check('parseAccelerator("Super+H") vira meta', JSON.stringify(parseAccelerator('Super+H').modifiers) === '["meta"]',
  JSON.stringify(parseAccelerator('Super+H').modifiers))

// --- normalizeKeyName / normalizeEventKey ----------------------------------
check('normalizeKeyName("f6") = F6', normalizeKeyName('f6') === 'F6')
check('normalizeKeyName(" ") = SPACE', normalizeKeyName(' ') === 'SPACE')
check('normalizeKeyName("esc") = ESC', normalizeKeyName('esc') === 'ESC')
check('normalizeEventKey(code=KeyH) = H', normalizeEventKey(keyEvent({ code: 'KeyH', key: 'h' })) === 'H')
check('normalizeEventKey(code=Digit1) = 1', normalizeEventKey(keyEvent({ code: 'Digit1', key: '1' })) === '1')
check('normalizeEventKey(code=F6) = F6', normalizeEventKey(keyEvent({ code: 'F6', key: 'F6' })) === 'F6')
check('normalizeEventKey(code=Space) = SPACE', normalizeEventKey(keyEvent({ code: 'Space', key: ' ' })) === 'SPACE')
check('normalizeEventKey(code=vazio, key="f6") = F6', normalizeEventKey(keyEvent({ key: 'f6' })) === 'F6')
check('normalizeEventKey(null) = ""', normalizeEventKey(null) === '')

// --- matchesAccelerator ----------------------------------------------------
const f6 = keyEvent({ code: 'F6', key: 'F6' })
const ctrlF6 = keyEvent({ code: 'F6', key: 'F6', ctrlKey: true })
const ctrlShiftF6 = keyEvent({ code: 'F6', key: 'F6', ctrlKey: true, shiftKey: true })

check('F6 casa com F6', matchesAccelerator(f6, 'F6') === true)
check('F6 não casa com Ctrl+F6', matchesAccelerator(f6, 'Ctrl+F6') === false)
check('Ctrl+F6 casa com Ctrl+F6', matchesAccelerator(ctrlF6, 'Ctrl+F6') === true)
check('Ctrl+F6 não casa com F6', matchesAccelerator(ctrlF6, 'F6') === false)
check('Ctrl+Shift+F6 não casa com Ctrl+F6 (modificador extra)', matchesAccelerator(ctrlShiftF6, 'Ctrl+F6') === false)
check('Ctrl+F6 não casa com Ctrl+Shift+F6 (modificador ausente)', matchesAccelerator(ctrlF6, 'Ctrl+Shift+F6') === false)
check('Ctrl+Alt+H casa com Ctrl+Alt+H',
  matchesAccelerator(keyEvent({ code: 'KeyH', key: 'h', ctrlKey: true, altKey: true }), 'Ctrl+Alt+H') === true)
check('Ctrl+Alt+S casa com CommandOrControl+Alt+S',
  matchesAccelerator(keyEvent({ code: 'KeyS', key: 's', ctrlKey: true, altKey: true }), 'CommandOrControl+Alt+S') === true)
check('Acelerador vazio nunca casa', matchesAccelerator(f6, '') === false)
check('Evento nulo nunca casa', matchesAccelerator(null, 'F6') === false)
check('event.repeat é irrelevante para o matcher', matchesAccelerator({ ...f6, repeat: true }, 'F6') === true)

// --- acceleratorKeyLabels --------------------------------------------------
check('acceleratorKeyLabels("F6")', JSON.stringify(acceleratorKeyLabels('F6')) === '["F6"]',
  JSON.stringify(acceleratorKeyLabels('F6')))
check('acceleratorKeyLabels("Ctrl+F6")', JSON.stringify(acceleratorKeyLabels('Ctrl+F6')) === '["Ctrl","F6"]',
  JSON.stringify(acceleratorKeyLabels('Ctrl+F6')))
check('acceleratorKeyLabels("Ctrl+Alt+H")', JSON.stringify(acceleratorKeyLabels('Ctrl+Alt+H')) === '["Ctrl","Alt","H"]',
  JSON.stringify(acceleratorKeyLabels('Ctrl+Alt+H')))
check('acceleratorKeyLabels("Super+F6") usa Win', JSON.stringify(acceleratorKeyLabels('Super+F6')) === '["Win","F6"]',
  JSON.stringify(acceleratorKeyLabels('Super+F6')))
check('acceleratorKeyLabels("Space") usa rótulo desenhado', JSON.stringify(acceleratorKeyLabels('Space')) === '["Space"]',
  JSON.stringify(acceleratorKeyLabels('Space')))

// --- Teclado desenhado -----------------------------------------------------
const drawnLabels = new Set(KEYBOARD_ROWS.flat())
const drawableAccelerators = ['F6', 'Ctrl+F6', 'Ctrl+Alt+H', 'Shift+F6', 'Win+F6', 'Space', 'Escape', 'Ctrl+1']
for (const accelerator of drawableAccelerators) {
  const labels = acceleratorKeyLabels(accelerator)
  check(`teclado desenhado contém todas as teclas de ${accelerator}`, labels.every((label) => drawnLabels.has(label)),
    `faltando: ${labels.filter((label) => !drawnLabels.has(label)).join(', ')}`)
}
check('teclado tem 12 teclas de função', KEYBOARD_ROWS[0].filter((label) => /^F\d{1,2}$/.test(label)).length === 12)
check('F6 aparece uma única vez no teclado', KEYBOARD_ROWS.flat().filter((label) => label === 'F6').length === 1)
check('teclado tem Ctrl dos dois lados', KEYBOARD_ROWS.flat().filter((label) => label === 'Ctrl').length === 2)

console.log(`\n${passed} passed, ${failed} failed`)
assert.strictEqual(failed, 0)
