// Verifica a rotação do log persistente de telemetria (src/main/telemetry-log.js).
// Sem dependência de Electron: trabalha num diretório temporário isolado.
//
// Run: npm run test:telemetry-log   (ou: node scripts/test-telemetry-log.js)
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const telemetryLog = require('../src/main/telemetry-log')

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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snapaway-telemetry-log-'))
const logPath = path.join(tmpDir, 'iap-telemetry.log')
const rotatedPath = path.join(tmpDir, 'iap-telemetry.1.log')

function writeLines(count, sizePerLine, marker) {
  let payload = ''
  for (let i = 0; i < count; i += 1) {
    payload += `${marker}-${String(i).padStart(6, '0')}-${'x'.repeat(Math.max(0, sizePerLine - 20))}${os.EOL}`
  }
  fs.appendFileSync(logPath, payload, 'utf8')
}

function reset() {
  fs.rmSync(logPath, { force: true })
  fs.rmSync(rotatedPath, { force: true })
}

try {
  // 1) Caminho derivado da geração anterior.
  check('rotated path uses .1.log suffix', telemetryLog.getRotatedPath(logPath) === rotatedPath, telemetryLog.getRotatedPath(logPath))
  check('rotated path keeps .log files distinct', telemetryLog.getRotatedPath('C:\\x\\iaptelemetry.txt') !== 'C:\\x\\iaptelemetry.txt')

  // 2) Log inexistente: nada para rotacionar.
  reset()
  check('missing log does not rotate', telemetryLog.rotateLogIfNeeded(logPath) === false)

  // 3) Abaixo do limite: não rotaciona.
  writeLines(2, 100, 'small')
  const smallSize = fs.statSync(logPath).size
  check('below limit does not rotate', telemetryLog.rotateLogIfNeeded(logPath, smallSize + 1) === false)
  check('below limit keeps original file', fs.existsSync(logPath) && !fs.existsSync(rotatedPath))

  // 4) No limite: rotaciona e move o conteúdo para a geração anterior.
  check('at limit rotates', telemetryLog.rotateLogIfNeeded(logPath, smallSize) === true)
  check('rotation moves content to .1.log', fs.existsSync(rotatedPath) && !fs.existsSync(logPath))
  check('rotated content preserved', fs.readFileSync(rotatedPath, 'utf8').startsWith('small-000000-'))

  // 5) Segunda rotação descarta a geração anterior (rename no Windows falha se o destino existe).
  writeLines(3, 120, 'second')
  check('second rotation succeeds', telemetryLog.rotateLogIfNeeded(logPath, fs.statSync(logPath).size) === true)
  check('rotation keeps a single generation', fs.readdirSync(tmpDir).filter(n => n.endsWith('.log')).length === 1)
  check('latest content wins the .1.log slot', fs.readFileSync(rotatedPath, 'utf8').startsWith('second-000000-'))

  // 6) appendTelemetryLogLine rotaciona e grava no arquivo novo.
  reset()
  writeLines(4, 200, 'old')
  const rotateAt = fs.statSync(logPath).size
  telemetryLog.appendTelemetryLogLine(logPath, `new-line${os.EOL}`, rotateAt)
  check('append rotates when limit reached', fs.existsSync(rotatedPath) && fs.existsSync(logPath))
  check('append writes only the new line', fs.readFileSync(logPath, 'utf8') === `new-line${os.EOL}`, JSON.stringify(fs.readFileSync(logPath, 'utf8')))
  check('append kept old content in .1.log', fs.readFileSync(rotatedPath, 'utf8').startsWith('old-000000-'))

  // 7) Sem limite atingido, append só acrescenta (comportamento original).
  telemetryLog.appendTelemetryLogLine(logPath, `second-new${os.EOL}`, 1024 * 1024)
  check('append without rotation keeps both lines', fs.readFileSync(logPath, 'utf8') === `new-line${os.EOL}second-new${os.EOL}`)

  // 8) Limite inválido cai no default de 512 KB.
  check('default max is 512 KB', telemetryLog.DEFAULT_MAX_BYTES === 512 * 1024, String(telemetryLog.DEFAULT_MAX_BYTES))
  check('default max keeps the log pair under 1 MB', telemetryLog.DEFAULT_MAX_BYTES * 2 === 1024 * 1024)
  check('invalid max falls back to default', telemetryLog.rotateLogIfNeeded(logPath, 0) === false)
} catch (error) {
  failed += 1
  console.log(`FAIL  unexpected error — ${error && error.stack ? error.stack : error}`)
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true })
}

console.log(`\n${passed} passed, ${failed} failed`)
assert.strictEqual(failed, 0)
