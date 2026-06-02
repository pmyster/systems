//! Replay + video clip I/O — Phase 1 Week 4.
//!
//! Three commands:
//!   * `save_replay_file` — write a JSON replay to a user-chosen path.
//!   * `load_replay_file` — read an existing replay JSON back as a UTF-8 string.
//!   * `save_video_clip`  — write WebM bytes (from MediaRecorder) to disk.
//!
//! Why bypass `tauri-plugin-fs`? The plugin's scope is "deny by default".
//! User-chosen save/load paths in Tauri 2 are NOT auto-scoped — relying
//! on the plugin would force us to whitelist arbitrary disk locations.
//! We use `std::fs` directly per the documented escape hatch, same as
//! `read_unit_file` / `write_unit_file` in `lib.rs`.
//!
//! Loud-over-silent: every failure path returns a descriptive
//! `Err(String)` carrying the actual filesystem error.

use std::path::{Path, PathBuf};

/// Sanity check on a user-chosen save path. We do not require the file to
/// exist yet (it's a save target) but we DO require:
///   * non-empty
///   * the parent directory exists (so we don't silently fail on a
///     `New Folder/foo.replay.json` typo where the parent is missing).
///
/// We trust the native dialog to not return obviously hostile paths; this
/// is defence-in-depth, not the front line.
fn sanity_check_save_path(path: &str) -> Result<PathBuf, String> {
    if path.trim().is_empty() {
        return Err("save path cannot be empty".to_string());
    }
    let p = PathBuf::from(path);
    if let Some(parent) = p.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            return Err(format!(
                "parent directory does not exist: {}",
                parent.display()
            ));
        }
    }
    Ok(p)
}

/// Sanity check on a user-chosen load path. Must exist, must be a file,
/// extension must look replay-like (`.json` covers both `.replay.json`
/// and bare `.json` exports from older builds).
fn sanity_check_load_path(path: &str) -> Result<PathBuf, String> {
    if path.trim().is_empty() {
        return Err("load path cannot be empty".to_string());
    }
    let p = PathBuf::from(path);
    let canon = std::fs::canonicalize(&p)
        .map_err(|e| format!("canonicalize {}: {e}", p.display()))?;
    if !canon.is_file() {
        return Err(format!("not a regular file: {}", canon.display()));
    }
    // Accept any file ending in `.json` — covers `.replay.json` plus
    // legacy `.json` exports. We deliberately do NOT enforce the
    // compound `.replay.json` because Tauri's save-dialog on some
    // platforms (notably Linux) appends only the LAST extension.
    let name = canon
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("");
    if !name.ends_with(".json") {
        return Err(format!(
            "expected a .json or .replay.json file, got: {name}"
        ));
    }
    Ok(canon)
}

/// Write `json` (UTF-8) to `path`. The native save dialog should have
/// already been shown by the JS side via `@tauri-apps/plugin-dialog`;
/// this command is just the writer.
#[tauri::command]
pub fn save_replay_file(path: String, json: String) -> Result<String, String> {
    let target = sanity_check_save_path(&path)?;
    write_with_parent_mkdir(&target, json.as_bytes())?;
    Ok(target.to_string_lossy().to_string())
}

/// Read `path` as UTF-8 text and return its contents. JS side will
/// feed it through `decodeReplay` for schema validation.
#[tauri::command]
pub fn load_replay_file(path: String) -> Result<String, String> {
    let target = sanity_check_load_path(&path)?;
    std::fs::read_to_string(&target)
        .map_err(|e| format!("read {}: {e}", target.display()))
}

/// Write `bytes` (raw binary, e.g. WebM payload) to `path`.
///
/// Bytes arrive as a `Vec<u8>` over the Tauri JSON bridge. That's the
/// documented pattern for the MediaRecorder → disk handoff; the
/// alternative (base64) would double the payload size on the wire.
#[tauri::command]
pub fn save_video_clip(path: String, bytes: Vec<u8>) -> Result<String, String> {
    let target = sanity_check_save_path(&path)?;
    write_with_parent_mkdir(&target, &bytes)?;
    Ok(target.to_string_lossy().to_string())
}

fn write_with_parent_mkdir(target: &Path, contents: &[u8]) -> Result<(), String> {
    if let Some(parent) = target.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("create_dir_all {parent:?}: {e}"))?;
        }
    }
    std::fs::write(target, contents)
        .map_err(|e| format!("write {}: {e}", target.display()))
}
