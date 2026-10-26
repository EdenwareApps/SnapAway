// Verifica a comparacao de versoes usada pelo aviso de atualizacao
// (src/main/update-check.js). Sem dependencia de Electron.
//
// Run: npm run test:version-compare   (ou: node scripts/test-version-compare.js)
const { isNewerVersion, parseVersion } = require('../src/main/update-check')

let passed = 0
let failed = 0

function check(name, condition, detail) {
  if (condition) {
    passed += 1
    console.log(`PASS  ${name}`)
    return
  }
  failed += 1
  console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ''}`)
}

function checkEqual(name, actual, expected) {
  check(name, JSON.stringify(actual) === JSON.stringify(expected), `recebido ${JSON.stringify(actual)}`)
}

// parseVersion
checkEqual('parseVersion 1.2.4', parseVersion('1.2.4'), [1, 2, 4, 0])
checkEqual('parseVersion v1.2', parseVersion('v1.2'), [1, 2, 0, 0])
checkEqual('parseVersion 1.2.4.0', parseVersion('1.2.4.0'), [1, 2, 4, 0])
checkEqual('parseVersion pre-release', parseVersion(' 1.3.0-beta.1 '), [1, 3, 0, 0])
checkEqual('parseVersion vazio', parseVersion(''), null)
checkEqual('parseVersion null', parseVersion(null), null)
checkEqual('parseVersion invalido', parseVersion('sem versao'), null)

// Comparacoes que a comparacao de string errava
check('1.10.0 > 1.9.0', isNewerVersion('1.10.0', '1.9.0'))
check('1.2.10 > 1.2.9', isNewerVersion('1.2.10', '1.2.9'))
check('1.3 > 1.2.99', isNewerVersion('1.3', '1.2.99'))

// Casos do dia a dia
check('1.2.5 > 1.2.4', isNewerVersion('1.2.5', '1.2.4'))
check('mesma versao nao avisa', !isNewerVersion('1.2.4', '1.2.4'))
check('1.2.4 nao avisa para quem esta em 1.2.4.0', !isNewerVersion('1.2.4', '1.2.4.0'))
check('versao menor nao avisa', !isNewerVersion('1.2.3', '1.2.4'))
check('2.0.0 > 1.99.99', isNewerVersion('2.0.0', '1.99.99'))

// Entradas invalidas (update.json ausente, 204 sem corpo, campo faltando)
check('remote invalido nao avisa', !isNewerVersion(undefined, '1.2.4'))
check('remote vazio nao avisa', !isNewerVersion('', '1.2.4'))
check('local invalido nao avisa', !isNewerVersion('1.2.5', undefined))

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
