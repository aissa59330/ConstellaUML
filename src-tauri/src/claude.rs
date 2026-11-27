//! Registers the `constella --mcp` bridge in Claude Desktop (JSON config file)
//! and Claude Code (through its own `claude mcp` command).

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::{json, Map, Value};

use crate::mcp::bridge_command;

const SERVER_NAME: &str = "constella";

fn home() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default()
}

fn desktop_config_path() -> PathBuf {
    #[cfg(target_os = "macos")]
    let dir = home().join("Library/Application Support/Claude");
    #[cfg(target_os = "windows")]
    let dir = std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_default().join("Claude");
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let dir = std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from).unwrap_or_else(|| home().join(".config")).join("Claude");
    dir.join("claude_desktop_config.json")
}

/// `claude` executable: the PATH of a desktop session often lacks the
/// per-user install folders, so those are tried too.
fn claude_cli() -> Option<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default();
    let h = home();
    dirs.extend([h.join(".local/bin"), h.join(".claude/local"), h.join(".npm-global/bin"), h.join(".local/node/bin"), PathBuf::from("/usr/local/bin")]);
    dirs.into_iter().map(|d| d.join("claude")).find(|p| p.is_file())
}

#[derive(serde::Serialize)]
pub struct ClientStatus {
    /// The client looks installed on this machine.
    available: bool,
    /// Constella is registered in it.
    configured: bool,
    /// Config file or executable involved.
    location: String,
}

#[derive(serde::Serialize)]
pub struct ClaudeStatus {
    command: String,
    args: Vec<String>,
    desktop: ClientStatus,
    code: ClientStatus,
}

fn read_json(path: &Path) -> Result<Value, String> {
    match fs::read_to_string(path) {
        Ok(s) if s.trim().is_empty() => Ok(json!({})),
        Ok(s) => serde_json::from_str(&s).map_err(|e| format!("{} illisible : {e}", path.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(json!({})),
        Err(e) => Err(e.to_string()),
    }
}

fn has_server(config: &Value) -> bool {
    config.get("mcpServers").and_then(|s| s.get(SERVER_NAME)).is_some()
}

fn desktop_status() -> ClientStatus {
    let path = desktop_config_path();
    ClientStatus {
        available: path.parent().is_some_and(Path::exists),
        configured: read_json(&path).map(|c| has_server(&c)).unwrap_or(false),
        location: path.to_string_lossy().into_owned(),
    }
}

fn code_status() -> ClientStatus {
    let cli = claude_cli();
    ClientStatus {
        available: cli.is_some(),
        // User-scope servers live in ~/.claude.json, read-only here: Claude Code owns that file.
        configured: read_json(&home().join(".claude.json")).map(|c| has_server(&c)).unwrap_or(false),
        location: cli.map(|p| p.to_string_lossy().into_owned()).unwrap_or_default(),
    }
}

#[tauri::command]
pub fn claude_status() -> ClaudeStatus {
    let (command, args) = bridge_command();
    ClaudeStatus { command, args, desktop: desktop_status(), code: code_status() }
}

/// Adds or removes Constella in `config` (other keys and their order are kept).
fn set_server(config: &mut Value, enable: bool) -> Result<(), String> {
    let root = config.as_object_mut().ok_or("la configuration n'est pas un objet JSON")?;
    let servers = root.entry("mcpServers").or_insert_with(|| Value::Object(Map::new()));
    let servers = servers.as_object_mut().ok_or("mcpServers n'est pas un objet JSON")?;
    if enable {
        let (command, args) = bridge_command();
        servers.insert(SERVER_NAME.into(), json!({ "command": command, "args": args }));
    } else {
        servers.remove(SERVER_NAME);
    }
    Ok(())
}

fn connect_desktop(enable: bool) -> Result<(), String> {
    let path = desktop_config_path();
    let mut config = read_json(&path)?;
    set_server(&mut config, enable)?;
    if path.exists() {
        fs::copy(&path, path.with_extension("json.bak")).map_err(|e| e.to_string())?;
    }
    let mut text = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    text.push('\n');
    crate::write_atomic(&path, text.as_bytes())
}

fn connect_code(enable: bool) -> Result<(), String> {
    let cli = claude_cli().ok_or("Claude Code est introuvable (commande « claude »)")?;
    let run = |args: &[&str]| Command::new(&cli).args(args).output().map_err(|e| e.to_string());
    // Re-registering replaces a stale path (moved AppImage, new install).
    let removed = run(&["mcp", "remove", "--scope", "user", SERVER_NAME])?;
    if !enable {
        return if removed.status.success() || !code_status().configured { Ok(()) } else { Err(String::from_utf8_lossy(&removed.stderr).trim().to_string()) };
    }
    let (command, args) = bridge_command();
    let mut full = vec!["mcp", "add", "--scope", "user", SERVER_NAME, "--", command.as_str()];
    full.extend(args.iter().map(String::as_str));
    let out = run(&full)?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// `client` is "desktop" or "code".
#[tauri::command]
pub fn claude_connect(client: String, enable: bool) -> Result<ClaudeStatus, String> {
    match client.as_str() {
        "desktop" => connect_desktop(enable)?,
        "code" => connect_code(enable)?,
        _ => return Err(format!("client inconnu : {client}")),
    }
    Ok(claude_status())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_server_keeps_other_settings() {
        let mut c = json!({ "preferences": { "a": 1 }, "mcpServers": { "other": { "command": "x" } } });
        set_server(&mut c, true).unwrap();
        assert!(has_server(&c));
        assert_eq!(c["mcpServers"]["constella"]["args"], json!(["--mcp"]));
        assert_eq!(c["mcpServers"]["other"]["command"], "x");
        assert_eq!(c["preferences"]["a"], 1);
        let keys: Vec<_> = c.as_object().unwrap().keys().cloned().collect();
        assert_eq!(keys, ["preferences", "mcpServers"]);
        set_server(&mut c, false).unwrap();
        assert!(!has_server(&c));
        assert!(c["mcpServers"]["other"].is_object());

        let mut empty = json!({});
        set_server(&mut empty, true).unwrap();
        assert!(has_server(&empty));
    }
}
