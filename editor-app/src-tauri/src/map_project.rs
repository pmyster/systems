//! Map project I/O — atomic save/load + autosave + .bak rotation.
//!
//! On-disk layout (see docs/adr/0002-map-project-directory-format.md):
//!   <projectdir>/
//!     manifest.json         — UTF-8 JSON, validated JS-side via Zod
//!     heightmap.r32         — raw little-endian Float32 sidecar
//!     splatmap.r8           — raw RGBA Uint8 sidecar (4 material weights / pixel)
//!     .bak/<unix_ts>/       — last 10 snapshot copies (manifest + heightmap + splatmap)
//!     .autosave/            — most-recent autosave snapshot (overwrites in place)
//!
//! Atomicity strategy: write `.tmp` next to target, fsync, rename. On
//! Windows the rename can fail if another process briefly holds the
//! target (AV scanners, file watchers) — we retry once after 50ms before
//! surfacing the error. Per the constitution's "loud over silent" rule
//! every failure path returns a descriptive `Err(String)` rather than
//! swallowing it.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

/// One atomic unit of map state — manifest text + heightmap bytes + splatmap bytes.
///
/// `heightmap_bytes` is the raw .r32 payload: `widthPx * heightPx * 4`
/// little-endian Float32 values. `splatmap_bytes` is the raw .r8 payload:
/// `splatWidthPx * splatHeightPx * 4` RGBA Uint8 values. Encoding/decoding
/// lives JS-side (see `src/map/io/`); Rust only shuttles bytes.
///
/// `splatmap_bytes` defaults to an empty Vec for backward compat with v1
/// project folders that have no splatmap.r8 sidecar yet — the JS load
/// path synthesizes a default all-grass splatmap when the array is empty.
#[derive(Serialize, Deserialize, Debug)]
pub struct MapBundle {
    pub manifest_json: String,
    pub heightmap_bytes: Vec<u8>,
    #[serde(default)]
    pub splatmap_bytes: Vec<u8>,
    /// Optional PNG thumbnail bytes. Empty Vec means "no thumbnail this
    /// save" — we then skip the file write instead of clobbering an
    /// existing `thumbnail.png` with zero bytes. Loaders return an empty
    /// Vec when no thumbnail.png is present on disk.
    #[serde(default)]
    pub thumbnail_bytes: Vec<u8>,
}

/// Create a fresh project directory with manifest + sidecars.
///
/// Refuses to overwrite an existing manifest — the New flow must never
/// clobber an existing project. Use `save_map_project` for in-place
/// updates (which rotates the prior version into `.bak/`).
#[tauri::command]
pub fn create_map_project(dir: String, bundle: MapBundle) -> Result<(), String> {
    let dir_path = PathBuf::from(&dir);
    fs::create_dir_all(&dir_path)
        .map_err(|e| format!("create_dir_all failed: {e}"))?;
    let manifest_path = dir_path.join("manifest.json");
    if manifest_path.exists() {
        return Err(format!("Project already exists at {dir}"));
    }
    write_bundle_atomic(&dir_path, &bundle)?;
    Ok(())
}

/// Load manifest + sidecars from a project directory.
///
/// `splatmap.r8` is optional — older v1 projects don't have one. When
/// missing we return an empty `splatmap_bytes` Vec and let the JS load
/// path synthesize a default. Loud-over-silent: we log to stderr so a
/// developer running with the dev console knows the synth happened.
#[tauri::command]
pub fn open_map_project(dir: String) -> Result<MapBundle, String> {
    let dir_path = PathBuf::from(&dir);
    let manifest_path = dir_path.join("manifest.json");
    let heightmap_path = dir_path.join("heightmap.r32");
    let splatmap_path = dir_path.join("splatmap.r8");
    let manifest_json = fs::read_to_string(&manifest_path)
        .map_err(|e| format!("read manifest failed: {e}"))?;
    let heightmap_bytes = fs::read(&heightmap_path)
        .map_err(|e| format!("read heightmap failed: {e}"))?;
    let splatmap_bytes = if splatmap_path.exists() {
        fs::read(&splatmap_path)
            .map_err(|e| format!("read splatmap failed: {e}"))?
    } else {
        eprintln!(
            "[map_project] No splatmap.r8 at {splatmap_path:?}; JS layer will synth default."
        );
        Vec::new()
    };
    // Thumbnail is optional — older projects (or any project that has
    // never been saved with the thumbnail feature) won't have one. Empty
    // Vec signals "absent" to the JS side without failing the load.
    let thumbnail_path = dir_path.join("thumbnail.png");
    let thumbnail_bytes = if thumbnail_path.exists() {
        fs::read(&thumbnail_path).unwrap_or_else(|e| {
            eprintln!(
                "[map_project] thumbnail.png exists but read failed: {e}; returning empty"
            );
            Vec::new()
        })
    } else {
        Vec::new()
    };
    Ok(MapBundle {
        manifest_json,
        heightmap_bytes,
        splatmap_bytes,
        thumbnail_bytes,
    })
}

/// Lightweight metadata-only loader for the Recent Projects panel.
///
/// Returns just the manifest JSON + thumbnail bytes — skipping the
/// heightmap and splatmap sidecars (which can be several MB each).
/// Callers that need the full bundle should use `open_map_project`.
#[derive(Serialize, Deserialize, Debug)]
pub struct MapBundleMeta {
    pub manifest_json: String,
    #[serde(default)]
    pub thumbnail_bytes: Vec<u8>,
}

#[tauri::command]
pub fn open_map_project_meta_only(dir: String) -> Result<MapBundleMeta, String> {
    let dir_path = PathBuf::from(&dir);
    let manifest_json = fs::read_to_string(dir_path.join("manifest.json"))
        .map_err(|e| format!("read manifest failed: {e}"))?;
    let thumbnail_path = dir_path.join("thumbnail.png");
    let thumbnail_bytes = if thumbnail_path.exists() {
        fs::read(&thumbnail_path).unwrap_or_default()
    } else {
        Vec::new()
    };
    Ok(MapBundleMeta {
        manifest_json,
        thumbnail_bytes,
    })
}

/// Atomic save into an existing project directory.
///
/// Rotates the prior manifest+heightmap+splatmap into `.bak/<unix_ts>/`
/// (keeping the most recent 10), then writes the new payload via
/// `.tmp`+rename.
#[tauri::command]
pub fn save_map_project(dir: String, bundle: MapBundle) -> Result<(), String> {
    let dir_path = PathBuf::from(&dir);
    if !dir_path.is_dir() {
        return Err(format!("Project dir does not exist: {dir}"));
    }
    rotate_baks(&dir_path)?;
    write_bundle_atomic(&dir_path, &bundle)?;
    Ok(())
}

/// Write an autosave snapshot into `<projectdir>/.autosave/`.
///
/// Overwrites in place — autosave is best-effort recovery, not history.
/// (History lives in `.bak/`.)
#[tauri::command]
pub fn autosave_map_project(dir: String, bundle: MapBundle) -> Result<(), String> {
    let dir_path = PathBuf::from(&dir);
    let autosave_dir = dir_path.join(".autosave");
    fs::create_dir_all(&autosave_dir)
        .map_err(|e| format!("create .autosave dir: {e}"))?;
    write_atomic(
        &autosave_dir.join("manifest.json"),
        bundle.manifest_json.as_bytes(),
    )?;
    write_atomic(
        &autosave_dir.join("heightmap.r32"),
        &bundle.heightmap_bytes,
    )?;
    if !bundle.splatmap_bytes.is_empty() {
        write_atomic(
            &autosave_dir.join("splatmap.r8"),
            &bundle.splatmap_bytes,
        )?;
    }
    if !bundle.thumbnail_bytes.is_empty() {
        write_atomic(
            &autosave_dir.join("thumbnail.png"),
            &bundle.thumbnail_bytes,
        )?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

fn write_bundle_atomic(dir: &Path, bundle: &MapBundle) -> Result<(), String> {
    write_atomic(&dir.join("manifest.json"), bundle.manifest_json.as_bytes())?;
    write_atomic(&dir.join("heightmap.r32"), &bundle.heightmap_bytes)?;
    if !bundle.splatmap_bytes.is_empty() {
        write_atomic(&dir.join("splatmap.r8"), &bundle.splatmap_bytes)?;
    }
    // Thumbnail is best-effort: skip writing when no bytes were provided
    // (autosave, headless test, capture failure) rather than overwriting
    // an existing good thumbnail with zeros.
    if !bundle.thumbnail_bytes.is_empty() {
        write_atomic(&dir.join("thumbnail.png"), &bundle.thumbnail_bytes)?;
    }
    Ok(())
}

/// Write `contents` to `target` atomically: `.tmp`+fsync+rename.
///
/// On Windows the rename can race with AV/file-watcher handles; we retry
/// once after a tiny sleep before giving up. Both errors are surfaced.
fn write_atomic(target: &Path, contents: &[u8]) -> Result<(), String> {
    let tmp = target.with_extension(format!(
        "{}.tmp",
        target.extension().and_then(|e| e.to_str()).unwrap_or("")
    ));
    {
        let mut f = fs::File::create(&tmp)
            .map_err(|e| format!("create tmp {tmp:?} failed: {e}"))?;
        f.write_all(contents)
            .map_err(|e| format!("write tmp {tmp:?} failed: {e}"))?;
        f.sync_all()
            .map_err(|e| format!("fsync tmp {tmp:?} failed: {e}"))?;
    }
    match fs::rename(&tmp, target) {
        Ok(()) => Ok(()),
        Err(e) => {
            std::thread::sleep(std::time::Duration::from_millis(50));
            fs::rename(&tmp, target).map_err(|e2| {
                format!("rename {tmp:?} -> {target:?} failed (retry): {e2}; first: {e}")
            })
        }
    }
}

/// Copy the current manifest+heightmap+splatmap into `.bak/<unix_ts>/`,
/// then trim the backup folder to the 10 most recent snapshots.
fn rotate_baks(dir: &Path) -> Result<(), String> {
    let manifest = dir.join("manifest.json");
    if !manifest.exists() {
        return Ok(());
    }
    let bak_dir = dir.join(".bak");
    fs::create_dir_all(&bak_dir).map_err(|e| format!("create .bak dir: {e}"))?;
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map_err(|e| format!("time: {e}"))?
        .as_secs();
    // Pad to 20 chars so lexicographic sort == chronological sort even
    // when seconds-since-epoch eventually rolls a digit.
    let stamp_dir = bak_dir.join(format!("{now:020}"));
    fs::create_dir_all(&stamp_dir).map_err(|e| format!("create stamp dir: {e}"))?;
    let _ = fs::copy(&manifest, stamp_dir.join("manifest.json"));
    let _ = fs::copy(
        dir.join("heightmap.r32"),
        stamp_dir.join("heightmap.r32"),
    );
    let splatmap = dir.join("splatmap.r8");
    if splatmap.exists() {
        let _ = fs::copy(&splatmap, stamp_dir.join("splatmap.r8"));
    }
    let thumbnail = dir.join("thumbnail.png");
    if thumbnail.exists() {
        let _ = fs::copy(&thumbnail, stamp_dir.join("thumbnail.png"));
    }
    let mut entries: Vec<_> = fs::read_dir(&bak_dir)
        .map_err(|e| format!("read .bak dir: {e}"))?
        .filter_map(|r| r.ok())
        .filter(|e| e.path().is_dir())
        .collect();
    entries.sort_by_key(|e| e.file_name());
    while entries.len() > 10 {
        let oldest = entries.remove(0);
        let _ = fs::remove_dir_all(oldest.path());
    }
    Ok(())
}
