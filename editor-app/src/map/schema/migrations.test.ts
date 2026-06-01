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
    expect(out.schemaVersion).toBe(2);
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

  it("treats missing schemaVersion as v1 and migrates to v2", () => {
    const noVersion = {
      terrain: { sidecar: "heightmap.r32", widthPx: 129, heightPx: 129 },
    };
    const out = migrate(noVersion) as { schemaVersion: number; decals: unknown[] };
    expect(out.schemaVersion).toBe(2);
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

  it("leaves a v2 manifest unchanged", () => {
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
    const out = migrate(v2);
    expect(out).toBe(v2); // identity — fast-path
  });
});
