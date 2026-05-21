const { nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const srcIcon = path.resolve(__dirname, '../default-icon.png');
const assetsDir = path.resolve(__dirname, '../assets');

const targets = [
  { name: 'StoreLogo.png', size: 50 },
  { name: 'Square150x150Logo.png', size: 150 },
  { name: 'Square44x44Logo.png', size: 44 },
  { name: 'SplashScreen.png', size: 620 }
];

if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir);

(async () => {
  for (const t of targets) {
    const outPath = path.join(assetsDir, t.name);
    const img = nativeImage.createFromPath(srcIcon);
    const resized = img.resize({ width: t.size, height: t.size });
    await fs.promises.writeFile(outPath, resized.toPNG());
    console.log(`✓ Gerado: ${t.name} (${t.size}x${t.size})`);
  }
  console.log('Todos os ícones para APPX foram gerados em /assets');
})();
