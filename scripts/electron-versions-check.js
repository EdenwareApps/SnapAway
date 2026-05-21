const { spawnSync } = require('child_process');
const path = require('path');
const electronExe = require('electron');
const scriptPath = path.resolve(__dirname, 'electron-versions-runtime.js');

const result = spawnSync(electronExe, [scriptPath], {
  stdio: 'inherit',
  windowsHide: false
});

if (result.error) {
  console.error('[diag] failed to execute electron:', result.error.message || result.error);
  process.exit(1);
}

process.exit(result.status == null ? 1 : result.status);
