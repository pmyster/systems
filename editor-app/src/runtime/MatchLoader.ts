/**
 * MatchLoader — Phase 1 Week 1B
 *
 * 5-phase load orchestrator. Drives the progress bar in MatchSetupScreen,
 * sequences IO + parse + GLB-decode so the user sees motion the entire
 * time, and returns one MatchData bundle the runtime mounts.
 *
 *   Phase 1 — manifest:    read + Zod-validate the map's manifest.json
 *   Phase 2 — terrain:     hand off the LoadedMap (mesh + collider build at
 *                          mount time; this phase just acknowledges the data
 *                          is parsed and ready)
 *   Phase 3 — schematics:  load + Zod-validate every picked unit JSON
 *   Phase 4 — prefabs:     dedup-load every distinct mesh_asset referenced
 *                          by the schematics into the PrefabBank
 *   Phase 5 — audio:       placeholder (returns immediately; brief calls
 *                          this out as v1-deferred)
 *
 * The progress bar is the proof the pipeline works end-to-end. A user can
 * pick the largest map and dozens of unit types and watch the loader walk
 * through every step — any silent failure surfaces as a frozen bar.
 *
 * NOTE: Rapier init also happens here. It's a one-shot async warm-up;
 * doing it inside the loader keeps every other module synchronously usable
 * once a load has succeeded.
 */

import { loadMapFromDir, type LoadedMap } from "./loader/mapLoader";
import {
  loadSchematicsByPaths,
  type LoadedSchematic,
} from "./loader/schematicLoader";
import { PrefabBank, meshAssetKey } from "./loader/prefabBank";
import { initRapier } from "./physics/RuntimePhysics";
import { UnitTypeRegistry } from "./UnitTypeRegistry";

export type LoadPhase =
  | "manifest"
  | "terrain"
  | "schematics"
  | "prefabs"
  | "audio"
  | "ready";

export interface LoadProgress {
  readonly phase: LoadPhase;
  /** 0..1 overall progress across all phases. */
  readonly progress: number;
  /** Optional human-readable message for the progress bar. */
  readonly message?: string;
}

export interface MatchData {
  readonly map: LoadedMap;
  readonly schematics: readonly LoadedSchematic[];
  readonly prefabBank: PrefabBank;
  /**
   * Authored-id → numeric-typeId catalog, built from every successfully
   * loaded schematic. The spawner reads this to know which prefabs to
   * register with the InstancedUnitRenderer and what max-health to seed
   * Health components with.
   */
  readonly typeRegistry: UnitTypeRegistry;
}

export class MatchLoader {
  /**
   * Run the 5-phase load. Throws on map-load failure (the manifest is the
   * one strict gate — if it fails, the match has no terrain). Per-schematic
   * and per-prefab failures are logged + dropped so one broken unit type
   * doesn't kill the whole match.
   */
  async load(
    mapDir: string,
    schematicPaths: readonly string[],
    onProgress: (p: LoadProgress) => void,
  ): Promise<MatchData> {
    // -------- Phase 1: manifest -------------------------------------------
    onProgress({ phase: "manifest", progress: 0.0, message: "Loading map manifest…" });
    const map = await loadMapFromDir(mapDir);
    onProgress({ phase: "manifest", progress: 0.1, message: `Loaded ${map.manifest.name}` });

    // Warm up Rapier in parallel with the next phases. The mount-time
    // RuntimePhysics constructor awaits the same promise so by the time it
    // needs Rapier, init is done.
    const rapierWarmup = initRapier();

    // -------- Phase 2: terrain -------------------------------------------
    // Heightmap is already decoded in `map.heightmap`. The actual
    // RuntimeTerrain mesh and RuntimePhysics heightfield are built at mount
    // time by the React shell (they need a renderer/scene to live in). This
    // phase exists in the bar so the user sees progress; the work is
    // trivial (already done in phase 1).
    onProgress({
      phase: "terrain",
      progress: 0.2,
      message: `Terrain ${map.manifest.terrain.widthPx}×${map.manifest.terrain.heightPx}`,
    });

    // -------- Phase 3: schematics ----------------------------------------
    onProgress({
      phase: "schematics",
      progress: 0.3,
      message: `Loading ${schematicPaths.length} unit Schematic${schematicPaths.length === 1 ? "" : "s"}…`,
    });
    const schematics = await loadSchematicsByPaths(schematicPaths);
    onProgress({
      phase: "schematics",
      progress: 0.5,
      message: `Loaded ${schematics.length} of ${schematicPaths.length} unit Schematics`,
    });

    // -------- Phase 4: prefabs -------------------------------------------
    const prefabBank = new PrefabBank();
    // Dedup pass: collect unique mesh asset refs. Two tanks of the same
    // template share one cache entry; a player can pick "tank.json" twice
    // and only pay one buildGeometry() cost.
    const seenKeys = new Set<string>();
    const meshRefs: Array<{ unitId: string; ref: NonNullable<LoadedSchematic["unit"]["mesh_asset"]> }> = [];
    for (const s of schematics) {
      const ref = s.unit.mesh_asset;
      if (!ref) {
        // Unit without a mesh_asset can't render. Loud-over-silent: log it
        // so the author knows to set the mesh before re-saving.
        console.warn(
          `[MatchLoader] unit "${s.unit.id}" has no mesh_asset; it cannot render. Skipping prefab load.`,
        );
        continue;
      }
      const key = meshAssetKey(ref);
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      meshRefs.push({ unitId: s.unit.id, ref });
    }

    onProgress({
      phase: "prefabs",
      progress: 0.55,
      message: `Loading ${meshRefs.length} unique prefab mesh${meshRefs.length === 1 ? "" : "es"}…`,
    });
    let loaded = 0;
    for (const { unitId, ref } of meshRefs) {
      try {
        await prefabBank.load(ref);
      } catch (e) {
        // Per-prefab isolation: one failed GLB doesn't kill the load.
        console.warn(
          `[MatchLoader] prefab for unit "${unitId}" (${meshAssetKey(ref)}) failed:`,
          e,
        );
      }
      loaded++;
      const fraction = meshRefs.length > 0 ? loaded / meshRefs.length : 1;
      onProgress({
        phase: "prefabs",
        progress: 0.55 + 0.4 * fraction,
        message: `Prefabs ${loaded}/${meshRefs.length}`,
      });
    }

    // -------- Phase 5: audio (placeholder) -------------------------------
    onProgress({
      phase: "audio",
      progress: 0.97,
      message: "Audio (placeholder)",
    });
    // No-op for v1 per brief; sound design lands in a later phase.

    // Make sure Rapier finished initialising before we hand back to the
    // caller — Week 1C wants to construct RuntimePhysics synchronously
    // after this returns.
    await rapierWarmup;

    // -------- Build the UnitTypeRegistry ---------------------------------
    // After every prefab attempt is done, materialise the catalog. We
    // register EVERY successfully-loaded schematic (even ones whose
    // prefab failed to load) — the spawner will skip non-renderable
    // entries with a clear log line. Keeping them in the registry means
    // future systems (selection UI, debug overlays) can still see them.
    const typeRegistry = new UnitTypeRegistry();
    for (const s of schematics) {
      typeRegistry.register(s.unit);
    }

    onProgress({ phase: "ready", progress: 1.0, message: "Ready" });
    return { map, schematics, prefabBank, typeRegistry };
  }
}
