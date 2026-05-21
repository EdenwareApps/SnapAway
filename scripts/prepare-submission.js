#!/usr/bin/env node

/**
 * SnapAway - Microsoft Store Submission Preparation
 * 
 * Este script prepara o aplicativo para submissão no Microsoft Store
 * e fornece um guia passo a passo.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = path.join(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');

console.log('\nðŸ“‹ Microsoft Store Submission Preparation\n');

// Step 1: Validate compliance
console.log('1ï¸âƒ£  Validating Store Compliance...');
try {
  const compliance = require('./validate-store-compliance.js');
  console.log('   âœ“ Compliance check passed');
} catch (error) {
  console.error('   âŒ Compliance check failed');
  process.exit(1);
}

// Step 2: Find latest APPX
console.log('\n2ï¸âƒ£  Finding latest APPX package...');
const appxFiles = fs.readdirSync(DIST_DIR)
  .filter(f => f.endsWith('.appx'))
  .map(f => ({
    name: f,
    path: path.join(DIST_DIR, f),
    time: fs.statSync(path.join(DIST_DIR, f)).mtime.getTime()
  }))
  .sort((a, b) => b.time - a.time);

if (appxFiles.length === 0) {
  console.error('   âŒ No APPX files found. Run: node scripts/build-appx.js');
  process.exit(1);
}

const latestAppx = appxFiles[0];
const appxSize = (fs.statSync(latestAppx.path).size / 1024 / 1024).toFixed(2);
console.log(`   âœ“ Latest: ${latestAppx.name} (${appxSize} MB)`);

// Step 3: Check if signed
console.log('\n3ï¸âƒ£  Checking APPX signature...');
try {
  const signToolPath = 'C:\\Program Files (x86)\\Windows Kits\\10\\bin\\10.0.19041.0\\x64\\SignTool.exe';
  execSync(`"${signToolPath}" verify /pa "${latestAppx.path}"`, { stdio: 'pipe' });
  console.log('   âœ“ APPX is signed');
} catch (error) {
  console.warn('   âš ï¸  APPX is not signed');
  console.log('\n   To sign, use: node scripts/build-appx.js --sign --cert path/to/cert.pfx');
  console.log('   Or sign manually: SignTool sign /fd SHA256 /f "cert.pfx" "' + latestAppx.path + '"');
}

// Step 4: Create submission checklist
console.log('\n4ï¸âƒ£  Creating Submission Checklist...');

const checklist = `# Microsoft Partner Center Submission Checklist

## Pre-Submission
- [x] APPX built and validated
- [x] Compliance check passed
- [ ] APPX is signed with Partner Center certificate
- [ ] Marketing assets prepared (screenshots, descriptions)
- [ ] App description and privacy policy reviewed

## Partner Center Setup
1. Go to https://partner.microsoft.com/dashboard
2. Sign in with your Developer account
3. Click "Create a new app"
4. Reserve your app name: **SnapAway**

## Configuration Steps
1. **Product Identity**
   - Package Family Name: Will be auto-generated
   - Publisher Display Name: Edenware
   - Seller ID: (optional, for marketplace)

2. **Pricing & Availability**
   - Price: Set pricing tier by market
   - Categories: Utilities (or Productivity)
   - Free trial: Disable (for now)
   - Markets: Select applicable markets

3. **Store Listings**
   - Title: SnapAway
   - Description: Add comprehensive description
   - Screenshots: At least 3 (up to 9 recommended)
   - Store logo: 120x120 PNG
   
4. **In-App Products (IAP)**
   - Product ID: SnapAwayPro
   - Store ID: 9NNLVZPCLLTZ
   - Type: Durable Add-on
   - Title: SnapAway Pro Lifetime
   - Description: Lifetime Pro access
   - Price: Set by market

5. **Properties**
   - Category: Utilities
   - Category (subcategory): (leave blank or choose)
   - Website: (optional)
   - Support contact: your-email@example.com

6. **Age Rating**
   - Run questionnaire (should be 3+)
   - Accept ratings

## Submission
1. Review all information
2. Click "Submit for review"
3. Expected review time: 24-48 hours

## After Submission
- Monitor status in Partner Center
- Check for certification reports
- Address any issues if certification fails
- Once approved, app appears in Windows Store

---
**Submission File:** ${latestAppx.name}
**File Size:** ${appxSize} MB
**Date:** ${new Date().toLocaleString('pt-BR')}
`;

const checklistPath = path.join(ROOT_DIR, 'docs', 'SUBMISSION_CHECKLIST.md');
fs.writeFileSync(checklistPath, checklist);
console.log(`   âœ“ Checklist created: docs/SUBMISSION_CHECKLIST.md`);

// Step 5: Display submission info
console.log('\n5ï¸âƒ£  Submission Information:\n');
console.log('   ðŸ“¦ APPX Package Preview:');
console.log(`      File: ${latestAppx.name}`);
console.log(`      Size: ${appxSize} MB`);
console.log(`      Created: ${new Date(latestAppx.time).toLocaleString('pt-BR')}`);

console.log('\n   ðŸ“‹ Partner Center Details:');
console.log('      App Name: SnapAway');
console.log('      Publisher: Edenware');
console.log('      Category: Utilities');
console.log('      Pricing: Freemium (with IAP)');

console.log('\n   ðŸŽ¯ In-App Product (IAP):');
console.log('      Product ID: SnapAwayPro');
console.log('      Store ID: 9NNLVZPCLLTZ');
console.log('      Type: Durable Add-on');
console.log('      Title: SnapAway Pro Lifetime');

// Step 6: Create submission guide
console.log('\n6ï¸âƒ£  Partner Center Submission Guide:\n');
console.log('ðŸ“– STEP-BY-STEP INSTRUCTIONS:');
console.log('');
console.log('1. Go to: https://partner.microsoft.com/dashboard');
console.log('');
console.log('2. In the left menu, select "Apps and games" > "Create"');
console.log('');
console.log('3. Reserve the app name "SnapAway"');
console.log('');
console.log('4. Complete these sections:');
console.log('   a) Product Identity - Keep defaults');
console.log('   b) Pricing & Availability - Set free with paid IAP');
console.log('   c) Store listings - Add description, screenshots');
console.log('   d) In-App Products - Create SnapAwayPro (Store ID: 9NNLVZPCLLTZ)');
console.log('   e) Properties - Set category to Utilities');
console.log('   f) Age rating - Complete questionnaire');
console.log('');
console.log('5. Upload APPX:');
console.log(`   - File: ${latestAppx.name}`);
console.log(`   - Located in: dist/`);
console.log('');
console.log('6. Review and submit for certification');
console.log('');
console.log('7. Monitor status in Partner Center dashboard');
console.log('');

// Step 7: Display next steps
console.log(`\nâœ… Preparation complete!\n`);
console.log('ðŸ“‹ Your submission files are ready:');
console.log(`   - APPX: dist/${latestAppx.name}`);
console.log('   - Checklist: docs/SUBMISSION_CHECKLIST.md');
console.log('');
console.log('ðŸš€ Next steps:');
console.log('   1. Review docs/SUBMISSION_CHECKLIST.md');
console.log('   2. Visit Partner Center: https://partner.microsoft.com/dashboard');
console.log('   3. Create new app listing');
console.log('   4. Upload APPX package');
console.log('   5. Complete all required information');
console.log('   6. Submit for Microsoft certification');
console.log('');
