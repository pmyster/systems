/**
 * Project I/O — New / Open / Save / Save As wrappers for Map projects.
 *
 * The flow:
 *   1. Build a `MapBundle` (manifest JSON string + heightmap byte array)
 *      from the current Zustand store state.
 *   2. Hand it to Rust via one of four `invoke()` commands.
 *   3. On load, decode the bundle back into Float32 + manifest, then
 *      apply to the store (replacing the heightmap reference, bumping
 *      revision so the scene manager does a full re-upload).
 *
 * Why we store the manifest as a JSON STRING rather than a JS object:
 *   - It's already canonical on the wire — what we hash, what we diff,
 *     what we write to disk.
 *   - Rust never has to re-serialize. The Tauri command is shape-blind.
 *   - The validation barrier sits in one place: `MapProjectManifestSchema`.
 *
 * Tauri serializes `Vec<u8>` as `number[]`. We convert with
 * `new Uint8Array(arr)` on the way in and `Array.from(...)` on the way
 * out. That's the price of the JSON-RPC bridge until Tauri adds a
 * proper bytes channel.
 */

import { invoke } from "@tauri-apps/api/core";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";

import { mapCommandBus } from "../commands/CommandBus";
import {
  HEIGHTMAP_M_PER_PIXEL,
  TILE_SIZE_M,
  WORLD_M_PER_UNIT,
} from "../coords/constants";
import {
  MapProjectManifestSchema,
  type MapProjectManifest,
  MAP_SCHEMA_VERSION,
} from "../schema/manifest";
import { migrate } from "../schema/migrations";
import { useMapStore } from "../state/mapStore";

import { decodeHeightmap, encodeHeightmap } from "./heightmapCodec";

/** Tauri command payload — Rust returns `Vec<u8>` as JS `number[]`. */
interface MapBundle {
  manifest_json: string;
  heightmap_bytes: number[];
}

/**
 * Build a `MapBundle` snapshot of the current store state.
 *
 * Exported (with the `_` prefix) so the autosave loop can reuse it
 * without round-tripping through the dialog-based public API.
 */
export function _buildBundleFromStore(): MapBundle {
  const s = useMapStore.getState();
  const nowIso = new Date().toISOString();
  const manifest: MapProjectManifest = {
    schemaVersion: MAP_SCHEMA_VERSION,
    // Placeholder name — the metadata panel (Week 2+) will let the user
    // override this. Until then we surface the grid size so two unnamed
    // projects in the open dialog are at least distinguishable.
    name: `${s.terrain.widthPx}x${s.terrain.heightPx} map`,
    metadata: {
      author: "phee",
      theme: "default",
      dimensionsM: {
        width: (s.terrain.widthPx - 1) * HEIGHTMAP_M_PER_PIXEL,
        depth: (s.terrain.heightPx - 1) * HEIGHTMAP_M_PER_PIXEL,
      },
      createdAt: nowIso,
      modifiedAt: nowIso,
    },
    coordinateSystem: {
      up: "Y",
      tileSizeM: TILE_SIZE_M,
      heightmapMPerPixel: HEIGHTMAP_M_PER_PIXEL,
      worldMPerUnit: WORLD_M_PER_UNIT,
    },
    terrain: {
      sidecar: "heightmap.r32",
      widthPx: s.terrain.widthPx,
      heightPx: s.terrain.heightPx,
      tileSizeM: TILE_SIZE_M,
    },
    objects: Object.values(s.objects),
    spawnPoints: Object.values(s.spawnPoints),
  };
  return {
    manifest_json: JSON.stringify(manifest, null, 2),
    heightmap_bytes: Array.from(encodeHeightmap(s.terrain.heightmap)),
  };
}

/**
 * Apply a loaded bundle into the store.
 *
 * Heightmap is REPLACED (new Float32Array reference). The scene
 * manager's revision subscriber takes the bulk-upload path because
 * `_drainDirty()` returns null (we don't accumulate per-pixel dirty
 * markers for a load). Command history is cleared because the new
 * project's undo trail no longer matches the in-memory state.
 */
function applyBundleToStore(bundle: MapBundle): void {
  const rawJson: unknown = JSON.parse(bundle.manifest_json);
  const migrated = migrate(rawJson);
  const manifest = MapProjectManifestSchema.parse(migrated);
  const heightmap = decodeHeightmap(
    new Uint8Array(bundle.heightmap_bytes),
    manifest.terrain.widthPx,
    manifest.terrain.heightPx,
  );
  useMapStore.setState(
    (s) => ({
      ...s,
      terrain: {
        widthPx: manifest.terrain.widthPx,
        heightPx: manifest.terrain.heightPx,
        heightmap,
        revision: s.terrain.revision + 1,
      },
      objects: Object.fromEntries(manifest.objects.map((o) => [o.id, o])),
      spawnPoints: Object.fromEntries(
        manifest.spawnPoints.map((sp) => [sp.id, sp]),
      ),
      selection: { kind: "none", id: null },
    }),
    false,
  );
  mapCommandBus.clear();
}

// ---------------------------------------------------------------------------
// Current-project tracking — single module-singleton string.
// ---------------------------------------------------------------------------

let currentProjectDir: string | null = null;

export function getCurrentProjectDir(): string | null {
  return currentProjectDir;
}

// ---------------------------------------------------------------------------
// Public API — wired from MapMenuBar.
// ---------------------------------------------------------------------------

/** Create a new project at a directory the user picks via Save dialog. */
export async function newMapProject(): Promise<void> {
  const dir = await saveDialog({
    title: "Create Map Project Folder",
    defaultPath: "untitled-map",
    // No filters: the user picks a DIRECTORY NAME, not a file. Tauri's
    // saveDialog still gives us a clean string back even with no
    // extension — we use it as a directory path on the Rust side.
    // The dialog title is the only signal the OS file picker shows to
    // explain the directory-not-file model (ADR 0002: a map project is
    // a folder containing manifest.json + heightmap.r32 sidecars).
  });
  if (!dir) return;
  const bundle = _buildBundleFromStore();
  await invoke("create_map_project", { dir, bundle });
  currentProjectDir = dir;
  console.warn(
    `[map] Created project folder ${dir}. Manifest + heightmap sidecars saved inside.`,
  );
}

/** Open an existing project directory the user picks via Open dialog. */
export async function openMapProject(): Promise<void> {
  const picked = await openDialog({
    directory: true,
    title: "Open Map Project Folder",
  });
  if (!picked || Array.isArray(picked)) return;
  const bundle = await invoke<MapBundle>("open_map_project", { dir: picked });
  applyBundleToStore(bundle);
  currentProjectDir = picked;
  console.warn(`[map] opened project from ${picked}`);
}

/** Save to the current project (rotates a .bak snapshot first). */
export async function saveMapProject(): Promise<void> {
  if (!currentProjectDir) {
    await saveMapProjectAs();
    return;
  }
  const bundle = _buildBundleFromStore();
  await invoke("save_map_project", { dir: currentProjectDir, bundle });
  console.warn(`[map] saved to ${currentProjectDir}`);
}

/** Save to a new directory the user picks; switches current project. */
export async function saveMapProjectAs(): Promise<void> {
  const dir = await saveDialog({
    title: "Save Map Project As (new folder)",
    defaultPath: currentProjectDir ?? "untitled-map",
  });
  if (!dir) return;
  const bundle = _buildBundleFromStore();
  // First try create (errors if dir exists with a manifest). If that
  // fails — i.e. the user picked an existing project — fall through to
  // save, which rotates a .bak then overwrites. Either way the user
  // sees their chosen location become "current".
  try {
    await invoke("create_map_project", { dir, bundle });
  } catch {
    await invoke("save_map_project", { dir, bundle });
  }
  currentProjectDir = dir;
  console.warn(`[map] saved as ${dir}`);
}
