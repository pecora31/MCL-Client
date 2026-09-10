/**
 * Clears what this launcher keeps in the webview's storage (settings, servers, skins, account)
 * and restarts the interface. Profiles come back from the backend's own profile list, and
 * downloaded game files and worlds are never touched.
 */
export function resetLauncherData(): void {
  try {
    Object.keys(localStorage)
      .filter((key) => key.startsWith('mcl_'))
      .forEach((key) => localStorage.removeItem(key));
  } catch (err) {
    console.warn('Failed to clear local data:', err);
  }
  window.location.reload();
}
