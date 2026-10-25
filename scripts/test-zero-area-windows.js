// Verifies the hide-path zero-area guard in src/x-system/win32-support.js.
// Runs against the live desktop (user32 only), like the app does.
//
// Run: npm run test:zero-area-windows   (or: node scripts/test-zero-area-windows.js)
const assert = require('assert')
const koffi = require('koffi')
const { isZeroAreaWindow } = require('../src/x-system/win32-support')

const user32 = koffi.load('user32.dll')
const GetWindowRect = user32.func('bool __stdcall GetWindowRect(void * hWnd, void * lpRect)')
const IsIconic = user32.func('bool __stdcall IsIconic(void * hWnd)')
const EnumWindowsProc = koffi.proto('bool __stdcall ZeroAreaTestEnumProc(void * hwnd, int32_t lParam)')
const EnumWindows = user32.func('bool __stdcall EnumWindows(ZeroAreaTestEnumProc * lpEnumFunc, int32_t lParam)')

let passed = 0
let failed = 0

function check(name, condition, detail) {
  if (condition) {
    passed += 1
    console.log(`PASS  ${name}`)
    return
  }
  failed += 1
  console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
}

// Reference implementation: the guard must agree with a plain GetWindowRect.
function referenceZeroArea(hwnd) {
  try {
    if (IsIconic(hwnd)) return false
    const rect = Buffer.alloc(16)
    if (!GetWindowRect(hwnd, rect)) return false
    const width = rect.readInt32LE(8) - rect.readInt32LE(0)
    const height = rect.readInt32LE(12) - rect.readInt32LE(4)
    return width <= 0 || height <= 0
  } catch (_) {
    return false
  }
}

function addonStyleHwnd(hwnd) {
  // Same shape the native process addon produces: 16 uppercase hex digits.
  return BigInt(koffi.address(hwnd)).toString(16).toUpperCase().padStart(16, '0')
}

function enumerateWindows() {
  const windows = []
  const callback = koffi.register((hwnd) => {
    windows.push(hwnd)
    return true
  }, koffi.pointer(EnumWindowsProc))
  EnumWindows(callback, 0)
  koffi.unregister(callback)
  return windows
}

check('null hwnd is not zero-area', isZeroAreaWindow(null) === false)
check('empty string is not zero-area', isZeroAreaWindow('') === false)
check('pointer 0 is not zero-area', isZeroAreaWindow(0) === false)

const windows = enumerateWindows().filter(hwnd => hwnd && koffi.address(hwnd) !== 0n)
check('enumerated live windows', windows.length > 10, `windows=${windows.length}`)

let mismatches = []
let zeroAreaSeen = 0
let areaSeen = 0
for (const hwnd of windows) {
  const expected = referenceZeroArea(hwnd)
  if (expected !== isZeroAreaWindow(hwnd)) {
    mismatches.push(`${addonStyleHwnd(hwnd)} expected=${expected}`)
  }
  if (expected) zeroAreaSeen += 1
  else areaSeen += 1
}
check('guard matches GetWindowRect for every live window', mismatches.length === 0, mismatches.slice(0, 3).join(', '))
check('live desktop has both kinds of window', zeroAreaSeen > 0 && areaSeen > 0, `zero=${zeroAreaSeen} area=${areaSeen}`)

// The caller (system.js) passes hwnds in the addon hex-string format.
const hexMismatches = []
for (const hwnd of windows) {
  const viaPointer = isZeroAreaWindow(hwnd)
  const viaHex = isZeroAreaWindow(addonStyleHwnd(hwnd))
  if (viaPointer !== viaHex) hexMismatches.push(addonStyleHwnd(hwnd))
}
check('hex-string hwnds behave like pointers', hexMismatches.length === 0, hexMismatches.slice(0, 3).join(', '))

console.log(`\n${passed}/${passed + failed} passed`)
process.exit(failed === 0 ? 0 : 1)
