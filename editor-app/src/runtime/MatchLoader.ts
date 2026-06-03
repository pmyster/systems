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

import { join } from "@tauri-apps/api/path";

import { loadMapFromDir, type LoadedMap } from "./loader/mapLoader";
import {
  loadSchematicsByPaths,
  type LoadedSchematic,
} from "./loader/schematicLoader";
import { PrefabBank, meshAssetKey } from "./loader/prefabBank";
import { LoadDiagnostics } from "./loader/LoadDiagnostics";
import { initRapier } from "./physics/RuntimePhysics";
import { UnitTypeRegistry } from "./UnitTypeRegistry";
import { ProjectileRegistry } from "./ProjectileRegistry";
import { loadProjectile } from "../file-ops/projectile-ops";
import { isWeapon } from "../types/part";

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
  /**
   * Phase 1 Week 3 — projectile catalog discovered from every weapon
   * part's `projectile_id` field. The sim's projectileSpawnSystem and
   * impactSystem read this to get the authored physics; the in-flight
   * projectile entity carries only a numeric `ProjectileSchemaId`.
   *
   * Per-file load failures are logged + dropped (matches the schematic
   * load pattern). A weapon whose projectile_id failed to load cannot
   * fire — the weaponFireSystem skips it with a warn.
   */
  readonly projectileRegistry: ProjectileRegistry;
  /**
   * All warnings collected during the load — schematic parse failures,
   * prefab load failures, unknown mesh_asset kinds, MatchSpawner skips,
   * etc. The HUD reads this to surface a "Load warnings: N" chip so the
   * owner doesn't need to open the F12 dev console to learn why a unit
   * type silently produced zero entities. Per CLAUDE.md rule #1 (loud
   * over silent).
   */
  readonly diagnostics: LoadDiagnostics;
  /**
   * Count of distinct mesh-asset refs the loader ASKED the bank to
   * load (post-dedup). Surfaced in the HUD next to `schematics` and
   * `prefabBank.size()` so the owner can see the three numbers
   * line up — or NOT, in which case the HUD chip turns orange and
   * points at the discrepancy. Per CLAUDE.md rule #1: every gate
   * has a visible default. The triplet
   *   schematics : prefabsRequested : prefabsCached
   * IS that visible gate.
   */
  readonly prefabsRequested: number;
}

/** Absolute on-disk projectiles directory — mirrors WeaponSubform.tsx const. */
const PROJECTILES_DIR = "C:\\dev\\Strategy Game\\units\\projectiles";

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
    // Single diagnostics collector threaded through every phase. Every
    // layer that drops/skips data pushes here; the HUD reads it back.
    const diagnostics = new LoadDiagnostics();
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
    const schematics = await loadSchematicsByPaths(schematicPaths, diagnostics);
    if (schematics.length < schematicPaths.length) {
      // The collector already has per-file detail; surface the count
      // at the load-orchestrator level too so a glance at the warnings
      // chip shows the magnitude (e.g. "3 of 5 dropped").
      diagnostics.add({
        source: "MatchLoader",
        message: `${schematicPaths.length - schematics.length} of ${schematicPaths.length} schematics failed to load; see prior entries.`,
      });
    }
    onProgress({
      phase: "schematics",
      progress: 0.5,
      message: `Loaded ${schematics.length} of ${schematicPaths.length} unit Schematics`,
    });

    // -------- Phase 4: prefabs -------------------------------------------
    const prefabBank = new PrefabBank();
    prefabBank.setDiagnostics(diagnostics);
    // Dedup pass: collect unique mesh asset refs. Two tanks of the same
    // template share one cache entry; a player can pick "tank.json" twice
    // and only pay one buildGeometry() cost.
    const seenKeys = new Set<string>();
    const meshRefs: Array<{ unitId: string; ref: NonNullable<LoadedSchematic["unit"]["mesh_asset"]> }> = [];
    for (const s of schematics) {
      const ref = s.unit.mesh_asset;
      if (!ref) {
        // Unit without a mesh_asset can't render. Loud-over-silent: log
        // it in BOTH console (existing) AND diagnostics (HUD chip) so the
        // author knows to set the mesh before re-saving.
        diagnostics.add({
          source: "MatchLoader",
          message: `unit "${s.unit.id}" has no mesh_asset; cannot render — skipping prefab load.`,
        });
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
        // Push to diagnostics so the HUD chip shows the unit + cause.
        const msg = e instanceof Error ? e.message : String(e);
        diagnostics.add({
          source: "MatchLoader",
          message: `prefab for unit "${unitId}" (${meshAssetKey(ref)}) failed: ${msg}`,
          detail:
            e instanceof Error
              ? { name: e.name, message: e.message, stack: e.stack }
              : { value: String(e) },
        });
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

    // -------- Diagnose chassis mesh sub-mesh count ----------------------
    // Phase 1.5: the renderer now stamps an InstancedMesh per Mesh in
    // each prefab subtree (chassis hull + weapon-part barrels + accents).
    // A chassis prefab that decoded to ZERO Meshes is loud-over-silent: it
    // would render nothing despite the prefab "loading". A chassis prefab
    // that decoded to EXACTLY ONE Mesh is fine — single-mesh procedural
    // templates (the legacy tank/mech path) live in that regime. Walk every
    // cached prefab and push a diagnostic when the count is zero.
    //
    // For chassis prefabs that have hardpoints[] declared but the prefab
    // has only one Mesh, we ALSO push a diagnostic — the chassis was
    // authored with weapon mount points but no weapon geometry resolved
    // in the GLB, so the owner sees a "flat base" visual without barrels
    // and should re-export the GLB with the weapon parts included.
    //
    // The walk is over cached prefabs (not schematics) because the
    // template traversal is the source of truth for what the renderer
    // will actually see.
    for (const s of schematics) {
      const ref = s.unit.mesh_asset;
      if (!ref) continue;
      const cached = prefabBank.get(ref);
      if (!cached) continue; // prefab failed to load — already diagnosed
      let meshCount = 0;
      cached.traverse((o) => {
        // Three.js Mesh check via prototype string to keep this loader
        // free of a runtime three.js dep dance — the prefab subtree was
        // built by three.js so the property is always present.
        if ((o as { isMesh?: boolean }).isMesh === true) meshCount++;
      });
      if (meshCount === 0) {
        diagnostics.add({
          source: "MatchLoader",
          message: `unit "${s.unit.id}" prefab decoded with 0 mesh nodes; nothing will render even though the prefab loaded. Check the GLB export.`,
        });
      } else if (
        s.unit.hardpoints &&
        s.unit.hardpoints.length > 0 &&
        meshCount === 1
      ) {
        // The chassis has hardpoints but the prefab is a single mesh —
        // weapon-part geometry isn't in the GLB. The unit renders as a
        // flat base. Loud-over-silent: this is the exact bug Phase 1.5
        // was opened to fix at the runtime layer; for SCHEMA-side cases
        // (forgotten GLB re-export) it stays a warning so the owner sees
        // the cause→effect chain.
        diagnostics.add({
          source: "MatchLoader",
          message: `unit "${s.unit.id}" declares ${s.unit.hardpoints.length} hardpoint(s) but its chassis GLB decoded to a single mesh node — weapon-part geometry is missing from the GLB. Unit will render as a flat base with no visible barrels.`,
        });
      }
    }

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

    // -------- Discover + load projectiles --------------------------------
    // Walk every loaded unit's parts[]; every weapon with a projectile_id
    // gets enqueued for load. Dedup by id (multiple units may share one
    // projectile). One bad projectile file warns + drops — the weapon
    // using it simply can't fire.
    const projectileRegistry = new ProjectileRegistry();
    const projIdsToLoad = new Set<string>();
    for (const s of schematics) {
      for (const p of s.unit.parts ?? []) {
        if (!isWeapon(p)) continue;
        const pid = p.projectile_id;
        if (pid && pid.length > 0) projIdsToLoad.add(pid);
      }
    }
    if (projIdsToLoad.size > 0) {
      onProgress({
        phase: "prefabs",
        progress: 0.96,
        message: `Loading ${projIdsToLoad.size} projectile${projIdsToLoad.size === 1 ? "" : "s"}…`,
      });
      for (const pid of projIdsToLoad) {
        try {
          const path = await join(PROJECTILES_DIR, `${pid}.proj.json`);
          const proj = await loadProjectile(path);
          projectileRegistry.register(proj);
        } catch (e) {
          diagnostics.addFromError(
            "MatchLoader",
            `failed to load projectile "${pid}"`,
            e,
          );
        }
      }
    }

    // Final summary line for the dev console — gives a single
    // greppable "here's how the load went" entry alongside the
    // structured collector.
    if (diagnostics.hasAny()) {
      // eslint-disable-next-line no-console
      console.warn(
        `[MatchLoader] load completed with ${diagnostics.count()} warning(s). See "Load warnings" in the HUD or [load:*] entries above.`,
      );
    }

    // Loud HUD-visible accounting: if N schematics were registered but
    // 0 ended up in the bank, the triplet
    //   schematics : prefabsRequested : prefabsCached
    // will read e.g. "1 : 0 : 0" and the HUD chip turns orange. Emit a
    // structured warning if the post-dedup request count diverges from
    // the registered-schematic count — surfacing schema-shape silent
    // skips at the load-orchestrator altitude.
    if (schematics.length > 0 && meshRefs.length === 0) {
      diagnostics.add({
        source: "MatchLoader",
        message: `${schematics.length} schematic(s) registered but 0 prefab loads were requested — every unit has a missing/unsupported mesh_asset shape. Spawn will produce 0 entities.`,
      });
    }
    if (meshRefs.length > 0 && prefabBank.size() < meshRefs.length) {
      diagnostics.add({
        source: "MatchLoader",
        message: `prefab bank holds ${prefabBank.size()} of ${meshRefs.length} requested mesh(es) — see prior [load:prefabBank] entries for the underlying failures.`,
      });
    }

    onProgress({ phase: "ready", progress: 1.0, message: "Ready" });
    return {
      map,
      schematics,
      prefabBank,
      typeRegistry,
      projectileRegistry,
      diagnostics,
      prefabsRequested: meshRefs.length,
    };
  }
}
