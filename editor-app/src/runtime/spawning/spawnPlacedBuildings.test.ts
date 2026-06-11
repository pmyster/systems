/**
 * spawnPlacedBuildings — Phase 2 Stage 1 integration tests.
 *
 * We don't mount a Three.js scene; we feed minimal in-memory
 * registries + a fake renderer + a fake prefab bank to exercise the
 * spawn path's component-stamping logic.
 *
 * Coverage:
 *   - Buildings spawn at the authored (x, z) per placement (not in the
 *     team-cluster grid).
 *   - AA towers get AAFiringArc with the expected pitch.
 *   - Bunkers get BunkerHealRange with the expected radius + heal.
 *   - Walls get WallNoFire tag.
 *   - Walls do NOT spawn weapon-instance entities.
 *   - MovementSpeed is removed (buildings don't move).
 *   - No-schematic placements push a diagnostic (loud-over-silent).
 */

import { describe, it, expect } from "vitest";
import { hasComponent, query } from "bitecs";
import * as THREE from "three";

import {
  AAFiringArc,
  BunkerHealRange,
  MovementSpeed,
  Position,
  TeamId,
  WallNoFire,
  WeaponInstanceTag,
  createSimWorld,
} from "../../sim/world";
import { spawnPlacedBuildings } from "./MatchSpawner";
import { UnitTypeRegistry } from "../UnitTypeRegistry";
import { ProjectileRegistry } from "../ProjectileRegistry";
import { PrefabBank } from "../loader/prefabBank";
import { InstancedUnitRenderer } from "../scene/InstancedUnitRenderer";
import { LoadDiagnostics } from "../loader/LoadDiagnostics";
import type { LoadedSchematic } from "../loader/schematicLoader";
import type { UnitSchematic, BuildingChassisClass } from "../../types/unit";
import type { BuildingPlacement } from "../BuildingPlacement";

// ---------------------------------------------------------------------------
// Minimal building schematic factory — bypasses Zod for test brevity.
// ---------------------------------------------------------------------------

function makeBuildingSchematic(
  id: string,
  chassis: BuildingChassisClass,
  withHardpoint = false,
): UnitSchematic {
  return {
    kind: "unit",
    id,
    physics_version: "1.0",
    name: id,
    chassis: {
      chassis_class: chassis,
      mass_kg: 10000,
      engine_kW: 0,
      drivetrain_efficiency: 0,
    },
    parts: withHardpoint
      ? [
          {
            id: "test_weapon",
            name: "Test",
            mass_kg: 10,
            power_draw_kW: 1,
            category: "weapon",
            weapon_type: "kinetic",
            propellant_energy_MJ: 1,
            projectile_mass_kg: 1,
            barrel_thermal_capacity_MJ: 50,
            per_shot_heat_MJ: 1,
            cooling_rate_MJs: 1,
            drag_coefficient: 0.3,
            elevation_range_deg: [-10, 30],
          },
        ]
      : [],
    mesh_asset: {
      kind: "procedural_building",
      building_chassis: chassis,
    },
    hardpoints: withHardpoint
      ? [
          {
            id: "hp_test",
            parent_rig_id: null,
            local_position: [0, 1, 0],
            local_quaternion: [0, 0, 0, 1],
            weapon_part_id: "test_weapon",
          },
        ]
      : [],
    vulnerability: {
      armor_zones: {
        front: { thickness_mm: 100, material: "composite" },
        side: { thickness_mm: 100, material: "composite" },
        rear: { thickness_mm: 100, material: "composite" },
        top: { thickness_mm: 100, material: "composite" },
      },
      electronics: [],
      crew: { count: 0, exposure: "sealed" },
      thermal_dissipation_kws: 10,
      mobility_redundancy: 1.0,
      structural_integrity_mj: 10,
    },
  };
}

function setupFixture(schematics: UnitSchematic[]): {
  registry: UnitTypeRegistry;
  prefabBank: PrefabBank;
  renderer: InstancedUnitRenderer;
  loaded: readonly LoadedSchematic[];
} {
  const registry = new UnitTypeRegistry();
  for (const s of schematics) registry.register(s);
  const prefabBank = new PrefabBank();
  // Pre-stamp the bank with a stub mesh so MatchSpawner's `prefabBank.get`
  // returns truthy. The renderer's register accepts any Object3D with a
  // child Mesh.
  for (const s of schematics) {
    const stub = new THREE.Group();
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial(),
    );
    stub.add(mesh);
    // Reach into the bank's cache via a public load() — but we need it
    // synchronous for the test. The simplest path is to use a custom
    // PrefabBank subclass; here we monkey-patch a `get` to return the
    // stub.
    const key = `procedural_building:${s.chassis.chassis_class}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prefabBank as any).cache.set(key, stub);
  }
  const renderer = new InstancedUnitRenderer();
  const loaded: LoadedSchematic[] = schematics.map((s) => ({
    path: `/fake/${s.id}.json`,
    unit: s,
  }));
  return { registry, prefabBank, renderer, loaded };
}

const heightAt = (_x: number, _z: number): number => 0;

describe("spawnPlacedBuildings", () => {
  it("spawns a turret at the authored position with the authored faction", () => {
    const s = makeBuildingSchematic("turret_t", "building_turret", true);
    const { registry, prefabBank, renderer, loaded } = setupFixture([s]);
    const world = createSimWorld();
    const placements: BuildingPlacement[] = [
      {
        chassis_class: "building_turret",
        position_xz: [42, 17],
        rotation_y: 0,
        faction: 1,
      },
    ];
    const projectileRegistry = new ProjectileRegistry();

    const count = spawnPlacedBuildings(
      world,
      registry,
      prefabBank,
      renderer,
      placements,
      heightAt,
      loaded,
      projectileRegistry,
    );

    expect(count).toBe(1);
    // Find the one non-weapon-instance entity that has a Position.
    const eids = query(world, [Position, TeamId]);
    expect(eids.length).toBeGreaterThan(0);
    const buildingEid = eids.find((e) => !hasComponent(world, e, WeaponInstanceTag));
    expect(buildingEid).toBeDefined();
    if (buildingEid !== undefined) {
      expect(Position.x[buildingEid]).toBeCloseTo(42);
      expect(Position.z[buildingEid]).toBeCloseTo(17);
      expect(TeamId.value[buildingEid]).toBe(1);
    }
  });

  it("removes MovementSpeed so buildings don't move", () => {
    const s = makeBuildingSchematic("wall_w", "building_wall");
    const { registry, prefabBank, renderer, loaded } = setupFixture([s]);
    const world = createSimWorld();
    const placements: BuildingPlacement[] = [
      {
        chassis_class: "building_wall",
        position_xz: [5, 5],
        rotation_y: 0,
        faction: 0,
      },
    ];
    spawnPlacedBuildings(
      world,
      registry,
      prefabBank,
      renderer,
      placements,
      heightAt,
      loaded,
      new ProjectileRegistry(),
    );
    const buildings = query(world, [Position, TeamId]);
    const eid = buildings[0];
    expect(hasComponent(world, eid, MovementSpeed)).toBe(false);
  });

  it("stamps AAFiringArc on AA towers", () => {
    const s = makeBuildingSchematic("aa_test", "building_aa", true);
    const { registry, prefabBank, renderer, loaded } = setupFixture([s]);
    const world = createSimWorld();
    spawnPlacedBuildings(
      world,
      registry,
      prefabBank,
      renderer,
      [{
        chassis_class: "building_aa",
        position_xz: [0, 0],
        rotation_y: 0,
        faction: 0,
      }],
      heightAt,
      loaded,
      new ProjectileRegistry(),
    );
    const ents = query(world, [Position, TeamId]);
    const aa = ents.find((e) => hasComponent(world, e, AAFiringArc));
    expect(aa).toBeDefined();
    if (aa !== undefined) {
      expect(AAFiringArc.pitchMinRad[aa]).toBeGreaterThan(0);
    }
  });

  it("stamps BunkerHealRange on bunkers with the documented defaults", () => {
    const s = makeBuildingSchematic("bunker_b", "building_bunker");
    const { registry, prefabBank, renderer, loaded } = setupFixture([s]);
    const world = createSimWorld();
    spawnPlacedBuildings(
      world,
      registry,
      prefabBank,
      renderer,
      [{
        chassis_class: "building_bunker",
        position_xz: [0, 0],
        rotation_y: 0,
        faction: 0,
      }],
      heightAt,
      loaded,
      new ProjectileRegistry(),
    );
    const ents = query(world, [Position, TeamId]);
    const bunker = ents.find((e) => hasComponent(world, e, BunkerHealRange));
    expect(bunker).toBeDefined();
    if (bunker !== undefined) {
      expect(BunkerHealRange.radiusM[bunker]).toBeCloseTo(12);
      expect(BunkerHealRange.healPerTickMj[bunker]).toBeCloseTo(1);
    }
  });

  it("stamps WallNoFire tag on walls and does NOT spawn weapon instances", () => {
    const s = makeBuildingSchematic("wall_test", "building_wall");
    const { registry, prefabBank, renderer, loaded } = setupFixture([s]);
    const world = createSimWorld();
    spawnPlacedBuildings(
      world,
      registry,
      prefabBank,
      renderer,
      [{
        chassis_class: "building_wall",
        position_xz: [0, 0],
        rotation_y: 0,
        faction: 0,
      }],
      heightAt,
      loaded,
      new ProjectileRegistry(),
    );
    const ents = query(world, [Position, TeamId]);
    const wall = ents.find((e) => hasComponent(world, e, WallNoFire));
    expect(wall).toBeDefined();
    // No WeaponInstanceTag entities exist in this world.
    const weapons = query(world, [WeaponInstanceTag]);
    expect(weapons.length).toBe(0);
  });

  it("pushes a diagnostic for placements with no matching schematic", () => {
    const { registry, prefabBank, renderer } = setupFixture([]);
    const diagnostics = new LoadDiagnostics();
    const world = createSimWorld();

    const count = spawnPlacedBuildings(
      world,
      registry,
      prefabBank,
      renderer,
      [{
        chassis_class: "building_turret",
        position_xz: [0, 0],
        rotation_y: 0,
        faction: 0,
      }],
      heightAt,
      [],
      new ProjectileRegistry(),
      diagnostics,
    );

    expect(count).toBe(0);
    expect(diagnostics.count()).toBeGreaterThan(0);
  });

  it("warns once about AA + no flying targets via diagnostics", () => {
    const s = makeBuildingSchematic("aa_x", "building_aa", true);
    const { registry, prefabBank, renderer, loaded } = setupFixture([s]);
    const diagnostics = new LoadDiagnostics();
    const world = createSimWorld();

    spawnPlacedBuildings(
      world,
      registry,
      prefabBank,
      renderer,
      [{
        chassis_class: "building_aa",
        position_xz: [0, 0],
        rotation_y: 0,
        faction: 0,
      }],
      heightAt,
      loaded,
      new ProjectileRegistry(),
      diagnostics,
    );

    // At least the AA-idle-by-design diagnostic.
    expect(
      diagnostics.all().some((d) => d.message.includes("AA tower")),
    ).toBe(true);
  });

  it("returns 0 for an empty placements list", () => {
    const { registry, prefabBank, renderer, loaded } = setupFixture([]);
    const world = createSimWorld();
    const count = spawnPlacedBuildings(
      world,
      registry,
      prefabBank,
      renderer,
      [],
      heightAt,
      loaded,
      new ProjectileRegistry(),
    );
    expect(count).toBe(0);
  });
});
