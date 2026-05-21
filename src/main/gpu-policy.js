const env = process.env;

const gpuPolicyFlags = {
  disableGpu: env.SNAPAWAY_DISABLE_GPU === '1',
  disableGpuCompositing: env.SNAPAWAY_DISABLE_GPU_COMPOSITING === '1',
  softwareRendering: env.SNAPAWAY_SOFTWARE_RENDERING === '1',
  safeMode: env.SNAPAWAY_SAFE_MODE === '1'
};

function applyGpuPolicy(app) {
  if (!app) {
    return gpuPolicyFlags;
  }

  if (gpuPolicyFlags.disableGpu) {
    console.warn('[GPU POLICY] Hardware acceleration is disabled by environment flag.');
    app.disableHardwareAcceleration();
  }

  if (gpuPolicyFlags.disableGpuCompositing) {
    console.warn('[GPU POLICY] GPU compositing is disabled by environment flag.');
    app.commandLine.appendSwitch('disable-gpu-compositing');
  }

  if (gpuPolicyFlags.softwareRendering) {
    console.warn('[GPU POLICY] Software rendering is enabled by environment flag.');
    app.commandLine.appendSwitch('disable-gpu');
  }

  if (gpuPolicyFlags.safeMode) {
    console.warn('[GPU POLICY] Safe mode enabled by environment flag.');
  }

  return gpuPolicyFlags;
}

function getGpuPolicyFlags() {
  return Object.assign({}, gpuPolicyFlags);
}

module.exports = {
  applyGpuPolicy,
  getGpuPolicyFlags
};
