import { getCurrentWindow } from "@tauri-apps/api/window";

// One-shot flag so show() is only called once even if this module is
// evaluated multiple times (React StrictMode double-invoke, HMR, etc.)
let _shown = false;

/**
 * Reveal the Tauri window. Safe to call multiple times — only acts once.
 * Called by App on mount; also on a dead-man's timer in main.tsx as a fallback.
 */
export async function showWindow(): Promise<void> {
  if (_shown) return;
  _shown = true;
  await getCurrentWindow().show();
}

// Dead-man's switch: if React crashes or the lazy chunk fails to load,
// the window would stay hidden forever. Force-show after 10 s as a last resort.
const _fallbackTimer = setTimeout(() => {
  showWindow().catch(console.error);
}, 10_000);

/**
 * Cancel the dead-man's timer. Called by App.tsx on successful mount so
 * the 10-second fallback doesn't fire after the app is already visible.
 */
export function cancelFallback(): void {
  clearTimeout(_fallbackTimer);
}
