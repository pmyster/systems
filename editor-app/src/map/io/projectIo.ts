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
  DEFAULT_COLOR_PAINT_HEIGHT_PX,
  DEFAULT_COLOR_PAINT_WIDTH_PX,
  DEFAULT_SPLATMAP_HEIGHT_PX,
  DEFAULT_SPLATMAP_WIDTH_PX,
  MapProjectManifestSchema,
  MAP_SCHEMA_VERSION,
  type MapProjectManifest,
} from "../schema/manifest";
import { migrate } from "../schema/migrations";
import {
  DEFAULT_ATMOSPHERE,
  DEFAULT_COLOR_VARIANCE,
  DEFAULT_ELEVATION_PROFILE,
  DEFAULT_SPLAT_TO_ELEVATION_MIX,
} from "../scene/biomes";
import { useMapStore } from "../state/mapStore";

import { decodeHeightmap, encodeHeightmap } from "./heightmapCodec";

/** Tauri command payload. */
interface MapBundle {
  manifest_json: string;
  heightmap_bytes: number[];
  splatmap_bytes: number[];
  /**
   * Raw `colorpaint.r8` bytes — `widthPx * heightPx * 4` RGBA values
   * where RGB is the painted color and A is the overlay opacity.
   * Empty array signals "no painted color anywhere" so the Rust side
   * skips writing the sidecar file (keeping legacy maps free of an
   * empty stub file). Loaders likewise return an empty array when no
   * `colorpaint.r8` is present.
   */
  colorpaint_bytes: number[];
  /**
   * Optional PNG bytes for `thumbnail.png`. Empty array signals "no
   * thumbnail this save"; the Rust side then skips the file write rather
   * than overwriting an existing thumbnail with zeros.
   */
  thumbnail_bytes: number[];
}

/** Lightweight bundle for the Recent Projects panel — manifest + thumb only. */
interface MapBundleMeta {
  manifest_json: string;
  thumbnail_bytes: number[];
}

// ---------------------------------------------------------------------------
// Recent projects — small list of dirs we've opened/created/saved-as, stored
// in localStorage so it survives reloads. The Recent panel reads this list,
// lazy-loads thumbnails per entry, and offers a quick re-open path.
// ---------------------------------------------------------------------------

/** Entry persisted to localStorage. lastOpenedAt is passed in by callers — */
/** we don't compute it here so the function stays pure for tests. */
export interface RecentProject {
  dir: string;
  name: string;
  lastOpenedAt: number;
}

const RECENT_KEY = "cl_map_recent_projects";
const RECENT_MAX = 8;

export function getRecentProjects(): RecentProject[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as RecentProject[];
    return Array.isArray(arr) ? arr.slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

export function pushRecentProject(
  dir: string,
  name: string,
  nowMs: number,
): void {
  try {
    const existing = getRecentProjects().filter((r) => r.dir !== dir);
    const next = [{ dir, name, lastOpenedAt: nowMs }, ...existing].slice(
      0,
      RECENT_MAX,
    );
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch (e) {
    // Loud-over-silent: localStorage quota / disabled storage shouldn't
    // crash the save flow, but we want to know it regressed.
    console.warn("[projectIo] failed to persist recent projects:", e);
  }
}

/**
 * Read `thumbnail.png` from a project dir via the cheap meta-only
 * Rust command (skips the heightmap+splatmap sidecars). Returns a
 * base64 data URL ready to drop into `<img src=...>`, or null if no
 * thumbnail / read failure.
 */
export async function readProjectThumbnail(
  dir: string,
): Promise<string | null> {
  try {
    const bundle = await invoke<MapBundleMeta>("open_map_project_meta_only", {
      dir,
    });
    if (!bundle.thumbnail_bytes || bundle.thumbnail_bytes.length === 0) {
      return null;
    }
    const bytes = new Uint8Array(bundle.thumbnail_bytes);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return `data:image/png;base64,${btoa(binary)}`;
  } catch (e) {
    console.warn("[projectIo] readProjectThumbnail failed:", dir, e);
    return null;
  }
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

/** All-zero color-paint buffer = no painted tint anywhere. */
function buildDefaultColorPaint(
  widthPx: number,
  heightPx: number,
): Uint8Array {
  return new Uint8Array(widthPx * heightPx * 4);
}

/**
 * True iff the color-paint buffer has any non-zero byte. We only
 * serialize the sidecar when there's actually painted content — saves a
 * 64 KB write per save for the common "no color paint yet" case and
 * keeps legacy projects from gaining an empty stub file.
 */
function hasAnyColorPaint(data: Uint8Array): boolean {
  for (let i = 0; i < data.length; i++) {
    if (data[i] !== 0) return true;
  }
  return false;
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
      // colorPaint sidecar ref is always declared so a re-load knows
      // the expected dimensions even when the sidecar bytes are absent
      // (no painted content — see hasAnyColorPaint gate below).
      colorPaint: {
        sidecar: "colorpaint.r8",
        widthPx: s.colorPaint.widthPx,
        heightPx: s.colorPaint.heightPx,
      },
    },
    objects: Object.values(s.objects),
    spawnPoints: Object.values(s.spawnPoints),
    decals: Object.values(s.decals),
    elevationProfile: {
      mid: [
        s.elevationProfile.mid[0],
        s.elevationProfile.mid[1],
        s.elevationProfile.mid[2],
      ],
      high: [
        s.elevationProfile.high[0],
        s.elevationProfile.high[1],
        s.elevationProfile.high[2],
      ],
      peak: [
        s.elevationProfile.peak[0],
        s.elevationProfile.peak[1],
        s.elevationProfile.peak[2],
      ],
    },
    splatToElevationMix: s.splatToElevationMix,
    atmosphere: {
      skyTop: [
        s.atmosphere.skyTop[0],
        s.atmosphere.skyTop[1],
        s.atmosphere.skyTop[2],
      ],
      skyHorizon: [
        s.atmosphere.skyHorizon[0],
        s.atmosphere.skyHorizon[1],
        s.atmosphere.skyHorizon[2],
      ],
      skyGround: [
        s.atmosphere.skyGround[0],
        s.atmosphere.skyGround[1],
        s.atmosphere.skyGround[2],
      ],
      sunColor: [
        s.atmosphere.sunColor[0],
        s.atmosphere.sunColor[1],
        s.atmosphere.sunColor[2],
      ],
      sunIntensity: s.atmosphere.sunIntensity,
      hemiSky: [
        s.atmosphere.hemiSky[0],
        s.atmosphere.hemiSky[1],
        s.atmosphere.hemiSky[2],
      ],
      hemiGround: [
        s.atmosphere.hemiGround[0],
        s.atmosphere.hemiGround[1],
        s.atmosphere.hemiGround[2],
      ],
      hemiIntensity: s.atmosphere.hemiIntensity,
      fogColor: [
        s.atmosphere.fogColor[0],
        s.atmosphere.fogColor[1],
        s.atmosphere.fogColor[2],
      ],
      fogNear: s.atmosphere.fogNear,
      fogFar: s.atmosphere.fogFar,
    },
    colorVariance: s.colorVariance,
    ...(thumbnailBytes.length > 0 ? { thumbnail: "thumbnail.png" } : {}),
  };
  // Only emit color-paint bytes when there's actually paint on the
  // terrain. Skipping for empty buffers (the common case for legacy
  // maps) avoids a 64 KB write per save and keeps the on-disk project
  // dir clean.
  const colorPaintBytes = hasAnyColorPaint(s.colorPaint.data)
    ? Array.from(s.colorPaint.data)
    : [];

  return {
    manifest_json: JSON.stringify(manifest, null, 2),
    heightmap_bytes: Array.from(encodeHeightmap(s.terrain.heightmap)),
    splatmap_bytes: Array.from(s.splatmap.data),
    colorpaint_bytes: colorPaintBytes,
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
  // Elevation profile + mix come from the v3 manifest fields. v2 maps were
  // migrated to v3 in `migrate()` with Grassland defaults; v3-native maps
  // may carry custom values. Fall back defensively if either field is
  // missing — never let the load path crash because of an old manifest.
  const ep = manifest.elevationProfile ?? DEFAULT_ELEVATION_PROFILE;
  const elevationProfile = {
    mid: [ep.mid[0], ep.mid[1], ep.mid[2]] as [number, number, number],
    high: [ep.high[0], ep.high[1], ep.high[2]] as [number, number, number],
    peak: [ep.peak[0], ep.peak[1], ep.peak[2]] as [number, number, number],
  };
  const splatToElevationMix =
    manifest.splatToElevationMix ?? DEFAULT_SPLAT_TO_ELEVATION_MIX;
  // v4 — atmosphere + color variance. Migration synthesises defaults from
  // the legacy daylight rig for pre-v4 maps so they keep rendering as
  // before. We still defensively fall back here in case a hand-edit
  // somehow stripped the field after migration.
  const atm = manifest.atmosphere ?? DEFAULT_ATMOSPHERE;
  const atmosphere = {
    skyTop: [atm.skyTop[0], atm.skyTop[1], atm.skyTop[2]] as [
      number,
      number,
      number,
    ],
    skyHorizon: [atm.skyHorizon[0], atm.skyHorizon[1], atm.skyHorizon[2]] as [
      number,
      number,
      number,
    ],
    skyGround: [atm.skyGround[0], atm.skyGround[1], atm.skyGround[2]] as [
      number,
      number,
      number,
    ],
    sunColor: [atm.sunColor[0], atm.sunColor[1], atm.sunColor[2]] as [
      number,
      number,
      number,
    ],
    sunIntensity: atm.sunIntensity,
    hemiSky: [atm.hemiSky[0], atm.hemiSky[1], atm.hemiSky[2]] as [
      number,
      number,
      number,
    ],
    hemiGround: [atm.hemiGround[0], atm.hemiGround[1], atm.hemiGround[2]] as [
      number,
      number,
      number,
    ],
    hemiIntensity: atm.hemiIntensity,
    fogColor: [atm.fogColor[0], atm.fogColor[1], atm.fogColor[2]] as [
      number,
      number,
      number,
    ],
    fogNear: atm.fogNear,
    fogFar: atm.fogFar,
  };
  const colorVariance = manifest.colorVariance ?? DEFAULT_COLOR_VARIANCE;

  // Color-paint fallback chain mirrors splatmap:
  //   1. Manifest declares dims + sidecar bytes present with matching
  //      length → use them.
  //   2. Manifest declares dims only → all-zero buffer at those dims.
  //   3. Neither → default 128×128 all-zero buffer.
  const colorPaintRef = manifest.terrain.colorPaint;
  const colorPaintWidth =
    colorPaintRef?.widthPx ?? DEFAULT_COLOR_PAINT_WIDTH_PX;
  const colorPaintHeight =
    colorPaintRef?.heightPx ?? DEFAULT_COLOR_PAINT_HEIGHT_PX;
  const expectedColorPaintLen = colorPaintWidth * colorPaintHeight * 4;
  let colorPaintData: Uint8Array;
  if (
    bundle.colorpaint_bytes &&
    bundle.colorpaint_bytes.length === expectedColorPaintLen
  ) {
    colorPaintData = new Uint8Array(bundle.colorpaint_bytes);
  } else {
    if (bundle.colorpaint_bytes && bundle.colorpaint_bytes.length > 0) {
      // Loud-over-silent: size mismatch surfaces in the dev console.
      console.warn(
        `[projectIo] colorpaint.r8 length ${bundle.colorpaint_bytes.length} != expected ${expectedColorPaintLen} (${colorPaintWidth}x${colorPaintHeight}*4). Falling back to empty.`,
      );
    }
    colorPaintData = buildDefaultColorPaint(colorPaintWidth, colorPaintHeight);
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
      colorPaint: {
        widthPx: colorPaintWidth,
        heightPx: colorPaintHeight,
        data: colorPaintData,
        revision: s.colorPaint.revision + 1,
      },
      objects: Object.fromEntries(manifest.objects.map((o) => [o.id, o])),
      spawnPoints: Object.fromEntries(
        manifest.spawnPoints.map((sp) => [sp.id, sp]),
      ),
      decals: Object.fromEntries(manifest.decals.map((d) => [d.id, d])),
      selection: { kind: "none", id: null },
      elevationProfile,
      splatToElevationMix,
      atmosphere,
      colorVariance,
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

/**
 * Pull the human-friendly project name from a manifest JSON string.
 * Falls back to the dir's basename if the manifest doesn't have one or
 * fails to parse — we never want this to throw.
 */
function deriveProjectName(manifestJson: string, dir: string): string {
  try {
    const parsed = JSON.parse(manifestJson) as { name?: unknown };
    if (typeof parsed.name === "string" && parsed.name.length > 0) {
      return parsed.name;
    }
  } catch {
    // ignore — fall through to basename
  }
  const parts = dir.split(/[\\/]/).filter((p) => p.length > 0);
  return parts[parts.length - 1] ?? dir;
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
  pushRecentProject(dir, deriveProjectName(bundle.manifest_json, dir), Date.now());
  console.warn(
    `[map] Created project folder ${dir}. Manifest + heightmap + splatmap sidecars saved inside.`,
  );
}

/**
 * Create a new project from whatever is CURRENTLY in the store — used by
 * the New Map modal flow: `setupNewMap()` populates the store with the
 * user's chosen dimensions + biome, then this prompts for a folder and
 * persists the snapshot. Behaviour mirrors `newMapProject` once the dir
 * is chosen; the only difference is that the store has been
 * pre-populated by the caller instead of using the default flat 129×129
 * grass map.
 */
export async function newMapProjectFromCurrentState(): Promise<void> {
  const dir = await saveDialog({
    title: "Create Map Project Folder",
    defaultPath: "untitled-map",
  });
  if (!dir) return;
  const bundle = _buildBundleFromStore();
  await invoke("create_map_project", { dir, bundle });
  currentProjectDir = dir;
  pushRecentProject(
    dir,
    deriveProjectName(bundle.manifest_json, dir),
    Date.now(),
  );
  console.warn(
    `[map] Created project folder ${dir} from current store state (New Map modal flow).`,
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
  pushRecentProject(picked, deriveProjectName(bundle.manifest_json, picked), Date.now());
  console.warn(`[map] opened project from ${picked}`);
}

/**
 * Open an existing project directory by an explicit path — used by the
 * Recent Projects panel to skip the dialog. Behaves identically to
 * `openMapProject` once the dir is known.
 */
export async function openMapProjectByDir(dir: string): Promise<void> {
  const bundle = await invoke<MapBundle>("open_map_project", { dir });
  applyBundleToStore(bundle);
  currentProjectDir = dir;
  pushRecentProject(dir, deriveProjectName(bundle.manifest_json, dir), Date.now());
  console.warn(`[map] opened project from ${dir}`);
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
  pushRecentProject(dir, deriveProjectName(bundle.manifest_json, dir), Date.now());
  console.warn(`[map] saved as ${dir}`);
}
