const fs = require('fs')
const path = require('path')
const { nativeTheme } = require('electron')

function colorRefToRgb(colorRef) {
  const intValue = Number(colorRef)
  if (!Number.isFinite(intValue)) return null
  return {
    r: intValue & 0xff,
    g: (intValue >> 8) & 0xff,
    b: (intValue >> 16) & 0xff
  }
}

function getBrightness(rgb) {
  if (!rgb) return null
  return Math.round((rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000)
}

function isDarkByCaptionColor(captionColorRef) {
  const intValue = Number(captionColorRef)
  if (!Number.isFinite(intValue) || intValue === 0) return null
  const rgb = colorRefToRgb(captionColorRef)
  const brightness = getBrightness(rgb)
  if (brightness === null) return null
  return brightness < 150
}

function resolveIconPath(iconName) {
  const candidates = [
    path.join(__dirname, '..', 'renderer', 'assets', 'images', iconName),
    path.join(__dirname, '..', '..', 'src', 'renderer', 'assets', 'images', iconName),
    path.join(process.cwd(), 'src', 'renderer', 'assets', 'images', iconName),
    path.join(process.resourcesPath || '', 'app.asar', 'out', 'renderer', 'assets', 'images', iconName),
    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'out', 'renderer', 'assets', 'images', iconName)
  ]

  return candidates.find(candidate => {
    try {
      return candidate && fs.existsSync(candidate)
    } catch (_) {
      return false
    }
  }) || null
}

function detectOverlayIconTheme(input) {
  const captionDark = isDarkByCaptionColor(input && input.captionColorRef)
  if (captionDark === true) return 'white'
  if (captionDark === false) return 'black'

  // Janelas com moldura DWM (DWMWA_CAPTION_BUTTON_BOUNDS presente): o atributo
  // immersiveDarkMode é confiável porque o próprio app (ou o DWM) o seta.
  // Ex.: FileZilla/WMP em tema claro → immersiveDarkMode=false → ícone preto.
  if (input && input.usingDwmCaptionBounds === true) {
    if (typeof input.immersiveDarkMode === 'boolean') {
      return input.immersiveDarkMode ? 'white' : 'black'
    }
    // Sem immersive disponível, usa o luma medido como fallback.
    const luma = Number(input && input.titlebarLuma)
    if (Number.isFinite(luma)) {
      return luma < 150 ? 'white' : 'black'
    }
    return 'black'
  }

  // Titlebar CUSTOMIZADA (ex.: FxSound): o DWM não informa nem captionColor
  // nem immersiveDarkMode (fica false por padrão), então o luma medido do
  // screenshot é a única fonte confiável da aparência real da barra.
  const luma = Number(input && input.titlebarLuma)
  if (Number.isFinite(luma)) {
    return luma < 150 ? 'white' : 'black'
  }

  return 'black'
}

function pickOverlayIconPath(input) {
  const theme = detectOverlayIconTheme(input)
  const preferred = theme === 'white' ? 'tray-white.png' : 'tray-black.png'
  const fallback = theme === 'white' ? 'tray-black.png' : 'tray-white.png'

  return resolveIconPath(preferred) || resolveIconPath(fallback)
}

module.exports = {
  detectOverlayIconTheme,
  pickOverlayIconPath,
  resolveIconPath
}
