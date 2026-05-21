const path = require('path');
const fs = require('fs');

// Load the native addon
let IconExtractorClass;
try {
    // Try multiple possible paths for the addon
    let nativeAddon;
    const appUnpackedPath = process.resourcesPath
        ? path.join(process.resourcesPath, 'app.asar.unpacked')
        : null;
    const possiblePaths = [
        // Dev: wrapper copied to out/main/icons, addon copied to out/main
        path.join(__dirname, '..', 'icon_addon.node'),
        // Dev: original source location
        path.join(__dirname, '..', 'icon-extractor', 'build', 'Release', 'icon_addon.node'),
        path.join(__dirname, 'build', 'Release', 'icon_addon.node'),
        path.join(__dirname, 'build', 'Release', 'icon_addon'),
        // Dev: from workspace root
        path.join(process.cwd(), 'src', 'icon-extractor', 'build', 'Release', 'icon_addon.node'),
        path.join(process.cwd(), 'src', 'icon-extractor', 'build', 'Debug', 'icon_addon.node'),
        path.join(process.cwd(), 'src', 'icons', 'build', 'Release', 'icon_addon.node'),
        path.join(process.cwd(), 'src', 'icons', 'build', 'Release', 'icon_addon'),
        path.join(process.cwd(), 'out', 'main', 'icon_addon.node'),
        path.join(process.cwd(), 'dist', 'icon_addon.node'),
        path.join(process.cwd(), 'dist', 'icon_addon'),
        path.join(__dirname, '..', '..', 'src', 'icons', 'build', 'Release', 'icon_addon.node'),
        path.join(__dirname, '..', '..', 'src', 'icons', 'build', 'Release', 'icon_addon'),
        path.join(__dirname, '..', '..', 'dist', 'icon_addon.node'),
        path.join(__dirname, '..', '..', 'dist', 'icon_addon'),
        // Packaged app paths (asarUnpack includes dist/icon_addon.node)
        ...(appUnpackedPath ? [
            path.join(appUnpackedPath, 'dist', 'icon_addon.node'),
            path.join(appUnpackedPath, 'src', 'icon-extractor', 'build', 'Release', 'icon_addon.node'),
            path.join(appUnpackedPath, 'src', 'icon-extractor', 'build', 'Debug', 'icon_addon.node'),
            path.join(appUnpackedPath, 'src', 'icons', 'build', 'Release', 'icon_addon.node'),
            path.join(appUnpackedPath, 'src', 'icons', 'build', 'Debug', 'icon_addon.node'),
            path.join(appUnpackedPath, 'out', 'main', 'icon_addon.node')
        ] : [])
    ];
    
    const r = eval('require');
    for (const addonPath of possiblePaths) {
        try {
            nativeAddon = r(addonPath);
            // console.log('[ICON-ADDON] Native icon addon loaded from:', addonPath);
            break;
        } catch (e) {
            // Continue to next path
        }
    }
    
    if (nativeAddon) {
        IconExtractorClass = nativeAddon.IconExtractor;
        // console.log('[ICON-ADDON] Native icon addon loaded successfully');
    } else {
        throw new Error('Addon not found in any of the expected paths');
    }
} catch (error) {
    console.warn('[ICON-ADDON] Native icon addon not available:', error.message);
    IconExtractorClass = null;
}

class IconExtractorWrapper {
    constructor() {
        this.isAvailable = IconExtractorClass !== null;
        this.extractor = this.isAvailable ? new IconExtractorClass() : null;
        
        if (this.isAvailable) {
            // console.log('[ICON-ADDON] Icon extractor initialized');
        } else {
            console.log('[ICON-ADDON] Icon extractor not available, using fallback');
        }
    }

    /**
     * Extract icon from executable file
     * @param {string} executablePath - Path to the executable file
     * @param {string} outputPath - Path where the icon should be saved
     * @returns {Promise<boolean>} - True if successful, false otherwise
     */
    async extractIcon(executablePath, outputPath) {
        if (!this.isAvailable || !this.extractor) {
            // console.log('[ICON-ADDON] Native extractor not available, skipping extraction');
            return false;
        }

        try {
            // Ensure the output directory exists
            const outputDir = path.dirname(outputPath);
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }

            // Extract icon using native addon
            const result = this.extractor.extractIcon(executablePath, outputPath);
            
            if (result) {
                // console.log(`[ICON-ADDON] Successfully extracted icon from ${executablePath} to ${outputPath}`);
                return true;
            } else {
                // console.log(`[ICON-ADDON] Failed to extract icon from ${executablePath}`);
                return false;
            }
        } catch (error) {
            console.error(`[ICON-ADDON] Error extracting icon from ${executablePath}:`, error);
            return false;
        }
    }

    /**
     * Extract icons from multiple executables
     * @param {Array<string>} executables - Array of executable paths
     * @param {string} outputDir - Directory where icons should be saved
     * @returns {Promise<Object>} - Mapping of executable paths to icon paths
     */
    async extractIcons(executables, outputDir) {
        if (!this.isAvailable) {
            // console.log('[ICON-ADDON] Native extractor not available, returning empty mapping');
            return {};
        }

        const mappings = {};
        const promises = executables.map(async (executable) => {
            try {
                // Create a safe filename for the icon
                const safeName = executable.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
                const iconPath = path.join(outputDir, `${safeName}.png`);
                
                const success = await this.extractIcon(executable, iconPath);
                if (success) {
                    mappings[executable] = iconPath;
                }
            } catch (error) {
                console.error(`[ICON-ADDON] Error processing executable ${executable}:`, error);
            }
        });

        await Promise.allSettled(promises);
        return mappings;
    }

    /**
     * Clean up resources
     */
    cleanup() {
        if (this.isAvailable && this.extractor.cleanup) {
            this.extractor.cleanup();
        }
    }
}

module.exports = IconExtractorWrapper; 