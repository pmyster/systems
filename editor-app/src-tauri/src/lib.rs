// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
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
    std::fs::read_to_string(&path).map_err(|e| format!("Failed to read {path}: {e}"))
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            read_unit_file,
            write_unit_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
