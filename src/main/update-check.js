/**
 * update-check.js
 * Comparacao de versoes do update.json (src/main/index.js). Fica em modulo
 * proprio, sem dependencia de Electron, para poder ser exercitado em Node puro
 * (scripts/test-version-compare.js).
 *
 * Motivo: a comparacao anterior era `remote > local` em cima de strings, o que
 * so acerta enquanto todos os componentes tem um digito. "1.10.0" > "1.9.0" e
 * falso em comparacao de string, entao o aviso de atualizacao simplesmente
 * pararia de aparecer na decima release menor.
 */

// Extrai os componentes numericos de "1.2.4", "v1.2.4", "1.2.4.0" ou "1.3.0-beta.1".
// Sufixos (pre-release, build) sao ignorados: interessa apenas a ordem de release.
function parseVersion(value) {
  const match = String(value === undefined || value === null ? '' : value)
    .trim()
    .match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\.(\d+))?/i);

  if (!match) {
    return null;
  }

  return [match[1], match[2], match[3], match[4]].map(part => Number(part || 0));
}

// true somente quando `remote` e uma release estritamente mais nova que `local`.
// Versoes invalidas nunca disparam aviso de atualizacao.
function isNewerVersion(remote, local) {
  const remoteParts = parseVersion(remote);
  const localParts = parseVersion(local);

  if (!remoteParts || !localParts) {
    return false;
  }

  for (let index = 0; index < remoteParts.length; index += 1) {
    if (remoteParts[index] > localParts[index]) {
      return true;
    }
    if (remoteParts[index] < localParts[index]) {
      return false;
    }
  }

  return false;
}

module.exports = { isNewerVersion, parseVersion };
