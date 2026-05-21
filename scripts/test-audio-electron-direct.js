const { spawnSync } = require('child_process');
const path = require('path');
const electronExe = require('electron');

const testFile = path.resolve(__dirname, 'test_audio_load_electron_direct.js');
const result = spawnSync(electronExe, [testFile], {
  stdio: 'inherit',
  windowsHide: false
});

if (result.error) {
  console.error('[diag] failed to execute electron audio direct test:', result.error.message || result.error);
  process.exit(1);
}

process.exit(result.status == null ? 1 : result.status);
