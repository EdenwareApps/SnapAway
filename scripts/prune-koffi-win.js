const fs = require('fs').promises;
const path = require('path');

module.exports = async function(context) {
  const appOutDir = context.appOutDir;
  if (!appOutDir) {
    console.warn('[prune-koffi-win] appOutDir is not set, skipping prune');
    return;
  }

  const koffiDir = path.join(appOutDir, 'resources', 'app.asar.unpacked', 'node_modules', 'koffi', 'build', 'koffi');
  try {
    const entries = await fs.readdir(koffiDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (!entry.name.startsWith('win32_')) {
        const full = path.join(koffiDir, entry.name);
        console.log('[prune-koffi-win] removing', full);
        await fs.rm(full, { recursive: true, force: true });
      }
    }
  } catch (error) {
    console.warn('[prune-koffi-win] could not prune kofif binaries', error.message);
  }

  // node.exe alias is no longer needed; native addons resolve symbols via SnapAway.exe directly
  // This saves ~170+ MB in the installer package
  console.log('[prune-koffi-win] native addons will use SnapAway.exe for symbol resolution');
};
