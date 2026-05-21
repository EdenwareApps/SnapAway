const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const runtimeRequire = createRequire(__filename);

const PRIVATE_PROVIDER_CANDIDATES = [
    path.join(process.cwd(), 'private', 'premium-provider.js'),
    path.join(process.cwd(), 'private', 'snapaway-premium-provider.js'),
    path.join(__dirname, '..', '..', 'private', 'premium-provider.js')
];

let loadedProvider = null;
let loadedProviderPath = null;
let loadError = null;

function loadPrivateProvider() {
    if (loadedProvider) {
        return loadedProvider;
    }

    for (const candidatePath of PRIVATE_PROVIDER_CANDIDATES) {
        try {
            if (!fs.existsSync(candidatePath)) {
                continue;
            }
            // Keep the private provider fully optional for community builds.
            // createRequire keeps runtime dynamic loading without eval warnings
            // and prevents SSR bundling from resolving machine-local modules.
            const requiredModule = runtimeRequire(candidatePath);
            loadedProvider = (requiredModule && (requiredModule.default || requiredModule)) || requiredModule;
            loadedProviderPath = candidatePath;
            loadError = null;
            return loadedProvider;
        } catch (error) {
            loadError = error && error.message ? error.message : String(error);
        }
    }

    return null;
}

function getFallbackCapabilities(context = {}) {
    return {
        mode: 'community',
        loaded: false,
        providerPath: null,
        error: loadError,
        license: {
            available: false,
            reason: 'private-provider-not-loaded'
        },
        billing: {
            available: !!context.iapAvailable,
            reason: context.iapAvailable ? 'iap-native-available' : 'iap-native-unavailable',
            isStoreInstall: !!context.isStoreInstall
        },
        telemetry: {
            available: true,
            reason: 'public-telemetry-module'
        }
    };
}

function getCapabilities(context = {}) {
    const privateProvider = loadPrivateProvider();
    if (!privateProvider || typeof privateProvider.getCapabilities !== 'function') {
        return getFallbackCapabilities(context);
    }

    try {
        const providerCapabilities = privateProvider.getCapabilities(context);
        if (!providerCapabilities || typeof providerCapabilities !== 'object') {
            return getFallbackCapabilities(context);
        }
        return {
            ...getFallbackCapabilities(context),
            ...providerCapabilities,
            loaded: true,
            providerPath: loadedProviderPath,
            error: null
        };
    } catch (error) {
        return {
            ...getFallbackCapabilities(context),
            loaded: false,
            providerPath: loadedProviderPath,
            error: error && error.message ? error.message : String(error)
        };
    }
}

module.exports = {
    getCapabilities,
    loadPrivateProvider
};