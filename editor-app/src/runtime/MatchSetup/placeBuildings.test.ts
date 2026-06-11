/**
 * PlaceBuildingsStep — non-React-renderer unit tests.
 *
 * The UI itself is straightforward state plumbing. The interesting
 * behaviors are the PURE helpers (clamp, slope sample, heightmap-to-
 * grayscale) and the data-shape contract of BuildingPlacement.
 *
 * These tests exercise the helpers directly. Full React renderer tests
 * with jsdom + click simulation are deferred — the UI surface is small
 * enough that visual review during the verify pass catches issues that
 * unit tests would have to mock 90% of the canvas API to reach.
 */

import { describe, it, expect } from "vitest";

import {
  heightmapToGrayscale,
  sampleSlopeDeg,
  canvasFractionToWorld,
  worldToCanvasFraction,
} from "./PlaceBuildingsStep";
import {
  clampPlacementToMap,
  FACTION_NEUTRAL,
  type BuildingPlacement,
} from "../BuildingPlacement";

describe("heightmapToGrayscale", () => {
  it("normalizes a flat map to mid-grey across all pixels", () => {
    const flat = new Float32Array(4 * 4).fill(7);
    const out = heightmapToGrayscale(flat, 4, 4);
    // Every pixel should be the same. Mid-grey ≈ 127 (range / 2 path
    // returns n=0.5 → g=127).
    expect(out.length).toBe(4 * 4 * 4);
    for (let i = 0; i < out.length; i += 4) {
      expect(out[i]).toBe(out[i + 1]);
      expect(out[i + 1]).toBe(out[i + 2]);
      expect(out[i + 3]).toBe(255);
    }
    // Mid-grey is what we expect for a flat input.
    expect(out[0]).toBeGreaterThanOrEqual(126);
    expect(out[0]).toBeLessThanOrEqual(128);
  });

  it("maps min→0 and max→255", () => {
    const arr = new Float32Array(4);
    arr[0] = 0;
    arr[1] = 1;
    arr[2] = 2;
    arr[3] = 10;
    const out = heightmapToGrayscale(arr, 4, 1);
    expect(out[0 * 4]).toBe(0);
    expect(out[3 * 4]).toBe(255);
    // Mid-values fall between.
    expect(out[1 * 4]).toBeGreaterThan(out[0 * 4]);
    expect(out[1 * 4]).toBeLessThan(out[3 * 4]);
  });

  it("throws on size mismatch — loud over silent", () => {
    expect(() => heightmapToGrayscale(new Float32Array(10), 4, 4)).toThrow();
  });
});

describe("sampleSlopeDeg", () => {
  it("returns 0 on a flat map", () => {
    const flat = new Float32Array(16).fill(5);
    const slope = sampleSlopeDeg(flat, 4, 4, /*tileM*/ 1, /*x*/ 1, /*z*/ 1);
    expect(slope).toBe(0);
  });

  it("returns >0 on a sloped map", () => {
    // Ramp ascending in +X: column 0 = 0, column 3 = 3 (per row).
    const ramp = new Float32Array(16);
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        ramp[r * 4 + c] = c;
      }
    }
    const slope = sampleSlopeDeg(ramp, 4, 4, /*tileM*/ 1, /*x*/ 1, /*z*/ 1);
    // dh/dx = 1 per meter → atan(1) = 45°.
    expect(slope).toBeCloseTo(45, 0);
  });

  it("returns 0 on out-of-bounds query (defensive)", () => {
    const flat = new Float32Array(16).fill(5);
    expect(sampleSlopeDeg(flat, 4, 4, 1, -1, -1)).toBe(0);
    expect(sampleSlopeDeg(flat, 4, 4, 1, 1000, 1000)).toBe(0);
  });
});

describe("clampPlacementToMap", () => {
  it("does not clamp an in-bounds position", () => {
    const { position, wasClamped } = clampPlacementToMap(
      [50, 50],
      100,
      100,
    );
    expect(position).toEqual([50, 50]);
    expect(wasClamped).toBe(false);
  });

  it("clamps a position past the +X bound", () => {
    const { position, wasClamped } = clampPlacementToMap(
      [150, 50],
      100,
      100,
    );
    expect(position[0]).toBe(100);
    expect(position[1]).toBe(50);
    expect(wasClamped).toBe(true);
  });

  it("clamps a position past the -Z bound", () => {
    const { position, wasClamped } = clampPlacementToMap(
      [50, -30],
      100,
      100,
    );
    expect(position[0]).toBe(50);
    expect(position[1]).toBe(0);
    expect(wasClamped).toBe(true);
  });

  it("clamps both axes when out on both", () => {
    const { position, wasClamped } = clampPlacementToMap(
      [-10, 500],
      100,
      100,
    );
    expect(position).toEqual([0, 100]);
    expect(wasClamped).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Pixel → world conversion. Owner reported "where I put the units on the
// minimap doesn't matter or is not precise" — these tests pin the
// convention so any future regression surfaces here loudly instead of in
// the spawn behavior.
//
// Convention under test:
//   - Canvas (0,0) ↔ world (0,0) (TOP-LEFT corner origin, NOT centered).
//   - Canvas (1,1) ↔ world (mapWm, mapDm) (BOTTOM-RIGHT corner).
//   - mapWm = (widthPx-1)*tileM — corner-sampled heightmap convention.
// ---------------------------------------------------------------------------
describe("canvasFractionToWorld", () => {
  // Mirror the Green_Fields map dimensions: 513×513 heightmap at
  // tileM=1 ⇒ rendered terrain spans world [0, 512] × [0, 512].
  const mapWm = 512;
  const mapDm = 512;

  it("maps canvas center to world center", () => {
    const [wx, wz] = canvasFractionToWorld(0.5, 0.5, mapWm, mapDm);
    expect(wx).toBeCloseTo(256);
    expect(wz).toBeCloseTo(256);
  });

  it("maps canvas top-left to world (0, 0)", () => {
    const [wx, wz] = canvasFractionToWorld(0, 0, mapWm, mapDm);
    expect(wx).toBe(0);
    expect(wz).toBe(0);
  });

  it("maps canvas bottom-right to world (mapWm, mapDm)", () => {
    const [wx, wz] = canvasFractionToWorld(1, 1, mapWm, mapDm);
    expect(wx).toBe(mapWm);
    expect(wz).toBe(mapDm);
  });

  it("maps canvas top-right to world (mapWm, 0)", () => {
    const [wx, wz] = canvasFractionToWorld(1, 0, mapWm, mapDm);
    expect(wx).toBe(mapWm);
    expect(wz).toBe(0);
  });

  it("maps canvas bottom-left to world (0, mapDm)", () => {
    const [wx, wz] = canvasFractionToWorld(0, 1, mapWm, mapDm);
    expect(wx).toBe(0);
    expect(wz).toBe(mapDm);
  });

  it("maps a quarter-from-top-left to (mapWm/4, mapDm/4)", () => {
    const [wx, wz] = canvasFractionToWorld(0.25, 0.25, mapWm, mapDm);
    expect(wx).toBeCloseTo(128);
    expect(wz).toBeCloseTo(128);
  });
});

describe("worldToCanvasFraction (inverse)", () => {
  const mapWm = 512;
  const mapDm = 512;

  it("maps world (0,0) to canvas (0,0)", () => {
    const [fx, fy] = worldToCanvasFraction(0, 0, mapWm, mapDm);
    expect(fx).toBe(0);
    expect(fy).toBe(0);
  });

  it("maps world center to canvas (0.5, 0.5)", () => {
    const [fx, fy] = worldToCanvasFraction(256, 256, mapWm, mapDm);
    expect(fx).toBeCloseTo(0.5);
    expect(fy).toBeCloseTo(0.5);
  });

  it("maps world (mapWm, mapDm) to canvas (1, 1)", () => {
    const [fx, fy] = worldToCanvasFraction(mapWm, mapDm, mapWm, mapDm);
    expect(fx).toBe(1);
    expect(fy).toBe(1);
  });

  it("guards against div-by-zero on degenerate dimensions", () => {
    const [fx, fy] = worldToCanvasFraction(10, 10, 0, 0);
    expect(fx).toBe(0);
    expect(fy).toBe(0);
  });
});

describe("pixel↔world round-trip", () => {
  // Tests of the form: world → fraction → world should be lossless.
  const mapWm = 512;
  const mapDm = 512;

  it("round-trips a center placement losslessly", () => {
    const [fx, fy] = worldToCanvasFraction(256, 256, mapWm, mapDm);
    const [wx, wz] = canvasFractionToWorld(fx, fy, mapWm, mapDm);
    expect(wx).toBeCloseTo(256);
    expect(wz).toBeCloseTo(256);
  });

  it("round-trips an arbitrary placement losslessly", () => {
    const [fx, fy] = worldToCanvasFraction(173.5, 411.2, mapWm, mapDm);
    const [wx, wz] = canvasFractionToWorld(fx, fy, mapWm, mapDm);
    expect(wx).toBeCloseTo(173.5);
    expect(wz).toBeCloseTo(411.2);
  });

  it("round-trips the corners exactly", () => {
    for (const [wxIn, wzIn] of [
      [0, 0],
      [mapWm, 0],
      [0, mapDm],
      [mapWm, mapDm],
    ]) {
      const [fx, fy] = worldToCanvasFraction(wxIn, wzIn, mapWm, mapDm);
      const [wxOut, wzOut] = canvasFractionToWorld(fx, fy, mapWm, mapDm);
      expect(wxOut).toBe(wxIn);
      expect(wzOut).toBe(wzIn);
    }
  });
});

describe("pixel→world non-square maps + non-unit tile sizes", () => {
  // A small wide map: 65×33 heightmap at tileM=8.
  //   widthM = (65-1)*8 = 512m
  //   depthM = (33-1)*8 = 256m
  // Owner's regression: if the conversion used widthPx*tileM (520m,
  // 264m) instead of (widthPx-1)*tileM, click at canvas right edge
  // would land at world 520m — 8m outside the actual terrain — and
  // the spawned building would float at world (520, h, ?) past the
  // playable area.
  const mapWm = 512;
  const mapDm = 256;

  it("maps top-right click to the wide map's actual right edge", () => {
    const [wx, wz] = canvasFractionToWorld(1, 0, mapWm, mapDm);
    expect(wx).toBe(512);
    expect(wz).toBe(0);
  });

  it("maps center click to the wide map's actual center", () => {
    const [wx, wz] = canvasFractionToWorld(0.5, 0.5, mapWm, mapDm);
    expect(wx).toBe(256);
    expect(wz).toBe(128);
  });
});

describe("BuildingPlacement shape", () => {
  it("matches the documented field set", () => {
    const p: BuildingPlacement = {
      chassis_class: "building_turret",
      position_xz: [10, 20],
      rotation_y: 0,
      faction: 0,
    };
    expect(p.chassis_class).toBe("building_turret");
    expect(p.position_xz).toEqual([10, 20]);
    expect(p.rotation_y).toBe(0);
    expect(p.faction).toBe(0);
  });

  it("FACTION_NEUTRAL sentinel is 255", () => {
    expect(FACTION_NEUTRAL).toBe(255);
  });
});

// ---------------------------------------------------------------------------
// Pure state-transition tests for placements lists (add/remove/rotate).
// These exercise the reducer-shape ops MatchSetup performs.
// ---------------------------------------------------------------------------

describe("placements list ops (pure)", () => {
  function add(
    list: readonly BuildingPlacement[],
    p: BuildingPlacement,
  ): readonly BuildingPlacement[] {
    return [...list, p];
  }
  function removeAt(
    list: readonly BuildingPlacement[],
    idx: number,
  ): readonly BuildingPlacement[] {
    return list.filter((_, i) => i !== idx);
  }
  function rotate(
    list: readonly BuildingPlacement[],
    idx: number,
    rad: number,
  ): readonly BuildingPlacement[] {
    return list.map((p, i) => (i === idx ? { ...p, rotation_y: rad } : p));
  }

  const base: BuildingPlacement = {
    chassis_class: "building_turret",
    position_xz: [5, 5],
    rotation_y: 0,
    faction: 0,
  };

  it("adds a placement to the list", () => {
    const next = add([], base);
    expect(next.length).toBe(1);
    expect(next[0]).toEqual(base);
  });

  it("removes a placement by index", () => {
    const list = [base, { ...base, chassis_class: "building_wall" as const }];
    const next = removeAt(list, 0);
    expect(next.length).toBe(1);
    expect(next[0].chassis_class).toBe("building_wall");
  });

  it("rotates a placement by index without mutating the original list", () => {
    const list = [base];
    const next = rotate(list, 0, Math.PI / 2);
    expect(next[0].rotation_y).toBeCloseTo(Math.PI / 2);
    // Original untouched.
    expect(list[0].rotation_y).toBe(0);
  });

  it("toggles faction by replacing the placement (immutable)", () => {
    const list: readonly BuildingPlacement[] = [base];
    const next = list.map((p) => ({ ...p, faction: 1 }));
    expect(next[0].faction).toBe(1);
    expect(list[0].faction).toBe(0);
  });
});
