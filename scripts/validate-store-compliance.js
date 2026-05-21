#!/usr/bin/env node

/**
 * Microsoft Store Compliance Checker for SnapAway
 * Validates app against Store requirements before submission
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const MANIFEST_PATH = path.join(ROOT_DIR, 'AppxManifest.xml');
const PACKAGE_JSON = path.join(ROOT_DIR, 'package.json');
const BUILD_DIR = path.join(ROOT_DIR, 'build');
const DIST_DIR = path.join(ROOT_DIR, 'dist');

console.log('🔍 Validating Microsoft Store Compliance...\n');

let errors = [];
let warnings = [];

// ### Step 0: Validate generated APPX package metadata
const { execSync } = require('child_process');

function validateAppx(appxPath) {
  if (!fs.existsSync(appxPath)) return;

  const tempDir = path.join(DIST_DIR, 'appx-validate-temp');
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    const appxSafe = appxPath.replace(/'/g, "''");
    const tempDirSafe = tempDir.replace(/'/g, "''");
    const extractCmd = `powershell -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory('${appxSafe}', '${tempDirSafe}')"`;
    execSync(extractCmd, { stdio: 'pipe' });
  } catch (ex) {
    errors.push(`Unable to extract ${appxPath}: ${ex.message}`);
    return;
  }

  const manifestPath = path.join(tempDir, 'AppxManifest.xml');
  if (!fs.existsSync(manifestPath)) {
    errors.push(`AppxManifest.xml not found in extracted ${appxPath}`);
    return;
  }

  const manifestContent = fs.readFileSync(manifestPath, 'utf8');

  const getAttr = (name) => {
    // XML allows both single and double quotes for attributes
    const m = manifestContent.match(new RegExp(name + '\\s*=\\s*["\']([^"\']+)["\']'));
    return m ? m[1] : null;
  };

  const getTag = (name) => {
    const m = manifestContent.match(new RegExp(`<${name}>([^<]+)</${name}>`, 'i'));
    return m ? m[1] : null;
  };

  const identityName = getAttr('Name');
  const publisher = getAttr('Publisher');
  const displayName = getTag('DisplayName');
  const publisherDisplayName = getTag('PublisherDisplayName');

  const exp = {
    identityName: 'Edenware.app.Snapcover',
    publisher: 'CN=31770A1C-AE43-4A48-A8CA-86C8455BB6F2',
    displayName: 'SnapAway',
    publisherDisplayName: 'Edenware'
  };

  if (identityName !== exp.identityName) {
    errors.push(`Invalid APPX Identity Name in ${appxPath}: ${identityName} (expected ${exp.identityName})`);
  }
  if (publisher !== exp.publisher) {
    errors.push(`Invalid APPX Publisher in ${appxPath}: ${publisher} (expected ${exp.publisher})`);
  }
  if (displayName !== exp.displayName) {
    errors.push(`Invalid APPX DisplayName in ${appxPath}: ${displayName} (expected ${exp.displayName})`);
  }
  if (publisherDisplayName !== exp.publisherDisplayName) {
    errors.push(`Invalid APPX PublisherDisplayName in ${appxPath}: ${publisherDisplayName} (expected ${exp.publisherDisplayName})`);
  }

  fs.rmSync(tempDir, { recursive: true, force: true });
}

const appxFiles = fs.readdirSync(DIST_DIR).filter(f => f.endsWith('.appx')).map(f => path.join(DIST_DIR, f));
if (appxFiles.length === 0) {
  warnings.push('No APPX files found in dist for validation.');
} else {
  const latestAppx = appxFiles
    .map(ap => ({ path: ap, mtime: fs.statSync(ap).mtime }))
    .sort((a, b) => b.mtime - a.mtime)[0].path;
  console.log(`   ✓ Validating latest APPX: ${path.basename(latestAppx)}`);
  validateAppx(latestAppx);
}


// 1. Check AppxManifest.xml
console.log('1️⃣  Checking AppxManifest.xml...');
if (!fs.existsSync(MANIFEST_PATH)) {
  errors.push('AppxManifest.xml not found');
} else {
  const manifest = fs.readFileSync(MANIFEST_PATH, 'utf8');

  // Check required fields
  const requiredFields = [
    'Name="',
    'Publisher="',
    'Version="',
    'DisplayName',
    'PublisherDisplayName',
    'TargetDeviceFamily'
  ];

  requiredFields.forEach(field => {
    if (!manifest.includes(field)) {
      errors.push(`Missing required field: ${field}`);
    }
  });

  // Check Store Product Features (IAP)
  if (!manifest.includes('windows.storeProductFeature')) {
    warnings.push('No Store Product Features defined (IAP)');
  }

  // Check capabilities
  if (!manifest.includes('runFullTrust')) {
    errors.push('Missing runFullTrust capability for Electron app');
  }

  console.log('   ✓ Manifest structure OK');
}

// 2. Check package.json
console.log('2️⃣  Checking package.json...');
if (!fs.existsSync(PACKAGE_JSON)) {
  errors.push('package.json not found');
} else {
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8'));

  // Check appId
  const expectedAppId = 'Edenware.app.Snapcover';
  if (!pkg.build?.appId || pkg.build.appId !== expectedAppId) {
    errors.push(`Invalid or missing appId in package.json (found: ${pkg.build?.appId || 'none'}, expected: ${expectedAppId})`);
  }

  // Check appx config
  if (!pkg.build?.appx) {
    errors.push('Missing appx configuration in package.json');
  } else {
    const appx = pkg.build.appx;
    if (!appx.applicationId || !appx.identityName || !appx.publisher) {
      errors.push('Incomplete appx configuration');
    }
  }

  console.log('   ✓ Package configuration OK');
}

// 3. Check Store assets
console.log('3️⃣  Checking Store assets...');
const assetsDir = path.join(ROOT_DIR, 'build', 'store-assets');
const requiredAssets = [
  'StoreLogo.png',
  'Square150x150Logo.png',
  'Square44x44Logo.png',
  'SplashScreen.png'
];

if (!fs.existsSync(assetsDir)) {
  warnings.push('Store assets directory not found');
} else {
  requiredAssets.forEach(asset => {
    const assetPath = path.join(assetsDir, asset);
    if (!fs.existsSync(assetPath)) {
      warnings.push(`Missing required asset: ${asset}`);
    }
  });
}

// 4. Check IAP implementation
console.log('4️⃣  Checking IAP implementation...');
const iapAddon = path.join(ROOT_DIR, 'dist', 'iap_addon.node');
if (!fs.existsSync(iapAddon)) {
  warnings.push('IAP addon not built (iap_addon.node missing)');
} else {
  console.log('   ✓ IAP addon present');
}

// 5. Check for restricted content
console.log('5️⃣  Checking for restricted content...');
const restrictedWords = ['hack', 'crack', 'pirate', 'warez', 'keygen'];
const filesToCheck = [
  'README.md',
  'package.json',
  'AppxManifest.xml'
];

filesToCheck.forEach(file => {
  const filePath = path.join(ROOT_DIR, file);
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf8').toLowerCase();
    restrictedWords.forEach(word => {
      if (content.includes(word)) {
        warnings.push(`Potentially restricted word "${word}" found in ${file}`);
      }
    });
  }
});

// 6. Check version format
console.log('6️⃣  Checking version format...');
if (fs.existsSync(PACKAGE_JSON)) {
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8'));
  const version = pkg.version;
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    errors.push('Version must be in format x.y.z (no pre-release tags)');
  }
  
  // Check for IAP configuration
  if (!pkg.build?.appx) {
    warnings.push('Missing appx configuration in package.json');
  }
}

// 7. Check for built app
console.log('7️⃣  Checking for built app files...');
const distDir = path.join(ROOT_DIR, 'dist');
const winUnpacked = path.join(distDir, 'win-unpacked');

if (!fs.existsSync(winUnpacked)) {
  errors.push('Built app not found. Run: npm run build');
} else {
  // Product name should be SnapAway.exe
  const expectedExeNames = ['SnapAway.exe'];
  const exePath = expectedExeNames.map(name => path.join(winUnpacked, name)).find(p => fs.existsSync(p));
  if (!exePath) {
    errors.push(`SnapAway executable not found in dist/win-unpacked (tried: ${expectedExeNames.join(', ')})`);
  } else {
    console.log(`   ✓ Built app found: ${path.basename(exePath)}`);
  }
}


// Results
console.log('\n📊 Validation Results:');
console.log(`   ❌ Errors: ${errors.length}`);
console.log(`   ⚠️  Warnings: ${warnings.length}`);

if (errors.length > 0) {
  console.log('\n❌ Critical Issues:');
  errors.forEach(error => console.log(`   • ${error}`));
}

if (warnings.length > 0) {
  console.log('\n⚠️  Warnings:');
  warnings.forEach(warning => console.log(`   • ${warning}`));
}

if (errors.length === 0) {
  console.log('\n✅ App appears compliant for Microsoft Store submission!');
  console.log('\n📋 Next steps:');
  console.log('   1. Build APPX: node scripts/build-appx.js');
  console.log('   2. Sign APPX: node scripts/build-appx.js --sign --cert path/to/cert.pfx');
  console.log('   3. Submit to Partner Center');
} else {
  console.log('\n❌ Fix critical issues before submission');
  process.exit(1);
}