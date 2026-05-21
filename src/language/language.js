const path = require('path');

const texts = require('./texts.json');

class Language {
    constructor() {
        this.langDir = path.join(__dirname, 'lang');
        this.availableLangs = this.getAvailableLanguages();
        this.assign(texts.en);
    }

    getAvailableLanguages() {
        return Object.keys(texts);
    }

    async loadAppropriateLanguageAsync() {
        const userLang = this.getUserLanguage();
        const langToLoad = this.availableLangs.includes(userLang) ? userLang : 'en';

        const baseTexts = texts.en || {};
        const selectedTexts = texts[langToLoad] || {};
        const mergedTexts = Object.assign({}, baseTexts, selectedTexts);

        try {
            this.assign(mergedTexts);
        } catch (error) {
            console.error(`Falha ao carregar o arquivo de idioma para ${langToLoad}:`, error);
        }
    }

    assign(obj) {
        for (const key in obj) {
            if (key == key.toUpperCase()) {
                this[key] = obj[key];
            }
        }
    }

    getUserLanguage() {
        if (this.userLang) {
            return this.userLang;
        }
        // On Windows (including MSIX/Store), LANG env vars are typically absent.
        // Prefer Intl API which works cross-platform, then env vars as fallback.
        let detected = null;
        if (typeof Intl !== 'undefined' && Intl.DateTimeFormat) {
            try {
                const resolved = Intl.DateTimeFormat().resolvedOptions().locale;
                if (resolved) detected = resolved.split('-')[0].toLowerCase();
            } catch (_) {}
        }
        if (!detected) {
            const envLang = process.env.LANG || process.env.LANGUAGE || process.env.LC_ALL || process.env.LC_MESSAGES;
            if (envLang) {
                detected = envLang.split(/[_\-.]/)[0].toLowerCase();
            }
        }
        if (!detected && typeof navigator !== 'undefined' && navigator.language) {
            detected = navigator.language.split('-')[0].toLowerCase();
        }
        this.userLang = detected || 'en';
        return this.userLang;
    }

    async setUserLanguage(lang) {
        if (this.userLang !== lang) {
            this.userLang = lang;
            return this.loadAppropriateLanguageAsync();
        }
    }

    toObject() {
        
        const obj = {};
        for (const key in this) {
            if (key == key.toUpperCase() && this.hasOwnProperty(key)) {
                obj[key] = this[key];
            }
        }
        return obj;
    }

    availableLanguages() {
        const langNames = {
            ar: 'العربية',       // Arabic
            cs: 'čeština',       // Czech
            de: 'Deutsch',       // German
            el: 'Ελληνικά',      // Greek
            en: 'English',       // English
            fr: 'Français',      // French
            hi: 'हिन्दी',          // Hindi
            hu: 'Magyar',        // Hungarian
            pt: 'Português',     // Portuguese
            es: 'Español',       // Spanish
            it: 'Italiano',      // Italian
            ja: '日本語',         // Japanese
            ko: '한국어',         // Korean
            nl: 'Nederlands',    // Dutch
            pl: 'Polski',        // Polish
            ru: 'Русский',       // Russian
            sv: 'Svenska',       // Swedish
            th: 'ไทย',           // Thai
            tr: 'Türkçe',        // Turkish
            zh: '中文'           // Chinese
        };
        return Object.fromEntries(this.availableLangs.map(lang => [lang, langNames[lang]]));
    }
}

module.exports = new Language();
