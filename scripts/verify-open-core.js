#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');
const premiumProvider = require(path.join(ROOT, 'src', 'main', 'premium', 'provider.js'));

const SCANNED_EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.ts', '.tsx', '.svelte']);

const forbiddenCodePatterns = [
  {
    name: 'direct-private-import',
    regex: /require\((['"])\.{0,2}\/.*private\//i,
    message: 'Direct private require found'
  },
  {
    name: 'direct-private-import-esm',
    regex: /from\s+(['"])\.{0,2}\/.*private\//i,
    message: 'Direct private ESM import found'
  },
  {
    name: 'absolute-private-import',
    regex: /require\((['"]).*\/private\//i,
    message: 'Absolute private require found'
  }
];

function listFilesRecursive(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFilesRecursive(fullPath));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const ext = path.extname(entry.name).toLowerCase();
    if (SCANNED_EXTENSIONS.has(ext)) {
      files.push(fullPath);
    }
  }

  return files;
}

function hasRequiredIgnorePattern(filePath, patterns) {
  if (!fs.existsSync(filePath)) {
    return false;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  return patterns.some((pattern) => content.includes(pattern));
}

function main() {
  const issues = [];

  const sourceFiles = listFilesRecursive(SRC_DIR);
  for (const filePath of sourceFiles) {
    const relativePath = path.relative(ROOT, filePath).replace(/\\/g, '/');
    const content = fs.readFileSync(filePath, 'utf8');

    for (const rule of forbiddenCodePatterns) {
      if (rule.regex.test(content)) {
        issues.push(`${rule.message}: ${relativePath}`);
      }
    }
  }

  const gitignorePath = path.join(ROOT, '.gitignore');
  const npmignorePath = path.join(ROOT, '.npmignore');

  if (!hasRequiredIgnorePattern(gitignorePath, ['private/', '/private/'])) {
    issues.push('Missing private/ rule in .gitignore');
  }

  if (!hasRequiredIgnorePattern(npmignorePath, ['private/'])) {
    issues.push('Missing private/ rule in .npmignore');
  }

  try {
    const capabilities = premiumProvider.getCapabilities({
      iapAvailable: false,
      isStoreInstall: false
    });

    if (!capabilities || typeof capabilities !== 'object') {
      issues.push('premium-provider.getCapabilities did not return an object');
    } else {
      if (!capabilities.mode) {
        issues.push('premium capabilities missing mode');
      }
      if (!capabilities.license || typeof capabilities.license.available !== 'boolean') {
        issues.push('premium capabilities missing license.available');
      }
      if (!capabilities.billing || typeof capabilities.billing.available !== 'boolean') {
        issues.push('premium capabilities missing billing.available');
      }
      if (!capabilities.telemetry || typeof capabilities.telemetry.available !== 'boolean') {
        issues.push('premium capabilities missing telemetry.available');
      }
    }
  } catch (error) {
    issues.push(`premium-provider capability check failed: ${error && error.message ? error.message : String(error)}`);
  }

  if (issues.length > 0) {
    console.error('[verify-open-core] FAIL');
    for (const issue of issues) {
      console.error(` - ${issue}`);
    }
    process.exit(1);
  }

  console.log('[verify-open-core] OK');
  console.log(`Scanned ${sourceFiles.length} source files.`);
}

main();
