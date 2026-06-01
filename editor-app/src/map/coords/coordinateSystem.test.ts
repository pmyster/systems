/**
 * Vitest coverage for the pure coordinate-conversion helpers.
 *
 * Day 2 replaces the inline `import.meta.env.DEV` self-asserts that
 * lived at the bottom of `coordinateSystem.ts`.
 *
 * Coverage:
 *   - Round-trip: world → heightmap → world is identity at integer pixels.
 *   - Boundary: origin (0,0) and the default-map SE corner.
 *   - Tile math: tile centers, tile-from-world floor semantics, negative
 *     coordinates round toward -infinity (NOT toward zero).
 */

import { describe, it, expect } from "vitest";

import {
  DEFAULT_HEIGHTMAP_HEIGHT_PX,
  DEFAULT_HEIGHTMAP_WIDTH_PX,
  HEIGHTMAP_M_PER_PIXEL,
} from "./constants";
import {
  heightmapToWorld,
  tileToWorld,
  worldToHeightmap,
  worldToTile,
} from "./coordinateSystem";

describe("worldToHeightmap / heightmapToWorld", () => {
  it("maps origin (0,0) to pixel (0,0)", () => {
    expect(worldToHeightmap(0, 0)).toEqual({ px: 0, py: 0 });
    expect(heightmapToWorld(0, 0)).toEqual({ x: 0, z: 0 });
  });

  it("maps the default-map SE corner cleanly", () => {
    const w = (DEFAULT_HEIGHTMAP_WIDTH_PX - 1) * HEIGHTMAP_M_PER_PIXEL;
    const h = (DEFAULT_HEIGHTMAP_HEIGHT_PX - 1) * HEIGHTMAP_M_PER_PIXEL;
    const px = worldToHeightmap(w, h);
    expect(px.px).toBeCloseTo(DEFAULT_HEIGHTMAP_WIDTH_PX - 1, 10);
    expect(px.py).toBeCloseTo(DEFAULT_HEIGHTMAP_HEIGHT_PX - 1, 10);
  });

  it("is an identity round-trip at integer pixel coords", () => {
    for (const [px, py] of [
      [0, 0],
      [1, 1],
      [17, 0],
      [0, 64],
      [64, 32],
      [DEFAULT_HEIGHTMAP_WIDTH_PX - 1, DEFAULT_HEIGHTMAP_HEIGHT_PX - 1],
    ]) {
      const world = heightmapToWorld(px, py);
      const back = worldToHeightmap(world.x, world.z);
      expect(back.px).toBeCloseTo(px, 10);
      expect(back.py).toBeCloseTo(py, 10);
    }
  });

  it("handles off-map values without throwing (caller must clamp)", () => {
    const off = worldToHeightmap(-5, 9999);
    expect(off.px).toBeCloseTo(-5 / HEIGHTMAP_M_PER_PIXEL, 10);
    expect(off.py).toBeCloseTo(9999 / HEIGHTMAP_M_PER_PIXEL, 10);
  });
});

describe("worldToTile / tileToWorld", () => {
  it("tile (0,0) centers at (0.5, 0.5)", () => {
    expect(tileToWorld(0, 0)).toEqual({ x: 0.5, z: 0.5 });
  });

  it("world (0.7, 1.2) is in tile (0, 1)", () => {
    expect(worldToTile(0.7, 1.2)).toEqual({ tx: 0, tz: 1 });
  });

  it("rounds toward -infinity for negative world coordinates", () => {
    // CRITICAL: -0.1 lives in tile -1, NOT tile 0. floor is correct.
    expect(worldToTile(-0.1, -0.1)).toEqual({ tx: -1, tz: -1 });
    expect(worldToTile(-1.0, -1.0)).toEqual({ tx: -1, tz: -1 });
    expect(worldToTile(-1.0001, -1.0001)).toEqual({ tx: -2, tz: -2 });
  });
});
