use serde::Serialize;

mod map_project;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// Row returned by `list_projectile_files` — enough for the picker UI
/// to render without round-tripping the full projectile body.
#[derive(Serialize)]
struct ProjectileFileEntry {
    path: String,
    id: String,
    name: String,
}

/// Enumerate `*.proj.json` files in a directory and pull `id` + `name`
/// from each. Per the constitution's "loud over silent" rule, files
/// that fail to parse are logged to stderr (so they show up in the
/// dev console / Rust log) AND skipped from the returned list rather
/// than silently swallowed. The skipped count is implicit in the
/// directory-vs-list size delta — the UI can surface a warning if it
/// needs to.
#[tauri::command]
fn list_projectile_files(dir: String) -> Result<Vec<ProjectileFileEntry>, String> {
    let dir_path = std::path::Path::new(&dir);
    if !dir_path.exists() {
        // Treat a missing directory as "no projectiles yet" — the
        // first save will create it via write_unit_file's mkdir-p.
        return Ok(Vec::new());
    }
    let read = std::fs::read_dir(&dir)
        .map_err(|e| format!("Failed to read dir {dir}: {e}"))?;
    let mut out: Vec<ProjectileFileEntry> = Vec::new();
    for entry in read {
        let entry = match entry {
            Ok(e) => e,
            Err(e) => {
                eprintln!("[list_projectile_files] dir entry error: {e}");
                continue;
            }
        };
        let path = entry.path();
        // Filter to `*.proj.json`. We do this by string suffix on the
        // filename so we catch the compound extension reliably across
        // platforms (Path::extension only returns the last segment).
        let file_name = match path.file_name().and_then(|s| s.to_str()) {
            Some(s) => s,
            None => continue,
        };
        if !file_name.ends_with(".proj.json") {
            continue;
        }
        let path_str = match path.to_str() {
            Some(s) => s.to_string(),
            None => {
                eprintln!(
                    "[list_projectile_files] non-utf8 path skipped: {:?}",
                    path
                );
                continue;
            }
        };
        let text = match std::fs::read_to_string(&path) {
            Ok(t) => t,
            Err(e) => {
                eprintln!("[list_projectile_files] read failed {path_str}: {e}");
                continue;
            }
        };
        // We don't deserialize the full projectile shape here — that
        // would couple Rust to the TS schema. We only need id + name,
        // which we pull via serde_json::Value lookup.
        let v: serde_json::Value = match serde_json::from_str(&text) {
            Ok(v) => v,
            Err(e) => {
                eprintln!("[list_projectile_files] parse failed {path_str}: {e}");
                continue;
            }
        };
        let id = match v.get("id").and_then(|x| x.as_str()) {
            Some(s) => s.to_string(),
            None => {
                eprintln!(
                    "[list_projectile_files] missing id field {path_str}",
                );
                continue;
            }
        };
        let name = match v.get("name").and_then(|x| x.as_str()) {
            Some(s) => s.to_string(),
            None => {
                eprintln!(
                    "[list_projectile_files] missing name field {path_str}",
                );
                continue;
            }
        };
        out.push(ProjectileFileEntry {
            path: path_str,
            id,
            name,
        });
    }
    Ok(out)
}

/// Read a UTF-8 text file from an absolute path.
///
/// We deliberately bypass `tauri-plugin-fs` here so the path the user
/// picked in the native dialog can be opened without first whitelisting
/// it in the fs-plugin scope. The plugin's scope is "deny by default",
/// and dialog-returned paths are NOT automatically granted scope in
/// Tauri 2 - relying on the plugin would force us to either keep the
/// app sandboxed to `$APPDATA/childoflight-editor/**` (which breaks the
/// "save to Desktop, reopen later" DoD) or to register a wildcard scope
/// (which defeats the point of having one). Using `std::fs` directly is
/// the documented escape hatch.
#[tauri::command]
fn read_unit_file(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path)
        .map_err(|e| format!("Failed to read {path}: {e}"))?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// Write a UTF-8 text file to an absolute path, creating parent
/// directories as needed. See `read_unit_file` for why we bypass the fs
/// plugin. The `create_dir_all` call is what lets autosave drop its
/// snapshot under `$APPDATA/childoflight-editor/.autosave/...` without a
/// separate mkdir round-trip.
#[tauri::command]
fn write_unit_file(path: String, contents: String) -> Result<(), String> {
    if let Some(parent) = std::path::Path::new(&path).parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create parent dir {parent:?}: {e}"))?;
        }
    }
    std::fs::write(&path, contents).map_err(|e| format!("Failed to write {path}: {e}"))
}

/// Read an arbitrary file from an absolute path as raw bytes.
///
/// Needed for binary mesh assets (GLB, and self-contained GLTF) the user
/// imports via the native dialog. Same scope rationale as `read_unit_file`
/// — we bypass `tauri-plugin-fs` so dialog-picked paths open without a
/// whitelist. Returned as a byte vector; the JS side wraps it in a
/// Uint8Array for the Three.js loaders.
#[tauri::command]
fn read_binary_file(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| format!("Failed to read {path}: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            read_unit_file,
            write_unit_file,
            read_binary_file,
            list_projectile_files,
            map_project::create_map_project,
            map_project::open_map_project,
            map_project::open_map_project_meta_only,
            map_project::save_map_project,
            map_project::autosave_map_project,
            map_project::list_user_prefabs,
            map_project::read_user_prefab_bytes,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
