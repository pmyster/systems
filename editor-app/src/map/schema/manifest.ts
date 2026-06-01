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
export const MAP_SCHEMA_VERSION = 2 as const;

/** Default splatmap dimensions in pixels (square, ~1 sample per meter at 128m map). */
export const DEFAULT_SPLATMAP_WIDTH_PX = 128 as const;
export const DEFAULT_SPLATMAP_HEIGHT_PX = 128 as const;

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

const TerrainRef = z.object({
  sidecar: z.literal("heightmap.r32"),
  widthPx: z.number().int().positive(),
  heightPx: z.number().int().positive(),
  tileSizeM: z.number().positive(),
  splatmap: SplatmapRef.optional(),
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
    },
    objects: [],
    spawnPoints: [],
    decals: [],
  };
}
