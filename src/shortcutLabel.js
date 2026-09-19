export function currentDesktopPlatform() {
  if (typeof window === 'undefined') {
    return 'linux';
  }
  return window.avb?.platform ?? 'darwin';
}
export function shortcutLabel(key, modifier, platform) {
  if (platform === 'darwin') {
    return modifier === 'primary-shift' ? `⌘⇧${key}` : `⌘${key}`;
  }
  return modifier === 'primary-shift' ? `Ctrl+Shift+${key}` : `Ctrl+${key}`;
}
