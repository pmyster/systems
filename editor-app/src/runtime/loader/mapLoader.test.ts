/**
 * Tests for mapLoader.
 *
 * The Tauri `invoke` is mocked at the module boundary so we exercise the
 * parse + validation paths without touching the Rust side. Each test builds
 * a tiny in-memory MapBundle and asserts the post-parse shape.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock must come BEFORE the import that uses the mocked module. Vitest
// hoists mocks above imports automatically.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { loadMapFromDir } from "./mapLoader";

const mockedInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

/** Build a manifest object for a `widthPx × heightPx` map. */
function makeManifest(widthPx: number, heightPx: number) {
  return {
    schemaVersion: 5,
    name: "test-map",
    metadata: {
      author: "test",
      theme: "default",
      dimensionsM: { width: (widthPx - 1) * 1, depth: (heightPx - 1) * 1 },
      createdAt: "2026-01-01T00:00:00.000Z",
      modifiedAt: "2026-01-01T00:00:00.000Z",
    },
    coordinateSystem: {
      up: "Y" as const,
      tileSizeM: 1,
      heightmapMPerPixel: 1,
      worldMPerUnit: 1,
    },
    terrain: {
      sidecar: "heightmap.r32" as const,
      widthPx,
      heightPx,
      tileSizeM: 1,
    },
    objects: [],
    spawnPoints: [],
    decals: [],
    elevationProfile: {
      mid: [0.35, 0.55, 0.22],
      high: [0.45, 0.55, 0.3],
      peak: [0.55, 0.55, 0.4],
    },
    splatToElevationMix: 0.75,
    atmosphere: {
      skyTop: [0.3, 0.5, 0.8],
      skyHorizon: [0.7, 0.9, 1.0],
      skyGround: [0.5, 0.6, 0.7],
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
}

/** Encode a heightmap Float32 array to little-endian byte array. */
function encodeHeights(values: readonly number[]): number[] {
  const arr = new Float32Array(values);
  const view = new DataView(arr.buffer);
  const out: number[] = [];
  for (let i = 0; i < arr.length; i++) {
    const f = view.getFloat32(i * 4, true);
    // Re-write so we exercise the "round-trip from raw bytes" path the
    // loader uses. We write back into the same DataView to capture the
    // exact little-endian bytes.
    view.setFloat32(i * 4, f, true);
  }
  const bytes = new Uint8Array(arr.buffer);
  for (let i = 0; i < bytes.length; i++) out.push(bytes[i]);
  return out;
}

describe("loadMapFromDir", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  it("decodes a 3×3 heightmap into a Float32Array of length 9", async () => {
    const manifest = makeManifest(3, 3);
    const heightValues = [0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0];
    mockedInvoke.mockResolvedValueOnce({
      manifest_json: JSON.stringify(manifest),
      heightmap_bytes: encodeHeights(heightValues),
      splatmap_bytes: [],
      colorpaint_bytes: [],
      thumbnail_bytes: [],
    });

    const loaded = await loadMapFromDir("/fake/dir");

    expect(loaded.dir).toBe("/fake/dir");
    expect(loaded.manifest.terrain.widthPx).toBe(3);
    expect(loaded.manifest.terrain.heightPx).toBe(3);
    expect(loaded.heightmap).toBeInstanceOf(Float32Array);
    expect(loaded.heightmap.length).toBe(9);
    for (let i = 0; i < heightValues.length; i++) {
      expect(loaded.heightmap[i]).toBeCloseTo(heightValues[i], 5);
    }
  });

  it("throws with a clear message when heightmap byte length is wrong", async () => {
    const manifest = makeManifest(3, 3); // expects 36 bytes
    mockedInvoke.mockResolvedValueOnce({
      manifest_json: JSON.stringify(manifest),
      heightmap_bytes: new Array(20).fill(0), // wrong size — 20 bytes
      splatmap_bytes: [],
      colorpaint_bytes: [],
      thumbnail_bytes: [],
    });

    await expect(loadMapFromDir("/fake/dir")).rejects.toThrow(/size mismatch/);
  });

  it("returns null splatmap and colorpaint when sidecars are absent", async () => {
    const manifest = makeManifest(2, 2);
    mockedInvoke.mockResolvedValueOnce({
      manifest_json: JSON.stringify(manifest),
      heightmap_bytes: encodeHeights([0, 0, 0, 0]),
      splatmap_bytes: [],
      colorpaint_bytes: [],
      thumbnail_bytes: [],
    });

    const loaded = await loadMapFromDir("/fake/dir");
    expect(loaded.splatmap).toBeNull();
    expect(loaded.colorpaint).toBeNull();
  });

  it("passes splatmap and colorpaint through as Uint8Array when present", async () => {
    const manifest = makeManifest(2, 2);
    mockedInvoke.mockResolvedValueOnce({
      manifest_json: JSON.stringify(manifest),
      heightmap_bytes: encodeHeights([0, 0, 0, 0]),
      splatmap_bytes: [255, 0, 0, 0, 255, 0, 0, 0],
      colorpaint_bytes: [10, 20, 30, 40],
      thumbnail_bytes: [],
    });

    const loaded = await loadMapFromDir("/fake/dir");
    expect(loaded.splatmap).toBeInstanceOf(Uint8Array);
    expect(loaded.splatmap?.length).toBe(8);
    expect(loaded.splatmap?.[0]).toBe(255);
    expect(loaded.colorpaint).toBeInstanceOf(Uint8Array);
    expect(loaded.colorpaint?.length).toBe(4);
    expect(loaded.colorpaint?.[3]).toBe(40);
  });
});
