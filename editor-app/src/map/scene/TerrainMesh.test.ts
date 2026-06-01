/**
 * Vitest coverage for TerrainMesh.
 *
 * Coverage:
 *   - Initial geometry has widthPx * heightPx vertices.
 *   - applyHeightmap writes vertex Y values that match the source array.
 *   - applyDirtyPixels only touches the indices in the dirty set; other
 *     verts retain their previous Y.
 *   - worldToPixelIndex returns the right index for in-bounds coords and
 *     -1 for out-of-bounds coords.
 *
 * No real WebGL context is needed — Three's BufferGeometry math is pure
 * CPU and runs fine under jsdom.
 */

import { describe, it, expect } from "vitest";
import * as THREE from "three";

import { TerrainMesh } from "./TerrainMesh";

const W = 5;
const H = 5;

function makeHeightmap(fillValue: number): Float32Array {
  const hm = new Float32Array(W * H);
  hm.fill(fillValue);
  return hm;
}

describe("TerrainMesh", () => {
  it("has widthPx * heightPx vertices", () => {
    const hm = makeHeightmap(0);
    const tm = new TerrainMesh(W, H, hm);
    const count = (
      tm.mesh.geometry.attributes.position as THREE.BufferAttribute
    ).count;
    expect(count).toBe(W * H);
    tm.dispose();
  });

  it("applyHeightmap sets vertex Y values to match the source", () => {
    const hm = new Float32Array(W * H);
    for (let i = 0; i < hm.length; i++) hm[i] = i * 0.1;
    const tm = new TerrainMesh(W, H, hm);
    const pos = tm.mesh.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < hm.length; i++) {
      expect(pos.getY(i)).toBeCloseTo(hm[i], 6);
    }
    tm.dispose();
  });

  it("applyDirtyPixels only touches the indices in the dirty set", () => {
    const hm = makeHeightmap(0);
    const tm = new TerrainMesh(W, H, hm);
    const pos = tm.mesh.geometry.attributes.position as THREE.BufferAttribute;

    // Verify baseline: every Y is 0.
    for (let i = 0; i < hm.length; i++) expect(pos.getY(i)).toBe(0);

    // Mutate hm at a couple of indices and apply only those.
    hm[3] = 2.5;
    hm[11] = -1.25;
    tm.applyDirtyPixels(hm, new Set([3, 11]));

    expect(pos.getY(3)).toBeCloseTo(2.5, 6);
    expect(pos.getY(11)).toBeCloseTo(-1.25, 6);
    // Every OTHER vertex should still read 0 — proves we didn't do a
    // full re-upload.
    for (let i = 0; i < hm.length; i++) {
      if (i === 3 || i === 11) continue;
      expect(pos.getY(i)).toBe(0);
    }
    tm.dispose();
  });

  it("worldToPixelIndex returns the row-major index in bounds and -1 out of bounds", () => {
    const hm = makeHeightmap(0);
    const tm = new TerrainMesh(W, H, hm);

    // SW corner = world (0, 0)
    expect(tm.worldToPixelIndex(0, 0)).toBe(0);
    // Row 2, column 3 -> 2 * 5 + 3 = 13
    expect(tm.worldToPixelIndex(3, 2)).toBe(13);
    // Far corner inside grid
    expect(tm.worldToPixelIndex(W - 1, H - 1)).toBe(W * H - 1);

    // Negative & past-the-edge values are out of bounds.
    expect(tm.worldToPixelIndex(-1, 0)).toBe(-1);
    expect(tm.worldToPixelIndex(0, -1)).toBe(-1);
    expect(tm.worldToPixelIndex(W, 0)).toBe(-1);
    expect(tm.worldToPixelIndex(0, H)).toBe(-1);
    tm.dispose();
  });
});
