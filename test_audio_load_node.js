try {
    console.log('loading audio addon via node');
    require('./out/main/audio_addon.node');
    console.log('loaded via node');
    process.exit(0);
} catch (error) {
    console.error('audio addon load failed via node:', error && error.stack ? error.stack : error);
    process.exit(1);
}
