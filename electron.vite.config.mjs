import { defineConfig } from 'electron-vite';
import { resolve } from 'path';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import fs from 'fs';
import path from 'path';
// bundling helpers
import commonjs from '@rollup/plugin-commonjs';
import { nodeResolve } from '@rollup/plugin-node-resolve';

function copyNativeModules() {
  return {
    name: 'copy-native-modules',
    writeBundle() {
      const nativeModules = [
        ['src/audio/build/Release/audio_addon.node'],
        ['src/icon-extractor/build/Release/icon_addon.node', 'src/icons/build/Release/icon_addon.node'],
        ['src/process/build/Release/process_addon.node'],
        ['src/windows/build/Release/windows_addon.node'],
        ['src/iap/build/Release/iap_addon.node']
      ];

      const wrapperScripts = [
        'src/audio/audio-wrapper.js',
        'src/icons/icon-wrapper.js',
        'src/process/process-wrapper.js',
        'src/windows/windows-wrapper.js',
        'src/iap/iap-wrapper.js',
        'src/iap/iap-child.js'
      ];

      nativeModules.forEach((candidatePaths) => {
        const existing = candidatePaths.find((modulePath) => fs.existsSync(path.resolve(modulePath)));
        if (existing) {
          const srcPath = path.resolve(existing);
          const destPath = path.resolve('out/main', path.basename(existing));
          try {
            fs.copyFileSync(srcPath, destPath);
            console.log(`Copied ${existing} to out/main/`);
          } catch (error) {
            const lockError = error && (error.code === 'EBUSY' || error.code === 'EPERM');
            if (lockError && fs.existsSync(destPath)) {
              console.warn(`Native module locked during copy (${existing}); reusing existing ${destPath}`);
            } else {
              throw error;
            }
          }
        } else {
          console.warn(`Native module not found: ${candidatePaths.join(' OR ')}`);
        }
      });

      // copy wrapper scripts preserving directory structure under out/main
      wrapperScripts.forEach(script => {
        const srcPath = path.resolve(script);
        if (fs.existsSync(srcPath)) {
          const relative = path.relative('src', script);
          const destPath = path.resolve('out/main', relative);
          fs.mkdirSync(path.dirname(destPath), { recursive: true });
          fs.copyFileSync(srcPath, destPath);
          console.log(`Copied wrapper ${script} to ${destPath}`);

          // also duplicate at the root of out/main to satisfy any flattened require paths
          const rootDest = path.resolve('out/main', path.basename(script));
          if (rootDest !== destPath) {
            fs.copyFileSync(srcPath, rootDest);
            console.log(`Also copied wrapper ${script} to ${rootDest}`);
          }
        } else {
          console.warn(`Wrapper script not found: ${script}`);
        }
      });
    }
  };
}

function copyTitlebarThemeIcons() {
  return {
    name: 'copy-titlebar-theme-icons',
    writeBundle() {
      const outputDir = path.resolve('out/renderer/assets/images');
      const sourceDir = path.resolve('src/renderer/assets/images');
      const icons = ['black.png', 'white.png'];

      fs.mkdirSync(outputDir, { recursive: true });
      icons.forEach((iconName) => {
        const srcPath = path.join(sourceDir, iconName);
        const destPath = path.join(outputDir, iconName);

        if (fs.existsSync(srcPath)) {
          fs.copyFileSync(srcPath, destPath);
          console.log(`Copied titlebar icon ${iconName} to out/renderer/assets/images/`);
        } else {
          console.warn(`Titlebar icon not found: ${srcPath}`);
        }
      });
    }
  };
}

export default defineConfig({
  main: {
    build: {
      // Preserve native addon binaries in out/main between rebuilds.
      // Vite's default cleanup can fail with EPERM when a .node file is locked.
      emptyOutDir: false,
      rollupOptions: {
        // bundle everything except electron and native binaries
        // treat any wrapper script or native binary as external so runtime require
        // pulls the copied file instead of bundling it.  using a function allows
        // us to match by suffix rather than glob semantics.
        external(id) {
          // builtins and electron must stay external
          if (id === 'electron') return true;
          // native binary modules
          if (id.endsWith('.node')) return true;
          // treat any file whose basename ends with -wrapper.js as external; this
          // handles absolute Windows paths with backslashes as well as relative
          const name = path.basename(id);
          if (name.endsWith('-wrapper.js')) return true;
          return false;
        },

        plugins: [
          nodeResolve({ preferBuiltins: true }),
          commonjs({
            // allow dynamic require for native addons but ignore static analysis on
            // wrappers since they are external now
            ignoreDynamicRequires: true,
            dynamicRequireTargets: [
              'src/**/build/**/Release/*.node',
              'out/main/*.node'
            ]
            // no need for exclude array; wrappers are external already
          }),
          // copy native .node files and wrapper scripts into out/main after build
          copyNativeModules()
        ],
        output: {
          // force a single bundle file for main process
          manualChunks: () => 'main'
        }
      }
    },
    resolve: {
      alias: {
        '@main': resolve(__dirname, 'src/main'),
        '@utils': resolve(__dirname, 'src')
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        // bundle preload script as a single file as well
        external: ['electron'],
        plugins: [
          nodeResolve({ preferBuiltins: true }),
          commonjs()
        ],
        output: {
          manualChunks: () => 'preload'
        }
      }
    }
  },
  renderer: {
    plugins: [svelte()],
    build: {
      rollupOptions: {
        plugins: [copyTitlebarThemeIcons()],
        output: {
          entryFileNames: '[name].js',
          chunkFileNames: '[name].js',
          assetFileNames: '[name].[ext]',
          manualChunks: () => 'renderer'
        }
      }
    },
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer'),
        '@components': resolve(__dirname, 'src/renderer/components')
      }
    }
  },
  // no top-level plugins needed; native modules are handled in main.build.rollupOptions
});

