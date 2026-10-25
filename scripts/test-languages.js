// Garante que nenhuma string traduzida caia silenciosamente no fallback do inglês
// (src/language/language.js faz merge de texts.en com o idioma escolhido).
//
// Run: npm run test:languages   (ou: node scripts/test-languages.js)
const assert = require('assert')
const path = require('path')
const texts = require('../src/language/texts.json')

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

const en = texts.en
const languages = Object.keys(texts)
const enKeys = Object.keys(en)

check('existe o idioma base "en"', !!en)

for (const lang of languages) {
  if (lang === 'en') continue

  const dict = texts[lang]
  const missing = enKeys.filter((key) => !(key in dict))
  check(`${lang}: ${enKeys.length} chaves`, missing.length === 0, `faltam ${missing.slice(0, 5).join(', ')}`)

  const empty = enKeys.filter((key) => key in dict && !String(dict[key]).trim())
  check(`${lang}: nenhum valor vazio`, empty.length === 0, empty.slice(0, 5).join(', '))

  // {0} / {1} são trocados por String.replace no main; se a tradução perder o
  // marcador a mensagem sai sem o nome do recurso.
  const placeholderBreaks = enKeys.filter((key) => {
    if (!(key in dict)) return false
    const count = (s) => (String(s).match(/\{\d+\}/g) || []).length
    return count(en[key]) !== count(dict[key])
  })
  check(`${lang}: marcadores {n} preservados`, placeholderBreaks.length === 0, placeholderBreaks.slice(0, 5).join(', '))
}

// getRevealHintNotificationBody() substitui o literal "Ctrl+F6" pelo atalho real,
// então toda tradução precisa citar exatamente esse texto.
for (const lang of languages) {
  const body = texts[lang].REVEAL_HINT_NOTIFICATION_BODY
  check(`${lang}: dica de restauração cita Ctrl+F6`, typeof body === 'string' && body.includes('Ctrl+F6'), body)
}

// As opções de recurso Pro e o pedido de avaliação são o que aparece no momento
// em que o usuário decide comprar; não podem sobrar em inglês.
for (const key of ['PRO_UPSELL_TITLE', 'PRO_UPSELL_CTA', 'PRO_UPSELL_DISMISS', 'REVIEW_TITLE', 'REVIEW_RATE_NOW']) {
  for (const lang of languages) {
    check(`${lang}: ${key} presente`, !!texts[lang][key])
  }
}

console.log(`\n${passed} passed, ${failed} failed`)
assert.strictEqual(failed, 0)
