const fs = require('fs');
const path = require('path');

const sourceDir = path.join(__dirname, '..', 'src', 'renderer', 'assets', 'images');
const outputDir = path.join(__dirname, '..', 'out', 'renderer', 'assets', 'images');
const icons = [
  'tray-black.ico',
  'tray-white.ico',
  'tray-black.png',
  'tray-white.png'
];

function ensureDirectory(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function copyFile(sourcePath, targetPath) {
  if (!fs.existsSync(sourcePath)) {
    return false;
  }

  try {
    fs.copyFileSync(sourcePath, targetPath);
    return true;
  } catch (err) {
    console.warn(`Could not copy ${sourcePath} to ${targetPath}:`, err.message);
    return false;
  }
}

function run() {
  console.log('[copy-tray-icons] sourceDir:', sourceDir);
  console.log('[copy-tray-icons] outputDir:', outputDir);

  ensureDirectory(outputDir);

  let anyCopied = false;
  for (const icon of icons) {
    const from = path.join(sourceDir, icon);
    const to = path.join(outputDir, icon);
    if (copyFile(from, to)) {
      console.log(`[copy-tray-icons] Copied ${icon}`);
      anyCopied = true;
    }
  }

  // Also maintain alias names used by titlebar fallback
  const mapping = [
    { src: 'tray-black.png', target: 'black.png' },
    { src: 'tray-white.png', target: 'white.png' }
  ];

  for (const m of mapping) {
    const from = path.join(outputDir, m.src);
    const to = path.join(outputDir, m.target);
    if (fs.existsSync(from)) {
      try {
        fs.copyFileSync(from, to);
        console.log(`[copy-tray-icons] Copied alias ${m.target}`);
        anyCopied = true;
      } catch (err) {
        console.warn(`[copy-tray-icons] Could not copy alias ${m.target}:`, err.message);
      }
    }
  }

  if (!anyCopied) {
    console.log('[copy-tray-icons] No tray icons found to copy. Proceeding.');
  }

  process.exit(0);
}

run();