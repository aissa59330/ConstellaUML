use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::Manager;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(err)
}

/// Writes through a temporary file then renames it, so a crash never leaves a
/// half-written model behind.
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let dir = path.parent().ok_or("chemin invalide")?;
    fs::create_dir_all(dir).map_err(err)?;
    let tmp = dir.join(format!(
        ".{}.tmp",
        path.file_name().and_then(|n| n.to_str()).unwrap_or("constella")
    ));
    {
        let mut f = fs::File::create(&tmp).map_err(err)?;
        f.write_all(bytes).map_err(err)?;
        f.sync_all().map_err(err)?;
    }
    fs::rename(&tmp, path).map_err(err)
}

#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    write_atomic(Path::new(&path), contents.as_bytes())
}

#[tauri::command]
fn write_binary_file(path: String, contents: Vec<u8>) -> Result<(), String> {
    write_atomic(Path::new(&path), &contents)
}

fn autosave_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_local_data_dir().map_err(err)?.join("autosave.mdj"))
}

#[tauri::command]
fn autosave_write(app: tauri::AppHandle, contents: String) -> Result<(), String> {
    write_atomic(&autosave_path(&app)?, contents.as_bytes())
}

#[tauri::command]
fn autosave_read(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let p = autosave_path(&app)?;
    if p.exists() {
        fs::read_to_string(p).map(Some).map_err(err)
    } else {
        Ok(None)
    }
}

#[tauri::command]
fn autosave_clear(app: tauri::AppHandle) -> Result<(), String> {
    let p = autosave_path(&app)?;
    if p.exists() {
        fs::remove_file(p).map_err(err)?;
    }
    Ok(())
}

/// First command-line argument ending in .mdj / .mfj (file association, CLI).
#[tauri::command]
fn startup_file() -> Option<String> {
    std::env::args()
        .skip(1)
        .find(|a| a.ends_with(".mdj") || a.ends_with(".mfj"))
        .and_then(|a| fs::canonicalize(a).ok())
        .map(|p| p.to_string_lossy().into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_text_file,
            write_text_file,
            write_binary_file,
            autosave_write,
            autosave_read,
            autosave_clear,
            startup_file
        ])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de Constella");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn atomic_write_replaces_content() {
        let dir = std::env::temp_dir().join(format!("constella-test-{}", std::process::id()));
        let file = dir.join("a.mdj");
        write_atomic(&file, b"one").unwrap();
        write_atomic(&file, b"two").unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "two");
        assert!(!dir.join(".a.mdj.tmp").exists());
        fs::remove_dir_all(dir).unwrap();
    }
}
