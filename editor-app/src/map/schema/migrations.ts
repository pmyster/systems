/**
 * Map manifest migration scaffolding.
 *
 * Every load path calls `migrate(rawParsedJson)` BEFORE validating against
 * the current Zod schema. Migrations are pure functions that take raw JSON,
 * look at its `schemaVersion`, and return raw JSON shaped for the next
 * version. We compose them in `migrate()`. Inputs are never mutated.
 *
 * If `schemaVersion` is missing, we treat as v1 — early dev maps may not
 * have the field.
 *
 * v1 → v2:
 *   - Add `decals: []` (empty array — v1 maps had no decal authoring).
 *   - Add `terrain.splatmap` sidecar reference with default 128×128 dims
 *     (the load path will synthesize a default all-grass splatmap when no
 *     `splatmap.r8` bytes are present alongside the manifest).
 */

import {
  DEFAULT_SPLATMAP_HEIGHT_PX,
  DEFAULT_SPLATMAP_WIDTH_PX,
  MAP_SCHEMA_VERSION,
} from "./manifest";

interface AnyRecord {
  [k: string]: unknown;
}

function isObject(v: unknown): v is AnyRecord {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Migrate raw parsed JSON up to the current MAP_SCHEMA_VERSION.
 *
 * Returns the input unchanged when no migration is needed. Returns a new
 * object when migration is performed (never mutates the input).
 *
 * The caller is responsible for running Zod validation on the result.
 */
export function migrate(raw: unknown): unknown {
  if (!isObject(raw)) return raw;
  let cur = raw;
  // Treat missing schemaVersion as v1 (defensive — early dev maps).
  const version =
    typeof cur.schemaVersion === "number" ? cur.schemaVersion : 1;

  if (version < 2) {
    cur = migrateV1ToV2(cur);
  }

  // Future: if (cur.schemaVersion < 3) cur = migrateV2ToV3(cur); etc.
  void MAP_SCHEMA_VERSION;
  return cur;
}

/**
 * v1 → v2:
 *   - Bumps schemaVersion.
 *   - Adds `decals: []`.
 *   - Adds a default `terrain.splatmap` sidecar reference if missing.
 */
function migrateV1ToV2(v1: AnyRecord): AnyRecord {
  // Shallow-clone the top level + the terrain sub-object so we never
  // mutate the input. Everything else can keep its reference.
  const terrainRaw = isObject(v1.terrain) ? v1.terrain : {};
  // v1's TerrainRef had `splatmap: z.string().optional()`. v2 promotes it
  // to a structured ref. We always overwrite to the default v2 shape — if
  // a v1 user had only the string form, it never carried real data anyway.
  const nextTerrain: AnyRecord = {
    ...terrainRaw,
    splatmap: {
      sidecar: "splatmap.r8",
      widthPx: DEFAULT_SPLATMAP_WIDTH_PX,
      heightPx: DEFAULT_SPLATMAP_HEIGHT_PX,
    },
  };
  return {
    ...v1,
    schemaVersion: 2,
    terrain: nextTerrain,
    // Preserve any existing decals array if a future hand-edit added one;
    // otherwise default to empty (no decals authored in v1).
    decals: Array.isArray(v1.decals) ? v1.decals : [],
  };
}
