#!/usr/bin/env node

/**
 * Build APPX package for Microsoft Store submission
 * Usage: node scripts/build-appx.js [--sign] [--cert path/to/cert.pfx]
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const args = process.argv.slice(2);
const shouldSign = args.includes('--sign');
const certIndex = args.indexOf('--cert');
const certPath = certIndex >= 0 ? args[certIndex + 1] : null;

const ROOT_DIR = path.join(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const BUILD_DIR = path.join(ROOT_DIR, 'build', 'appx');
const ASSETS_DIR = path.join(ROOT_DIR, 'build', 'assets');
// Corrigir assetsDst para build/store-assets
const STORE_ASSETS_DIR = path.join(ROOT_DIR, 'build', 'store-assets');

console.log('📦 Building SnapAway APPX Package...\n');

// Step 1: Verify dependencies
console.log('1️⃣  Checking dependencies...');
const hasNodeModules = fs.existsSync(path.join(ROOT_DIR, 'node_modules'));
if (!hasNodeModules) {
  console.error('❌ node_modules not found. Run: npm install');
  process.exit(1);
}

// Step 2: Create build directories
console.log('2️⃣  Creating build directories...');
[BUILD_DIR, ASSETS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

const appxDir = path.join(BUILD_DIR, 'appx');
if (!fs.existsSync(appxDir)) {
  fs.mkdirSync(appxDir, { recursive: true });
}

// Step 3: Copy manifest
console.log('3️⃣  Copying AppxManifest.xml...');
const manifestSrc = path.join(ROOT_DIR, 'AppxManifest.xml');
const manifestDst = path.join(BUILD_DIR, 'AppxManifest.xml');
if (fs.existsSync(manifestSrc)) {
  fs.copyFileSync(manifestSrc, manifestDst);
  console.log('   ✓ Manifest copied');
} else {
  console.warn('   ⚠  AppxManifest.xml not found, using defaults');
}

// Step 4: Copy assets (if available)
console.log('4️⃣  Copying Store assets...');
const assetsDst = STORE_ASSETS_DIR;

if (!fs.existsSync(assetsDst)) {
  fs.mkdirSync(assetsDst, { recursive: true });
}

// Create required assets
const requiredAssets = [
  'StoreLogo.png',
  'Square150x150Logo.png', 
  'Square44x44Logo.png',
  'SplashScreen.png'
];

// Copiar PNGs válidos de build/store-assets para build/appx/assets
requiredAssets.forEach(asset => {
  const srcPath = path.join(assetsDst, asset);
  const dstPath = path.join(appxDir, 'Assets', asset);
  if (fs.existsSync(srcPath)) {
    fs.copyFileSync(srcPath, dstPath);
    console.log(`   ✓ Copiado para APPX: ${asset}`);
  } else if (!fs.existsSync(dstPath)) {
    // Só gera placeholder se não existe PNG em nenhum local
    const placeholderPng = Buffer.from([
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4, 0x89, 0x00, 0x00, 0x00,
      0x0B, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
      0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00, 0x00, 0x00, 0x00, 0x49,
      0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82
    ]);
    fs.writeFileSync(dstPath, placeholderPng);
    console.log(`   ✓ Created placeholder: ${asset}`);
  }
});

// Copy assets to APPX directory
const appxAssetsDir = path.join(appxDir, 'Assets');
if (!fs.existsSync(appxAssetsDir)) {
  fs.mkdirSync(appxAssetsDir, { recursive: true });
}

requiredAssets.forEach(asset => {
  const srcPath = path.join(assetsDst, asset);
  const dstPath = path.join(appxAssetsDir, asset);
  if (fs.existsSync(srcPath)) {
    // Só copia se o arquivo de destino não existe ou é placeholder (1x1)
    let copy = true;
    if (fs.existsSync(dstPath)) {
      try {
        const sizeOf = require('image-size');
        const dim = sizeOf(dstPath);
        if (dim.width > 1 && dim.height > 1) {
          copy = false;
        }
      } catch (e) { copy = true; }
    }
    if (copy) {
      fs.copyFileSync(srcPath, dstPath);
      console.log(`   ✓ Copiado para APPX: ${asset}`);
    } else {
      console.log(`   ✓ Já existe válido em APPX: ${asset}`);
    }
  } else {
    // Se não existe em nenhum local, gera placeholder
    if (!fs.existsSync(dstPath)) {
      const placeholderPng = Buffer.from([
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D,
        0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4, 0x89, 0x00, 0x00, 0x00,
        0x0B, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
        0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00, 0x00, 0x00, 0x00, 0x49,
        0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82
      ]);
      fs.writeFileSync(dstPath, placeholderPng);
      console.log(`   ✓ Created placeholder in APPX: ${asset}`);
    }
  }
});

// Step 5: Build using electron-builder
console.log('5️⃣  Building APPX with electron-builder...');
const builderConfig = {
  appId: 'Edenware.app.Snapcover',
  productName: 'SnapAway',
  directories: {
    buildResources: ASSETS_DIR,
    output: BUILD_DIR
  },
  appx: {
    applicationId: 'SnapAway',
    identityName: 'Edenware.app.Snapcover',
    publisher: 'CN=31770A1C-AE43-4A48-A8CA-86C8455BB6F2',
    publisherDisplayName: 'Edenware',
    certificateFile: certPath || null,
    signingHashAlgorithms: ['sha256'],
    languages: ['en-US', 'pt-BR']
  }
};

// Write config to temp file
const configPath = path.join(BUILD_DIR, 'electron-builder-appx.json');
fs.writeFileSync(configPath, JSON.stringify(builderConfig, null, 2));

// Step 5: Create APPX structure manually
console.log('5️⃣  Creating APPX structure...');

// Copy built app files
const appSrcDir = path.join(DIST_DIR, 'win-unpacked');
const appDstDir = path.join(appxDir, 'app');

if (fs.existsSync(appSrcDir)) {
  console.log('   ✓ Using existing built app');
  // Copy app files
  copyDirRecursive(appSrcDir, appDstDir);
} else {
  console.log('   ⚠  No built app found, creating basic structure');
  // Create basic app structure
  if (!fs.existsSync(appDstDir)) {
    fs.mkdirSync(appDstDir, { recursive: true });
  }

  // Copy source files
  const srcDirs = ['src', 'out', 'dist'];
  srcDirs.forEach(dir => {
    const srcPath = path.join(ROOT_DIR, dir);
    if (fs.existsSync(srcPath)) {
      copyDirRecursive(srcPath, path.join(appDstDir, dir));
    }
  });

  // Copy package.json and other root files used by runtime/config
  const rootFiles = ['package.json', 'defaults.json', 'LICENSE'];
  rootFiles.forEach(file => {
    const srcFile = path.join(ROOT_DIR, file);
    if (fs.existsSync(srcFile)) {
      fs.copyFileSync(srcFile, path.join(appDstDir, file));
    }
  });
}

// Create node.exe alias for native Electron modules that import node.exe directly.
const mainExeSrc = path.join(appDstDir, 'SnapAway.exe');
const nodeExeDst = path.join(appDstDir, 'node.exe');
if (fs.existsSync(mainExeSrc) && !fs.existsSync(nodeExeDst)) {
  try {
    fs.copyFileSync(mainExeSrc, nodeExeDst);
    console.log('   ✓ Created node.exe alias for native module loading');
  } catch (copyError) {
    console.warn('   ⚠  Failed to create node.exe alias:', copyError.message);
  }
}

// Copy the custom DPI manifest as SnapAway.exe.manifest so the EXE is DPI-aware at load time
const exeManifestSrc = path.join(ROOT_DIR, 'snapaway.manifest');
const exeManifestDst = path.join(appDstDir, 'SnapAway.exe.manifest');
if (fs.existsSync(exeManifestSrc)) {
  fs.copyFileSync(exeManifestSrc, exeManifestDst);
  console.log('   ✓ Copied SnapAway.exe.manifest into app folder');
} else {
  console.warn('   ⚠  snapaway.manifest not found; skipping EXE manifest copy');
}

// Copy manifest to APPX root
fs.copyFileSync(manifestDst, path.join(appxDir, 'AppxManifest.xml'));

console.log('   ✓ APPX structure created');

// Step 6: Create APPX package
console.log('6️⃣  Creating APPX package...');

const outputAppx = path.join(DIST_DIR, `SnapAway_${Date.now()}.appx`);

try {
  // Try to use MakeAppx if available (use full path to Windows SDK)
  const makeAppxPath = '"C:\\Program Files (x86)\\Windows Kits\\10\\bin\\10.0.19041.0\\x64\\MakeAppx.exe"';
  const makeAppxCmd = `${makeAppxPath} pack /d "${appxDir}" /p "${outputAppx}"`;
  execSync(makeAppxCmd, { stdio: 'inherit' });
  console.log(`   ✓ APPX created: ${outputAppx}`);
} catch (error) {
  console.error('   ❌ Failed to create APPX package:', error.message);
  console.warn('   ℹ️  MakeAppx requires Windows 10 APP Certification Kit');
  console.warn('   ℹ️  Install from: https://go.microsoft.com/fwlink/p/?LinkId=845298');
  process.exit(1);
}

// Step 7: Sign APPX if requested
if (shouldSign) {
  console.log('7️⃣  Signing APPX package...');
  
  // Verify APPX was created
  if (!fs.existsSync(outputAppx)) {
    console.error('   ❌ APPX file not found:', outputAppx);
    process.exit(1);
  }
  
  if (!certPath) {
    console.error('   ❌ Certificate path required for signing. Use --cert path/to/cert.pfx');
    process.exit(1);
  }
  
  // Verify certificate exists
  if (!fs.existsSync(certPath)) {
    console.error('   ❌ Certificate file not found:', certPath);
    process.exit(1);
  }
  
  try {
    const signToolPath = '"C:\\Program Files (x86)\\Windows Kits\\10\\bin\\10.0.19041.0\\x64\\SignTool.exe"';
    const signCmd = `${signToolPath} sign /fd SHA256 /a /f "${certPath}" "${outputAppx}"`;
    execSync(signCmd, { stdio: 'inherit' });
    console.log('   ✓ APPX signed successfully');
  } catch (error) {
    console.error('   ❌ Failed to sign APPX:', error.message);
    console.log('   📁 Unsigned APPX available at:', outputAppx);
    process.exit(1);
  }
}

// Helper function to copy directories recursively
function copyDirRecursive(src, dst) {
  if (!fs.existsSync(dst)) {
    fs.mkdirSync(dst, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);

    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, dstPath);
    } else {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

// Step 6: Verify output
console.log('6️⃣  Verifying output...');
const appxFiles = fs.readdirSync(DIST_DIR).filter(f => f.endsWith('.appx'));
if (appxFiles.length > 0) {
  console.log('✅ APPX built successfully!\n');
  appxFiles.forEach(file => {
    const fullPath = path.join(DIST_DIR, file);
    const size = (fs.statSync(fullPath).size / 1024 / 1024).toFixed(2);
    console.log(`   📦 ${file} (${size} MB)`);
  });
  console.log(`\n📂 Output directory: ${DIST_DIR}`);
  
  // Step 7: Show next steps
  console.log('\n📋 Next steps:');
  if (!shouldSign) {
    console.log('   1. Sign APPX: node scripts/build-appx.js --sign --cert path/to/cert.pfx');
    console.log('   2. Submit to Microsoft Store via Partner Center');
  } else {
    console.log('   1. Submit signed APPX to Microsoft Store via Partner Center');
  }
  console.log('   2. Monitor review status (~24-48 hours)\n');
} else {
  console.error('❌ No APPX files generated');
  process.exit(1);
}
