const { screen } = require('electron')
const CAPTION_BUTTON_MIN_GAP = 6
const DEFAULT_ICON_SIZE = 16
const CUSTOM_TITLEBAR_VERTICAL_BIAS = 0
const CUSTOM_TITLEBAR_RIGHT_CLEARANCE = 52
const TITLEBAR_RIGHT_MARGIN = 6
const titlebarAnalysisCache = new Map()

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function getDynamicCaptionGap(captionButtonsRect) {
  if (!captionButtonsRect || !captionButtonsRect.width) return CAPTION_BUTTON_MIN_GAP

  // Caption bounds normally contain minimize/maximize/close button cluster.
  const estimatedButtonWidth = captionButtonsRect.width / 3
  return clamp(Math.round(estimatedButtonWidth * 0.22), CAPTION_BUTTON_MIN_GAP, 20)
}

function normalizeRect(rect) {
  if (!rect) return null
  const left = Number(rect.left)
  const top = Number(rect.top)
  const right = Number(rect.right)
  const bottom = Number(rect.bottom)
  if (!Number.isFinite(left) || !Number.isFinite(top) || !Number.isFinite(right) || !Number.isFinite(bottom)) {
    return null
  }
  if (right <= left || bottom <= top) return null
  return { left, top, right, bottom, width: right - left, height: bottom - top }
}

function pointInsideRect(point, rect) {
  if (!point || !rect) return false
  return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom
}

function getFallbackCaptionHeight(windowRect) {
  const rough = Math.round(windowRect.height * 0.045)
  return clamp(rough, 28, 36)
}

function buildOverlayBounds(anchorX, anchorY, iconSize) {
  return {
    x: Math.round(anchorX),
    y: Math.round(anchorY),
    width: iconSize,
    height: iconSize
  }
}

function getVisibleTopAdjustment(windowRect) {
  if (!windowRect || !Number.isFinite(windowRect.top)) return 0
  if (windowRect.top < 0) {
    return -windowRect.top
  }
  if (typeof screen.getDisplayNearestPoint !== 'function') return 0

  const display = screen.getDisplayNearestPoint({
    x: Math.round(windowRect.left),
    y: Math.round(windowRect.top)
  })
  if (!display || !display.bounds || !Number.isFinite(display.bounds.y)) return 0

  return Math.max(0, display.bounds.y - windowRect.top)
}

function buildTitlebarAnalysis(windowRect, captionButtonsRect, iconSize) {
  const titlebarHeight = captionButtonsRect
    ? clamp(captionButtonsRect.height, 24, 44)
    : getFallbackCaptionHeight(windowRect)

  if (captionButtonsRect) {
    const dynamicGap = getDynamicCaptionGap(captionButtonsRect)
    const overlayOffsetX = captionButtonsRect.left - windowRect.left - iconSize - dynamicGap
    if (overlayOffsetX <= dynamicGap) {
      return { valid: false, reason: 'no-safe-space-near-minimize', titlebarHeight }
    }

    const verticalCenter = (captionButtonsRect.top + captionButtonsRect.bottom) / 2
    const overlayOffsetY = verticalCenter - windowRect.top - iconSize / 2
    return {
      valid: true,
      titlebarHeight,
      overlayOffsetX,
      overlayOffsetY,
      usingDwmCaptionBounds: true
    }
  }

  const fallbackRightPadding = 140
  const overlayOffsetX = windowRect.width - fallbackRightPadding - iconSize
  if (overlayOffsetX <= CAPTION_BUTTON_MIN_GAP) {
    return { valid: false, reason: 'window-too-narrow', titlebarHeight }
  }

  return {
    valid: true,
    titlebarHeight,
    overlayOffsetX,
    overlayOffsetY: (titlebarHeight - iconSize) / 2 + CUSTOM_TITLEBAR_VERTICAL_BIAS,
    fallbackCaptionZoneLeftOffset: windowRect.width - fallbackRightPadding,
    usingDwmCaptionBounds: false
  }
}

function detectTitlebarHover(input) {
  const cursor = input && input.cursor
  const windowRect = normalizeRect(input && input.windowRect)
  const captionButtonsRect = normalizeRect(input && input.captionButtonsRect)
  const iconSize = Number(input && input.iconSize) || DEFAULT_ICON_SIZE
  const windowKey = input && input.windowKey
  const screenshotAnalysis = input && input.screenshotAnalysis

  if (!cursor || !windowRect) {
    return { visible: false, reason: 'invalid-geometry' }
  }

  if (!pointInsideRect(cursor, windowRect)) {
    return { visible: false, reason: 'cursor-outside-window' }
  }

  let analysis = null
  if (windowKey && titlebarAnalysisCache.has(windowKey)) {
    analysis = titlebarAnalysisCache.get(windowKey)
  } else {
    analysis = buildTitlebarAnalysis(windowRect, captionButtonsRect, iconSize)
    if (windowKey) {
      titlebarAnalysisCache.set(windowKey, analysis)
    }
  }

  const titlebarHeight = analysis.titlebarHeight

  const titlebarRect = {
    left: windowRect.left,
    top: windowRect.top,
    right: windowRect.right,
    bottom: windowRect.top + titlebarHeight
  }

  if (!pointInsideRect(cursor, titlebarRect)) {
    return { visible: false, reason: 'cursor-outside-titlebar' }
  }

  if (!analysis.valid) {
    return { visible: false, reason: analysis.reason }
  }

  if (!analysis.usingDwmCaptionBounds) {
    const fallbackCaptionZoneLeft = windowRect.left + analysis.fallbackCaptionZoneLeftOffset
    if (cursor.x >= fallbackCaptionZoneLeft) {
      return { visible: false, reason: 'cursor-over-fallback-caption-zone' }
    }
  }

  let overlayOffsetX = analysis.overlayOffsetX
  if (
    screenshotAnalysis &&
    Number.isFinite(screenshotAnalysis.overlayOffsetDeltaX)
  ) {
    overlayOffsetX += screenshotAnalysis.overlayOffsetDeltaX
  }

  let overlayOffsetY = analysis.overlayOffsetY
  if (
    screenshotAnalysis &&
    Number.isFinite(screenshotAnalysis.overlayOffsetYDelta)
  ) {
    overlayOffsetY += screenshotAnalysis.overlayOffsetYDelta
  }

  const visibleTopAdjustment = getVisibleTopAdjustment(windowRect)
  overlayOffsetY += visibleTopAdjustment

  if (!analysis.usingDwmCaptionBounds) {
    const maxOverlayOffsetX = Math.max(
      CAPTION_BUTTON_MIN_GAP,
      Math.round(analysis.fallbackCaptionZoneLeftOffset - iconSize - CAPTION_BUTTON_MIN_GAP)
    )
    overlayOffsetX = Math.min(overlayOffsetX, maxOverlayOffsetX)

    if (screenshotAnalysis && Number.isFinite(screenshotAnalysis.detectedCaptionLeft)) {
      const anchoredSafeOffsetX =
        (screenshotAnalysis.detectedCaptionLeft - windowRect.left) -
        iconSize -
        CAPTION_BUTTON_MIN_GAP -
        CUSTOM_TITLEBAR_RIGHT_CLEARANCE
      overlayOffsetX = Math.min(overlayOffsetX, anchoredSafeOffsetX)
    }
  }

  overlayOffsetX -= TITLEBAR_RIGHT_MARGIN

  const maxOverlayOffsetY = Math.max(
    CAPTION_BUTTON_MIN_GAP,
    Math.round(titlebarHeight - iconSize - CAPTION_BUTTON_MIN_GAP + visibleTopAdjustment)
  )
  overlayOffsetY = clamp(overlayOffsetY, CAPTION_BUTTON_MIN_GAP, maxOverlayOffsetY)

  overlayOffsetX = clamp(
    overlayOffsetX,
    CAPTION_BUTTON_MIN_GAP,
    Math.max(CAPTION_BUTTON_MIN_GAP, windowRect.width - iconSize - CAPTION_BUTTON_MIN_GAP)
  )

  const overlayX = windowRect.left + overlayOffsetX
  const overlayY = windowRect.top + overlayOffsetY

  const overlayBounds = buildOverlayBounds(overlayX, overlayY, iconSize)
  return {
    visible: true,
    overlayBounds,
    titlebarRect,
    usingDwmCaptionBounds: analysis.usingDwmCaptionBounds
  }
}

module.exports = {
  detectTitlebarHover,
  normalizeRect,
  pointInsideRect,
  getDynamicCaptionGap,
  buildTitlebarAnalysis
}
