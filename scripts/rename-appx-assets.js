const fs = require('fs');
const path = require('path');
const srcDir = path.resolve(__dirname, '../build/store-assets');
const dstDir = path.resolve(__dirname, '../build/store-assets');

const renameMap = [
  { old: 'StoreLogo.png', new: 'StoreLogo.scale-100.png' },
  { old: 'Square150x150Logo.png', new: 'Square150x150Logo.scale-100.png' },
  { old: 'Square44x44Logo.png', new: 'Square44x44Logo.scale-100.png' },
  { old: 'SplashScreen.png', new: 'SplashScreen.scale-100.png' }
];

renameMap.forEach(({ old, new: newName }) => {
  const oldPath = path.join(srcDir, old);
  const newPath = path.join(dstDir, newName);
  if (fs.existsSync(oldPath)) {
    fs.copyFileSync(oldPath, newPath);
    console.log(`✓ Renomeado: ${old} -> ${newName}`);
  } else {
    console.warn(`⚠ Não encontrado: ${old}`);
  }
});
console.log('Renomeação dos PNGs para padrão scale-100 concluída.');
