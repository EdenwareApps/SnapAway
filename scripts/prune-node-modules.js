const path = require('path');
const fs = require('fs').promises;
const { existsSync } = require('fs');

const root = process.cwd();
const nodeModulesPath = path.join(root, 'node_modules');

const removeGlobs = [
  '**/test/**',
  '**/tests/**',
  '**/__tests__/**',
  '**/example/**',
  '**/examples/**',
  '**/demo/**',
  '**/demos/**',
  '**/doc/**',
  '**/docs/**',
  '**/coverage/**',
  '**/benchmark/**',
  '**/.github/**',
  '**/.vscode/**',
  '**/scripts/**',
  '**/tools/**',
  '**/*.map',
  '**/*.md',
  '**/*.ts',
  '**/*.tsx',
  '**/*.coffee',
];

// We can't use glob directly no stdlib; use a manual walk and filter

async function walk(dir, callback) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullname = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(fullname, callback);
      await callback(fullname, true);
    } else {
      await callback(fullname, false);
    }
  }
}

function matchesPattern(fullnameRelative) {
  const normalized = fullnameRelative.replace(/\\/g, '/');
  return removeGlobs.some((pattern) => {
    if (pattern.endsWith('/**')) {
      const base = pattern.slice(0, -3);
      return normalized.startsWith(base);
    }
    if (pattern.startsWith('**/*.')) {
      const ext = pattern.slice(4);
      return normalized.endsWith(ext);
    }
    return false;
  });
}

(async () => {
  if (!existsSync(nodeModulesPath)) {
    console.log('[prune-node-modules] node_modules not found, skipping');
    return;
  }

  const toDelete = new Set();

  await walk(nodeModulesPath, (fullname, isDir) => {
    const rel = path.relative(nodeModulesPath, fullname);
    if (!rel) return Promise.resolve();

    // keep native addons and runtime files; skip deletion for node binaries
    if (fullname.endsWith('.node')) {
      return Promise.resolve();
    }

    if (matchesPattern(rel)) {
      toDelete.add(fullname);
    }

    return Promise.resolve();
  });

  const sorted = [...toDelete].sort((a, b) => b.length - a.length);
  for (const item of sorted) {
    try {
      await fs.rm(item, { recursive: true, force: true });
      console.log('[prune-node-modules] removed', item);
    } catch (error) {
      console.warn('[prune-node-modules] failed to remove', item, error.message);
    }
  }

  console.log('[prune-node-modules] finished');
})();
