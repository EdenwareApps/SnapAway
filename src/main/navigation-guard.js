const { shell } = require('electron');

/**
 * Instala guards de navegação em uma janela para impedir que o renderer
 * navegue para conteúdo externo (ex.: abrir um PDF — que acionaria o PDFium
 * do Chromium —, página de phishing, etc.).
 *
 * - `will-navigate`: bloqueia navegações iniciadas pelo renderer para URLs
 *   não permitidas pelo predicado `isAllowed`. Não afeta o load inicial
 *   (loadURL/loadFile) nem navegações in-page (hash/anchors), que não emitem
 *   este evento.
 * - `setWindowOpenHandler`: impede a abertura de novas janelas. Se
 *   `openExternalHttp` for true, URLs http(s) são abertas no navegador padrão
 *   via shell.openExternal (mesmo comportamento do `launchUrl`).
 *
 * @param {import('electron').BrowserWindow} win
 * @param {object} [opts]
 * @param {(url: string) => boolean} [opts.isAllowed] Predicado que retorna
 *   true se a URL pode ser carregada na própria janela. Default: nega tudo
 *   (útil para janelas com conteúdo fixo, ex.: overlay `data:`).
 * @param {boolean} [opts.openExternalHttp] Abre URLs http(s) no navegador
 *   padrão em vez de criar uma nova janela do app.
 */
function installNavigationGuards(win, opts = {}) {
  const isAllowed = typeof opts.isAllowed === 'function' ? opts.isAllowed : () => false;
  const openExternalHttp = opts.openExternalHttp === true;

  if (!win || !win.webContents) {
    return;
  }

  win.webContents.on('will-navigate', (event, url) => {
    if (isAllowed(url)) {
      return;
    }
    event.preventDefault();
    console.warn('[NAV-GUARD] Blocked navigation to:', url);
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (openExternalHttp && /^https?:\/\//i.test(url)) {
      shell.openExternal(url).catch(() => {});
      return { action: 'deny' };
    }
    console.warn('[NAV-GUARD] Blocked window.open to:', url);
    return { action: 'deny' };
  });
}

module.exports = { installNavigationGuards };
