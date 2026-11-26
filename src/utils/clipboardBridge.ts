/**
 * Unified Host <-> Virtual Desktop Clipboard Bridge.
 *
 * Works seamlessly on BOTH HTTPS/localhost AND plain HTTP (e.g. http://<vps-ip>:4800)
 * by combining the Async Clipboard API with a focus-preserving `document.execCommand('copy')`
 * fallback during browser Transient User Activation windows, plus native `paste` events.
 */

let cachedClipboardText = '';
const listeners = new Set<(text: string) => void>();

export function getCachedClipboardText(): string {
  return cachedClipboardText;
}

export function setCachedClipboardText(text: string, notify = false): void {
  if (typeof text !== 'string') return;
  cachedClipboardText = text;
  if (notify) {
    for (const fn of listeners) {
      try {
        fn(text);
      } catch {}
    }
  }
}

export function onHostClipboardSync(fn: (text: string) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Copies `text` into the user's real host computer (macOS / Windows / Linux) system clipboard.
 * Uses `navigator.clipboard.writeText` when available (HTTPS/localhost) AND falls back to an
 * offscreen `<textarea>` + `document.execCommand('copy')` so plain HTTP deployments also copy
 * directly to the host OS clipboard!
 */
export function copyTextToHostClipboard(text: string): boolean {
  if (typeof text !== 'string' || !text) return false;
  cachedClipboardText = text;

  let copiedSync = false;
  const prevActive = document.activeElement as HTMLElement | null;

  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.setAttribute('aria-hidden', 'true');
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    ta.style.left = '-9999px';
    ta.style.width = '1px';
    ta.style.height = '1px';
    ta.style.opacity = '0';
    ta.style.pointerEvents = 'none';
    document.body.appendChild(ta);
    ta.focus({ preventScroll: true });
    ta.select();
    ta.setSelectionRange(0, text.length);
    copiedSync = document.execCommand('copy');
    document.body.removeChild(ta);
  } catch {
    copiedSync = false;
  } finally {
    if (prevActive && typeof prevActive.focus === 'function' && document.contains(prevActive)) {
      try {
        prevActive.focus({ preventScroll: true });
      } catch {}
    }
  }

  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    navigator.clipboard.writeText(text).catch(() => {});
    return true;
  }

  return copiedSync;
}

/**
 * Silently reads host clipboard when running in a Secure Context (HTTPS / localhost)
 * and clipboard-read permission is granted.
 */
export async function readHostClipboardSilently(): Promise<string | null> {
  if (!navigator.clipboard || typeof navigator.clipboard.readText !== 'function') {
    return null;
  }
  try {
    const txt = await navigator.clipboard.readText();
    if (typeof txt === 'string' && txt.length > 0) {
      cachedClipboardText = txt;
      return txt;
    }
  } catch {
    // Permission not granted or non-secure context; native `paste` event handles HTTP seamlessly.
  }
  return null;
}
