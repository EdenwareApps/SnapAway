try {
    console.log('loading audio addon');
    const addon = require('./out/main/audio_addon.node');
    console.log('addon loaded:', addon && typeof addon === 'object');
    process.exit(0);
} catch (error) {
    console.error('audio addon load failed:', error && error.stack ? error.stack : error);
    process.exit(1);
}
