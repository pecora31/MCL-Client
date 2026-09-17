// Tauri's webview swallows a plain <a target="_blank"> or window.open() to an external origin
// instead of launching the system browser, so every external link in the app has to go through
// the open_external_url Tauri command (src-tauri/src/lib.rs) instead — it shells out to the OS's
// own "open this URL" mechanism (explorer/open/xdg-open), same as the working privacy-policy link
// in Settings already did.
import { invokeCommand, isTauri } from './api';

export async function openExternalUrl(url: string | undefined | null): Promise<void> {
  if (!url) return;
  if (isTauri()) {
    try {
      await invokeCommand('open_external_url', { url });
    } catch (err) {
      console.warn('Could not open external URL:', url, err);
    }
  } else {
    // Browser-preview fallback, where a real new tab works fine.
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
