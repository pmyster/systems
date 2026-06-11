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
 *
 * v2 → v3:
 *   - Add `elevationProfile` + `splatToElevationMix` synthesized from the
 *     Grassland defaults (the safe legacy-looking gradient — green plains,
 *     no snow at peak, splatmap-dominant). Anyone whose old map looked
 *     grassland-ish will get an identical render after migration.
 */

import {
  DEFAULT_COLOR_PAINT_HEIGHT_PX,
  DEFAULT_COLOR_PAINT_WIDTH_PX,
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
  // Re-read schemaVersion after each step; intermediate migrations
  // mutate it so the next gate compares against the post-step value.
  const v2 =
    typeof cur.schemaVersion === "number" ? cur.schemaVersion : version;
  if (v2 < 3) {
    cur = migrateV2ToV3(cur);
  }
  const v3 =
    typeof cur.schemaVersion === "number" ? cur.schemaVersion : version;
  if (v3 < 4) {
    cur = migrateV3ToV4(cur);
  }
  const v4 =
    typeof cur.schemaVersion === "number" ? cur.schemaVersion : version;
  if (v4 < 5) {
    cur = migrateV4ToV5(cur);
  }

  void MAP_SCHEMA_VERSION;
  return cur;
}

/**
 * v1 → v2:
 *   - Bumps schemaVersion.
 *   - Adds `decals: []`.
 *   - Adds a default `terrain.splatmap` sidecar reference if missing.
 */
/**
 * v2 → v3:
 *   - Bumps schemaVersion.
 *   - Synthesizes `elevationProfile` + `splatToElevationMix` using
 *     Grassland defaults (legacy-equivalent green plains gradient with
 *     splatmap-dominant mix). Pre-existing fields are preserved if the
 *     manifest already carried them (forward-compat with hand-edits).
 *
 *   Kept in sync with `DEFAULT_ELEVATION_PROFILE` / `DEFAULT_SPLAT_TO_ELEVATION_MIX`
 *   in `../scene/biomes.ts` — values inlined here to keep the migrations
 *   module free of scene-layer imports.
 */
/**
 * v3 → v4:
 *   - Bumps schemaVersion.
 *   - Synthesizes `atmosphere` (sky/sun/hemi/fog) using the legacy
 *     hardcoded daylight rig so pre-v4 maps render identically post-
 *     migration.
 *   - Synthesizes `colorVariance: 0` so no procedural tint variation is
 *     applied to legacy maps.
 *
 *   Kept in sync with `DEFAULT_ATMOSPHERE` / `DEFAULT_COLOR_VARIANCE` in
 *   `../scene/biomes.ts` — values inlined to keep the migrations module
 *   free of scene-layer imports.
 */
/**
 * v4 → v5:
 *   - Bumps schemaVersion.
 *   - Synthesises a default `terrain.colorPaint` sidecar reference
 *     (128×128). The actual `colorpaint.r8` bytes file is allowed to be
 *     absent on disk — the JS load path synthesises an all-zero buffer
 *     (no painted color anywhere) so existing maps look identical
 *     post-migration.
 */
function migrateV4ToV5(v4: AnyRecord): AnyRecord {
  const out: AnyRecord = { ...v4, schemaVersion: 5 };
  const terrainRaw = isObject(out.terrain) ? out.terrain : {};
  // Only synthesise the colorPaint ref when absent so hand-edited
  // pre-v5 manifests carrying a custom dim survive the migration.
  if (!isObject(terrainRaw.colorPaint)) {
    out.terrain = {
      ...terrainRaw,
      colorPaint: {
        sidecar: "colorpaint.r8",
        widthPx: DEFAULT_COLOR_PAINT_WIDTH_PX,
        heightPx: DEFAULT_COLOR_PAINT_HEIGHT_PX,
      },
    };
  }
  return out;
}

function migrateV3ToV4(v3: AnyRecord): AnyRecord {
  const out: AnyRecord = { ...v3, schemaVersion: 4 };
  if (out.atmosphere === undefined) {
    out.atmosphere = {
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
    };
  }
  if (out.colorVariance === undefined) {
    out.colorVariance = 0;
  }
  return out;
}

function migrateV2ToV3(v2: AnyRecord): AnyRecord {
  const out: AnyRecord = { ...v2, schemaVersion: 3 };
  if (out.elevationProfile === undefined) {
    out.elevationProfile = {
      mid: [0.35, 0.55, 0.22],
      high: [0.45, 0.55, 0.3],
      peak: [0.55, 0.55, 0.4],
    };
  }
  if (out.splatToElevationMix === undefined) {
    out.splatToElevationMix = 0.75;
  }
  return out;
}

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
