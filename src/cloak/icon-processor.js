const { nativeImage } = require('electron');
const fs = require('fs').promises;
const path = require('path');

class IconProcessor {
    /**
     * Process and save cloak icon in appropriate formats for each platform
     * @param {string} sourcePath - Path to source image file
     * @param {string} outputDir - Directory to save processed icons
     * @returns {Promise<Object>} - Object with paths to processed icons
     */
    async processCloakIcon(sourcePath, outputDir) {
        try {
            // Validate inputs
            if (!sourcePath || typeof sourcePath !== 'string') {
                throw new Error('Invalid source path');
            }
            if (!outputDir || typeof outputDir !== 'string') {
                throw new Error('Invalid output directory');
            }
            
            // Check if source file exists
            if (!await this.fileExists(sourcePath)) {
                throw new Error(`Source file does not exist: ${sourcePath}`);
            }

            // Ensure output directory exists
            await fs.mkdir(outputDir, { recursive: true });

            const baseName = 'cloak-icon';
            const results = {};

            // Load image using Electron nativeImage
            let img;
            try {
                img = nativeImage.createFromPath(sourcePath);
            } catch (error) {
                throw new Error(`Failed to load image: ${error.message}`);
            }

            const size = img.getSize();
            if (!size.width || !size.height) {
                throw new Error('Invalid image file - unable to read dimensions');
            }

            console.log('[ICON-PROCESSOR] Source image:', size.width, 'x', size.height);

            // Process for Windows (PNG format - Electron accepts PNG as icon on Windows)
            if (process.platform === 'win32') {
                const pngPath = path.join(outputDir, `${baseName}.png`);
                // Create high-quality PNG for Windows using nativeImage
                const resized = img.resize({ width: 256, height: 256 });
                await fs.writeFile(pngPath, resized.toPNG());
                results.windows = pngPath;
                results.primary = pngPath;
            }

            // Process for macOS (PNG)
            if (process.platform === 'darwin') {
                const pngPath = path.join(outputDir, `${baseName}.png`);
                // Create high-quality PNG for macOS
                const resizedMac = img.resize({ width: 512, height: 512 });
                await fs.writeFile(pngPath, resizedMac.toPNG());
                results.macos = pngPath;
                if (!results.primary) results.primary = pngPath;
            }

            // Process for Linux (PNG)
            if (process.platform === 'linux') {
                const pngPath = path.join(outputDir, `${baseName}.png`);
                // Create PNG for Linux
                const resizedLin = img.resize({ width: 512, height: 512 });
                await fs.writeFile(pngPath, resizedLin.toPNG());
                results.linux = pngPath;
                if (!results.primary) results.primary = pngPath;
            }

            // Also create a PNG for titlebar (small size)
            const titlebarPath = path.join(outputDir, `${baseName}-titlebar.png`);
            const resizedTitle = img.resize({ width: 26, height: 26 });
            await fs.writeFile(titlebarPath, resizedTitle.toPNG());
            results.titlebar = titlebarPath;

            // Create tray icon (typically 16x16 or 32x32)
            const trayPath = path.join(outputDir, `${baseName}-tray.png`);
            const resizedTray = img.resize({ width: 32, height: 32 });
            await fs.writeFile(trayPath, resizedTray.toPNG());
            results.tray = trayPath;

            // Ensure primary icon exists
            if (!results.primary) {
                throw new Error('Failed to create primary icon for current platform');
            }
            
            // Verify that primary icon file was actually created
            if (!await this.fileExists(results.primary)) {
                throw new Error(`Primary icon file was not created: ${results.primary}`);
            }
            
            console.log('[ICON-PROCESSOR] Icons processed successfully:', results);
            return results;
        } catch (error) {
            console.error('[ICON-PROCESSOR] Error processing icon:', error);
            throw error;
        }
    }

    /**
     * Check if file exists
     * @param {string} filePath - Path to file
     * @returns {Promise<boolean>} - True if file exists
     */
    async fileExists(filePath) {
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Validate image file
     * @param {string} filePath - Path to image file
     * @returns {Promise<boolean>} - True if valid image
     */
    async validateImage(filePath) {
        try {
            const img = nativeImage.createFromPath(filePath);
            const size = img.getSize();
            return size.width > 0 && size.height > 0;
        } catch (error) {
            console.error('[ICON-PROCESSOR] Invalid image:', error);
            return false;
        }
    }
}

module.exports = new IconProcessor();
