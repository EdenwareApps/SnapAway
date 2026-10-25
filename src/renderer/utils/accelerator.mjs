/**
 * Helpers to compare Electron accelerators (e.g. "Ctrl+F6") against DOM keyboard
 * events, plus the compact keyboard layout used by the onboarding practice
 * step. Kept dependency-free and framework-free so it can be unit tested with
 * plain node (see scripts/test-accelerator.mjs).
 */

const MODIFIER_ALIASES = {
  ctrl: 'ctrl',
  control: 'ctrl',
  cmdorctrl: 'ctrl',
  commandorcontrol: 'ctrl',
  command: 'ctrl',
  cmd: 'ctrl',
  alt: 'alt',
  option: 'alt',
  shift: 'shift',
  super: 'meta',
  meta: 'meta',
  win: 'meta',
  windows: 'meta'
};

const KEY_ALIASES = {
  ' ': 'SPACE',
  space: 'SPACE',
  spacebar: 'SPACE',
  esc: 'ESC',
  escape: 'ESC',
  return: 'ENTER',
  enter: 'ENTER',
  tab: 'TAB',
  backspace: 'BACKSPACE',
  del: 'DELETE',
  delete: 'DELETE',
  ins: 'INSERT',
  insert: 'INSERT',
  up: 'ARROWUP',
  down: 'ARROWDOWN',
  left: 'ARROWLEFT',
  right: 'ARROWRIGHT',
  home: 'HOME',
  end: 'END',
  pageup: 'PAGEUP',
  pagedown: 'PAGEDOWN'
};

const MODIFIER_LABELS = { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: 'Win' };

const DISPLAY_LABELS = {
  SPACE: 'Space',
  ESC: 'Esc',
  ENTER: 'Enter',
  TAB: 'Tab',
  BACKSPACE: 'Bksp',
  CAPSLOCK: 'Caps',
  DELETE: 'Del',
  INSERT: 'Ins',
  ARROWUP: '↑',
  ARROWDOWN: '↓',
  ARROWLEFT: '←',
  ARROWRIGHT: '→',
  PAGEUP: 'PgUp',
  PAGEDOWN: 'PgDn'
};

const CODE_LABELS = {
  Space: 'SPACE',
  Escape: 'ESC',
  Tab: 'TAB',
  Enter: 'ENTER',
  NumpadEnter: 'ENTER',
  Backspace: 'BACKSPACE',
  Delete: 'DELETE',
  Insert: 'INSERT',
  ArrowUp: 'ARROWUP',
  ArrowDown: 'ARROWDOWN',
  ArrowLeft: 'ARROWLEFT',
  ArrowRight: 'ARROWRIGHT',
  Home: 'HOME',
  End: 'END',
  PageUp: 'PAGEUP',
  PageDown: 'PAGEDOWN'
};

/**
 * Keyboard drawn during onboarding. Duplicated labels (Ctrl/Alt/Shift/Win) are
 * intentional, so consumers must render it without keyed each blocks.
 */
export const KEYBOARD_ROWS = [
  ['Esc', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'],
  ['`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', 'Bksp'],
  ['Tab', 'Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', '[', ']', '\\'],
  ['Caps', 'A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';', "'", 'Enter'],
  ['Shift', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '/', 'Shift'],
  ['Ctrl', 'Win', 'Alt', 'Space', 'Alt', 'Win', 'Ctrl']
];

export function normalizeKeyName(key) {
  const raw = String(key == null ? '' : key);
  if (!raw) return '';
  // Aliases are matched before trimming so a single space can mean SPACE.
  const lower = raw.toLowerCase();
  if (KEY_ALIASES[lower]) return KEY_ALIASES[lower];

  const trimmed = raw.trim();
  if (!trimmed) return '';
  return KEY_ALIASES[trimmed.toLowerCase()] || trimmed.toUpperCase();
}

export function parseAccelerator(accelerator) {
  const parts = String(accelerator == null ? '' : accelerator)
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) return { key: '', modifiers: [] };

  const modifiers = [];
  for (const part of parts.slice(0, -1)) {
    const modifier = MODIFIER_ALIASES[part.toLowerCase()];
    if (modifier && !modifiers.includes(modifier)) modifiers.push(modifier);
  }

  return { key: parts[parts.length - 1], modifiers };
}

/** Normalizes a DOM KeyboardEvent into the same vocabulary as parseAccelerator. */
export function normalizeEventKey(event) {
  if (!event) return '';
  const code = String(event.code || '');

  const alphanumeric = /^(?:Key|Digit|Numpad)([A-Z0-9])$/.exec(code);
  if (alphanumeric) return normalizeKeyName(alphanumeric[1]);

  const functionKey = /^F\d{1,2}$/.exec(code);
  if (functionKey) return normalizeKeyName(functionKey[0]);

  if (CODE_LABELS[code]) return CODE_LABELS[code];

  return normalizeKeyName(event.key);
}

export function matchesAccelerator(event, accelerator) {
  if (!event) return false;
  const { key, modifiers } = parseAccelerator(accelerator);
  if (!key) return false;
  if (normalizeEventKey(event) !== normalizeKeyName(key)) return false;

  if (modifiers.includes('ctrl') !== !!event.ctrlKey) return false;
  if (modifiers.includes('alt') !== !!event.altKey) return false;
  if (modifiers.includes('shift') !== !!event.shiftKey) return false;
  if (modifiers.includes('meta') !== !!event.metaKey) return false;
  return true;
}

/** Labels of the keys that must blink on the drawn keyboard for an accelerator. */
export function acceleratorKeyLabels(accelerator) {
  const { key, modifiers } = parseAccelerator(accelerator);
  const labels = modifiers.map((modifier) => MODIFIER_LABELS[modifier]).filter(Boolean);
  if (key) labels.push(displayKeyLabel(key));
  return labels;
}

function displayKeyLabel(key) {
  const normalized = normalizeKeyName(key);
  return DISPLAY_LABELS[normalized] || normalized;
}
