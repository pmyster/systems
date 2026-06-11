/**
 * Vitest coverage for manifest migrations.
 *
 * Coverage:
 *   - v1 (no decals, no structured splatmap) → v2 adds `decals: []` and
 *     a default splatmap sidecar reference.
 *   - Missing `schemaVersion` is treated as v1 (defensive).
 *   - Migration never mutates the input.
 *   - v2 input passes through unchanged.
 */

import { describe, it, expect } from "vitest";

import { migrate } from "./migrations";

describe("migrate v1 → v2", () => {
  it("adds an empty decals array when the source has none", () => {
    const v1 = {
      schemaVersion: 1,
      name: "old",
      terrain: { sidecar: "heightmap.r32", widthPx: 129, heightPx: 129 },
    };
    const out = migrate(v1) as { schemaVersion: number; decals: unknown[] };
    // v1 → v2 → v3 → v4 → v5 chain (current).
    expect(out.schemaVersion).toBe(5);
    expect(out.decals).toEqual([]);
  });

  it("synthesizes a default splatmap sidecar reference", () => {
    const v1 = {
      schemaVersion: 1,
      terrain: { sidecar: "heightmap.r32", widthPx: 129, heightPx: 129 },
    };
    const out = migrate(v1) as {
      terrain: { splatmap: { sidecar: string; widthPx: number; heightPx: number } };
    };
    expect(out.terrain.splatmap).toEqual({
      sidecar: "splatmap.r8",
      widthPx: 128,
      heightPx: 128,
    });
  });

  it("treats missing schemaVersion as v1 and migrates to current", () => {
    const noVersion = {
      terrain: { sidecar: "heightmap.r32", widthPx: 129, heightPx: 129 },
    };
    const out = migrate(noVersion) as { schemaVersion: number; decals: unknown[] };
    expect(out.schemaVersion).toBe(5);
    expect(out.decals).toEqual([]);
  });

  it("does not mutate the input", () => {
    const v1: Record<string, unknown> = {
      schemaVersion: 1,
      terrain: { sidecar: "heightmap.r32", widthPx: 129, heightPx: 129 },
    };
    const snap = JSON.parse(JSON.stringify(v1));
    migrate(v1);
    expect(v1).toEqual(snap);
  });
});

describe("migrate v2 → v3", () => {
  it("synthesizes Grassland elevation profile + splat mix when absent", () => {
    const v2 = {
      schemaVersion: 2,
      name: "v2",
      terrain: {
        sidecar: "heightmap.r32",
        widthPx: 129,
        heightPx: 129,
        splatmap: { sidecar: "splatmap.r8", widthPx: 128, heightPx: 128 },
      },
      decals: [],
    };
    const out = migrate(v2) as {
      schemaVersion: number;
      elevationProfile: {
        mid: readonly number[];
        high: readonly number[];
        peak: readonly number[];
      };
      splatToElevationMix: number;
    };
    // v2 → v3 → v4 → v5 (current).
    expect(out.schemaVersion).toBe(5);
    expect(out.elevationProfile).toEqual({
      mid: [0.35, 0.55, 0.22],
      high: [0.45, 0.55, 0.3],
      peak: [0.55, 0.55, 0.4],
    });
    expect(out.splatToElevationMix).toBe(0.75);
  });

  it("preserves existing v3 elevation profile / mix on a hand-edited manifest", () => {
    const v2WithProfile = {
      schemaVersion: 2,
      name: "v2-handedit",
      terrain: {
        sidecar: "heightmap.r32",
        widthPx: 129,
        heightPx: 129,
        splatmap: { sidecar: "splatmap.r8", widthPx: 128, heightPx: 128 },
      },
      decals: [],
      elevationProfile: {
        mid: [0.62, 0.3, 0.18],
        high: [0.55, 0.22, 0.12],
        peak: [0.45, 0.18, 0.1],
      },
      splatToElevationMix: 0.5,
    };
    const out = migrate(v2WithProfile) as {
      schemaVersion: number;
      elevationProfile: { mid: readonly number[] };
      splatToElevationMix: number;
    };
    expect(out.schemaVersion).toBe(5);
    expect(out.elevationProfile.mid).toEqual([0.62, 0.3, 0.18]);
    expect(out.splatToElevationMix).toBe(0.5);
  });

  it("synthesizes default atmosphere + zero color variance for a v3 manifest", () => {
    const v3 = {
      schemaVersion: 3,
      name: "v3",
      terrain: {
        sidecar: "heightmap.r32",
        widthPx: 129,
        heightPx: 129,
        splatmap: { sidecar: "splatmap.r8", widthPx: 128, heightPx: 128 },
      },
      decals: [],
      elevationProfile: {
        mid: [0.35, 0.55, 0.22],
        high: [0.45, 0.55, 0.3],
        peak: [0.55, 0.55, 0.4],
      },
      splatToElevationMix: 0.75,
    };
    const out = migrate(v3) as {
      schemaVersion: number;
      atmosphere: { sunIntensity: number; fogNear: number; fogFar: number };
      colorVariance: number;
    };
    expect(out.schemaVersion).toBe(5);
    expect(out.atmosphere.sunIntensity).toBe(2.6);
    expect(out.atmosphere.fogNear).toBe(100);
    expect(out.atmosphere.fogFar).toBe(500);
    expect(out.colorVariance).toBe(0);
  });

  it("leaves a v5 manifest unchanged", () => {
    const v5 = {
      schemaVersion: 5,
      name: "v4",
      terrain: {
        sidecar: "heightmap.r32",
        widthPx: 129,
        heightPx: 129,
        splatmap: { sidecar: "splatmap.r8", widthPx: 128, heightPx: 128 },
        colorPaint: { sidecar: "colorpaint.r8", widthPx: 128, heightPx: 128 },
      },
      decals: [],
      elevationProfile: {
        mid: [0.35, 0.55, 0.22],
        high: [0.45, 0.55, 0.3],
        peak: [0.55, 0.55, 0.4],
      },
      splatToElevationMix: 0.75,
      atmosphere: {
        skyTop: [0.31, 0.56, 0.81],
        skyHorizon: [0.78, 0.9, 1.0],
        skyGround: [0.54, 0.63, 0.71],
        sunColor: [1.0, 0.97, 0.91],
        sunIntensity: 2.6,
        hemiSky: [0.78, 0.9, 1.0],
        hemiGround: [0.42, 0.63, 0.29],
        hemiIntensity: 1.15,
        fogColor: [0.78, 0.9, 1.0],
        fogNear: 100,
        fogFar: 500,
      },
      colorVariance: 0,
    };
    const out = migrate(v5);
    expect(out).toBe(v5); // identity — fast-path
  });
});

describe("migrate v4 → v5", () => {
  it("synthesises a default colorPaint sidecar ref when absent", () => {
    const v4 = {
      schemaVersion: 4,
      name: "v4",
      terrain: {
        sidecar: "heightmap.r32",
        widthPx: 129,
        heightPx: 129,
        splatmap: { sidecar: "splatmap.r8", widthPx: 128, heightPx: 128 },
      },
      decals: [],
    };
    const out = migrate(v4) as {
      schemaVersion: number;
      terrain: {
        colorPaint: { sidecar: string; widthPx: number; heightPx: number };
      };
    };
    expect(out.schemaVersion).toBe(5);
    expect(out.terrain.colorPaint).toEqual({
      sidecar: "colorpaint.r8",
      widthPx: 128,
      heightPx: 128,
    });
  });
});
