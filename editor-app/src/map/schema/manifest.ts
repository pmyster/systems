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
export const MAP_SCHEMA_VERSION = 1 as const;

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

const TerrainRef = z.object({
  sidecar: z.literal("heightmap.r32"),
  widthPx: z.number().int().positive(),
  heightPx: z.number().int().positive(),
  tileSizeM: z.number().positive(),
  splatmap: z.string().optional(),
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
    },
    objects: [],
    spawnPoints: [],
  };
}
