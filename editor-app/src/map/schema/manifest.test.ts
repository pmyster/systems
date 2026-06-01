/**
 * Vitest coverage for the map-project manifest schema + factory.
 *
 * What we verify:
 *   - `createEmptyManifest(...)` round-trips through the Zod parser without
 *     loss — i.e. the factory's shape exactly matches the declared schema.
 *   - Malformed inputs are rejected (missing required field, wrong type,
 *     wrong schemaVersion literal).
 */

import { describe, it, expect } from "vitest";

import { createEmptyManifest, MapProjectManifestSchema } from "./manifest";

describe("createEmptyManifest", () => {
  it("round-trips through MapProjectManifestSchema.parse without loss", () => {
    const m = createEmptyManifest("test", "phee");
    const parsed = MapProjectManifestSchema.parse(m);
    expect(parsed).toEqual(m);
  });

  it("includes the caller-supplied name and author", () => {
    const m = createEmptyManifest("Vermilion Pass", "phee");
    expect(m.name).toBe("Vermilion Pass");
    expect(m.metadata.author).toBe("phee");
  });

  it("uses the current schemaVersion literal", () => {
    const m = createEmptyManifest("a", "b");
    expect(m.schemaVersion).toBe(5);
  });

  it("seeds the v3 elevation profile + splat mix with Grassland defaults", () => {
    const m = createEmptyManifest("a", "b");
    expect(m.elevationProfile).toEqual({
      mid: [0.35, 0.55, 0.22],
      high: [0.45, 0.55, 0.3],
      peak: [0.55, 0.55, 0.4],
    });
    expect(m.splatToElevationMix).toBe(0.75);
  });

  it("seeds the v4 default atmosphere + zero color variance", () => {
    const m = createEmptyManifest("a", "b");
    expect(m.atmosphere).toBeDefined();
    expect(m.atmosphere?.sunIntensity).toBe(2.6);
    expect(m.atmosphere?.fogNear).toBe(100);
    expect(m.atmosphere?.fogFar).toBe(500);
    expect(m.colorVariance).toBe(0);
  });

  it("starts with empty objects, spawnPoints, and decals arrays", () => {
    const m = createEmptyManifest("a", "b");
    expect(m.objects).toEqual([]);
    expect(m.spawnPoints).toEqual([]);
    expect(m.decals).toEqual([]);
  });

  it("includes a default splatmap sidecar reference on the terrain", () => {
    const m = createEmptyManifest("a", "b");
    expect(m.terrain.splatmap).toEqual({
      sidecar: "splatmap.r8",
      widthPx: 128,
      heightPx: 128,
    });
  });

  it("includes a default colorPaint sidecar reference on the terrain", () => {
    const m = createEmptyManifest("a", "b");
    expect(m.terrain.colorPaint).toEqual({
      sidecar: "colorpaint.r8",
      widthPx: 128,
      heightPx: 128,
    });
  });
});

describe("MapProjectManifestSchema rejects malformed input", () => {
  it("rejects when schemaVersion is wrong", () => {
    const m = createEmptyManifest("a", "b") as unknown as Record<string, unknown>;
    m.schemaVersion = 999;
    expect(() => MapProjectManifestSchema.parse(m)).toThrow();
  });

  it("rejects when a required field is missing", () => {
    const m = createEmptyManifest("a", "b") as unknown as Record<string, unknown>;
    delete m.terrain;
    expect(() => MapProjectManifestSchema.parse(m)).toThrow();
  });

  it("rejects when coordinateSystem.up is not 'Y'", () => {
    const m = createEmptyManifest("a", "b") as unknown as {
      coordinateSystem: { up: string };
    };
    m.coordinateSystem.up = "Z";
    expect(() => MapProjectManifestSchema.parse(m)).toThrow();
  });

  it("rejects fully bogus input", () => {
    expect(() => MapProjectManifestSchema.parse({ foo: "bar" })).toThrow();
  });
});
