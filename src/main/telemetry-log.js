/**
 * telemetry-log.js
 * Escrita do log persistente de telemetria (iap-telemetry.log) com rotação
 * por tamanho. Fica em módulo próprio, sem dependência de Electron, para
 * poder ser exercitado em Node puro (scripts/test-telemetry-log.js).
 *
 * Rotação: ao atingir maxBytes, o arquivo é renomeado para ".1.log" (uma única
 * geração anterior, sobrescrita a cada rotação). Sem isso o log cresceria
 * indefinidamente (~3 KB por sessão em uso normal). Com 512 KB o uso no disco
 * fica limitado a ~1 MB no total.
 */

const fs = require('fs');

const DEFAULT_MAX_BYTES = 512 * 1024; // 512 KB

function getRotatedPath(logPath) {
  return `${String(logPath).replace(/\.log$/i, '')}.1.log`;
}

// Move o log atual para a geração anterior quando ele passa do limite.
// Retorna true se rotacionou.
function rotateLogIfNeeded(logPath, maxBytes = DEFAULT_MAX_BYTES) {
  const limit = Number(maxBytes) > 0 ? Number(maxBytes) : DEFAULT_MAX_BYTES;

  let size = 0;
  try {
    size = fs.statSync(logPath).size;
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }

  if (size < limit) {
    return false;
  }

  const rotatedPath = getRotatedPath(logPath);
  // renameSync falha no Windows quando o destino já existe.
  fs.rmSync(rotatedPath, { force: true });
  fs.renameSync(logPath, rotatedPath);
  return true;
}

// Anexa uma linha. Falha de rotação nunca impede a gravação do evento.
function appendTelemetryLogLine(logPath, line, maxBytes = DEFAULT_MAX_BYTES) {
  try {
    rotateLogIfNeeded(logPath, maxBytes);
  } catch (error) {
    console.warn('[TELEMETRY] Failed to rotate telemetry log:', error && error.message ? error.message : error);
  }

  fs.appendFileSync(logPath, line, 'utf8');
}

module.exports = {
  DEFAULT_MAX_BYTES,
  getRotatedPath,
  rotateLogIfNeeded,
  appendTelemetryLogLine
};
