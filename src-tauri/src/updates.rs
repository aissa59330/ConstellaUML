//! Updates of the Arch Linux package. The Tauri updater replaces AppImages
//! and installers but not a pacman package, so for those the release also
//! publishes a signed `.pkg.tar.zst` (target `linux-x86_64-pacman` in
//! latest.json): the updater downloads and verifies it, then pacman installs
//! it through pkexec (the system asks for the user's password).

/// Whether this executable belongs to an installed pacman package.
#[tauri::command]
pub fn installed_with_pacman() -> bool {
    #[cfg(target_os = "linux")]
    {
        if std::env::var_os("APPIMAGE").is_some() || !std::path::Path::new("/etc/arch-release").exists() {
            return false;
        }
        let Ok(exe) = std::env::current_exe() else { return false };
        std::process::Command::new("pacman")
            .arg("-Qqo")
            .arg(exe)
            .output()
            .is_ok_and(|o| o.status.success())
    }
    #[cfg(not(target_os = "linux"))]
    {
        false
    }
}

/// Downloads the signed pacman package of the latest version and installs it.
/// Returns the installed version, or None when already up to date.
#[tauri::command]
pub async fn pacman_update(app: tauri::AppHandle) -> Result<Option<String>, String> {
    #[cfg(target_os = "linux")]
    {
        use tauri_plugin_updater::UpdaterExt;
        let updater = app.updater_builder().target("linux-x86_64-pacman").build().map_err(|e| e.to_string())?;
        let Some(update) = updater.check().await.map_err(|e| e.to_string())? else { return Ok(None) };
        // download() checks the signature against the public key of tauri.conf.json.
        let bytes = update.download(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
        let dir = std::env::temp_dir().join(format!("constella-update-{}", std::process::id()));
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let file = dir.join(format!("constella-bin-{}-x86_64.pkg.tar.zst", update.version));
        std::fs::write(&file, bytes).map_err(|e| e.to_string())?;
        let status = std::process::Command::new("pkexec")
            .args(["pacman", "-U", "--noconfirm"])
            .arg(&file)
            .status()
            .map_err(|e| format!("pkexec introuvable : {e}"))?;
        let _ = std::fs::remove_dir_all(&dir);
        match status.code() {
            Some(0) => Ok(Some(update.version)),
            // pkexec: 126 = authentication refused or dialog dismissed.
            Some(126) | Some(127) => Err("installation annulée".into()),
            _ => Err(format!("pacman a échoué ({status})")),
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = app;
        Err("réservé à Arch Linux".into())
    }
}
