// Lightweight wrapper to require 'koffi' without crashing the main bundle.
// This file is copied as-is to out/main and treated as external by the bundler.
let koffi = null;
try {
    koffi = require('koffi');
} catch (err) {
    koffi = null;
    // keep quiet; caller will check for null
}

module.exports = koffi;
