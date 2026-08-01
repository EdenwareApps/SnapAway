const { desktopCapturer, screen } = require('electron')

const MAX_CACHE_ENTRIES = 400
const NO_RESULT_TTL_MS = 15000
const state = {
  cache: new Map(),
  lastByHwnd: new Map(),
  pending: new Set(),
  noResult: new Map()
}

function parseWindowKey(windowKey) {
  if (!windowKey) return null
  const parts = String(windowKey).split(':')
  if (parts.length < 5) return null
  return {
    hwnd: parts[0],
    width: Number(parts[1]) || 0,
    height: Number(parts[2]) || 0,
    captionWidth: Number(parts[3]) || 0,
    captionHeight: Number(parts[4]) || 0
  }
}

function toDisplayRect(windowRect) {
  return {
    x: windowRect.left,
    y: windowRect.top,
    width: Math.max(1, windowRect.right - windowRect.left),
    height: Math.max(1, windowRect.bottom - windowRect.top)
  }
}

function toDipRect(windowRect) {
  if (!windowRect) return null
  if (typeof screen.screenToDipPoint !== 'function') {
    return toDisplayRect(windowRect)
  }

  const topLeft = screen.screenToDipPoint({
    x: Math.round(windowRect.left),
    y: Math.round(windowRect.top)
  })
  const bottomRight = screen.screenToDipPoint({
    x: Math.round(windowRect.right),
    y: Math.round(windowRect.bottom)
  })
  return {
    x: Math.round(Math.min(topLeft.x, bottomRight.x)),
    y: Math.round(Math.min(topLeft.y, bottomRight.y)),
    width: Math.max(1, Math.round(Math.abs(bottomRight.x - topLeft.x))),
    height: Math.max(1, Math.round(Math.abs(bottomRight.y - topLeft.y)))
  }
}

function toPhysicalDisplayBounds(display) {
  if (!display || !display.bounds) return null
  if (typeof screen.dipToScreenPoint === 'function') {
    const topLeft = screen.dipToScreenPoint({
      x: Math.round(display.bounds.x),
      y: Math.round(display.bounds.y)
    })
    const bottomRight = screen.dipToScreenPoint({
      x: Math.round(display.bounds.x + display.bounds.width),
      y: Math.round(display.bounds.y + display.bounds.height)
    })
    return {
      x: Math.min(topLeft.x, bottomRight.x),
      y: Math.min(topLeft.y, bottomRight.y),
      width: Math.max(1, Math.abs(bottomRight.x - topLeft.x)),
      height: Math.max(1, Math.abs(bottomRight.y - topLeft.y))
    }
  }

  const scale = Number(display.scaleFactor) || 1
  return {
    x: Math.round(display.bounds.x * scale),
    y: Math.round(display.bounds.y * scale),
    width: Math.max(1, Math.round(display.bounds.width * scale)),
    height: Math.max(1, Math.round(display.bounds.height * scale))
  }
}

function readPixelGray(bitmap, imageWidth, x, y) {
  const index = ((y * imageWidth) + x) * 4
  const b = bitmap[index]
  const g = bitmap[index + 1]
  const r = bitmap[index + 2]
  return (r * 0.299) + (g * 0.587) + (b * 0.114)
}

function sampleVariance(bitmap, imageWidth, imageHeight, centerX, centerY, radius) {
  const minX = Math.max(0, centerX - radius)
  const maxX = Math.min(imageWidth - 1, centerX + radius)
  const minY = Math.max(0, centerY - radius)
  const maxY = Math.min(imageHeight - 1, centerY + radius)

  let count = 0
  let sum = 0
  let sumSq = 0

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const gray = readPixelGray(bitmap, imageWidth, x, y)
      count += 1
      sum += gray
      sumSq += gray * gray
    }
  }

  if (count <= 1) return Number.POSITIVE_INFINITY
  const mean = sum / count
  const variance = (sumSq / count) - (mean * mean)
  return Number.isFinite(variance) ? variance : Number.POSITIVE_INFINITY
}

function mapToImagePoint(globalX, globalY, displayBounds, imageWidth, imageHeight) {
  const relX = globalX - displayBounds.x
  const relY = globalY - displayBounds.y

  const x = Math.round((relX / Math.max(1, displayBounds.width)) * imageWidth)
  const y = Math.round((relY / Math.max(1, displayBounds.height)) * imageHeight)

  return {
    x: Math.max(0, Math.min(imageWidth - 1, x)),
    y: Math.max(0, Math.min(imageHeight - 1, y))
  }
}

function setCached(windowKey, analysis, input) {
  if (!windowKey || !analysis) return
  if (!state.cache.has(windowKey) && state.cache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = state.cache.keys().next().value
    if (oldestKey) state.cache.delete(oldestKey)
  }
  state.cache.set(windowKey, analysis)
  state.noResult.delete(windowKey)

  const keyInfo = parseWindowKey(windowKey)
  const windowRect = input && input.windowRect
  if (!keyInfo || !windowRect || !Number.isFinite(analysis.detectedCaptionLeft)) return

  state.lastByHwnd.set(keyInfo.hwnd, {
    sourceWindowKey: windowKey,
    windowWidth: Math.max(1, windowRect.right - windowRect.left),
    detectedCaptionLeftOffset: analysis.detectedCaptionLeft - windowRect.left,
    detectedLeftEndOffset: Number.isFinite(analysis.detectedLeftEnd)
      ? analysis.detectedLeftEnd - windowRect.left
      : 0,
    analysis
  })
}

function setNoResult(windowKey) {
  if (!windowKey) return
  state.noResult.set(windowKey, Date.now() + NO_RESULT_TTL_MS)
}

function isNoResultActive(windowKey) {
  if (!windowKey) return false
  const until = state.noResult.get(windowKey)
  if (!until) return false
  if (Date.now() >= until) {
    state.noResult.delete(windowKey)
    return false
  }
  return true
}

function getCachedTitlebarAnalysis(windowKey) {
  if (!windowKey) return null
  return state.cache.get(windowKey) || null
}

function getApproximateTitlebarAnalysis(input) {
  const windowKey = input && input.windowKey
  const windowRect = input && input.windowRect
  const captionButtonsRect = input && input.captionButtonsRect
  const iconSize = Number(input && input.iconSize) || 16

  if (!windowKey || !windowRect || captionButtonsRect) return null

  const keyInfo = parseWindowKey(windowKey)
  if (!keyInfo || !keyInfo.hwnd) return null

  const last = state.lastByHwnd.get(keyInfo.hwnd)
  if (!last || !last.windowWidth || !Number.isFinite(last.detectedCaptionLeftOffset)) return null

  const currentWidth = Math.max(1, windowRect.right - windowRect.left)
  const widthRatio = currentWidth / Math.max(1, last.windowWidth)
  const scaledCaptionLeftOffset = last.detectedCaptionLeftOffset * widthRatio
  const scaledLeftEndOffset = Math.max(0, last.detectedLeftEndOffset * widthRatio)

  const detectedCaptionLeft = windowRect.left + scaledCaptionLeftOffset
  const detectedLeftEnd = windowRect.left + scaledLeftEndOffset
  const defaultGapPx = 6
  const bestX = detectedCaptionLeft - defaultGapPx - iconSize
  const fallbackRightPadding = 140
  const fallbackDefaultX = windowRect.right - fallbackRightPadding - iconSize

  if (!Number.isFinite(bestX)) return null

  return {
    overlayOffsetDeltaX: bestX - fallbackDefaultX,
    overlayOffsetYDelta: null,
    detectedCaptionLeft,
    detectedLeftEnd,
    freeZoneWidth: Math.max(0, detectedCaptionLeft - detectedLeftEnd),
    freePercent: Math.round(Math.max(0, detectedCaptionLeft - detectedLeftEnd) / currentWidth * 100),
    source: 'approx-screenshot',
    at: Date.now()
  }
}

function getTitlebarAnalysisCacheState(windowKey) {
  if (!windowKey) {
    return {
      hasCache: false,
      pending: false,
      source: null
    }
  }

  const cached = state.cache.get(windowKey)
  return {
    hasCache: !!cached,
    pending: state.pending.has(windowKey),
    noResult: isNoResultActive(windowKey),
    source: cached && cached.source ? cached.source : null
  }
}

async function analyzeTitlebarScreenshot(input) {
  const { windowRect, captionButtonsRect, iconSize } = input
  if (!windowRect) return null

  const display = screen.getDisplayMatching(toDipRect(windowRect))
  if (!display || !display.bounds) return null

  const physicalDisplayBounds = toPhysicalDisplayBounds(display)
  if (!physicalDisplayBounds) return null

  const targetWidth = Math.max(1, Math.round(physicalDisplayBounds.width))
  const targetHeight = Math.max(1, Math.round(physicalDisplayBounds.height))

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: targetWidth, height: targetHeight },
    fetchWindowIcons: false
  })

  if (!Array.isArray(sources) || sources.length === 0) return null

  const source = sources.find(item => String(item.display_id || '') === String(display.id)) || sources[0]
  if (!source || !source.thumbnail || source.thumbnail.isEmpty()) return null

  const imageSize = source.thumbnail.getSize()
  const imageWidth = Number(imageSize.width) || 0
  const imageHeight = Number(imageSize.height) || 0
  if (imageWidth <= 2 || imageHeight <= 2) return null

  const bitmap = source.thumbnail.toBitmap()
  if (!bitmap || bitmap.length < 4) return null

  const defaultGap = 6
  const winWidth = windowRect.right - windowRect.left
  const winHeight = windowRect.bottom - windowRect.top
  const searchMinX = Math.round(windowRect.left + Math.max(18, winWidth * 0.38))

  if (captionButtonsRect) {
    // --- Known caption rect: scan leftward from default position for lowest-variance area ---
    const defaultX = Math.round(captionButtonsRect.left - iconSize - defaultGap)
    const defaultY = Math.round(((captionButtonsRect.top + captionButtonsRect.bottom) / 2) - (iconSize / 2))
    if (defaultX <= searchMinX) return null

    const centerY = defaultY + Math.round(iconSize / 2)
    const defaultPoint = mapToImagePoint(defaultX + Math.round(iconSize / 2), centerY, physicalDisplayBounds, imageWidth, imageHeight)
    let bestScore = sampleVariance(bitmap, imageWidth, imageHeight, defaultPoint.x, defaultPoint.y, 5)
    let bestX = defaultX

    for (let candidateX = defaultX; candidateX >= searchMinX; candidateX -= 4) {
      const point = mapToImagePoint(candidateX + Math.round(iconSize / 2), centerY, physicalDisplayBounds, imageWidth, imageHeight)
      const variance = sampleVariance(bitmap, imageWidth, imageHeight, point.x, point.y, 5)

      if (variance < bestScore * 0.92) {
        bestScore = variance
        bestX = candidateX
      }

      if (variance < 18) {
        bestScore = variance
        bestX = candidateX
        break
      }
    }

    if (bestX === defaultX) return null

    return {
      overlayOffsetDeltaX: bestX - defaultX,
      source: 'screenshot',
      score: Math.round(bestScore * 100) / 100,
      at: Date.now()
    }
  }

  // --- No caption rect (custom titlebar like VSCode): bidirectional scan ---
  // VSCode and other custom-titlebar apps have occupied zones on BOTH sides:
  //   Left side:  hamburger menu, activity icons, breadcrumbs, tab strip
  //   Right side: layout buttons, extension buttons, window controls (min/max/close)
  //
  // Problem: when mouse is NOT hovering over the titlebar, custom-titlebar buttons
  // are drawn with near-zero contrast (flat dark background).  Fixed thresholds like
  // HIGH_VAR_THRESHOLD=28 never fire.  Solution: pre-scan first to determine the
  // observed variance range, then use ADAPTIVE thresholds relative to that range.
  //
  // We scan VERTICAL STRIPS (full titlebar height) instead of small squares so that
  // even tiny icon pixels contribute to the column variance.

  const titlebarH = Math.max(28, Math.min(36, Math.round(winHeight * 0.045)))

  const stripTopPt = mapToImagePoint(windowRect.left, windowRect.top, physicalDisplayBounds, imageWidth, imageHeight)
  const stripBotPt = mapToImagePoint(windowRect.left, windowRect.top + titlebarH, physicalDisplayBounds, imageWidth, imageHeight)
  const stripTopY = Math.max(0, stripTopPt.y)
  const stripBotY = Math.min(imageHeight - 1, stripBotPt.y)
  if (stripBotY <= stripTopY) return null

  function columnVariance(globalX) {
    const xl = mapToImagePoint(globalX, windowRect.top, physicalDisplayBounds, imageWidth, imageHeight).x
    const x0 = Math.max(0, xl - 1)
    const x1 = Math.min(imageWidth - 1, xl + 1)
    let cnt = 0, sum = 0, sumSq = 0
    for (let y = stripTopY; y <= stripBotY; y++) {
      for (let x = x0; x <= x1; x++) {
        const g = readPixelGray(bitmap, imageWidth, x, y)
        cnt++; sum += g; sumSq += g * g
      }
    }
    if (cnt <= 1) return 0
    const mean = sum / cnt
    const v = (sumSq / cnt) - (mean * mean)
    return v < 0 ? 0 : v
  }

  function estimateTitlebarHeight(globalX) {
    const MAX_SCAN_HEIGHT = 64
    const MIN_TITLEBAR_HEIGHT = 24
    const MAX_TITLEBAR_HEIGHT = 60
    const SAMPLE_RADIUS = 4

    const startY = windowRect.top
    const endY = Math.min(windowRect.bottom - 1, windowRect.top + MAX_SCAN_HEIGHT)
    const rows = []

    for (let gy = startY + 2; gy <= endY; gy += 1) {
      const pt = mapToImagePoint(globalX, gy, physicalDisplayBounds, imageWidth, imageHeight)
      const v = sampleVariance(bitmap, imageWidth, imageHeight, pt.x, pt.y, SAMPLE_RADIUS)
      rows.push(v)
    }

    if (rows.length < 8) return null

    const sorted = [...rows].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]
    const highThreshold = Math.max(median * 2.5, median + 9)

    let highRun = 0
    for (let index = 0; index < rows.length; index += 1) {
      if (rows[index] >= highThreshold) {
        highRun += 1
      } else {
        highRun = 0
      }

      if (highRun >= 2) {
        const detectedHeight = index + 2
        return Math.max(MIN_TITLEBAR_HEIGHT, Math.min(MAX_TITLEBAR_HEIGHT, Math.round(detectedHeight)))
      }
    }

    return null
  }

  // Build variance profile with denser sampling, then light smoothing.
  // (suppresses isolated spikes from tab text that spans only 1-2 columns)
  const PROFILE_STEP = 4
  const SMOOTH_HALF = 2
  const EDGE_MARGIN = 10

  const profile = []
  for (let gx = windowRect.left + EDGE_MARGIN; gx <= windowRect.right - EDGE_MARGIN; gx += PROFILE_STEP) {
    profile.push({ x: gx, v: columnVariance(gx) })
  }
  if (profile.length < 10) return null

  const smoothed = profile.map((pt, i) => {
    let s = 0, cnt = 0
    for (let di = -SMOOTH_HALF; di <= SMOOTH_HALF; di++) {
      const j = i + di
      if (j >= 0 && j < profile.length) { s += profile[j].v; cnt++ }
    }
    return { x: pt.x, v: s / cnt }
  })

  // ADAPTIVE thresholds: use median of smoothed values (robust to extreme spikes)
  const svs = smoothed.map(s => s.v).sort((a, b) => a - b)
  const median = svs[Math.floor(svs.length / 2)]
  // HIGH: clearly above background, LOW: close to or below background median
  const HIGH_VAR_THRESHOLD = Math.max(median * 3.8, median + 9)
  const LOW_VAR_THRESHOLD  = Math.max(median * 1.45, median + 2)

  if (HIGH_VAR_THRESHOLD <= LOW_VAR_THRESHOLD + 1) return null

  const MIN_HIGH_RUN = 2
  const MIN_LOW_RUN  = 2
  const RIGHT_ZONE_MIN_RATIO = 0.62
  const rightScanMinX = Math.round(windowRect.left + (winWidth * RIGHT_ZONE_MIN_RATIO))
  const rawRightScanStartIdx = smoothed.findIndex(s => s.x >= rightScanMinX)
  const rightScanStartIdx = rawRightScanStartIdx >= 0 ? rawRightScanStartIdx : Math.max(0, smoothed.length - 1)
  const rightSlice = smoothed.slice(rightScanStartIdx)
  const rightValues = rightSlice.map(s => s.v).sort((a, b) => a - b)
  const rightMedian = rightValues.length ? rightValues[Math.floor(rightValues.length / 2)] : median
  const rightMax = rightValues.length ? rightValues[rightValues.length - 1] : HIGH_VAR_THRESHOLD
  const rightRange = Math.max(0, rightMax - rightMedian)
  const rightHighThreshold = Math.max(HIGH_VAR_THRESHOLD, rightMedian + (rightRange * 0.34), rightMedian + 4)
  const rightLowThreshold = Math.max(LOW_VAR_THRESHOLD, rightMedian + (rightRange * 0.18), rightMedian + 2)

  // -- Pass 1: scan right→left, but require DENSE occupancy in a short window --
  // This avoids treating isolated title/tab text spikes in the mid-right region as if
  // they were the actual right-side control cluster.
  let highRun = 0, lowRun = 0, highVarianceSeen = false
  let detectedCaptionLeft = null
  const RIGHT_OCCUPANCY_WINDOW = 7
  const RIGHT_OCCUPANCY_MIN_COUNT = 4

  for (let i = smoothed.length - 1; i >= rightScanStartIdx; i--) {
    const windowEnd = Math.min(smoothed.length - 1, i + RIGHT_OCCUPANCY_WINDOW - 1)
    let occupiedCount = 0
    let highCount = 0
    for (let j = i; j <= windowEnd; j++) {
      if (smoothed[j].v >= rightLowThreshold) occupiedCount += 1
      if (smoothed[j].v >= rightHighThreshold) highCount += 1
    }

    const denselyOccupied = occupiedCount >= RIGHT_OCCUPANCY_MIN_COUNT && highCount >= 2
    if (denselyOccupied) {
      detectedCaptionLeft = smoothed[i].x
      highVarianceSeen = true
      lowRun = 0
      continue
    }

    if (highVarianceSeen) {
      lowRun += 1
      if (lowRun >= MIN_LOW_RUN) {
        break
      }
    }
  }

  if (detectedCaptionLeft === null) {
    for (let i = smoothed.length - 1; i >= rightScanStartIdx; i--) {
      if (smoothed[i].v >= rightHighThreshold) {
        detectedCaptionLeft = smoothed[i].x
        break
      }
    }
  }

  let fallbackUsed = false
  if (detectedCaptionLeft === null) {
    // Fallback for low-contrast frames: assume the right occupied cluster
    // begins near the last quarter of the titlebar width.
    detectedCaptionLeft = windowRect.right - Math.round(winWidth * 0.22)
    fallbackUsed = true
  }
  detectedCaptionLeft = Math.max(detectedCaptionLeft, rightScanMinX)

  // -- Pass 2: scan left→right on smoothed profile, find right edge of left zone --
  highRun = 0; lowRun = 0; highVarianceSeen = false
  let detectedLeftEnd = windowRect.left

  const captionIdx = smoothed.findIndex(s => s.x >= detectedCaptionLeft)
  const endIdx = captionIdx >= 0 ? captionIdx : smoothed.length - 1

  for (let i = 0; i < endIdx; i++) {
    const sv = smoothed[i].v
    if (sv >= HIGH_VAR_THRESHOLD) {
      highRun++; lowRun = 0
      if (highRun >= MIN_HIGH_RUN) highVarianceSeen = true
    } else if (sv <= LOW_VAR_THRESHOLD) {
      lowRun++; highRun = 0
      if (highVarianceSeen && lowRun >= MIN_LOW_RUN) {
        detectedLeftEnd = smoothed[Math.max(0, i - MIN_LOW_RUN)].x
        break
      }
    } else {
      highRun = 0; lowRun = 0
    }
  }

  // -- Compute free zones and place overlay using the best low-variance segment --
  const defaultGapPx = 6
  const freeZoneLeft = detectedLeftEnd + defaultGapPx
  const freeZoneRight = detectedCaptionLeft - defaultGapPx
  const freeZoneWidth = freeZoneRight - freeZoneLeft
  const freePercent = Math.round((freeZoneWidth / winWidth) * 100)

  // Logical right-side no-go zone for min/max/close cluster.
  // Even if the variance scan sees low variation there, we should not mark it as free.
  const logicalButtonsWidth = Math.round(Math.max(120, Math.min(220, winWidth * 0.12)))
  const noButtonsRightLimit = Math.min(freeZoneRight, windowRect.right - logicalButtonsWidth)

  if (freeZoneWidth < iconSize * 2) {
    fallbackUsed = true
  }

  const segmentScanStart = Math.round(windowRect.left + EDGE_MARGIN)
  const segmentScanEnd = Math.round(windowRect.right - EDGE_MARGIN)
  const segmentValues = smoothed.filter(s => s.x >= segmentScanStart && s.x <= segmentScanEnd)
  let freeSegments = []
  const MAX_FREE_SEGMENTS = 2
  const MIN_FREE_SEGMENT_GAP_TO_MERGE = Math.round(Math.max(14, iconSize * 0.8, PROFILE_STEP * 2))
  const freeThreshold = Math.max(LOW_VAR_THRESHOLD * 1.08, LOW_VAR_THRESHOLD + 1)

  let runStart = null
  let runEnd = null
  for (let i = 0; i < segmentValues.length; i += 1) {
    const point = segmentValues[i]
    const isFree = point.v <= freeThreshold

    if (isFree) {
      if (runStart === null) {
        runStart = point.x
      }
      runEnd = point.x
      continue
    }

    if (runStart !== null && runEnd !== null) {
      const segLeft = Math.max(freeZoneLeft, runStart - Math.round(PROFILE_STEP / 2))
      const segRight = Math.min(noButtonsRightLimit, runEnd + Math.round(PROFILE_STEP / 2))
      if (segRight - segLeft >= iconSize * 2) {
        freeSegments.push({ left: segLeft, right: segRight, width: segRight - segLeft })
      }
    }
    runStart = null
    runEnd = null
  }

  if (runStart !== null && runEnd !== null) {
    const segLeft = Math.max(freeZoneLeft, runStart - Math.round(PROFILE_STEP / 2))
    const segRight = Math.min(noButtonsRightLimit, runEnd + Math.round(PROFILE_STEP / 2))
    if (segRight - segLeft >= iconSize * 2) {
      freeSegments.push({ left: segLeft, right: segRight, width: segRight - segLeft })
    }
  }

  if (freeSegments.length > 1) {
    freeSegments = freeSegments
      .slice()
      .sort((a, b) => a.left - b.left)
      .reduce((merged, segment) => {
        if (!merged.length) return [segment]
        const previous = merged[merged.length - 1]
        if (segment.left - previous.right <= MIN_FREE_SEGMENT_GAP_TO_MERGE) {
          previous.right = Math.max(previous.right, segment.right)
          previous.width = previous.right - previous.left
          return merged
        }
        merged.push(segment)
        return merged
      }, [])
  }

  while (freeSegments.length > MAX_FREE_SEGMENTS) {
    let smallestGap = Number.POSITIVE_INFINITY
    let mergeIndex = 0

    for (let i = 0; i < freeSegments.length - 1; i += 1) {
      const gap = freeSegments[i + 1].left - freeSegments[i].right
      if (gap < smallestGap) {
        smallestGap = gap
        mergeIndex = i
      }
    }

    const left = freeSegments[mergeIndex]
    const right = freeSegments[mergeIndex + 1]
    const mergedSegment = {
      left: left.left,
      right: Math.max(left.right, right.right)
    }
    mergedSegment.width = mergedSegment.right - mergedSegment.left
    freeSegments.splice(mergeIndex, 2, mergedSegment)
  }

  // Keep extra distance from the right occupied cluster on custom titlebars.
  // In restored VSCode there are often extra controls left of min/max/close.
  const rightSafetyPadding = Math.round(Math.max(28, Math.min(56, winWidth * 0.03)))
  const preferredCandidates = freeSegments.filter(segment => (
    segment.left < noButtonsRightLimit && segment.right <= (noButtonsRightLimit + PROFILE_STEP)
  ))

  const preferredSegment = (preferredCandidates.length ? preferredCandidates : freeSegments).length
    ? (preferredCandidates.length ? preferredCandidates : freeSegments)
        .slice()
        // Always prefer the last (rightmost) valid free segment.
        .sort((a, b) => b.right - a.right)[0]
    : {
        left: Math.max(windowRect.left + defaultGapPx, freeZoneLeft),
        right: Math.max(windowRect.left + defaultGapPx + (iconSize * 2), freeZoneRight),
        width: Math.max(iconSize * 2, freeZoneWidth)
      }

  const bestX = Math.max(
    preferredSegment.left,
    Math.min(noButtonsRightLimit, preferredSegment.right) - iconSize
  )

  const fallbackRightPadding = 140
  const fallbackDefaultX = windowRect.right - fallbackRightPadding - iconSize

  if (Math.abs(bestX - fallbackDefaultX) < 4) {
    fallbackUsed = true
  }

  const fallbackTitlebarHeight = titlebarH
  const titlebarHeightProbes = [
    Math.max(windowRect.left + 24, detectedLeftEnd + 28),
    Math.min(windowRect.right - 24, detectedCaptionLeft - 28),
    Math.round(freeZoneLeft + (freeZoneWidth / 2))
  ].filter(value => Number.isFinite(value))

  const probeHeights = titlebarHeightProbes
    .map(probeX => estimateTitlebarHeight(probeX))
    .filter(value => Number.isFinite(value))

  const rawDetectedTitlebarHeight = probeHeights.length ? Math.max(...probeHeights) : null
  const detectedTitlebarHeight = Number.isFinite(rawDetectedTitlebarHeight)
    ? Math.max(fallbackTitlebarHeight, rawDetectedTitlebarHeight)
    : fallbackTitlebarHeight

  const overlayOffsetYDelta = detectedTitlebarHeight === fallbackTitlebarHeight
    ? null
    : ((detectedTitlebarHeight - iconSize) / 2) - ((fallbackTitlebarHeight - iconSize) / 2)

  return {
    overlayOffsetDeltaX: bestX - fallbackDefaultX,
    overlayOffsetYDelta,
    detectedCaptionLeft,
    detectedLeftEnd,
    detectedTitlebarHeight,
    freeZoneWidth,
    freePercent,
    noButtonsRightLimit,
    freeSegments,
    preferredSegment,
    adaptiveThresholds: {
      high: Math.round(HIGH_VAR_THRESHOLD * 100) / 100,
      low: Math.round(LOW_VAR_THRESHOLD * 100) / 100,
      rightHigh: Math.round(rightHighThreshold * 100) / 100,
      rightLow: Math.round(rightLowThreshold * 100) / 100
    },
    source: fallbackUsed ? 'screenshot-fallback' : 'screenshot-scan',
    at: Date.now()
  }
}

function warmupTitlebarAnalysis(input) {
  const windowKey = input && input.windowKey
  if (!windowKey || state.cache.has(windowKey) || state.pending.has(windowKey) || isNoResultActive(windowKey)) return

  state.pending.add(windowKey)

  Promise.resolve()
    .then(() => analyzeTitlebarScreenshot(input))
    .then(result => {
      if (result) {
        setCached(windowKey, result, input)
      } else {
        setNoResult(windowKey)
      }
    })
    .catch(() => {
      // Best-effort only: keep default geometric positioning on failures.
      setNoResult(windowKey)
    })
    .finally(() => {
      state.pending.delete(windowKey)
    })
}

module.exports = {
  analyzeTitlebarScreenshot,
  getApproximateTitlebarAnalysis,
  getCachedTitlebarAnalysis,
  getTitlebarAnalysisCacheState,
  warmupTitlebarAnalysis
}
