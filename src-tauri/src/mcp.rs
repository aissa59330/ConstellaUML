//! MCP bridge between Claude and the running Constella.
//!
//! Claude Desktop / Claude Code start `constella --mcp`, which speaks MCP
//! (JSON-RPC, one message per line) over stdio. The bridge relays each line
//! to the open Constella window through a Unix socket; the WebView answers
//! (tools live in `src/ai`), so Claude edits the model that is on screen and
//! every change it makes is one undoable operation.
//!
//! The bridge answers `initialize` and `ping` itself and serves `tools/list`
//! from a cache written by the app, so starting Claude does not launch
//! Constella: the app is only started on the first tool call.

#![cfg_attr(not(unix), allow(unused_imports, dead_code))]

use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

#[cfg(unix)]
use std::os::unix::net::{UnixListener, UnixStream};

const PROTOCOL_VERSIONS: &[&str] = &["2025-06-18", "2025-03-26", "2024-11-05"];

const INSTRUCTIONS: &str = "ConstellaUML est un modeleur UML ouvert sur le poste de l'utilisateur. \
Les outils agissent en direct sur le projet affiché : chaque appel d'écriture est une seule étape \
d'annulation (Ctrl+Z). Commence par get_context (diagramme actif, sélection), puis \
get_project_outline ou get_diagram. Avant d'ajouter des éléments, appelle list_diagram_tools pour \
connaître les outils valides du type de diagramme. Les attributs et opérations s'écrivent comme dans \
l'éditeur rapide : « - titre: String », « + emprunter(date: Date): Boolean ». Termine un nouveau \
diagramme par auto_layout puis vérifie le rendu avec render_diagram.";

fn runtime_dir() -> PathBuf {
    let user = std::env::var("USER").unwrap_or_else(|_| "user".into());
    std::env::var_os("XDG_RUNTIME_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join(format!("constella-{user}"))
}

pub fn socket_path() -> PathBuf {
    runtime_dir().join("mcp.sock")
}

fn tools_cache_path() -> PathBuf {
    let base = std::env::var_os("XDG_CACHE_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".cache")))
        .unwrap_or_else(std::env::temp_dir);
    base.join("constella").join("mcp-tools.json")
}

/// Executable Claude should start, with its arguments. Inside an AppImage the
/// running binary lives in a temporary mount, so the image itself is used.
pub fn bridge_command() -> (String, Vec<String>) {
    let exe = std::env::var("APPIMAGE")
        .ok()
        .map(PathBuf::from)
        .or_else(|| std::env::current_exe().ok())
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| "constella".into());
    (exe, vec!["--mcp".into()])
}

// ---- app side ---------------------------------------------------------------------

#[derive(Default)]
pub struct McpState {
    started: AtomicBool,
    next_id: AtomicU64,
    #[cfg(unix)]
    conns: Mutex<HashMap<u64, UnixStream>>,
}

#[derive(Clone, serde::Serialize)]
struct McpRequest {
    conn: u64,
    message: String,
}

#[cfg(unix)]
fn emit_clients(app: &tauri::AppHandle, state: &McpState) {
    use tauri::Emitter;
    let n = state.conns.lock().map(|c| c.len()).unwrap_or(0);
    let _ = app.emit("mcp-clients", n);
}

/// Opens the socket Claude's bridges connect to (called once the WebView
/// listens), and caches the tool list for bridges started while the app is
/// closed. Returns the socket path.
#[cfg(unix)]
#[tauri::command]
pub fn mcp_start(app: tauri::AppHandle, state: tauri::State<'_, Arc<McpState>>, tools: String) -> Result<String, String> {
    use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
    use tauri::Emitter;

    let cache = tools_cache_path();
    if let Some(dir) = cache.parent() {
        let _ = fs::create_dir_all(dir);
    }
    let _ = fs::write(&cache, tools);

    let path = socket_path();
    if state.started.swap(true, Ordering::SeqCst) {
        return Ok(path.to_string_lossy().into_owned());
    }
    let dir = runtime_dir();
    fs::DirBuilder::new().recursive(true).mode(0o700).create(&dir).map_err(|e| e.to_string())?;
    if path.exists() {
        if UnixStream::connect(&path).is_ok() {
            state.started.store(false, Ordering::SeqCst);
            return Err("une autre fenêtre de ConstellaUML est déjà connectée à Claude".into());
        }
        let _ = fs::remove_file(&path);
    }
    let listener = UnixListener::bind(&path).map_err(|e| e.to_string())?;
    let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));

    let st: Arc<McpState> = state.inner().clone();
    thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(stream) = stream else { continue };
            let Ok(writer) = stream.try_clone() else { continue };
            let id = st.next_id.fetch_add(1, Ordering::SeqCst) + 1;
            if let Ok(mut c) = st.conns.lock() {
                c.insert(id, writer);
            }
            emit_clients(&app, &st);
            let (app, st) = (app.clone(), st.clone());
            thread::spawn(move || {
                for line in BufReader::new(stream).lines() {
                    let Ok(message) = line else { break };
                    if !message.trim().is_empty() {
                        let _ = app.emit("mcp-request", McpRequest { conn: id, message });
                    }
                }
                if let Ok(mut c) = st.conns.lock() {
                    c.remove(&id);
                }
                emit_clients(&app, &st);
            });
        }
    });
    Ok(path.to_string_lossy().into_owned())
}

#[cfg(not(unix))]
#[tauri::command]
pub fn mcp_start(tools: String) -> Result<String, String> {
    let _ = tools;
    Err("la connexion à Claude n'est disponible que sous Linux et macOS".into())
}

/// Sends the WebView's answer back to the bridge that asked.
#[tauri::command]
pub fn mcp_reply(state: tauri::State<'_, Arc<McpState>>, conn: u64, message: String) -> Result<(), String> {
    #[cfg(unix)]
    {
        let mut conns = state.conns.lock().map_err(|e| e.to_string())?;
        let stream = conns.get_mut(&conn).ok_or("client déconnecté")?;
        let mut line = message.replace('\n', " ");
        line.push('\n');
        stream.write_all(line.as_bytes()).map_err(|e| e.to_string())
    }
    #[cfg(not(unix))]
    {
        let _ = (state, conn, message);
        Err("non disponible".into())
    }
}

pub fn cleanup() {
    let _ = fs::remove_file(socket_path());
}

// ---- bridge side (`constella --mcp`) ---------------------------------------------

fn initialize_result(params: &Value) -> Value {
    let asked = params.get("protocolVersion").and_then(Value::as_str).unwrap_or("");
    let version = if PROTOCOL_VERSIONS.contains(&asked) { asked } else { PROTOCOL_VERSIONS[0] };
    json!({
        "protocolVersion": version,
        "capabilities": { "tools": { "listChanged": false } },
        "serverInfo": { "name": "constella", "title": "ConstellaUML", "version": env!("CARGO_PKG_VERSION") },
        "instructions": INSTRUCTIONS,
    })
}

fn write_stdout(line: &str) {
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "{line}");
    let _ = out.flush();
}

fn reply(id: &Value, result: Value) {
    write_stdout(&json!({ "jsonrpc": "2.0", "id": id, "result": result }).to_string());
}

fn reply_error(id: &Value, code: i64, message: &str) {
    write_stdout(&json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } }).to_string());
}

#[cfg(unix)]
type Link = Arc<Mutex<Option<UnixStream>>>;

/// Connects to the running app; its answers are copied to stdout until it
/// closes, after which the link is cleared and the next call reconnects.
#[cfg(unix)]
fn connect(link: &Link) -> bool {
    if link.lock().map(|l| l.is_some()).unwrap_or(false) {
        return true;
    }
    let Ok(stream) = UnixStream::connect(socket_path()) else { return false };
    let Ok(reader) = stream.try_clone() else { return false };
    if let Ok(mut l) = link.lock() {
        *l = Some(stream);
    }
    let link = link.clone();
    thread::spawn(move || {
        for line in BufReader::new(reader).lines() {
            let Ok(line) = line else { break };
            write_stdout(&line);
        }
        if let Ok(mut l) = link.lock() {
            *l = None;
        }
    });
    true
}

/// Starts Constella (detached, so it outlives Claude) and waits for its socket.
#[cfg(unix)]
fn launch_and_connect(link: &Link) -> bool {
    use std::os::unix::process::CommandExt;
    let (exe, _) = bridge_command();
    let spawned = std::process::Command::new(exe)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .process_group(0)
        .spawn();
    if spawned.is_err() {
        return false;
    }
    let deadline = Instant::now() + Duration::from_secs(30);
    while Instant::now() < deadline {
        if connect(link) {
            return true;
        }
        thread::sleep(Duration::from_millis(250));
    }
    false
}

#[cfg(unix)]
fn forward(link: &Link, line: &str) -> bool {
    let Ok(mut l) = link.lock() else { return false };
    let Some(stream) = l.as_mut() else { return false };
    if writeln!(stream, "{line}").is_ok() {
        return true;
    }
    *l = None;
    false
}

/// Entry point of `constella --mcp`. Returns the process exit code.
#[cfg(unix)]
pub fn bridge() -> i32 {
    let link: Link = Arc::new(Mutex::new(None));
    connect(&link);
    for line in std::io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let msg: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => {
                reply_error(&Value::Null, -32700, "JSON invalide");
                continue;
            }
        };
        let method = msg.get("method").and_then(Value::as_str).unwrap_or("");
        let id = msg.get("id").cloned();
        match (method, &id) {
            ("initialize", Some(id)) => reply(id, initialize_result(msg.get("params").unwrap_or(&Value::Null))),
            ("ping", Some(id)) => reply(id, json!({})),
            // Notifications need no app: the WebView is stateless between calls.
            (_, None) => {
                forward(&link, &line);
            }
            (_, Some(id)) => {
                if connect(&link) && forward(&link, &line) {
                    continue;
                }
                if method == "tools/list" {
                    if let Some(tools) = fs::read_to_string(tools_cache_path()).ok().and_then(|s| serde_json::from_str::<Value>(&s).ok()) {
                        reply(id, json!({ "tools": tools }));
                        continue;
                    }
                }
                if launch_and_connect(&link) && forward(&link, &line) {
                    continue;
                }
                if method == "tools/call" {
                    reply(id, json!({ "content": [{ "type": "text", "text": "ConstellaUML n'est pas ouvert et n'a pas pu être lancé. Ouvre ConstellaUML puis réessaie." }], "isError": true }));
                } else {
                    reply_error(id, -32603, "ConstellaUML n'est pas joignable");
                }
            }
        }
    }
    0
}

#[cfg(not(unix))]
pub fn bridge() -> i32 {
    eprintln!("constella --mcp n'est disponible que sous Linux et macOS");
    1
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn negotiates_protocol_version() {
        let r = initialize_result(&json!({ "protocolVersion": "2025-03-26" }));
        assert_eq!(r["protocolVersion"], "2025-03-26");
        let r = initialize_result(&json!({ "protocolVersion": "1999-01-01" }));
        assert_eq!(r["protocolVersion"], PROTOCOL_VERSIONS[0]);
        assert_eq!(r["serverInfo"]["name"], "constella");
    }
}
