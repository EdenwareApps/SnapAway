#!/usr/bin/env node

/**
 * SnapAway - Pre-Submission Verification Tests
 * 
 * Executa uma série de testes para garantir que tudo está pronto
 * para submissão no Microsoft Store.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = path.join(__dirname, '..');
const TESTS = [];

console.log('\n🧪 SnapAway - Pre-Submission Verification Tests\n');
console.log('═════════════════════════════════════════════════════════════\n');

// Test 1: AppxManifest.xml exists and is valid XML
console.log('Test 1: AppxManifest.xml validation');
try {
  const manifestPath = path.join(ROOT_DIR, 'AppxManifest.xml');
  if (!fs.existsSync(manifestPath)) {
    console.log('   ❌ FAILED: AppxManifest.xml not found');
    TESTS.push({ name: 'AppxManifest validation', status: 'FAILED' });
  } else {
    const manifest = fs.readFileSync(manifestPath, 'utf8');
    
    // Check basic XML structure
    // NOTE: AppxManifest.xml é um template com placeholders (ex.: ${executableName})
    // que o electron-builder preenche durante o build, então validamos o template.
    if (!manifest.includes('<?xml') || !manifest.includes('</Package>')) {
      console.log('   ❌ FAILED: Invalid XML structure');
      TESTS.push({ name: 'AppxManifest validation', status: 'FAILED' });
    } else if (!manifest.includes('Executable="app\\${executableName}.exe"')) {
      console.log('   ❌ FAILED: Missing Executable attribute (template placeholder)');
      TESTS.push({ name: 'AppxManifest validation', status: 'FAILED' });
    } else if (!manifest.includes('EntryPoint="Windows.FullTrustApplication"')) {
      console.log('   ❌ FAILED: Missing Windows.FullTrustApplication EntryPoint');
      TESTS.push({ name: 'AppxManifest validation', status: 'FAILED' });
    } else if (!manifest.includes('runFullTrust')) {
      console.log('   ❌ FAILED: Missing runFullTrust capability');
      TESTS.push({ name: 'AppxManifest validation', status: 'FAILED' });
    } else {
      console.log('   ✅ PASSED: AppxManifest.xml is valid');
      TESTS.push({ name: 'AppxManifest validation', status: 'PASSED' });
    }
  }
} catch (error) {
  console.log('   ❌ FAILED:', error.message);
  TESTS.push({ name: 'AppxManifest validation', status: 'FAILED' });
}

// Test 2: package.json configuration
console.log('\nTest 2: package.json configuration');
try {
  const pkgPath = path.join(ROOT_DIR, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  
  let valid = true;
  if (!pkg.build?.appx) {
    console.log('   ❌ FAILED: Missing build.appx configuration');
    valid = false;
  }
  // appId real do projeto: Edenware.app.Snapcover (aceita snapaway/snapcover, case-insensitive)
  if (!pkg.build?.appId || !/snapaway|snapcover/i.test(pkg.build.appId)) {
    console.log('   ❌ FAILED: Invalid appId');
    valid = false;
  }
  if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) {
    console.log('   ❌ FAILED: Invalid version format (must be x.y.z)');
    valid = false;
  }
  
  if (valid) {
    console.log('   ✅ PASSED: package.json is properly configured');
    TESTS.push({ name: 'package.json configuration', status: 'PASSED' });
  } else {
    TESTS.push({ name: 'package.json configuration', status: 'FAILED' });
  }
} catch (error) {
  console.log('   ❌ FAILED:', error.message);
  TESTS.push({ name: 'package.json configuration', status: 'FAILED' });
}

// Test 3: Built app exists
console.log('\nTest 3: Built application (electron-vite build)');
try {
  const exePath = path.join(ROOT_DIR, 'dist', 'win-unpacked', 'SnapAway.exe');
  if (!fs.existsSync(exePath)) {
    console.log('   ❌ FAILED: SnapAway.exe not found in dist/win-unpacked');
    console.log('   ℹ️  Run: npm run build');
    TESTS.push({ name: 'Built application', status: 'FAILED' });
  } else {
    console.log('   ✅ PASSED: SnapAway.exe found');
    TESTS.push({ name: 'Built application', status: 'PASSED' });
  }
} catch (error) {
  console.log('   ❌ FAILED:', error.message);
  TESTS.push({ name: 'Built application', status: 'FAILED' });
}

// Test 4: IAP addon
console.log('\nTest 4: IAP addon (in-app purchases)');
try {
  const iapPath = path.join(ROOT_DIR, 'dist', 'iap_addon.node');
  if (!fs.existsSync(iapPath)) {
    console.log('   ⚠️  WARNING: iap_addon.node not found');
    console.log('   ℹ️  Run: npm run rebuild:iap && npm run copy:iap');
    TESTS.push({ name: 'IAP addon', status: 'WARNING' });
  } else {
    console.log('   ✅ PASSED: IAP addon found');
    TESTS.push({ name: 'IAP addon', status: 'PASSED' });
  }
} catch (error) {
  console.log('   ❌ FAILED:', error.message);
  TESTS.push({ name: 'IAP addon', status: 'FAILED' });
}

// Test 5: Build and Sign scripts
console.log('\nTest 5: Build scripts');
try {
  const buildScript = path.join(ROOT_DIR, 'scripts', 'build-appx.js');
  const validateScript = path.join(ROOT_DIR, 'scripts', 'validate-store-compliance.js');
  
  let valid = true;
  if (!fs.existsSync(buildScript)) {
    console.log('   ❌ FAILED: build-appx.js not found');
    valid = false;
  }
  if (!fs.existsSync(validateScript)) {
    console.log('   ❌ FAILED: validate-store-compliance.js not found');
    valid = false;
  }
  
  if (valid) {
    console.log('   ✅ PASSED: All build scripts present');
    TESTS.push({ name: 'Build scripts', status: 'PASSED' });
  } else {
    TESTS.push({ name: 'Build scripts', status: 'FAILED' });
  }
} catch (error) {
  console.log('   ❌ FAILED:', error.message);
  TESTS.push({ name: 'Build scripts', status: 'FAILED' });
}

// Test 6: APPX exists
console.log('\nTest 6: APPX package file');
try {
  const distDir = path.join(ROOT_DIR, 'dist');
  const appxFiles = fs.readdirSync(distDir).filter(f => f.endsWith('.appx'));
  
  if (appxFiles.length === 0) {
    console.log('   ❌ FAILED: No APPX files found');
    console.log('   ℹ️  Run: node scripts/build-appx.js');
    TESTS.push({ name: 'APPX package', status: 'FAILED' });
  } else {
    const latest = appxFiles.sort().pop();
    const fileSize = (fs.statSync(path.join(distDir, latest)).size / 1024 / 1024).toFixed(2);
    console.log(`   ✅ PASSED: APPX found (${latest} - ${fileSize} MB)`);
    TESTS.push({ name: 'APPX package', status: 'PASSED' });
  }
} catch (error) {
  console.log('   ❌ FAILED:', error.message);
  TESTS.push({ name: 'APPX package', status: 'FAILED' });
}

// Test 7: Documentation
console.log('\nTest 7: Documentation files');
try {
  const docs = [
    'docs/PARTNER_CENTER_SETUP.md',
    'docs/SUBMISSION_CHECKLIST.md',
    'docs/POST_SUBMISSION_GUIDE.md'
  ];
  
  let allExist = true;
  docs.forEach(doc => {
    const docPath = path.join(ROOT_DIR, doc);
    if (!fs.existsSync(docPath)) {
      console.log(`   ❌ FAILED: ${doc} not found`);
      allExist = false;
    }
  });
  
  if (allExist) {
    console.log('   ✅ PASSED: All documentation files present');
    TESTS.push({ name: 'Documentation', status: 'PASSED' });
  } else {
    TESTS.push({ name: 'Documentation', status: 'FAILED' });
  }
} catch (error) {
  console.log('   ❌ FAILED:', error.message);
  TESTS.push({ name: 'Documentation', status: 'FAILED' });
}

// Summary
console.log('\n═════════════════════════════════════════════════════════════\n');
console.log('📊 Test Summary:\n');

const passed = TESTS.filter(t => t.status === 'PASSED').length;
const failed = TESTS.filter(t => t.status === 'FAILED').length;
const warnings = TESTS.filter(t => t.status === 'WARNING').length;

TESTS.forEach(test => {
  const icon = test.status === 'PASSED' ? '✅' : (test.status === 'FAILED' ? '❌' : '⚠️');
  console.log(`   ${icon} ${test.name}: ${test.status}`);
});

console.log('\n═════════════════════════════════════════════════════════════\n');
console.log(`   ✅ Passed:  ${passed}/${TESTS.length}`);
console.log(`   ❌ Failed:  ${failed}/${TESTS.length}`);
console.log(`   ⚠️  Warnings: ${warnings}/${TESTS.length}\n`);

if (failed > 0) {
  console.log('❌ Some tests failed. Please fix the issues above before submitting.\n');
  process.exit(1);
} else if (passed === TESTS.length) {
  console.log('✅ All tests passed! Application is ready for submission.\n');
  console.log('📋 Next steps:');
  console.log('   1. Review: docs/SUBMISSION_CHECKLIST.md');
  console.log('   2. Go to: https://partner.microsoft.com/dashboard');
  console.log('   3. Create new app listing');
  console.log('   4. Upload APPX: dist/SnapAway_*.appx');
  console.log('   5. Submit for certification\n');
  process.exit(0);
} else {
  console.log('⚠️  Some warnings found. Please review before submitting.\n');
  process.exit(0);
}
