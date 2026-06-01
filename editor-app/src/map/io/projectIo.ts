/**
 * Project I/O — New / Open / Save / Save As wrappers for Map projects.
 *
 * Bundle now carries:
 *   - manifest_json: canonical JSON string for the v2 manifest.
 *   - heightmap_bytes: raw little-endian Float32 sidecar.
 *   - splatmap_bytes: raw RGBA Uint8 sidecar (4 weights per pixel).
 *
 * The Tauri side serializes `Vec<u8>` as JS `number[]`. We convert via
 * `new Uint8Array(arr)` on the way in and `Array.from(...)` on the way
 * out. Manifest validation happens JS-side via Zod; Rust never inspects
 * the manifest bytes.
 *
 * Backward compat: a v1 project on disk has no splatmap.r8 sidecar. The
 * Rust loader returns an empty `splatmap_bytes` Vec for that case; we
 * detect the empty array here and synthesize a default all-grass
 * splatmap so the rest of the editor doesn't have to special-case it.
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
  DEFAULT_SPLATMAP_HEIGHT_PX,
  DEFAULT_SPLATMAP_WIDTH_PX,
  MapProjectManifestSchema,
  MAP_SCHEMA_VERSION,
  type MapProjectManifest,
} from "../schema/manifest";
import { migrate } from "../schema/migrations";
import { useMapStore } from "../state/mapStore";

import { decodeHeightmap, encodeHeightmap } from "./heightmapCodec";

/** Tauri command payload. */
interface MapBundle {
  manifest_json: string;
  heightmap_bytes: number[];
  splatmap_bytes: number[];
  /**
   * Optional PNG bytes for `thumbnail.png`. Empty array signals "no
   * thumbnail this save"; the Rust side then skips the file write rather
   * than overwriting an existing thumbnail with zeros.
   */
  thumbnail_bytes: number[];
}

/**
 * Scene manager handle for thumbnail capture at save time.
 *
 * The MapSceneManager registers itself here in its constructor (and
 * clears the slot in dispose) so the save pipeline can grab a viewport
 * thumbnail without each call site having to thread the manager through.
 * Module-singleton fits the project — there is exactly one scene manager
 * alive at a time (mirrors the dirty accumulators in mapStore).
 *
 * `null` when no scene manager is mounted (e.g. headless tests or
 * pre-mount autosave races); we then save without a thumbnail.
 */
interface ThumbnailCapturer {
  captureThumbnail(size?: number): Uint8Array;
}
let sceneManagerRef: ThumbnailCapturer | null = null;
export function _setSceneManagerForThumbnails(
  mgr: ThumbnailCapturer | null,
): void {
  sceneManagerRef = mgr;
}

function buildDefaultSplatmap(widthPx: number, heightPx: number): Uint8Array {
  const len = widthPx * heightPx * 4;
  const data = new Uint8Array(len);
  for (let i = 0; i < len; i += 4) data[i] = 255; // pure grass
  return data;
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
  // Capture thumbnail if a scene manager has registered itself. If not
  // (headless tests, autosave before mount), send an empty array — the
  // Rust side then skips the file write instead of clobbering an existing
  // thumbnail with zero bytes.
  let thumbnailBytes: number[] = [];
  if (sceneManagerRef) {
    try {
      thumbnailBytes = Array.from(sceneManagerRef.captureThumbnail());
    } catch (err) {
      // Loud-over-silent: thumbnail capture failing should not block save,
      // but the failure must surface so we know the feature regressed.
      console.warn("[projectIo] thumbnail capture failed:", err);
    }
  }
  const manifest: MapProjectManifest = {
    schemaVersion: MAP_SCHEMA_VERSION,
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
      splatmap: {
        sidecar: "splatmap.r8",
        widthPx: s.splatmap.widthPx,
        heightPx: s.splatmap.heightPx,
      },
    },
    objects: Object.values(s.objects),
    spawnPoints: Object.values(s.spawnPoints),
    decals: Object.values(s.decals),
    ...(thumbnailBytes.length > 0 ? { thumbnail: "thumbnail.png" } : {}),
  };
  return {
    manifest_json: JSON.stringify(manifest, null, 2),
    heightmap_bytes: Array.from(encodeHeightmap(s.terrain.heightmap)),
    splatmap_bytes: Array.from(s.splatmap.data),
    thumbnail_bytes: thumbnailBytes,
  };
}

/**
 * Apply a loaded bundle into the store.
 *
 * Heightmap + splatmap are REPLACED (new backing arrays). The scene
 * manager's revision subscribers take the bulk-upload path because the
 * dirty accumulators return null. Command history is cleared because the
 * new project's undo trail no longer matches the in-memory state.
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
  // Splatmap fallback chain:
  //   1. Sidecar bytes present + non-empty + correct length → use them.
  //   2. Manifest declares splatmap dims → synthesize all-grass at those dims.
  //   3. Neither → default 128×128 all-grass.
  const splatRef = manifest.terrain.splatmap;
  const splatWidth = splatRef?.widthPx ?? DEFAULT_SPLATMAP_WIDTH_PX;
  const splatHeight = splatRef?.heightPx ?? DEFAULT_SPLATMAP_HEIGHT_PX;
  const expectedSplatLen = splatWidth * splatHeight * 4;
  let splatData: Uint8Array;
  if (
    bundle.splatmap_bytes &&
    bundle.splatmap_bytes.length === expectedSplatLen
  ) {
    splatData = new Uint8Array(bundle.splatmap_bytes);
  } else {
    if (bundle.splatmap_bytes && bundle.splatmap_bytes.length > 0) {
      // Loud-over-silent: size mismatch should be visible, not swallowed.
      console.warn(
        `[projectIo] splatmap.r8 length ${bundle.splatmap_bytes.length} != expected ${expectedSplatLen} (${splatWidth}x${splatHeight}*4). Falling back to default grass.`,
      );
    }
    splatData = buildDefaultSplatmap(splatWidth, splatHeight);
  }
  useMapStore.setState(
    (s) => ({
      ...s,
      terrain: {
        widthPx: manifest.terrain.widthPx,
        heightPx: manifest.terrain.heightPx,
        heightmap,
        revision: s.terrain.revision + 1,
      },
      splatmap: {
        widthPx: splatWidth,
        heightPx: splatHeight,
        data: splatData,
        revision: s.splatmap.revision + 1,
      },
      objects: Object.fromEntries(manifest.objects.map((o) => [o.id, o])),
      spawnPoints: Object.fromEntries(
        manifest.spawnPoints.map((sp) => [sp.id, sp]),
      ),
      decals: Object.fromEntries(manifest.decals.map((d) => [d.id, d])),
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
  });
  if (!dir) return;
  const bundle = _buildBundleFromStore();
  await invoke("create_map_project", { dir, bundle });
  currentProjectDir = dir;
  console.warn(
    `[map] Created project folder ${dir}. Manifest + heightmap + splatmap sidecars saved inside.`,
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
  try {
    await invoke("create_map_project", { dir, bundle });
  } catch {
    await invoke("save_map_project", { dir, bundle });
  }
  currentProjectDir = dir;
  console.warn(`[map] saved as ${dir}`);
}
