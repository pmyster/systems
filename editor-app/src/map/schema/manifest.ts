/**
 * Zod schema for the Map Project manifest (`manifest.json`).
 *
 * See `docs/adr/0002-map-project-directory-format.md` for the on-disk layout
 * and `docs/adr/0001-map-editor-coordinate-system.md` for coord conventions.
 *
 * Every map load goes through `migrate(raw)` (see `./migrations.ts`) first,
 * then `MapProjectManifestSchema.safeParse(...)`.
 */

import { z } from "zod";

import {
  DEFAULT_HEIGHTMAP_HEIGHT_PX,
  DEFAULT_HEIGHTMAP_WIDTH_PX,
  DEFAULT_MAP_DEPTH_M,
  DEFAULT_MAP_WIDTH_M,
  HEIGHTMAP_M_PER_PIXEL,
  TILE_SIZE_M,
  WORLD_M_PER_UNIT,
} from "../coords/constants";

/** Current schema version. Bump and add a migration when shape changes. */
export const MAP_SCHEMA_VERSION = 5 as const;

/** Default splatmap dimensions in pixels (square, ~1 sample per meter at 128m map). */
export const DEFAULT_SPLATMAP_WIDTH_PX = 128 as const;
export const DEFAULT_SPLATMAP_HEIGHT_PX = 128 as const;

/** Default color-paint sidecar dimensions — matches the splatmap so the
 *  authoring grid feels equivalent between Material and Color tools. */
export const DEFAULT_COLOR_PAINT_WIDTH_PX = 128 as const;
export const DEFAULT_COLOR_PAINT_HEIGHT_PX = 128 as const;

// ---------------------------------------------------------------------------
// Primitive shapes
// ---------------------------------------------------------------------------

const Vec3 = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
});

const EulerXYZ = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
});

/**
 * Snapshot of ADR 0001 values, embedded in every saved map.
 *
 * Lets a future "open old map" flow detect drift if the convention ever
 * changes. We do not anticipate it changing, but cheap insurance.
 */
const CoordinateSystemSnapshot = z.object({
  up: z.literal("Y"),
  tileSizeM: z.number().positive(),
  heightmapMPerPixel: z.number().positive(),
  worldMPerUnit: z.number().positive(),
});

/**
 * Splatmap sidecar reference. Stored as `splatmap.r8` — raw bytes,
 * `widthPx * heightPx * 4` long. Each pixel is RGBA; each channel is a
 * 0-255 weight for one of four hardcoded materials (grass / dirt / sand /
 * scorched). Sidecar dims are smaller than the heightmap dims by design —
 * splatmap fidelity is "biome-scale" rather than per-vertex.
 */
const SplatmapRef = z.object({
  sidecar: z.literal("splatmap.r8"),
  widthPx: z.number().int().positive(),
  heightPx: z.number().int().positive(),
});

/**
 * Color-paint sidecar reference (v5+). Stored as `colorpaint.r8` — raw
 * bytes, `widthPx * heightPx * 4` long. Each pixel is RGBA where RGB is
 * the painted color and A is the tint opacity (0 = no overlay, 255 =
 * full overlay). An empty / all-zero buffer means no painted color
 * anywhere — the underlying material+atmosphere blend reads through
 * unchanged. Optional on TerrainRef so the field tolerates pre-v5
 * manifests at load time; the migration synthesises a default ref.
 */
const ColorPaintRef = z.object({
  sidecar: z.literal("colorpaint.r8"),
  widthPx: z.number().int().positive(),
  heightPx: z.number().int().positive(),
});

const TerrainRef = z.object({
  sidecar: z.literal("heightmap.r32"),
  widthPx: z.number().int().positive(),
  heightPx: z.number().int().positive(),
  tileSizeM: z.number().positive(),
  splatmap: SplatmapRef.optional(),
  colorPaint: ColorPaintRef.optional(),
  instances: z.string().optional(),
});

const InstanceObject = z.object({
  id: z.string().uuid(),
  prefabId: z.string(),
  position: Vec3,
  rotation: EulerXYZ,
  scale: Vec3,
  properties: z.record(z.unknown()),
});

const SpawnPoint = z.object({
  id: z.string().uuid(),
  kind: z.string(),
  position: Vec3,
  facing: z.number(),
  team: z.number().int().optional(),
});

/**
 * Decal instance — a flat textured quad laid on the terrain surface for
 * visual storytelling (scorch marks, tire tracks, blast craters).
 *
 * `decalKind` is a string (not enum) so plugins/users can register new
 * kinds via the runtime DecalRegistry without a schema migration. Unknown
 * kinds at load time are LOGGED and dropped at the renderer (loud-over-
 * silent), not by the schema parser — we want the data to survive a
 * round-trip even if a kind is temporarily missing from the build.
 */
const DecalInstance = z.object({
  id: z.string().uuid(),
  decalKind: z.string(),
  position: Vec3,
  /** Y-rotation in radians; decals lie flat on terrain, only yaw matters. */
  rotation: z.number(),
  /** Uniform scale multiplier on the decal's baseSize (1.0 = baseline). */
  scale: z.number().positive(),
  /** 0-1 alpha multiplier on the underlying texture. */
  opacity: z.number().min(0).max(1),
});

export type DecalInstanceData = z.infer<typeof DecalInstance>;

/**
 * Per-biome above-water elevation gradient stops. v3+ — synthesized for
 * pre-v3 manifests by the migration step (Grassland-default).
 *
 * Each tuple is `[r, g, b]` in 0..1 sRGB-ish (matches the renderer's
 * fallback color convention). Stops are interpolated by the shader:
 *   - mid:  ~0..2m   (sea-level to gentle hills)
 *   - high: ~2..5m   (high ground)
 *   - peak: >5m      (mountain peaks / spires)
 */
const ElevationProfile = z.object({
  mid: z.tuple([z.number(), z.number(), z.number()]),
  high: z.tuple([z.number(), z.number(), z.number()]),
  peak: z.tuple([z.number(), z.number(), z.number()]),
});

/**
 * Per-biome atmosphere (v4+). Sky / sun / hemi-light / fog values pushed
 * into the live scene when the biome is selected. Synthesized by the
 * v3→v4 migration with the previous hardcoded daylight rig so old maps
 * render identically post-migration.
 */
const Atmosphere = z.object({
  skyTop: z.tuple([z.number(), z.number(), z.number()]),
  skyHorizon: z.tuple([z.number(), z.number(), z.number()]),
  skyGround: z.tuple([z.number(), z.number(), z.number()]),
  sunColor: z.tuple([z.number(), z.number(), z.number()]),
  sunIntensity: z.number(),
  hemiSky: z.tuple([z.number(), z.number(), z.number()]),
  hemiGround: z.tuple([z.number(), z.number(), z.number()]),
  hemiIntensity: z.number(),
  fogColor: z.tuple([z.number(), z.number(), z.number()]),
  fogNear: z.number(),
  fogFar: z.number(),
});

// ---------------------------------------------------------------------------
// Top-level manifest
// ---------------------------------------------------------------------------

export const MapProjectManifestSchema = z.object({
  schemaVersion: z.literal(MAP_SCHEMA_VERSION),
  name: z.string(),
  metadata: z.object({
    author: z.string(),
    theme: z.string(),
    dimensionsM: z.object({
      width: z.number(),
      depth: z.number(),
    }),
    createdAt: z.string(),
    modifiedAt: z.string(),
  }),
  coordinateSystem: CoordinateSystemSnapshot,
  terrain: TerrainRef,
  objects: z.array(InstanceObject),
  spawnPoints: z.array(SpawnPoint),
  /**
   * Decal instances — required in v2 but can be empty. v1 manifests get
   * `[]` synthesized by the migration step.
   */
  decals: z.array(DecalInstance),
  /**
   * Optional thumbnail sidecar filename (e.g. "thumbnail.png"). Present
   * iff a thumbnail was captured at the last save. Acts purely as a
   * presence flag — the actual bytes live next to manifest.json on disk.
   */
  thumbnail: z.string().optional(),
  /**
   * v3 — per-map elevation gradient + splat/elevation mix ratio. Optional
   * for forward-compat (a fresh map without these fields falls back to
   * Grassland defaults at load time). Pre-v3 manifests get the same
   * defaults synthesized by the v2→v3 migration step.
   */
  elevationProfile: ElevationProfile.optional(),
  splatToElevationMix: z.number().optional(),
  /**
   * v4 — per-biome atmosphere (sky/sun/hemi/fog) and procedural color
   * variance. Optional for forward-compat; pre-v4 manifests get default
   * daylight + zero-variance synthesized by the v3→v4 migration.
   */
  atmosphere: Atmosphere.optional(),
  colorVariance: z.number().optional(),
});

export type MapProjectManifest = z.infer<typeof MapProjectManifestSchema>;

// ---------------------------------------------------------------------------
// Factory: fresh empty manifest
// ---------------------------------------------------------------------------

/**
 * Build a brand-new empty-manifest object that satisfies the current
 * schema. Used by the Day 4 "New Map" command.
 *
 * `name` and `author` are required because they're the only fields the
 * UI typically prompts for at creation time. Theme defaults to "default"
 * and can be edited later in the metadata panel (Week 2+).
 */
export function createEmptyManifest(
  name: string,
  author: string,
): MapProjectManifest {
  const nowIso = new Date().toISOString();
  return {
    schemaVersion: MAP_SCHEMA_VERSION,
    name,
    metadata: {
      author,
      theme: "default",
      dimensionsM: {
        width: DEFAULT_MAP_WIDTH_M,
        depth: DEFAULT_MAP_DEPTH_M,
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
      widthPx: DEFAULT_HEIGHTMAP_WIDTH_PX,
      heightPx: DEFAULT_HEIGHTMAP_HEIGHT_PX,
      tileSizeM: TILE_SIZE_M,
      splatmap: {
        sidecar: "splatmap.r8",
        widthPx: DEFAULT_SPLATMAP_WIDTH_PX,
        heightPx: DEFAULT_SPLATMAP_HEIGHT_PX,
      },
      colorPaint: {
        sidecar: "colorpaint.r8",
        widthPx: DEFAULT_COLOR_PAINT_WIDTH_PX,
        heightPx: DEFAULT_COLOR_PAINT_HEIGHT_PX,
      },
    },
    objects: [],
    spawnPoints: [],
    decals: [],
    // v3 — embed Grassland-default gradient so a fresh manifest looks
    // exactly like a pre-v3 map after migration. The biome registry is
    // the source of truth in the runtime; the schema layer just snapshots
    // the same defaults to avoid a scene→schema import cycle.
    elevationProfile: {
      mid: [0.35, 0.55, 0.22],
      high: [0.45, 0.55, 0.3],
      peak: [0.55, 0.55, 0.4],
    },
    splatToElevationMix: 0.75,
    // v4 — embed default daylight atmosphere + zero variance. Pre-v4 maps
    // get the same values synthesized by the v3→v4 migration so they keep
    // rendering exactly as they did before atmosphere existed.
    atmosphere: {
      skyTop: [0.31, 0.56, 0.81],
      skyHorizon: [0.78, 0.9, 1.0],
      skyGround: [0.54, 0.63, 0.71],
      sunColor: [1.0, 0.97, 0.91],
      sunIntensity: 2.6,
      hemiSky: [0.78, 0.9, 1.0],
      hemiGround: [0.42, 0.63, 0.29],
      hemiIntensity: 1.15,
      fogColor: [0.78, 0.9, 1.0],
      fogNear: 100,
      fogFar: 500,
    },
    colorVariance: 0,
  };
}
