/**
 * Tests for MaterialPainter's mesh-mode raycast → voxel-cell conversion.
 *
 * The painter's mesh mode raycasts the visible mesh surface and floors
 * the world-coord hit point to find the underlying voxel cell. The
 * conversion is the load-bearing piece — if it drifts by one cell the
 * artist paints the wrong voxel and the resulting unit's physics
 * diverges from its appearance. These tests pin the math to known
 * inputs.
 */

import { describe, it, expect } from "vitest";
import * as THREE from "three";

import { meshHitToVoxelCell } from "./MaterialPainter";

describe("meshHitToVoxelCell", () => {
  it("floors a hit deep inside a cell to that cell's integer coords", () => {
    // Hit at (6.4, 6.2, 1.7) lands inside voxel (6, 6, 1).
    const hit = new THREE.Vector3(6.4, 6.2, 1.7);
    const cell = meshHitToVoxelCell(hit);
    expect(cell).toEqual({ x: 6, y: 6, z: 1 });
  });

  it("maps the world origin (0,0,0) to voxel (0,0,0)", () => {
    const hit = new THREE.Vector3(0, 0, 0);
    const cell = meshHitToVoxelCell(hit);
    expect(cell).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("treats a hit just inside the far edge as the last in-bounds cell", () => {
    // Hit at 15.999 is still inside voxel 15 (the [15, 16) range).
    const hit = new THREE.Vector3(15.999, 15.999, 15.999);
    const cell = meshHitToVoxelCell(hit);
    expect(cell).toEqual({ x: 15, y: 15, z: 15 });
  });

  it("returns null for a hit past the +x edge of the grid", () => {
    // Hit at x=16 falls outside cell 15's [15, 16) range → out of bounds.
    const hit = new THREE.Vector3(16.0, 8, 8);
    const cell = meshHitToVoxelCell(hit);
    expect(cell).toBeNull();
  });

  it("returns null for a hit at negative coords", () => {
    // Pre-mesh-loader space could in principle produce a negative hit
    // if the alignment maths got inverted — the conversion must
    // surface that loud (null), not silently paint cell 0.
    const hit = new THREE.Vector3(-0.5, 4, 4);
    const cell = meshHitToVoxelCell(hit);
    expect(cell).toBeNull();
  });

  it("honours a custom grid size", () => {
    // Custom grid_size = 8 — used by a smaller-resolution preview, if/when.
    // Hit at (7.5, 7.5, 7.5) is still inside cell (7,7,7); a 9 would be out.
    expect(meshHitToVoxelCell(new THREE.Vector3(7.5, 7.5, 7.5), 8)).toEqual({
      x: 7,
      y: 7,
      z: 7,
    });
    expect(meshHitToVoxelCell(new THREE.Vector3(8.0, 4, 4), 8)).toBeNull();
  });
});
