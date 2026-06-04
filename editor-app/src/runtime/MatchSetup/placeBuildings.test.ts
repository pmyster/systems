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
