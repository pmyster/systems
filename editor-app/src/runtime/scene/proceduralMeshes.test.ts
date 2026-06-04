/**
 * proceduralMeshes tests — Phase 2 Stage 1.
 *
 * Verify each builder returns a Group with the expected sub-mesh layout
 * and that the bounding box roughly matches the documented dimensions.
 * We're not asserting exact pixels — just "did we produce something
 * non-degenerate that fits the spec sketch".
 */

import { describe, it, expect } from "vitest";
import * as THREE from "three";

import {
  buildTurretMesh,
  buildWallMesh,
  buildAATowerMesh,
  buildBunkerMesh,
  buildProceduralBuildingMesh,
  proceduralBuildingTemplateId,
} from "./proceduralMeshes";
import type { BuildingChassisClass } from "../../types/unit";

/** Helper — count THREE.Mesh nodes in a Group's subtree. */
function meshCount(group: THREE.Group): number {
  let n = 0;
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) n++;
  });
  return n;
}

/** Helper — bounding box dimensions. */
function bboxDims(group: THREE.Group): [number, number, number] {
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group);
  const size = new THREE.Vector3();
  box.getSize(size);
  return [size.x, size.y, size.z];
}

describe("proceduralMeshes", () => {
  describe("buildTurretMesh", () => {
    it("returns a Group with 4 sub-meshes (base + stem + barrel + accent)", () => {
      const g = buildTurretMesh();
      expect(g).toBeInstanceOf(THREE.Group);
      expect(meshCount(g)).toBe(4);
    });

    it("bbox fits roughly within the 6m envelope", () => {
      const g = buildTurretMesh();
      const [w, h, d] = bboxDims(g);
      // Width / depth ~ 4m base, height ~ 4m. Allow generous tolerance.
      expect(w).toBeGreaterThan(2);
      expect(w).toBeLessThan(8);
      expect(h).toBeGreaterThan(2);
      expect(h).toBeLessThan(8);
      expect(d).toBeGreaterThan(2);
      expect(d).toBeLessThan(8);
    });

    it("first mesh in traversal order is the chassis hull (base)", () => {
      const g = buildTurretMesh();
      let firstName: string | null = null;
      g.traverse((o) => {
        if (firstName === null && o instanceof THREE.Mesh) {
          firstName = o.name;
        }
      });
      expect(firstName).toBe("turret_base");
    });
  });

  describe("buildWallMesh", () => {
    it("has at least one wall body mesh + accent (2 total)", () => {
      const g = buildWallMesh();
      expect(meshCount(g)).toBe(2);
    });

    it("bbox matches a 4 × 3 × 0.5 wall (approximately)", () => {
      const g = buildWallMesh();
      const [w, h, d] = bboxDims(g);
      expect(w).toBeCloseTo(4, 0);
      expect(h).toBeGreaterThan(2);
      expect(h).toBeLessThan(4);
      expect(d).toBeLessThan(2);
    });
  });

  describe("buildAATowerMesh", () => {
    it("has 4 sub-meshes (base + cap + barrel + accent)", () => {
      const g = buildAATowerMesh();
      expect(meshCount(g)).toBe(4);
    });

    it("is taller than wide (tower silhouette)", () => {
      const g = buildAATowerMesh();
      const [w, h] = bboxDims(g);
      expect(h).toBeGreaterThan(w);
    });
  });

  describe("buildBunkerMesh", () => {
    it("has 3 sub-meshes (dome + entrance + accent)", () => {
      const g = buildBunkerMesh();
      expect(meshCount(g)).toBe(3);
    });

    it("is wider than tall (low dome silhouette)", () => {
      const g = buildBunkerMesh();
      const [w, h] = bboxDims(g);
      expect(w).toBeGreaterThan(h);
    });
  });

  describe("buildProceduralBuildingMesh dispatch", () => {
    it.each<BuildingChassisClass>([
      "building_turret",
      "building_wall",
      "building_aa",
      "building_bunker",
    ])("returns a fresh Group for %s", (chassis) => {
      const a = buildProceduralBuildingMesh(chassis);
      const b = buildProceduralBuildingMesh(chassis);
      expect(a).toBeInstanceOf(THREE.Group);
      expect(b).toBeInstanceOf(THREE.Group);
      // Distinct instances — no shared root object across calls.
      expect(a).not.toBe(b);
    });

    it("each builder produces independent sub-mesh trees", () => {
      const a = buildTurretMesh();
      const b = buildTurretMesh();
      // The roots are different.
      expect(a).not.toBe(b);
      // Child meshes are different Three.js objects too.
      const aFirst = a.children[0];
      const bFirst = b.children[0];
      expect(aFirst).not.toBe(bFirst);
    });
  });

  describe("proceduralBuildingTemplateId", () => {
    it("yields a unique stable key per chassis class", () => {
      const ids = new Set([
        proceduralBuildingTemplateId("building_turret"),
        proceduralBuildingTemplateId("building_wall"),
        proceduralBuildingTemplateId("building_aa"),
        proceduralBuildingTemplateId("building_bunker"),
      ]);
      expect(ids.size).toBe(4);
    });

    it("is stable for repeated calls", () => {
      const a = proceduralBuildingTemplateId("building_turret");
      const b = proceduralBuildingTemplateId("building_turret");
      expect(a).toBe(b);
    });
  });
});
