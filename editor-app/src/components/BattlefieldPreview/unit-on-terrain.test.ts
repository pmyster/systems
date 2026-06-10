/**
 * Tests for unit-on-terrain.ts — specifically the grounding behaviour that
 * keeps a unit's lowest vertex sitting on the terrain anchor regardless of
 * how the mesh was authored or scaled.
 *
 * The owner reported a "unit floats above terrain in Battlefield Preview"
 * bug whose root cause is the same class of issue the runtime fixed in
 * commit 73d5043 (prefab `root.position` not multiplied by UNIT_RENDER_SCALE).
 * The fix here is bbox-driven: measure the post-scale world bbox and shift
 * the object's position so its lowest vertex lands at y=0 in its parent's
 * local frame.
 *
 * We can't easily reach into the closure-scoped `groundObject3DToParentBase`
 * without exposing it, so instead we test the OBSERVABLE post-condition:
 * after the slot mounts a mesh-first unit with a scale offset, the world
 * bbox of the slot's parent group has min.y === 0 (matching the terrain
 * anchor at y=0).
 */

import { describe, it, expect } from "vitest";
import * as THREE from "three";

import { createUnitOnTerrain } from "./unit-on-terrain";
import type { TerrainHandle } from "./terrain";
import type { UnitSchematic } from "../../types";

/**
 * Stand-in terrain: flat at the owner-supplied height. Lets the test pin the
 * anchor wherever it wants so the assertions don't depend on the real
 * procedural noise stack.
 */
function makeFlatTerrain(height: number): TerrainHandle {
  const geometry = new THREE.PlaneGeometry(1, 1);
  const material = new THREE.MeshStandardMaterial();
  const mesh = new THREE.Mesh(geometry, material);
  return {
    mesh,
    geometry,
    material,
    getHeight: () => height,
  };
}

/**
 * Build a deterministic test-only "mesh" that simulates a GLB with bbox
 * extending y=`bottomY`..y=`topY` and the mesh-loader's grounding offset
 * baked into the group's position (so it'd sit at y=0 at scale=1, but
 * float above when scaled).
 *
 * The geometry is a unit cube at the origin; the mesh's local position
 * shifts it so its bottom is at y=`bottomY`. The group's own position is
 * `(-0, -bottomY, -0)` — the mesh-loader's grounding convention.
 *
 * This reproduces the exact float-bug pattern: at scale=1 the cancellation
 * works (group.y + bottomY = 0); at any other scale it drifts.
 */
function makeMeshSource(bottomY: number, topY: number): THREE.Group {
  const height = topY - bottomY;
  const geom = new THREE.BoxGeometry(2, height, 2);
  const mat = new THREE.MeshStandardMaterial();
  const mesh = new THREE.Mesh(geom, mat);
  // Place mesh so its centre is at y = (bottomY + topY)/2 in group-local
  // coords. The box geometry is centred on its own origin, so the mesh's
  // local position is the bbox centre.
  mesh.position.set(0, (bottomY + topY) / 2, 0);

  const group = new THREE.Group();
  group.add(mesh);
  // Mesh-loader convention: group's position offsets the mesh down so its
  // floor sits at y=0 at scale=1.
  group.position.set(0, -bottomY, 0);
  // Mimic the userData the loader attaches so length-based scaling works.
  group.userData.normalizedSizeM = 8;
  group.userData.normalizeScale = 1;
  return group;
}

/** Bare-minimum UnitSchematic the slot reads — fields not under test are stubbed. */
function makeUnit(overrides: Partial<UnitSchematic> = {}): UnitSchematic {
  return {
    kind: "unit",
    id: "test_unit",
    physics_version: "1.0",
    name: "Test Unit",
    chassis: {
      chassis_class: "static_structure",
      mass_kg: 1000,
      engine_kW: 0,
      drivetrain_efficiency: 0,
      energy_source: "internal",
      battery_capacity_MJ: 0,
      battery_recharge_rate_MJs: 0,
      armor_thickness_mm: 50,
      armor_material: "steel",
      hardpoint_count: 0,
      compatibility_tags: [],
      thermal_capacity_MJ: 0,
      hardpoints: [],
      hardpoint_units_version: "world_m",
    },
    parts: [],
    rig: [],
    hardpoints: [],
    vulnerability: {
      armor_zones: {
        front: { thickness_mm: 50, material: "steel" },
        side: { thickness_mm: 50, material: "steel" },
        rear: { thickness_mm: 50, material: "steel" },
        top: { thickness_mm: 50, material: "steel" },
      },
      electronics: [],
      crew: { count: 1, exposure: "sealed" },
      thermal_dissipation_kws: 0,
      mobility_redundancy: 0,
      structural_integrity_mj: 0,
    },
    ...overrides,
  } as UnitSchematic;
}

describe("unit-on-terrain grounding", () => {
  it("setMeshUnit floors a mesh whose author bbox has min.y > 0 (canon_01 case)", () => {
    // Mesh-loader would have shifted this so floor sits at y=0 at scale=1.
    // We test that the slot still produces a grounded mount.
    const scene = new THREE.Scene();
    const terrain = makeFlatTerrain(0);
    const meshSource = makeMeshSource(0, 4); // bottom=0, top=4

    const slot = createUnitOnTerrain(scene, terrain, makeUnit());
    slot.setMeshUnit(meshSource, null, [], [], 1, undefined);

    // After mount, the slot's parent (anchored at terrain y=0) should have
    // a world bbox whose min.y matches the terrain anchor exactly.
    slot.parent.updateMatrixWorld(true);
    const worldBox = new THREE.Box3().setFromObject(slot.parent);
    expect(worldBox.isEmpty()).toBe(false);
    expect(Math.abs(worldBox.min.y - 0)).toBeLessThan(1e-3);

    slot.dispose();
  });

  it("setMeshUnit floors a non-unit-scale mesh (chassis.length_m mismatch case)", () => {
    // Reproduces the exact float-bug pattern: the loader's grounding offset
    // was computed in pre-scale meters, but the unit is rendered at a
    // different effective scale. Without bbox-driven re-grounding the
    // mesh floats by `bottomY * (scale - 1)`.
    const scene = new THREE.Scene();
    const terrain = makeFlatTerrain(0);
    // Mesh whose lowest vertex is well above the loader's mesh-local zero —
    // this would have been the typical canon_01.glb shape before mesh-loader
    // normalisation. We simulate it directly here.
    const meshSource = makeMeshSource(2, 6); // bottom=2, top=6 → floor was at y=2 pre-shift
    // The maker function shifted by `-bottomY` so at scale=1 the floor IS at 0.
    // But with effectiveScale=2 the floor drifts to `2 * (2-1) = 2` if uncorrected.

    const slot = createUnitOnTerrain(scene, terrain, makeUnit());
    // length_m=16, normalizedSizeM=8 → effectiveScale=2
    slot.setMeshUnit(meshSource, null, [], [], 1, 16);

    slot.parent.updateMatrixWorld(true);
    const worldBox = new THREE.Box3().setFromObject(slot.parent);
    expect(worldBox.isEmpty()).toBe(false);
    // The whole point of the fix: regardless of effectiveScale, min.y lands
    // on the terrain anchor (y=0). Pre-fix this would be 2, not 0.
    expect(Math.abs(worldBox.min.y - 0)).toBeLessThan(1e-3);

    slot.dispose();
  });

  it("setMeshUnit centres the mesh's XZ on the terrain anchor", () => {
    // Side-effect of the grounding helper: XZ should also be centred on the
    // anchor. Caller-friendly: the unit visually sits "right where the
    // anchor is" rather than offset by some internal mesh-origin oddity.
    const scene = new THREE.Scene();
    const terrain = makeFlatTerrain(0);
    const meshSource = makeMeshSource(0, 4);
    // Push the mesh sideways inside its group so the natural bbox centre
    // isn't at the group origin.
    const mesh = meshSource.children[0] as THREE.Mesh;
    mesh.position.x += 3;
    mesh.position.z -= 2;

    const slot = createUnitOnTerrain(scene, terrain, makeUnit());
    slot.setMeshUnit(meshSource, null, [], [], 1, undefined);

    slot.parent.updateMatrixWorld(true);
    const worldBox = new THREE.Box3().setFromObject(slot.parent);
    const cx = (worldBox.min.x + worldBox.max.x) / 2;
    const cz = (worldBox.min.z + worldBox.max.z) / 2;
    // MAP_SIZE_M / 2 = 64. anchor x/z = 64.
    expect(Math.abs(cx - 64)).toBeLessThan(1e-3);
    expect(Math.abs(cz - 64)).toBeLessThan(1e-3);

    slot.dispose();
  });
});
