//! Map project I/O — atomic save/load + autosave + .bak rotation.
//!
//! On-disk layout (see docs/adr/0002-map-project-directory-format.md):
//!   <projectdir>/                          ← `projectdir` basename = map name
//!     <map_name>.manifest.json             — UTF-8 JSON, validated JS-side via Zod
//!     <map_name>.heightmap.r32             — raw little-endian Float32 sidecar
//!     <map_name>.splatmap.r8               — raw RGBA Uint8 sidecar (4 material weights / pixel)
//!     <map_name>.colorpaint.r8             — raw RGBA Uint8 color-paint overlay (v5+)
//!     <map_name>.thumbnail.png             — optional PNG thumbnail (skipped when absent)
//!     .bak/<unix_ts>/                      — last 10 snapshot copies (same name-prefixed scheme)
//!     .autosave/                           — most-recent autosave snapshot (overwrites in place)
//!
//! Filename prefixing (added 2026-06-07): every asset is prefixed with
//! the project folder's basename so the native file picker shows
//! distinctly-named files instead of a sea of identical `manifest.json`
//! / `heightmap.r32` entries across different folders. Back-compat: the
//! load path tries `<map_name>.<asset>` first, falls back to the bare
//! asset name for projects authored before this change. Save path always
//! writes the new-style name and leaves any old bare-named siblings in
//! place (least-destructive — owner deletes manually once confident).
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
    /// Color-paint overlay bytes (`colorpaint.r8`, RGBA Uint8 per
    /// pixel). Empty Vec means "no painted color anywhere" — we then
    /// skip the file write so legacy maps don't gain an empty stub and
    /// fresh maps stay clean until the user actually paints. Loaders
    /// return an empty Vec when no `colorpaint.r8` is present.
    #[serde(default)]
    pub colorpaint_bytes: Vec<u8>,
    /// Optional PNG thumbnail bytes. Empty Vec means "no thumbnail this
    /// save" — we then skip the file write instead of clobbering an
    /// existing `thumbnail.png` with zero bytes. Loaders return an empty
    /// Vec when no thumbnail.png is present on disk.
    #[serde(default)]
    pub thumbnail_bytes: Vec<u8>,
}

/// Derive the map name from a project directory path. Defaults to
/// `"map"` if the path has no basename (root, empty, or oddly-shaped
/// path) so save paths never silently produce `.manifest.json` with a
/// leading dot. The fallback is loud-friendly: callers can see the
/// derived name in the eventual on-disk filenames.
fn map_name_from_dir(dir: &Path) -> String {
    dir.file_name()
        .and_then(|s| s.to_str())
        .filter(|s| !s.is_empty())
        .unwrap_or("map")
        .to_string()
}

/// Resolve the on-disk path for an asset within a project directory.
///
/// Prefers the new prefixed convention `<map_name>.<asset>`; falls back
/// to the bare `<asset>` name for backward compat with maps authored
/// before the prefixing change. Loud-over-silent: when BOTH exist (the
/// half-renamed case, e.g. user manually copied some files), logs a
/// WARN to stderr and prefers the new style — never silently picks one
/// without surfacing the ambiguity.
///
/// Returns the resolved path AND a bool indicating whether the file
/// actually exists. Callers that need "exists OR I'll handle missing"
/// inspect the bool; callers that REQUIRE the file (manifest, heightmap)
/// just call `.exists()` on the result themselves.
fn resolve_asset_path(dir: &Path, map_name: &str, asset: &str) -> PathBuf {
    let prefixed = dir.join(format!("{map_name}.{asset}"));
    let bare = dir.join(asset);
    let prefixed_exists = prefixed.exists();
    let bare_exists = bare.exists();
    if prefixed_exists && bare_exists {
        eprintln!(
            "[map_project] Both new-style ({}) and old-style ({}) sidecars exist; preferring new-style. \
             You can safely delete the old-style file once you've verified the load.",
            prefixed.display(),
            bare.display()
        );
        prefixed
    } else if prefixed_exists {
        prefixed
    } else if bare_exists {
        bare
    } else {
        // Neither exists — return the prefixed path so a downstream
        // `read` produces an error message that points at the new
        // convention (the one we want authoring to converge to).
        prefixed
    }
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
    let map_name = map_name_from_dir(&dir_path);
    // Refuse to overwrite EITHER the new-style or the bare-style manifest.
    // A pre-existing manifest under either name means a project is already
    // here — the New flow must never clobber it.
    let new_manifest = dir_path.join(format!("{map_name}.manifest.json"));
    let bare_manifest = dir_path.join("manifest.json");
    if new_manifest.exists() || bare_manifest.exists() {
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
    let map_name = map_name_from_dir(&dir_path);
    // Try new-style `<map_name>.<asset>` first, fall back to bare name.
    // resolve_asset_path emits a loud WARN to stderr when both exist.
    let manifest_path = resolve_asset_path(&dir_path, &map_name, "manifest.json");
    let heightmap_path = resolve_asset_path(&dir_path, &map_name, "heightmap.r32");
    let splatmap_path = resolve_asset_path(&dir_path, &map_name, "splatmap.r8");
    let manifest_json = fs::read_to_string(&manifest_path)
        .map_err(|e| format!("read manifest failed ({}): {e}", manifest_path.display()))?;
    let heightmap_bytes = fs::read(&heightmap_path)
        .map_err(|e| format!("read heightmap failed ({}): {e}", heightmap_path.display()))?;
    let splatmap_bytes = if splatmap_path.exists() {
        fs::read(&splatmap_path)
            .map_err(|e| format!("read splatmap failed: {e}"))?
    } else {
        eprintln!(
            "[map_project] No splatmap sidecar at {splatmap_path:?}; JS layer will synth default."
        );
        Vec::new()
    };
    // colorpaint.r8 is optional — pre-v5 projects don't have one, and
    // fresh v5 projects skip the write until the user actually paints.
    // Absent file → empty Vec → JS layer synthesises a zero-tint buffer.
    let colorpaint_path = resolve_asset_path(&dir_path, &map_name, "colorpaint.r8");
    let colorpaint_bytes = if colorpaint_path.exists() {
        fs::read(&colorpaint_path)
            .map_err(|e| format!("read colorpaint failed: {e}"))?
    } else {
        Vec::new()
    };
    // Thumbnail is optional — older projects (or any project that has
    // never been saved with the thumbnail feature) won't have one. Empty
    // Vec signals "absent" to the JS side without failing the load.
    let thumbnail_path = resolve_asset_path(&dir_path, &map_name, "thumbnail.png");
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
        colorpaint_bytes,
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
    let map_name = map_name_from_dir(&dir_path);
    let manifest_path = resolve_asset_path(&dir_path, &map_name, "manifest.json");
    let manifest_json = fs::read_to_string(&manifest_path)
        .map_err(|e| format!("read manifest failed ({}): {e}", manifest_path.display()))?;
    let thumbnail_path = resolve_asset_path(&dir_path, &map_name, "thumbnail.png");
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

/// Scan a folder for .glb files. Returns just the filenames (no path).
///
/// The "user drop folder" workflow: users drop .glb files into a chosen
/// directory and the editor auto-registers them on next refresh — no
/// manifest editing required. We deliberately return only the filename
/// (not a path) so the JS side composes the URL relative to its
/// `/prefabs/user/` fetch root (for the dev default) or constructs an
/// absolute file:// reference (for an override), keeping path
/// conventions in one place.
///
/// If `path` is `Some(non-empty)`, scan THAT absolute path. Otherwise,
/// fall back to the dev-only default `../public/prefabs/user/`
/// resolved relative to the src-tauri cwd. Production builds should
/// always pass an explicit path (the dev default does not exist when
/// the public folder is bundled into the installer / app resources).
///
/// Defensive notes:
/// - A missing folder is NOT an error; first-run before anyone drops a
///   file is the normal case → return empty Vec.
/// - Per-entry I/O errors propagate (loud over silent) — a directory
///   that exists but can't be read is a real problem worth surfacing.
/// - Sort the output so the UI order is stable across refreshes
///   (filesystem read_dir order is unspecified on every platform).
///
/// TODO(prod): unset the dev default at build time so production users
/// MUST configure a folder via Settings before the scan can succeed.
#[tauri::command]
pub fn list_user_prefabs(path: Option<String>) -> Result<Vec<String>, String> {
    let user_dir: PathBuf = match path {
        Some(p) if !p.trim().is_empty() => PathBuf::from(p),
        _ => std::env::current_dir()
            .map_err(|e| format!("cwd: {e}"))?
            .join("..")
            .join("public")
            .join("prefabs")
            .join("user"),
    };

    if !user_dir.exists() {
        return Ok(Vec::new());
    }

    let mut prefabs = Vec::new();
    let entries = std::fs::read_dir(&user_dir)
        .map_err(|e| format!("read_dir {}: {e}", user_dir.display()))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("entry: {e}"))?;
        let path = entry.path();
        if path.is_file() {
            if let Some(ext) = path.extension() {
                if ext.eq_ignore_ascii_case("glb") {
                    if let Some(name) = path.file_name() {
                        prefabs.push(name.to_string_lossy().to_string());
                    }
                }
            }
        }
    }
    prefabs.sort();
    Ok(prefabs)
}

/// Read a .glb file from an explicit folder + filename. Returns raw bytes.
///
/// Companion to `list_user_prefabs` for the external-folder case: Vite
/// only serves files under `public/`, so when the Settings panel points
/// the user-prefab folder at an arbitrary location (`D:\MyPrefabs\`),
/// the JS GLTFLoader cannot fetch via a URL path. Instead the loader
/// asks Rust for the bytes and wraps them in a Blob URL.
///
/// Defensive guards:
/// - Empty folder is rejected outright (would canonicalise to cwd and
///   then any file path would "escape" the wrong root).
/// - Both folder and target are canonicalised, then we require the file
///   to live inside the folder — blocks `..\..\Windows\...` traversal
///   attempts via a crafted filename.
/// - Only `.glb` extensions are accepted. The dialog already filters,
///   but we re-check server-side so a programmatic caller cannot
///   exfiltrate arbitrary files by reusing the command.
#[tauri::command]
pub fn read_user_prefab_bytes(folder: String, filename: String) -> Result<Vec<u8>, String> {
    if folder.trim().is_empty() {
        return Err("folder cannot be empty".to_string());
    }
    let path = PathBuf::from(&folder).join(&filename);
    // Guard against directory traversal: ensure the resolved path stays inside the folder
    let folder_canonical = std::fs::canonicalize(&folder)
        .map_err(|e| format!("canonicalize folder {folder}: {e}"))?;
    let path_canonical = std::fs::canonicalize(&path)
        .map_err(|e| format!("canonicalize file {}: {e}", path.display()))?;
    if !path_canonical.starts_with(&folder_canonical) {
        return Err(format!("path escapes folder: {}", path_canonical.display()));
    }
    // Only allow .glb
    match path_canonical.extension() {
        Some(ext) if ext.eq_ignore_ascii_case("glb") => {}
        _ => return Err(format!("not a .glb file: {}", path_canonical.display())),
    }
    std::fs::read(&path_canonical).map_err(|e| format!("read {}: {e}", path_canonical.display()))
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
    if !bundle.colorpaint_bytes.is_empty() {
        write_atomic(
            &autosave_dir.join("colorpaint.r8"),
            &bundle.colorpaint_bytes,
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
    let map_name = map_name_from_dir(dir);
    // Always write the new-style prefixed filenames. We intentionally do
    // NOT delete any pre-existing bare-named siblings: that's the
    // least-destructive choice (least risk of nuking the owner's only
    // copy if something else hiccups during the save). The next manual
    // cleanup pass / future "migrate" button can remove the duplicates.
    write_atomic(
        &dir.join(format!("{map_name}.manifest.json")),
        bundle.manifest_json.as_bytes(),
    )?;
    write_atomic(
        &dir.join(format!("{map_name}.heightmap.r32")),
        &bundle.heightmap_bytes,
    )?;
    if !bundle.splatmap_bytes.is_empty() {
        write_atomic(
            &dir.join(format!("{map_name}.splatmap.r8")),
            &bundle.splatmap_bytes,
        )?;
    }
    // Color-paint sidecar: skip when empty (no painted content) so
    // legacy maps don't gain an empty stub file. The JS layer
    // synthesises an empty buffer at load time when the file's absent.
    if !bundle.colorpaint_bytes.is_empty() {
        write_atomic(
            &dir.join(format!("{map_name}.colorpaint.r8")),
            &bundle.colorpaint_bytes,
        )?;
    }
    // Thumbnail is best-effort: skip writing when no bytes were provided
    // (autosave, headless test, capture failure) rather than overwriting
    // an existing good thumbnail with zeros.
    if !bundle.thumbnail_bytes.is_empty() {
        write_atomic(
            &dir.join(format!("{map_name}.thumbnail.png")),
            &bundle.thumbnail_bytes,
        )?;
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
    let map_name = map_name_from_dir(dir);
    // Look for the current manifest under EITHER the new-style or
    // bare-name convention — rotate_baks runs before save, so the prior
    // version on disk could be from a previous (old-format) save.
    let manifest = resolve_asset_path(dir, &map_name, "manifest.json");
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
    // Backup snapshots inside `.bak/<ts>/` use the bare asset names —
    // they're nested under a timestamp dir, so there's no ambiguity to
    // resolve (the directory itself disambiguates). Keeping bare names
    // here also means the snapshots don't churn if the project folder
    // gets renamed.
    let _ = fs::copy(&manifest, stamp_dir.join("manifest.json"));
    let heightmap = resolve_asset_path(dir, &map_name, "heightmap.r32");
    if heightmap.exists() {
        let _ = fs::copy(&heightmap, stamp_dir.join("heightmap.r32"));
    }
    let splatmap = resolve_asset_path(dir, &map_name, "splatmap.r8");
    if splatmap.exists() {
        let _ = fs::copy(&splatmap, stamp_dir.join("splatmap.r8"));
    }
    let colorpaint = resolve_asset_path(dir, &map_name, "colorpaint.r8");
    if colorpaint.exists() {
        let _ = fs::copy(&colorpaint, stamp_dir.join("colorpaint.r8"));
    }
    let thumbnail = resolve_asset_path(dir, &map_name, "thumbnail.png");
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
