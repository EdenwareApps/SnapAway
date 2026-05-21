const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const superagent = require('superagent');

// NOTE: For real security, the server signs licenses using a private key and the client
// verifies signatures using a public key.
// The public key is hardcoded here (as provided by the server) for client-side validation.
// This eliminates the need to fetch the public key at runtime.
const PUBLIC_KEY = process.env.SNAPAWAY_PUBLIC_KEY || `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA2XYCNVOywji0qkJPVufk
uSMLNOEPwYyPr2mIGAZ5WXnnO7xUqLPxSjigmN8RnfAW5t3rvKK3XnYEqmgIWClW
c5nK5zXoAoBPpAp7KXTJ80Y6/9/2pMOIMjVgPQbgnYKRfj61/hYFoBbOahIuA2l5
lBWOSoP3qJts1DFPw4chDAHWCuoV+ZWEP3EL9QCVLfvcCEm6WCti3dBasGTVOeMo
z8OphI+qVax9NA+XQ2jYNPsSnCvSuUWKkQ1eqYj6uJc29bg8LsESbBJRD2eMLkR/
RmYVDrJ6QH1cEJWZ5YL74vZk4YcaZt8wWopUjY5Hq0EJ3+lmnaUFKz1VklE8ZjoY
DQIDAQAB
-----END PUBLIC KEY-----\n`;

function isPublicKeyPlaceholder(key) {
    return !key || key.includes('REPLACE_WITH_REAL_PUBLIC_KEY');
}

// Legacy HMAC secret (used only for very old license formats).
// New licenses should always be verified with the public key. HMAC fallback is not used.
const LICENSE_SIGNING_SECRET = process.env.LICENSE_SECRET_KEY || process.env.SNAPAWAY_LICENSE_SECRET || 'replace-this-with-your-secret';


class LicenseManager {
    constructor() {
        this.licensePath = path.join(os.homedir(), '.snapaway', 'license.json');
        this.validLicenseKey = 'SNAPAWAY-Pro-2024-EDENWARE';
        this.freeAppLimit = 2;
        this.licenseServer = 'https://hub.edenware.app';
        this.appId = 'snapaway';
        this.enableOnlineVerification = true; // Pode ser desabilitado para modo offline
        this.ProFeatures = {
            unlimitedApps: true,
            passwordProtection: true,
            audioControl: true,
            advancedShortcuts: true,
            highPriority: true
        };
        
        // Security: Split hash into multiple parts stored in different places
        this._hashParts = this._generateHashParts();
        this._validationKey = this._deriveValidationKey();
        this.lastOnlineCheck = null;
        this.onlineCheckInterval = 24 * 60 * 60 * 1000; // 24 hours
        this.requireOnlineCheck = true; // Force online check after 24h

        // Public key used to verify license signatures (hardcoded for clients).
        // Replace the placeholder in PUBLIC_KEY with the actual PEM key.
        // Users can also override via SNAPAWAY_PUBLIC_KEY.
        this.publicKey = isPublicKeyPlaceholder(PUBLIC_KEY) ? (process.env.SNAPAWAY_PUBLIC_KEY || null) : PUBLIC_KEY;
    }
    
    // Security: Split hash into parts to make it harder to find
    _generateHashParts() {
        const fullHash = '97855ce59fcccef3d59a9341afdbe5fc6907c0268edffd1adbc318bd6c05d084';
        return {
            part1: fullHash.substring(0, 16),
            part2: fullHash.substring(16, 32),
            part3: fullHash.substring(32, 48),
            part4: fullHash.substring(48, 64)
        };
    }
    
    // Security: Derive validation key from multiple sources
    _deriveValidationKey() {
        const machineId = this.getMachineId();
        const appVersion = '1.0.0'; // Can be read from package.json if needed
        return crypto.createHash('sha256')
            .update(machineId + appVersion + 'SnapAway2024Edenware')
            .digest('hex').substring(0, 16);
    }
    
    // Security: This client does not generate signatures itself.
    // The server must provide the signature (asymmetric signing with a private key),
    // and the client validates it using the public key.
    _signLicenseData() {
        // Intentionally not implemented; signatures must come from the server.
        return null;
    }

    // Verify a signed payload using the server's public key.
    _verifySignedData(value, signature) {
        if (!this.publicKey || !signature) return false;

        try {
            const verifier = crypto.createVerify('sha256');
            verifier.update(value);
            verifier.end();
            return verifier.verify(this.publicKey, signature, 'hex');
        } catch (error) {
            return false;
        }
    }

    // Generate license hash for verification
    generateLicenseHash(licenseKey) {
        const salt = 'SnapAway2024Edenware';
        return crypto.createHash('sha256')
            .update(licenseKey + salt)
            .digest('hex');
    }

    // Get machine ID for online verification
    getMachineId() {
        const machineInfo = {
            hostname: os.hostname(),
            platform: os.platform(),
            arch: os.arch(),
            cpus: os.cpus().length,
            totalMem: os.totalmem()
        };
        
        const machineString = JSON.stringify(machineInfo);
        return crypto.createHash('sha256').update(machineString).digest('hex').substring(0, 16);
    }

    // Human-friendly license error mapping
    _humanizeLicenseError(message) {
        if (!message) {
            return 'License verification failed. Please try again.';
        }

        // If message is an object with details, format the first validation issue.
        if (typeof message === 'object') {
            if (message.details && Array.isArray(message.details) && message.details.length > 0) {
                const first = message.details[0];
                return `${first.message || 'Validation failed'}${first.field ? ` (${first.field})` : ''}`;
            }
            if (message.error) {
                return this._humanizeLicenseError(message.error);
            }
            return 'License verification failed. Please try again.';
        }

        if (typeof message !== 'string') {
            return 'License verification failed. Please try again.';
        }

        const normalized = message.toLowerCase();
        if (normalized.includes('machine id must be between')) {
            return 'Invalid machine ID reported by server. Please restart the app and try again.';
        }
        if (normalized.includes('not activated on this machine')) {
            return 'This license is valid but not activated on this machine. Activate using your hub account or contact support.';
        }
        if (normalized.includes('not activated')) {
            return 'This license is valid but not currently activated. Please activate it in your account or try again later.';
        }
        if (normalized.includes('does not match required format') || normalized.includes('invalid format')) {
            return 'Invalid license key format. Use a key in the format SNAPAWAY-XXXX-XXXX-XXXX.';
        }
        if (normalized.includes('internal server error')) {
            return 'License server error. Please try again in a few minutes.';
        }
        if (normalized.includes('expired')) {
            return 'This license has expired. Please renew or purchase a new license.';
        }
        if (normalized.includes('not found') || normalized.includes('unknown')) {
            return 'License not found. Please verify your license key and try again.';
        }

        // Fallback to generic message for unknown errors.
        return message;
    }

    // Verify a stored license file has a valid signature and is not expired.
    _verifyStoredLicense(licenseData) {
        if (!licenseData || !licenseData.key) return false;

        // If we have a signature, verify it using either the server public key (preferred)
        // or the shared secret (fallback).
        if (licenseData.signature) {
            const activatedAt = licenseData.activated || licenseData.activatedAt || (licenseData.timestamp ? new Date(licenseData.timestamp).toISOString() : new Date().toISOString());
            const expiresAt = licenseData.expiresAt || licenseData.expires || activatedAt;
            const dataToSign = `${licenseData.key}|${licenseData.machineId}|${activatedAt}|${expiresAt}`;

            // Prefer asymmetric signature verification (public key).
            // Without a public key we cannot validate the signature.
            if (!this.publicKey) {
                return false;
            }
            if (!this._verifySignedData(dataToSign, licenseData.signature)) {
                return false;
            }
        }

        // Expiration check (optional, but recommended)
        if (licenseData.expiresAt) {
            const expires = new Date(licenseData.expiresAt);
            if (Number.isFinite(expires.getTime()) && expires < new Date()) {
                console.warn('[LICENSE] Stored license expired:', licenseData.expiresAt);
                return false;
            }
        }

        return true;
    }

    // Verify license key (offline) - Enhanced with multiple validation layers
    // If `expectedHash` is provided, it is treated as the authoritative hash stored in the license file.
    // Otherwise, a legacy constant hash is used for backwards compatibility.
    verifyLicenseOffline(licenseKey, expectedHash = null) {
        if (!licenseKey) {
            console.warn('[LICENSE] verifyLicenseOffline called with empty or missing license key');
            return false;
        }

        const sanitized = this.sanitizeLicenseKey(licenseKey);
        if (!sanitized) {
            console.warn('[LICENSE] verifyLicenseOffline rejected invalid license format', { licenseKey });
            return false;
        }

        const computedHash = this.generateLicenseHash(sanitized);

        // If we have an expected hash (from the stored license file), validate against it.
        if (expectedHash) {
            const isValid = computedHash === expectedHash;
            if (!isValid) {
                console.warn('[LICENSE] Offline validation failed: stored hash mismatch', {
                    licenseKey: sanitized,
                    expectedHash,
                    computedHash
                });
            }
            return isValid;
        }

        // Legacy behavior: validate against a fixed expected hash + derived validation key.
        const parts = this._hashParts;
        const legacyExpectedHash = parts.part1 + parts.part2 + parts.part3 + parts.part4;

        const validationKeyCheck = crypto.createHash('sha256')
            .update(sanitized + this._validationKey)
            .digest('hex');

        const isValidHash = computedHash === legacyExpectedHash;
        const isValidKey = validationKeyCheck.substring(0, 16) === this._validationKey.substring(0, 16);

        if (!isValidHash) {
            console.warn('[LICENSE] Offline validation failed: license hash mismatch', {
                licenseKey: sanitized,
                expectedHash: legacyExpectedHash,
                computedHash
            });
        }

        if (!isValidKey) {
            console.warn('[LICENSE] Offline validation failed: validation key mismatch', {
                validationKey: this._validationKey.substring(0, 16),
                computed: validationKeyCheck.substring(0, 16)
            });
        }

        return isValidHash && isValidKey;
    }

    // Fetch public key from server (used for signature verification)
    // NOTE: In current deployments the public key is hardcoded in the client.
    async fetchPublicKey() {
        return this.publicKey;
    }

    // Verify license online (optional)
    async verifyLicenseOnline(licenseKey) {
        if (!this.enableOnlineVerification || !this.licenseServer) {
            return false;
        }

        try {
            const machineId = this.getMachineId();
            const response = await superagent
                .post(`${this.licenseServer}/api/license/verify`)
                .send({
                    licenseKey: licenseKey,
                    machineId: machineId,
                    appId: this.appId
                })
                .timeout(10000);

            const body = response.body || {};
            if (!body.success) {
                return false;
            }

            const licensed = body.data?.license;
            if (!licensed || !licensed.signature || !this.publicKey) {
                return false;
            }

            const dataToSign = `${licensed.licenseKey}|${licensed.machineId}|${licensed.activatedAt}|${licensed.expiresAt}`;
            return this._verifySignedData(dataToSign, licensed.signature);
        } catch (error) {
            return false;
        }
    }

    // Save license to file - Enhanced with integrity signature
    // `options` can include `activatedAt`, `expiresAt`, and `signature` (from server).
    saveLicense(licenseKey, options = {}) {
        try {
            const licenseDir = path.dirname(this.licensePath);
            if (!fs.existsSync(licenseDir)) {
                fs.mkdirSync(licenseDir, { recursive: true });
            }

            const machineId = this.getMachineId();
            const activatedAt = options.activatedAt || new Date().toISOString();
            const expiresAt = options.expiresAt || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
            const timestamp = Date.now();

            const signature = options.signature;
            if (!signature) {
                // Do not save a license without a server signature; it cannot be validated.
                console.warn('[LICENSE] License activation response missing signature; cannot save license.');
                return false;
            }

            const licenseData = {
                key: licenseKey,
                activated: activatedAt,
                expiresAt: expiresAt,
                hash: this.generateLicenseHash(licenseKey),
                machineId: machineId,
                version: '1.0',
                timestamp: timestamp,
                // Security: Add integrity signature to detect tampering
                signature
            };

            // Write with atomic operation
            const tempPath = this.licensePath + '.tmp';
            fs.writeFileSync(tempPath, JSON.stringify(licenseData, null, 2));
            fs.renameSync(tempPath, this.licensePath);
            
            // Set file permissions (read-only) on non-Windows systems
            if (process.platform !== 'win32') {
                try {
                    fs.chmodSync(this.licensePath, 0o400);
                } catch (err) {
                    // Ignore chmod errors
                }
            }
            
            return true;
        } catch (error) {
            console.error('[LICENSE] Error saving license:', error);
            return false;
        }
    }

    // Load license from file - only accept if signature verifies against the public key.
    loadLicense() {
        try {
            if (!fs.existsSync(this.licensePath)) {
                return null;
            }

            const licenseData = JSON.parse(fs.readFileSync(this.licensePath, 'utf8'));

            // Must have a signature and public key to validate the license.
            if (!licenseData.signature || !this.publicKey) {
                this.removeLicense();
                return null;
            }

            // Verify signature (strict; no fallback behavior)
            if (!this._verifyStoredLicense(licenseData)) {
                this.removeLicense();
                return null;
            }

            // Integrity check on the stored hash
            const storedHash = licenseData.hash;
            const computedHash = this.generateLicenseHash(licenseData.key);
            if (storedHash !== computedHash) {
                console.warn('[LICENSE] License hash mismatch - removing invalid license');
                this.removeLicense();
                return null;
            }

            // Optional: warn if machine ID changed (does not invalidate)
            const currentMachineId = this.getMachineId();
            if (licenseData.machineId && licenseData.machineId !== currentMachineId) {
                console.warn('[LICENSE] Machine ID mismatch - license may not be valid on this device');
            }

            return licenseData;
        } catch (error) {
            console.error('[LICENSE] Error loading license:', error);
            return null;
        }
    }

    // Remove license file
    removeLicense() {
        try {
            if (fs.existsSync(this.licensePath)) {
                fs.unlinkSync(this.licensePath);
            }
        } catch (error) {
            console.error('[LICENSE] Error removing license:', error);
        }
    }

    // Activate license on server
    async activateLicenseOnline(licenseKey) {
        if (!this.enableOnlineVerification || !this.licenseServer) {
            return { success: false, message: 'Online activation not available' };
        }

        try {
            const machineId = this.getMachineId();
            const response = await superagent
                .post(`${this.licenseServer}/api/license/activate`)
                .send({
                    licenseKey: licenseKey,
                    machineId: machineId,
                    appId: this.appId
                })
                .timeout(10000);
            
            const body = response.body || {};
            if (body.success) {
                return {
                    success: true,
                    message: 'License activated successfully',
                    data: body.data
                };
            } else {
                const serverError = body.error || 'License activation failed';
                const details = body.details || null;
                return {
                    success: false,
                    message: this._humanizeLicenseError({ error: serverError, details }),
                    details
                };
            }
        } catch (error) {
            const serverBody = error.response?.body || {};
            const humanMessage = this._humanizeLicenseError({ error: serverBody.error || error.message || 'License activation failed', details: serverBody.details });
            return {
                success: false,
                message: humanMessage,
                details: serverBody.details || []
            };
        }
    }

    // Activate license
    async activateLicense(licenseKey) {
        try {
            // Sanitize input
            const sanitizedKey = this.sanitizeLicenseKey(licenseKey);
            if (!sanitizedKey) {
                return {
                    success: false,
                    message: 'Invalid license key format'
                };
            }

            // First, activate on server
            const activationResult = await this.activateLicenseOnline(sanitizedKey);
            if (!activationResult.success) {
                return activationResult;
            }

            // Then verify (online if available, offline as fallback)
            const isValid = await this.verifyLicenseOnline(sanitizedKey);
            
            if (isValid) {
                // Save the license locally, including any signature/expiration fields returned by the server.
                const serverData = activationResult.data?.license ? activationResult.data.license : activationResult.data;
                const activatedAt = serverData?.activatedAt || serverData?.activated || new Date().toISOString();
                const expiresAt = serverData?.expiresAt || serverData?.expires || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
                const signature = serverData?.signature;

                const saved = this.saveLicense(sanitizedKey, {
                    activatedAt,
                    expiresAt,
                    signature
                });

                if (saved) {
                    return {
                        success: true,
                        features: this.ProFeatures,
                        message: 'License activated successfully'
                    };
                } else {
                    return {
                        success: false,
                        message: 'Failed to save license'
                    };
                }
            } else {
                return {
                    success: false,
                    message: 'License verification failed after activation'
                };
            }
        } catch (error) {
            console.error('[LICENSE] Error activating license:', error);
            return {
                success: false,
                message: 'License activation failed'
            };
        }
    }

    // Sanitize license key input
    sanitizeLicenseKey(licenseKey) {
        if (!licenseKey || typeof licenseKey !== 'string') {
            return null;
        }
        
        // Remove whitespace and convert to uppercase
        const sanitized = licenseKey.trim().toUpperCase();
        
        // New format example: SNAPAWAY-EWG5-8MGT-TSC5
        const newFormatPattern = /^SNAPAWAY-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
        
        if (!newFormatPattern.test(sanitized)) {
            console.warn('[LICENSE] sanitizeLicenseKey rejected invalid format:', {
                original: licenseKey,
                sanitized
            });
            return null;
        }
        
        return sanitized;
    }

    // Check if user has Pro access - CRITICAL: Only accept licenses when signature verification passes.
    isPro() {
        const license = this.loadLicense();
        if (!license) return false;

        // If there is no signature, the license cannot be trusted.
        if (!license.signature) {
            this.removeLicense();
            return false;
        }

        // Verify signature using the server public key.
        if (!this._verifyStoredLicense(license)) {
            this.removeLicense();
            return false;
        }

        // Integrity check: ensure the stored hash matches the computed hash.
        const storedHash = license.hash;
        const computedHash = this.generateLicenseHash(license.key);
        if (storedHash !== computedHash) {
            console.warn('[LICENSE] License hash mismatch - removing invalid license');
            this.removeLicense();
            return false;
        }

        return true;
    }
    
    // Check Pro with online verification (for periodic checks)
    // Uses signature-based verification; does not rely on legacy hash checks.
    async isProWithOnlineCheck() {
        const license = this.loadLicense();
        if (!license) return false;

        // Verify stored signature first.
        if (!this._verifyStoredLicense(license)) {
            return false;
        }

        // If online checks are enabled and due, run one.
        const now = Date.now();
        const lastCheck = this.lastOnlineCheck || (license.activated ? new Date(license.activated).getTime() : 0);
        const timeSinceCheck = now - lastCheck;

        if (this.requireOnlineCheck && timeSinceCheck > this.onlineCheckInterval) {
            try {
                const isValid = await this.verifyLicenseOnline(license.key);
                this.lastOnlineCheck = now;
                return isValid;
            } catch (error) {
                console.warn('[LICENSE] Online check failed, using stored signature check:', error.message);
                return true; // Keep valid if offline signature is valid
            }
        }

        return true;
    }

    // Get Pro features
    getProFeatures() {
        if (this.isPro()) {
            return this.ProFeatures;
        }
        return {
            unlimitedApps: false,
            passwordProtection: false,
            audioControl: false,
            advancedShortcuts: false,
            highPriority: false
        };
    }

    // Get app limit for current user
    getAppLimit() {
        return this.isPro() ? Infinity : this.freeAppLimit;
    }

    // Check if user can add more apps
    canAddApp(currentCount) {
        if (this.isPro()) return true;
        return currentCount < this.freeAppLimit;
    }

    // Get license info - CRITICAL: Always re-validate
    getLicenseInfo() {
        // Security: Always re-validate, never trust cached state
        const isPro = this.isPro();
        const license = this.loadLicense();
        
        if (isPro && license) {
            return {
                isPro: true,
                activated: license.activated,
                features: this.ProFeatures,
                appLimit: Infinity,
                machineId: license.machineId
            };
        } else {
            return {
                isPro: false,
                activated: null,
                features: this.getProFeatures(),
                appLimit: this.freeAppLimit,
                machineId: this.getMachineId()
            };
        }
    }

    // Deactivate license on server
    async deactivateLicenseOnline(licenseKey) {
        if (!this.enableOnlineVerification || !this.licenseServer) {
            return { success: false, message: 'Online deactivation not available' };
        }

        try {
            const machineId = this.getMachineId();
            const response = await superagent
                .post(`${this.licenseServer}/api/license/deactivate`)
                .send({
                    licenseKey: licenseKey,
                    machineId: machineId,
                    appId: this.appId
                })
                .timeout(10000);
            
            if (response.data.success) {
                return {
                    success: true,
                    message: 'License deactivated successfully'
                };
            } else {
                return {
                    success: false,
                    message: response.data.error || 'License deactivation failed'
                };
            }
        } catch (error) {
            return {
                success: false,
                message: error.response?.data?.error || error.message || 'License deactivation failed'
            };
        }
    }

    // Deactivate license
    async deactivateLicense() {
        const license = this.loadLicense();
        const licenseKey = license ? license.key : null;
        
        // Try to deactivate on server if online and license exists
        if (licenseKey && this.enableOnlineVerification && this.licenseServer) {
            await this.deactivateLicenseOnline(licenseKey);
        }
        
        // Always remove local license file
        this.removeLicense();
        return {
            success: true,
            message: 'License deactivated successfully'
        };
    }

    // Check if a specific feature is available
    isFeatureAvailable(feature) {
        if (!this.isPro()) return false;
        
        const ProFeatures = this.getProFeatures();
        return ProFeatures[feature] || false;
    }

    // Validate shortcut complexity (for Pro users)
    validateShortcutComplexity(shortcut) {
        if (!shortcut || typeof shortcut !== 'string') return false;
        
        const keys = shortcut.split('+');
        
        // Free users limited to 3 keys max (e.g., Ctrl+Alt+H)
        if (!this.isPro() && keys.length > 3) {
            return false;
        }
        
        // Allow single function keys (F1..F12) as valid shortcuts
        if (keys.length === 1 && /^F\d{1,2}$/.test(keys[0])) return true;

        // Pro users can have more complex shortcuts
        return keys.length >= 2 && keys.length <= 5;
    }

    // Get remaining free apps count
    getRemainingFreeApps(currentCount) {
        if (this.isPro()) return Infinity;
        return Math.max(0, this.freeAppLimit - currentCount);
    }

    // Check if user is at the free limit
    isAtFreeLimit(currentCount) {
        if (this.isPro()) return false;
        return currentCount >= this.freeAppLimit;
    }
}

module.exports = new LicenseManager(); 