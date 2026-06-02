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
 */

import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

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
 * Open a native folder picker, then load the picked dir. Returns null if
 * the user cancels (mirrors the editor's "user cancelled" convention).
 */
export async function pickAndLoadMap(): Promise<LoadedMap | null> {
  const picked = await openDialog({
    directory: true,
    title: "Open Map Project Folder",
  });
  if (picked === null || picked === undefined) return null;
  // openDialog with `directory: true` always returns a string (or null) under
  // Tauri 2.x. Defensive against the array shape in case the plugin widens.
  const dir = typeof picked === "string" ? picked : null;
  if (!dir) return null;
  return await loadMapFromDir(dir);
}

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
