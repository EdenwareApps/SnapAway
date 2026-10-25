#!/usr/bin/env node
/**
 * Sobe para o Sentry os PDBs dos NOSSOS addons nativos.
 *
 * Por que só os nossos: os PDBs oficiais do Electron somam ~1,8 GB por release
 * (`electron-v<versão>-win32-x64-pdb.zip`) e consumiriam a cota inteira de
 * "Debug Files" do projeto. Já os nossos addons somam ~23 MB — e são exatamente
 * o que o Sentry NÃO consegue resolver sozinho.
 *
 * Caso concreto (ELECTRON-1A): a stack do minidump veio com todas as DLLs do
 * Windows simbolizadas (`combase.dll`, `Windows.ApplicationModel.Store.dll`) mas
 * com `InitOnceExecuteOnce` no lugar da função real dentro de `iap_addon.node`.
 * Sem o PDB do addon, o frame que interessa fica invisível.
 *
 * Uso:
 *   npm run symbols:upload                # avisa e sai 0 se não houver token
 *   npm run symbols:upload -- --strict    # falha (exit 1) sem token
 *
 * O token vem de SENTRY_AUTH_TOKEN (variável de ambiente) ou, se ela não
 * existir, do `.sentryclirc` — na raiz do repo ou no HOME do usuário. Esse
 * arquivo é gitignored: NUNCA commitar o token (ver .sentryclirc.example).
 *
 * Requer token com escopo de escrita no projeto (project:releases ou
 * project:write).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// Lê o `.sentryclirc` (INI) procurando `[defaults] org/project` e
// `[auth] token`. Valores entre `<>` são tratados como placeholder e
// ignorados, para um template não preenchido não passar por credencial.
function readSentryRc() {
  const candidates = [
    path.join(ROOT, '.sentryclirc'),
    path.join(os.homedir(), '.sentryclirc')
  ];
  const config = {};

  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    let section = '';
    for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith(';') || line.startsWith('#')) continue;

      const sectionMatch = /^\[(.+)\]$/.exec(line);
      if (sectionMatch) {
        section = sectionMatch[1].trim().toLowerCase();
        continue;
      }

      const kv = /^([^=]+?)\s*=\s*(.*)$/.exec(line);
      if (!kv) continue;
      const key = kv[1].trim().toLowerCase();
      const value = kv[2].trim().replace(/^["'](.*)["']$/, '$1');
      if (!value || value.startsWith('<')) continue;

      if (section === 'auth' && key === 'token') config.token = value;
      if (section === 'defaults' && key === 'org') config.org = value;
      if (section === 'defaults' && key === 'project') config.project = value;
    }
    if (config.token) break;
  }

  return config;
}

const ROOT = path.resolve(__dirname, '..');
const SENTRY_RC = readSentryRc();
const ORG = process.env.SENTRY_ORG || SENTRY_RC.org || 'edenwareapp';
const PROJECT = process.env.SENTRY_PROJECT || SENTRY_RC.project || 'electron';
const STRICT = process.argv.includes('--strict');

// Addons que realmente vão no pacote (ver "copy:natives" no package.json).
// O PDB fica ao lado do .node em src/<addon>/build/Release/, então casa com o
// binário que o electron-builder empacota.
const ADDONS = [
  { dir: 'iap', pdb: 'iap_addon.pdb' },
  { dir: 'audio', pdb: 'audio_addon.pdb' },
  { dir: 'icons', pdb: 'icon_addon.pdb' },
  { dir: 'process', pdb: 'process_addon.pdb' },
  { dir: 'windows', pdb: 'windows_addon.pdb' },
  { dir: 'startup', pdb: 'startup_addon.pdb' }
];

function log(msg) {
  console.log(`[SYMBOLS] ${msg}`);
}

// Devolve como invocar o sentry-cli: { cmd, prefixArgs }.
// No Windows o @sentry/cli v3 entrega um launcher JavaScript (`bin/sentry-cli`,
// começa com `#!`) que não é executável sozinho — precisa rodar via `node`.
function resolveSentryCli() {
  try {
    const pkgPath = require.resolve('@sentry/cli/package.json', { paths: [ROOT] });
    const binDir = path.join(path.dirname(pkgPath), 'bin');
    for (const candidate of ['sentry-cli.exe', 'sentry-cli']) {
      const full = path.join(binDir, candidate);
      if (!fs.existsSync(full)) continue;
      return isScriptFile(full)
        ? { cmd: process.execPath, prefixArgs: [full] }
        : { cmd: full, prefixArgs: [] };
    }
  } catch (_) {
    // @sentry/cli não instalado — tenta o shim do node_modules/.bin abaixo.
  }

  const localBin = path.join(
    ROOT,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'sentry-cli.cmd' : 'sentry-cli'
  );
  return fs.existsSync(localBin) ? { cmd: localBin, prefixArgs: [] } : null;
}

function isScriptFile(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const head = Buffer.alloc(2);
    fs.readSync(fd, head, 0, 2, 0);
    return head.toString('utf8') === '#!';
  } finally {
    fs.closeSync(fd);
  }
}

// sentry-cli 2.x renomeou `upload-dif` para `debug-files upload`.
function resolveUploadArgs({ cmd, prefixArgs }) {
  const version = spawnSync(cmd, [...prefixArgs, '--version'], { encoding: 'utf8' });
  const match = /(\d+)\./.exec(version.stdout || '');
  const major = match ? Number(match[1]) : 2;
  return major >= 2 ? ['debug-files', 'upload'] : ['upload-dif'];
}

function collectPdbs() {
  const found = [];
  const missing = [];

  for (const addon of ADDONS) {
    const pdbPath = path.join(ROOT, 'src', addon.dir, 'build', 'Release', addon.pdb);
    const nodePath = pdbPath.replace(/\.pdb$/i, '.node');
    if (fs.existsSync(pdbPath)) {
      // O PDB só serve se o .node que vai no pacote veio do mesmo build.
      if (!fs.existsSync(nodePath)) {
        log(`AVISO: ${addon.pdb} existe mas ${addon.pdb.replace('.pdb', '.node')} não — build incompleto?`);
      }
      found.push(pdbPath);
    } else {
      missing.push(pdbPath);
    }
  }

  return { found, missing };
}

function main() {
  const token = process.env.SENTRY_AUTH_TOKEN || SENTRY_RC.token;
  if (!token) {
    const msg = 'Token do Sentry ausente (SENTRY_AUTH_TOKEN ou .sentryclirc) — símbolos NÃO foram enviados.';
    if (STRICT) {
      console.error(`[SYMBOLS] ERRO: ${msg}`);
      process.exit(1);
    }
    log(`${msg} (rode com --strict para transformar isso em erro)`);
    return;
  }

  const cli = resolveSentryCli();
  if (!cli) {
    log('@sentry/cli não encontrado. Instale com: npm install --save-dev @sentry/cli');
    if (STRICT) process.exit(1);
    return;
  }

  const { found, missing } = collectPdbs();
  if (missing.length > 0) {
    log(`PDBs ausentes (rode "npm run rebuild:native"): ${missing.map(p => path.relative(ROOT, p)).join(', ')}`);
  }
  if (found.length === 0) {
    log('Nenhum PDB dos addons encontrado — nada a enviar.');
    if (STRICT) process.exit(1);
    return;
  }

  const totalMb = found.reduce((sum, p) => sum + fs.statSync(p).size, 0) / (1024 * 1024);
  log(`Enviando ${found.length} PDB(s) (${totalMb.toFixed(1)} MB) para ${ORG}/${PROJECT}...`);

  const args = [
    ...resolveUploadArgs(cli),
    '--org', ORG,
    '--project', PROJECT,
    ...found
  ];

  const result = spawnSync(cli.cmd, [...cli.prefixArgs, ...args], { stdio: 'inherit', cwd: ROOT });
  if (result.error) {
    console.error(`[SYMBOLS] Falha ao executar sentry-cli: ${result.error.message}`);
    process.exit(1);
  }
  process.exit(result.status === null ? 1 : result.status);
}

main();
