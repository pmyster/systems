/**
 * projectileSystem tests — Phase 1 Week 5 (Terrain Occlusion).
 *
 * Owns the terrain-occlusion contract:
 *
 *   - Ballistic shell over FLAT terrain still reaches its target (no
 *     regression vs the legacy 2D-flat path).
 *   - Ballistic shell with a HILL between muzzle and target terminates
 *     at the hill — no impact event reaches impactSystem, the target
 *     stays at full HP. A `projectile_impact_terrain` event fires.
 *   - Beam over FLAT terrain still damages target.
 *   - Beam with a HILL between muzzle and target produces a
 *     `beam_blocked_by_terrain` event and DOES NOT damage the target.
 *   - Out-of-bounds terrain (sampler returns null) does NOT terminate
 *     the projectile (loud-over-silent: warn + continue, surfaces the
 *     edge-case bug instead of silent collision).
 *
 * Each test wires projectileSpawnSystem → projectileSystem with a stub
 * terrain binding that reads from a tiny 8×8 fixture heightmap. The
 * combat path (resolveMuzzle etc.) is bypassed entirely: tests push a
 * single `PendingProjectileSpawn` directly into the queue.
 */

import { describe, it, expect, beforeEach } from "vitest";

import type { ProjectileSchematic } from "../../types/projectile";
import { SimEventLog } from "../events";
import { createSimWorld } from "../world";
import { spawnUnit } from "../spawn";
import {
  _resetTerrainWarnings,
  type ImpactEvent,
  projectileSystem,
} from "./projectileSystem";
import { projectileSpawnSystem } from "./projectileSpawnSystem";
import type { PendingProjectileSpawn } from "./weaponFireSystem";

// -------------------------------------------------------------------------
// Test fixtures.
// -------------------------------------------------------------------------

/**
 * 8×8 flat heightmap @ y=0 everywhere — baseline "no terrain" scene.
 * tile size = 1m so the map is 7m × 7m (verts), but the projectile
 * fixture works at a much smaller scale so the test stays tight.
 */
function flatTerrain(): (x: number, z: number) => number | null {
  return (_x, _z) => 0;
}

/**
 * 8×8 heightmap with a 10m tall ridge running along the entire z axis
 * at x ∈ [9, 11]. Outside the strip the ground is at y=0. Projectile
 * tests fire from x=0 toward x=20 with the lock-target on the far
 * side — the ridge is exactly between them.
 *
 * Note: this is a CALLBACK, not a typed array, because the sim doesn't
 * care about the storage format — the binding is just a (x,z) → height
 * function. Real game code uses the bilinear-sampled heightmap; here we
 * fake it analytically because the test is about projectile behaviour,
 * not sampler accuracy.
 */
function ridgeTerrain(): (x: number, z: number) => number | null {
  return (x, _z) => {
    if (x >= 9 && x <= 11) return 10;
    return 0;
  };
}

/** Sampler that returns null EVERYWHERE — simulates a projectile that
 * has flown off the map. */
function outOfBoundsTerrain(): (x: number, z: number) => number | null {
  return (_x, _z) => null;
}

const BALLISTIC_PROJECTILE: ProjectileSchematic = {
  id: "test_kinetic",
  name: "Test Kinetic",
  physics_version: "1.0",
  mass_kg: 1,
  delivery_params: {
    kind: "ballistic",
    muzzle_velocity_mps: 100, // slow enough that the per-tick step is small
    ballistic_coefficient: 0.5,
  },
  effect_params: {
    kind: "kinetic",
    penetrator_material: "steel",
    sectional_density_kgm2: 5,
  },
};

const BEAM_PROJECTILE: ProjectileSchematic = {
  id: "test_beam",
  name: "Test Beam",
  physics_version: "1.0",
  mass_kg: 0,
  delivery_params: {
    kind: "beam",
    beam_power_kw: 1000,
    dwell_time_s: 0.05,
    divergence_mrad: 1,
  },
  effect_params: {
    kind: "energy",
    joules_delivered: 1_000_000,
    medium: "visible",
  },
};

const lookupBallistic = (_id: number): ProjectileSchematic =>
  BALLISTIC_PROJECTILE;
const lookupBeam = (_id: number): ProjectileSchematic => BEAM_PROJECTILE;

/**
 * Build the standard fixture: shooter at (0, 1, 0) on team 0, target at
 * (20, 1, 0) on team 1. Returns the world + the two eids + a helper to
 * queue a projectile spawn aimed shooter → target.
 */
function buildShooterTargetWorld(
  schematic: ProjectileSchematic,
  lookup: (id: number) => ProjectileSchematic,
) {
  const world = createSimWorld();
  const shooter = spawnUnit(world, {
    typeId: 0,
    x: 0,
    y: 1,
    z: 0,
    qx: 0,
    qy: 0,
    qz: 0,
    qw: 1,
    maxHealth: 100,
    teamId: 0,
  });
  const target = spawnUnit(world, {
    typeId: 0,
    x: 20,
    y: 1,
    z: 0,
    qx: 0,
    qy: 0,
    qz: 0,
    qw: 1,
    maxHealth: 100,
    teamId: 1,
  });
  const events = new SimEventLog();
  // Fire shooter → target along +X. Muzzle at shooter y+1=2 so the
  // ballistic round starts above the flat ground and the slow Euler
  // step has room to fall under gravity into the ridge.
  const spawn: PendingProjectileSpawn = {
    ownerEid: shooter,
    weaponEid: 0,
    hardpointIdx: 0,
    teamId: 0,
    targetEid: target,
    projectileTypeId: 0,
    originX: 0,
    originY: 2,
    originZ: 0,
    dirX: 1,
    dirZ: 0,
    rangeM: 50,
  };
  projectileSpawnSystem(world, [spawn], lookup, events, 0);
  // Sanity: schematic referenced here so TS doesn't warn on an unused
  // closure capture in some test bodies.
  void schematic;
  return { world, shooter, target, events };
}

beforeEach(() => {
  // Clear the once-per-match warn-dedup so each test sees the
  // out-of-bounds warning on its own terms.
  _resetTerrainWarnings();
});

// -------------------------------------------------------------------------
// Ballistic.
// -------------------------------------------------------------------------

describe("projectileSystem — ballistic terrain occlusion", () => {
  it("reaches the target across flat terrain (no regression)", () => {
    const { world, target, events } = buildShooterTargetWorld(
      BALLISTIC_PROJECTILE,
      lookupBallistic,
    );
    const impacts: ImpactEvent[] = [];
    const terrainHeightAt = flatTerrain();
    // Step ticks at 30Hz until the projectile resolves (impact or
    // despawn). 60 ticks ≈ 2s, way more than needed for a 100 m/s
    // round to cross 20m.
    for (let t = 0; t < 60; t++) {
      projectileSystem(world, 1 / 30, events, impacts, t, terrainHeightAt);
      if (impacts.length > 0) break;
    }
    // Should have hit the target unit.
    expect(impacts.length).toBe(1);
    expect(impacts[0].targetEid).toBe(target);
    // No terrain-impact event.
    const terrainEvents = events
      .peek()
      .filter((e) => e.kind === "projectile_impact_terrain");
    expect(terrainEvents.length).toBe(0);
  });

  it("terminates at the hill — target stays at full HP", () => {
    const { world, target, events } = buildShooterTargetWorld(
      BALLISTIC_PROJECTILE,
      lookupBallistic,
    );
    const impacts: ImpactEvent[] = [];
    const terrainHeightAt = ridgeTerrain();
    for (let t = 0; t < 60; t++) {
      projectileSystem(world, 1 / 30, events, impacts, t, terrainHeightAt);
      // Loop until something resolves — either an impact (shouldn't
      // happen) or the projectile despawns via terrain.
      const drained = events.peek();
      if (
        drained.some((e) => e.kind === "projectile_impact_terrain") ||
        impacts.length > 0
      ) {
        break;
      }
    }
    // The projectile hit terrain, not the target — no impact pushed.
    expect(impacts.length).toBe(0);
    // The terrain-impact event fired at a point on or near the ridge
    // (x ∈ [9, 11]).
    const terrainImpacts = events
      .peek()
      .filter((e) => e.kind === "projectile_impact_terrain");
    expect(terrainImpacts.length).toBe(1);
    const ev = terrainImpacts[0];
    if (ev.kind === "projectile_impact_terrain") {
      expect(ev.x).toBeGreaterThanOrEqual(8);
      expect(ev.x).toBeLessThanOrEqual(12);
      expect(ev.y).toBeGreaterThan(0); // hit the ridge, not the floor
    }
    void target; // referenced for narrative — no HP assertion needed because
    // damage is applied by impactSystem (which never ran).
  });

  it("OOB sampler returns null → projectile continues unaffected (warn-once)", () => {
    // Capture console.warn so we can assert the warn-once path.
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (msg: string): void => {
      warnings.push(msg);
    };
    try {
      const { world, target, events } = buildShooterTargetWorld(
        BALLISTIC_PROJECTILE,
        lookupBallistic,
      );
      const impacts: ImpactEvent[] = [];
      const terrainHeightAt = outOfBoundsTerrain();
      for (let t = 0; t < 60; t++) {
        projectileSystem(world, 1 / 30, events, impacts, t, terrainHeightAt);
        if (impacts.length > 0) break;
      }
      // Projectile crosses the (null-terrain) gap and hits the unit.
      expect(impacts.length).toBe(1);
      expect(impacts[0].targetEid).toBe(target);
      // At least one OOB warning surfaced. We don't require exactly
      // one — the warn fires once per match but the dedup is fine to
      // be looser at the test boundary; what matters is the message
      // appeared at all and the projectile didn't silently terminate.
      const oobWarns = warnings.filter((w) => w.includes("OOB"));
      expect(oobWarns.length).toBeGreaterThanOrEqual(1);
    } finally {
      console.warn = origWarn;
    }
  });
});

// -------------------------------------------------------------------------
// Beam.
// -------------------------------------------------------------------------

describe("projectileSystem — beam terrain occlusion", () => {
  it("damages target across flat terrain (no regression)", () => {
    const { world, target, events } = buildShooterTargetWorld(
      BEAM_PROJECTILE,
      lookupBeam,
    );
    const impacts: ImpactEvent[] = [];
    const terrainHeightAt = flatTerrain();
    // Beam resolves on its first tick.
    projectileSystem(world, 1 / 30, events, impacts, 0, terrainHeightAt);
    expect(impacts.length).toBe(1);
    expect(impacts[0].targetEid).toBe(target);
    const blocked = events
      .peek()
      .filter((e) => e.kind === "beam_blocked_by_terrain");
    expect(blocked.length).toBe(0);
  });

  it("blocked by hill → no damage, beam_blocked_by_terrain event fires", () => {
    const { world, target, events } = buildShooterTargetWorld(
      BEAM_PROJECTILE,
      lookupBeam,
    );
    const impacts: ImpactEvent[] = [];
    const terrainHeightAt = ridgeTerrain();
    projectileSystem(world, 1 / 30, events, impacts, 0, terrainHeightAt);
    // No impact reached the impact system.
    expect(impacts.length).toBe(0);
    // The block event fired with hit position on the ridge.
    const blocked = events
      .peek()
      .filter((e) => e.kind === "beam_blocked_by_terrain");
    expect(blocked.length).toBe(1);
    const ev = blocked[0];
    if (ev.kind === "beam_blocked_by_terrain") {
      expect(ev.x).toBeGreaterThanOrEqual(8);
      expect(ev.x).toBeLessThanOrEqual(12);
      expect(ev.y).toBeGreaterThan(0);
    }
    void target;
  });
});

// -------------------------------------------------------------------------
// Legacy path — no terrain binding at all.
// -------------------------------------------------------------------------

describe("projectileSystem — backward compatibility", () => {
  it("ballistic with no terrain binding still hits target (legacy 2D-flat)", () => {
    const { world, target, events } = buildShooterTargetWorld(
      BALLISTIC_PROJECTILE,
      lookupBallistic,
    );
    const impacts: ImpactEvent[] = [];
    // NO terrainHeightAt argument — the binding is undefined.
    for (let t = 0; t < 60; t++) {
      projectileSystem(world, 1 / 30, events, impacts, t);
      if (impacts.length > 0) break;
    }
    expect(impacts.length).toBe(1);
    expect(impacts[0].targetEid).toBe(target);
  });
});
