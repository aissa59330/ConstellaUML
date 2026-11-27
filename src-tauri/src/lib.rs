use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::Manager;

mod claude;
mod mcp;

pub use mcp::bridge as mcp_bridge;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(err)
}

/// Writes through a temporary file then renames it, so a crash never leaves a
/// half-written model behind.
pub(crate) fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
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

/// Folders never worth reverse engineering (dependencies, build output, VCS).
const SKIPPED_DIRS: &[&str] = &["node_modules", ".git", "target", "build", "dist", "vendor", "__pycache__", ".venv", "venv", ".idea", ".gradle", "out"];
const MAX_FILES: usize = 5000;
const MAX_FILE_SIZE: u64 = 2 * 1024 * 1024;

#[derive(serde::Serialize, serde::Deserialize)]
struct SourceFile {
    path: String,
    content: String,
}

fn collect_sources(root: &Path, dir: &Path, extensions: &[String], out: &mut Vec<SourceFile>) -> Result<(), String> {
    let mut entries: Vec<_> = fs::read_dir(dir).map_err(err)?.filter_map(|e| e.ok()).collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        if out.len() >= MAX_FILES {
            break;
        }
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        let ft = entry.file_type().map_err(err)?;
        if ft.is_dir() {
            if !SKIPPED_DIRS.contains(&name.as_str()) && !name.starts_with('.') {
                collect_sources(root, &path, extensions, out)?;
            }
        } else if ft.is_file() && extensions.iter().any(|x| name.ends_with(x.as_str())) {
            if entry.metadata().map(|m| m.len()).unwrap_or(0) > MAX_FILE_SIZE {
                continue;
            }
            // Non-UTF-8 files are skipped rather than failing the whole import.
            if let Ok(content) = fs::read_to_string(&path) {
                let rel = path.strip_prefix(root).unwrap_or(&path).to_string_lossy().replace('\\', "/");
                out.push(SourceFile { path: rel, content });
            }
        }
    }
    Ok(())
}

/// Source files under `root` with one of `extensions`, paths relative to `root`.
#[tauri::command]
fn read_source_tree(root: String, extensions: Vec<String>) -> Result<Vec<SourceFile>, String> {
    let mut out = Vec::new();
    collect_sources(Path::new(&root), Path::new(&root), &extensions, &mut out)?;
    Ok(out)
}

/// `rel` joined to `root`, refusing absolute paths and ".." so generated
/// files can never land outside the chosen folder.
fn safe_join(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let p = Path::new(rel);
    if p.is_absolute() || p.components().any(|c| !matches!(c, std::path::Component::Normal(_))) {
        return Err(format!("chemin refusé : {rel}"));
    }
    Ok(root.join(p))
}

/// Writes generated files under `root` (folders created as needed).
#[tauri::command]
fn write_files(root: String, files: Vec<SourceFile>) -> Result<usize, String> {
    let root = Path::new(&root);
    for f in &files {
        write_atomic(&safe_join(root, &f.path)?, f.content.as_bytes())?;
    }
    Ok(files.len())
}

/// First command-line argument ending in .mdj / .mfj (file association, CLI).
#[tauri::command]
fn startup_file() -> Option<String> {
    std::env::args()
        .skip(1)
        .find(|a| a.ends_with(".mdj") || a.ends_with(".mfj"))
        .and_then(|a| fs::canonicalize(a).ok())
        .map(|p| display_path(&p))
}

/// Path as the user knows it: on Windows, `canonicalize` returns a verbatim
/// `\\?\C:\...` path, which is stripped back to `C:\...`.
fn display_path(p: &Path) -> String {
    let s = p.to_string_lossy();
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else if let Some(rest) = s.strip_prefix(r"\\?\") {
        rest.to_string()
    } else {
        s.into_owned()
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().plugin(tauri_plugin_dialog::init());
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());
    builder
        .manage(std::sync::Arc::new(mcp::McpState::default()))
        .invoke_handler(tauri::generate_handler![
            read_text_file,
            write_text_file,
            write_binary_file,
            autosave_write,
            autosave_read,
            autosave_clear,
            startup_file,
            read_source_tree,
            write_files,
            mcp::mcp_start,
            mcp::mcp_reply,
            claude::claude_status,
            claude::claude_connect
        ])
        .build(tauri::generate_context!())
        .expect("erreur au lancement de ConstellaUML")
        .run(|_, event| {
            if let tauri::RunEvent::Exit = event {
                mcp::cleanup();
            }
        });
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

    #[test]
    fn generated_files_stay_inside_the_folder() {
        let dir = std::env::temp_dir().join(format!("constella-gen-{}", std::process::id()));
        let files = vec![SourceFile { path: "a/B.java".into(), content: "class B {}".into() }];
        assert_eq!(write_files(dir.to_string_lossy().into(), files).unwrap(), 1);
        assert_eq!(fs::read_to_string(dir.join("a/B.java")).unwrap(), "class B {}");
        for bad in ["../x.txt", "/etc/x", "a/../../x"] {
            assert!(safe_join(&dir, bad).is_err(), "{bad}");
        }
        let found = read_source_tree(dir.to_string_lossy().into(), vec![".java".into()]).unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].path, "a/B.java");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn verbatim_windows_paths_are_stripped() {
        assert_eq!(display_path(Path::new(r"\\?\C:\a\b.mdj")), r"C:\a\b.mdj");
        assert_eq!(display_path(Path::new(r"\\?\UNC\srv\share\b.mdj")), r"\\srv\share\b.mdj");
        assert_eq!(display_path(Path::new("/home/a/b.mdj")), "/home/a/b.mdj");
    }
}
