// Application updates: the app checks the latest GitHub release at startup
// (latest.json, signed packages) and offers to install it, then restarts.
// "Help ▸ Check for updates" runs the same check and reports "up to date".
// Arch packages are replaced through pacman (src-tauri/src/updates.rs).
import { isTauri } from "./platform";
import { t } from "./i18n";
import { ask, toast, reportError } from "./store";

export const RELEASES_URL = "https://github.com/aissa59330/ConstellaUML/releases/latest";

let running = false;

/** `manual`: started from the menu, so "no update" and errors are reported too. */
export async function checkForUpdates(manual = false): Promise<void> {
  if (!isTauri) {
    if (manual) toast(t("update.desktopOnly"));
    return;
  }
  if (running) return;
  running = true;
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) {
      if (manual) toast(t("update.none"));
      return;
    }
    const answer = await ask(t("update.available", { version: update.version, current: update.currentVersion }), [
      { label: t("update.later"), value: "later" },
      { label: t("update.install"), value: "install", primary: true },
    ]);
    if (answer !== "install") return;
    toast(t("update.downloading"));
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      // Arch: the pacman package is updated through pacman (password asked by the system).
      if (await invoke<boolean>("installed_with_pacman")) await invoke("pacman_update");
      else await update.downloadAndInstall();
    } catch (e) {
      if (String(e).includes("annulée")) return toast(t("update.cancelled"));
      // Packages that cannot replace themselves (.deb/.rpm from a package
      // manager, read-only folder): point to the download page instead.
      console.error(e);
      await ask(t("update.manual", { url: RELEASES_URL }), [{ label: t("dialog.ok"), value: "ok", primary: true }]);
      return;
    }
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch (e) {
    // Offline at startup is normal: stay silent unless asked.
    if (manual) reportError(e);
    else console.warn("update check failed", e);
  } finally {
    running = false;
  }
}
