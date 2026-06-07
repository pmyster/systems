/**
 * mapLoader — Phase 1 Week 1B
 *
 * Read-only loader for an authored Map Project directory (`.col`-style on-disk
 * layout, see ADR 0002). The runtime never writes maps — it just consumes
 * `manifest.json` + heightmap/splat/colorpaint sidecars for rendering and
 * physics.
 *
 * Mirrors the editor's `src/map/io/projectIo.ts` open path but trimmed:
 *   - No store mutation (the runtime has its own ECS-shaped state)
 *   - No recent-projects bookkeeping
 *   - No autosave hooks
 *   - Returns a plain immutable `LoadedMap` for downstream consumers
 *     (`RuntimeTerrain`, `RuntimePhysics`) to build their own representations
 *
 * Defensive patterns (per CLAUDE.md "Unknown Data Must Be Visible"):
 *   - Heightmap byte length mismatch THROWS with a precise message — never
 *     silently truncates or pads. A wrong-sized sidecar is an authoring bug
 *     that must surface, not get swallowed.
 *   - Missing splatmap / colorpaint → null (the renderer falls back to a
 *     solid color). This is intentional: pre-v5 maps don't have colorpaint,
 *     and pre-day-2 maps don't have splatmaps. Loud-over-silent: callers
 *     check for null and log when they fall back.
 *   - Wrong file picked (the user selects something other than
 *     `manifest.json`) → THROWS at the picker layer with a precise hint;
 *     never silently fall through into a confusing "manifest.json not
 *     found" error from the Rust side.
 */

import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { dirname } from "@tauri-apps/api/path";

import {
  MapProjectManifestSchema,
  type MapProjectManifest,
} from "../../map/schema/manifest";
import { migrate } from "../../map/schema/migrations";

/**
 * Wire shape returned by the Rust `open_map_project` command. Matches the
 * struct in `src-tauri/src/map_project.rs`. Field names are snake_case to
 * mirror Serde's default rename.
 */
interface MapBundle {
  manifest_json: string;
  heightmap_bytes: number[];
  splatmap_bytes: number[];
  colorpaint_bytes: number[];
  thumbnail_bytes: number[];
}

/**
 * Parsed + validated map ready for runtime consumption. All fields are
 * `readonly` because the runtime never mutates a loaded map — it builds
 * derived structures (mesh, heightfield collider, lighting) from it once
 * at load time and then never touches the raw arrays again.
 */
export interface LoadedMap {
  /** Absolute path of the project directory on disk. */
  readonly dir: string;
  /** Migrated + Zod-validated manifest. */
  readonly manifest: MapProjectManifest;
  /** `widthPx * heightPx` Float32 grid of per-vertex heights, in world meters. */
  readonly heightmap: Float32Array;
  /** RGBA-weight splatmap bytes (4 weights per pixel) or null if absent. */
  readonly splatmap: Uint8Array | null;
  /** RGBA color-paint overlay bytes (RGB + opacity) or null if absent. */
  readonly colorpaint: Uint8Array | null;
}

/**
 * localStorage key for the last directory the Pick Map dialog opened to.
 * Per-picker key (see `match_setup_last_units_dir`, `match_setup_last_replay_dir`)
 * so bouncing between pickers doesn't lose any one picker's context.
 */
const LAST_MAP_DIR_KEY = "match_setup_last_map_dir";

/**
 * Read a stored last-used directory for the given key. Returns `undefined`
 * when nothing is stored (first run), when running in a non-browser context
 * (tests), or when access throws (privacy modes). Loud-over-silent doesn't
 * apply here — the worst case is the dialog opens at the OS default, which
 * is the same as the pre-feature behavior.
 */
function readLastDir(key: string): string | undefined {
  try {
    if (typeof localStorage === "undefined") return undefined;
    const v = localStorage.getItem(key);
    return v && v.length > 0 ? v : undefined;
  } catch {
    return undefined;
  }
}

/** Write a last-used directory; silently ignored in non-browser contexts. */
function writeLastDir(key: string, dir: string): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, dir);
  } catch {
    // Quota or privacy-mode failures don't matter — defaultPath falls
    // back to OS default next time, which is acceptable.
  }
}

/**
 * Open a native FILE picker for `manifest.json`, derive the containing
 * project directory, then load the map. Returns null if the user cancels.
 *
 * Why a file picker (not a folder picker) for a directory-shaped concept?
 * Folder pickers hide the contents of the folder, so sibling map projects
 * look indistinguishable at the dialog level — the owner reported this as
 * "confusing in picking folders". A file picker shows the manifest sitting
 * next to its `heightmap.r32` and `splatmap.png` siblings, which makes the
 * "is this the right map?" check obvious at a glance. It also mirrors the
 * Pick Units flow (which has always been a file picker).
 *
 * Last-used directory is remembered in localStorage under
 * `match_setup_last_map_dir` so the owner can bounce between Pick Map,
 * Pick Units, and Load Replay without re-navigating deep paths each time.
 * If the stored directory no longer exists on disk, Tauri's dialog
 * gracefully falls back to the OS default — no extra handling needed.
 *
 * Loud-over-silent (CLAUDE.md rule #1): if the user picks a non-manifest
 * `.json` file (e.g. they navigated into the units folder by mistake), we
 * THROW a precise error explaining what to pick. The caller surfaces it in
 * the UI error pane — we never silently load the wrong file.
 */
export async function pickAndLoadMap(): Promise<LoadedMap | null> {
  const defaultPath = readLastDir(LAST_MAP_DIR_KEY);
  const picked = await openDialog({
    multiple: false,
    directory: false,
    filters: [{ name: "Map manifest", extensions: ["json"] }],
    title: "Pick a map's manifest.json",
    defaultPath,
  });
  if (picked === null || picked === undefined) return null;
  // openDialog with `multiple: false` returns a string (or null) under
  // Tauri 2.x. Defensive against an array shape in case the plugin widens.
  const filePath = typeof picked === "string" ? picked : null;
  if (!filePath) return null;

  // Loud-over-silent: validate the basename before we touch the loader.
  // Manifest discovery in `open_map_project` (Rust) tries the new-style
  // `<map_name>.manifest.json` first then falls back to the bare
  // `manifest.json`, so anything else here would just produce a
  // confusing "manifest.json not found" error one layer down. Surface
  // the precise mistake here instead.
  //
  // Accept ANY file whose name ends with `.manifest.json` (the new
  // name-prefixed convention, e.g. `Green_Fields.manifest.json`) OR is
  // exactly `manifest.json` (the legacy bare-name convention). This is
  // the file-validation update that matches the save-side rename.
  const filename = filePath.split(/[/\\]/).pop() ?? "";
  const lower = filename.toLowerCase();
  const ok = lower === "manifest.json" || lower.endsWith(".manifest.json");
  if (!ok) {
    throw new Error(
      `Selected "${filename}" — expected manifest.json (or <map_name>.manifest.json). ` +
        `Pick the manifest file inside a map project folder.`,
    );
  }

  // Derive the project directory. Tauri's async `dirname` handles both
  // Windows (`\\`) and POSIX (`/`) separators correctly — preferred over
  // hand-rolled substring math.
  const dir = await dirname(filePath);
  // Persist for next time. We store the PARENT of the manifest's directory
  // (i.e. the folder that CONTAINS the map project), so re-opening the
  // dialog lands the user back at the siblings list where they can pick
  // a different map. If `dirname` fails on `dir` (already at filesystem
  // root) the catch swallows it — falling back to OS default is fine.
  try {
    const parentOfMapDir = await dirname(dir);
    writeLastDir(LAST_MAP_DIR_KEY, parentOfMapDir);
  } catch {
    // At-root edge case — leave the previous value (or absence) alone.
  }
  return await loadMapFromDir(dir);
}

// Re-export so sibling pickers (schematicLoader, ReplayPlayer) can use the
// same localStorage helpers without duplicating the try/catch boilerplate.
// Keeping them here (rather than a new util file) avoids a churned-imports
// diff on a small UX fix.
export { readLastDir, writeLastDir };

/**
 * Load + parse a Map Project from an explicit directory path. Throws on
 * Rust I/O failure, JSON parse error, schema validation failure, or
 * heightmap size mismatch. Callers surface the error — we never silently
 * substitute defaults at this layer (that would hide authoring bugs).
 */
export async function loadMapFromDir(dir: string): Promise<LoadedMap> {
  const bundle = await invoke<MapBundle>("open_map_project", { dir });

  // 1. Manifest: parse → migrate → Zod-validate. The migration step handles
  //    pre-v5 layouts; Zod is the strict gate at the current version.
  const rawJson: unknown = JSON.parse(bundle.manifest_json);
  const migrated = migrate(rawJson);
  const manifest = MapProjectManifestSchema.parse(migrated);

  // 2. Heightmap: raw little-endian Float32 sidecar. Width × height × 4 bytes
  //    expected. A mismatch means the manifest disagrees with the sidecar —
  //    something corrupted the project on disk. We REFUSE to load instead of
  //    rendering garbage terrain (loud-over-silent).
  const heightBytes = new Uint8Array(bundle.heightmap_bytes);
  const expectedHeightLen =
    manifest.terrain.widthPx * manifest.terrain.heightPx * 4;
  if (heightBytes.length !== expectedHeightLen) {
    throw new Error(
      `[mapLoader] heightmap.r32 size mismatch in ${dir}: ` +
        `got ${heightBytes.length} bytes, expected ${expectedHeightLen} ` +
        `(${manifest.terrain.widthPx}×${manifest.terrain.heightPx} × 4).`,
    );
  }
  const heightView = new DataView(
    heightBytes.buffer,
    heightBytes.byteOffset,
    heightBytes.byteLength,
  );
  const heightmap = new Float32Array(
    manifest.terrain.widthPx * manifest.terrain.heightPx,
  );
  for (let i = 0; i < heightmap.length; i++) {
    heightmap[i] = heightView.getFloat32(i * 4, true);
  }

  // 3. Splatmap + colorpaint are OPTIONAL on disk. We pass through whatever
  //    bytes Rust returned but null them out when empty so the consumer can
  //    branch cleanly. Size validation is the consumer's responsibility —
  //    splatmaps are used per-pixel at draw time and a wrong size would
  //    surface immediately in the renderer.
  const splatmap =
    bundle.splatmap_bytes.length > 0
      ? new Uint8Array(bundle.splatmap_bytes)
      : null;
  const colorpaint =
    bundle.colorpaint_bytes.length > 0
      ? new Uint8Array(bundle.colorpaint_bytes)
      : null;

  return { dir, manifest, heightmap, splatmap, colorpaint };
}
