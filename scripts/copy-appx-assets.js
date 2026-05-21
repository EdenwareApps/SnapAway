const fs = require('fs');
const path = require('path');
const { nativeImage } = require('electron');

const rootDir = path.resolve(__dirname, '..');
const sourceCandidates = [
  path.join(rootDir, 'Assets'),
  path.join(rootDir, 'build', 'store-assets')
];

const dstDir = path.join(rootDir, 'build', 'appx');

const requiredFiles = [
  'StoreLogo.png',
  'Square150x150Logo.png',
  'Square44x44Logo.png',
  'Wide310x150Logo.png'
];

const optionalFiles = ['SplashScreen.png'];

// Icons that need unplated versions to remove blue background in App Installer
const unplatedIcons = [
  'StoreLogo.png',
  'Square150x150Logo.png',
  'Square44x44Logo.png'
];

function findSourceFile(fileName) {
  for (const baseDir of sourceCandidates) {
    const filePath = path.join(baseDir, fileName);
    if (fs.existsSync(filePath)) {
      return filePath;
    }
  }
  return null;
}

async function createWideLogoFromSquare(squarePath, widePath) {
  const img = nativeImage.createFromPath(squarePath);
  const resized = img.resize({ width: 310, height: 150 });
  await fs.promises.writeFile(widePath, resized.toPNG());
}

function createUnplatedVariant(basePath) {
  // _altform-unplated suffix tells Windows App Installer that icon has no background plating
  // This removes the blue accent color background from the installation wizard
  const dir = path.dirname(basePath);
  const ext = path.extname(basePath);
  const base = path.basename(basePath, ext);
  const unplatedPath = path.join(dir, `${base}_altform-unplated${ext}`);
  fs.copyFileSync(basePath, unplatedPath);
  return unplatedPath;
}

async function run() {
  fs.mkdirSync(dstDir, { recursive: true });

  // Step 1: Copy or generate base files
  for (const file of [...requiredFiles, ...optionalFiles]) {
    const source = findSourceFile(file);
    const destination = path.join(dstDir, file);

    if (source) {
      fs.copyFileSync(source, destination);
      console.log(`✓ Copiado: ${file}`);
      continue;
    }

    if (file === 'Wide310x150Logo.png') {
      const squareSource = findSourceFile('Square150x150Logo.png');
      if (squareSource) {
        await createWideLogoFromSquare(squareSource, destination);
        console.log('✓ Gerado: Wide310x150Logo.png (a partir de Square150x150Logo.png)');
        continue;
      }
    }

    if (requiredFiles.includes(file)) {
      console.error(`✗ Asset obrigatório não encontrado: ${file}`);
      process.exit(1);
    }

    console.warn(`⚠ Asset opcional não encontrado: ${file}`);
  }

  // Step 2: Create scale-100 variants
  // Fix SplashScreen to required 620x300 (WACK requirement)
  const splashDst = path.join(dstDir, 'SplashScreen.png');
  if (fs.existsSync(splashDst)) {
    const splashImg = nativeImage.createFromPath(splashDst);
    const splashSize = splashImg.getSize();
    if (splashSize.width !== 620 || splashSize.height !== 300) {
      const splashResized = splashImg.resize({ width: 620, height: 300 });
      await fs.promises.writeFile(splashDst, splashResized.toPNG());
      console.log('✓ SplashScreen.png redimensionada para 620x300');
    }
  }

  const scalableFiles = ['StoreLogo.png', 'Square150x150Logo.png', 'Square44x44Logo.png', 'Wide310x150Logo.png', 'SplashScreen.png'];
  for (const file of scalableFiles) {
    const source = path.join(dstDir, file);
    if (!fs.existsSync(source)) continue;

    const scaled = path.join(dstDir, file.replace('.png', '.scale-100.png'));
    fs.copyFileSync(source, scaled);
  }

  // Step 3: Create _altform-unplated variants
  // These tell App Installer that icons don't need a colored background plating
  // This removes the blue (#0078D4) background from the installation wizard
  for (const file of unplatedIcons) {
    const basePath = path.join(dstDir, file);
    if (fs.existsSync(basePath)) {
      const unplatedPath = createUnplatedVariant(basePath);
      console.log(`✓ Gerado: ${path.basename(unplatedPath)}`);

      // Also create scale-100 variant of unplated
      const scaledPath = path.join(dstDir, file.replace('.png', '.scale-100.png'));
      if (fs.existsSync(scaledPath)) {
        const scaledUnplated = createUnplatedVariant(scaledPath);
        console.log(`✓ Gerado: ${path.basename(scaledUnplated)}`);
      }
    }
  }

  // Step 4: Create targetsize variants with altform-unplated suffix
  // These are crucial for Windows App Installer to NOT apply accent color background
  // Reference: https://docs.microsoft.com/en-us/windows/uwp/app-resources/tailor-resources-lang-scale-contrast
  const targetsizes = [16, 24, 32, 48, 256];
  // Use high-res source icon instead of 44x44 to avoid quality loss on larger sizes
  const highResIconPath = path.join(rootDir, 'default-icon.png');
  const baseLogoPath = fs.existsSync(highResIconPath) ? highResIconPath : path.join(dstDir, 'Square44x44Logo.png');
  if (fs.existsSync(baseLogoPath)) {
    for (const size of targetsizes) {
      const targetName = `Square44x44Logo.targetsize-${size}_altform-unplated.png`;
      const targetPath = path.join(dstDir, targetName);
      
      // Resize to exact targetsize dimensions
      const img = nativeImage.createFromPath(baseLogoPath);
      const resized = img.resize({ width: size, height: size });
      await fs.promises.writeFile(targetPath, resized.toPNG());
      
      console.log(`✓ Gerado: ${targetName} (${size}x${size}) from ${path.basename(baseLogoPath)}`);
    }
  }

  console.log('✓ Cópia dos PNGs para build/appx concluída.');
  process.exit(0);
}

run().catch(error => {
  console.error('Falha ao preparar assets APPX:', error);
  process.exit(1);
});
