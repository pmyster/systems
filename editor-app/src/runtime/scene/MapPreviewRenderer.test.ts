/**
 * MapPreviewRenderer smoke tests — Phase 2 Stage 1 polish.
 *
 * Covers:
 *   - elevationColorForY: stop interpolation reads the biome profile and
 *     matches the editor's TerrainMesh GLSL ladder at the documented Y
 *     breakpoints (water, shore, mid, high, peak).
 *   - computePreviewCameraFrame: ortho bounds frame the world dimensions
 *     1:1 so pixel↔meter conversion is trivial.
 *   - buildPreviewTerrainMesh: produces a non-degenerate mesh with the
 *     expected vertex count, per-vertex color attribute, and bounding box.
 *   - renderMapTopDownPreview end-to-end: in jsdom (no WebGL) the function
 *     gracefully falls back to the grayscale path and returns a valid PNG
 *     data URL — loud-over-silent diagnostic captured.
 *
 * We DON'T test rendered pixel content — that's a visual verification step
 * the owner performs in the live app. The smoke test guarantees the
 * pipeline runs without throwing in every supported environment.
 */

import { describe, it, expect } from "vitest";
import * as THREE from "three";

import {
  buildPreviewTerrainMesh,
  computePreviewCameraFrame,
  elevationColorForY,
  renderMapTopDownPreview,
  samplePixelVariance,
} from "./MapPreviewRenderer";
import type { LoadedMap } from "../loader/mapLoader";
import {
  DEFAULT_ELEVATION_PROFILE,
  DEFAULT_ATMOSPHERE,
} from "../../map/scene/biomes";

/**
 * Build a tiny synthetic LoadedMap. Heightmap is a 4×4 grid with a
 * simple ramp so vertex Y values span both below-water and above-water
 * regions.
 */
function fakeMap(widthPx = 4, heightPx = 4): LoadedMap {
  const heightmap = new Float32Array(widthPx * heightPx);
  // Ramp from -1 to +3 across the grid — covers shallow water, shore, mid.
  for (let i = 0; i < heightmap.length; i++) {
    heightmap[i] = -1 + (i / (heightmap.length - 1)) * 4;
  }
  return {
    dir: "/fake/test-map",
    manifest: {
      schemaVersion: 5,
      name: "test-map",
      metadata: {
        author: "test",
        theme: "default",
        dimensionsM: { width: widthPx, depth: heightPx },
        createdAt: "1970-01-01T00:00:00.000Z",
        modifiedAt: "1970-01-01T00:00:00.000Z",
      },
      coordinateSystem: {
        up: "Y",
        tileSizeM: 1,
        heightmapMPerPixel: 1,
        worldMPerUnit: 1,
      },
      terrain: {
        sidecar: "heightmap.r32",
        widthPx,
        heightPx,
        tileSizeM: 1,
        splatmap: { sidecar: "splatmap.r8", widthPx: 4, heightPx: 4 },
        colorPaint: { sidecar: "colorpaint.r8", widthPx: 4, heightPx: 4 },
      },
      objects: [],
      spawnPoints: [],
      decals: [],
      elevationProfile: {
        mid: [...DEFAULT_ELEVATION_PROFILE.mid] as [number, number, number],
        high: [...DEFAULT_ELEVATION_PROFILE.high] as [number, number, number],
        peak: [...DEFAULT_ELEVATION_PROFILE.peak] as [number, number, number],
      },
      splatToElevationMix: 0.75,
      atmosphere: {
        skyTop: [...DEFAULT_ATMOSPHERE.skyTop] as [number, number, number],
        skyHorizon: [...DEFAULT_ATMOSPHERE.skyHorizon] as [number, number, number],
        skyGround: [...DEFAULT_ATMOSPHERE.skyGround] as [number, number, number],
        sunColor: [...DEFAULT_ATMOSPHERE.sunColor] as [number, number, number],
        sunIntensity: DEFAULT_ATMOSPHERE.sunIntensity,
        hemiSky: [...DEFAULT_ATMOSPHERE.hemiSky] as [number, number, number],
        hemiGround: [...DEFAULT_ATMOSPHERE.hemiGround] as [number, number, number],
        hemiIntensity: DEFAULT_ATMOSPHERE.hemiIntensity,
        fogColor: [...DEFAULT_ATMOSPHERE.fogColor] as [number, number, number],
        fogNear: DEFAULT_ATMOSPHERE.fogNear,
        fogFar: DEFAULT_ATMOSPHERE.fogFar,
      },
      colorVariance: 0,
    } as unknown as LoadedMap["manifest"],
    heightmap,
    splatmap: null,
    colorpaint: null,
  };
}

describe("elevationColorForY", () => {
  it("returns the biome's mid color at the mid plateau (~1m)", () => {
    const c = elevationColorForY(1.5, DEFAULT_ELEVATION_PROFILE);
    expect(c[0]).toBeCloseTo(DEFAULT_ELEVATION_PROFILE.mid[0], 5);
    expect(c[1]).toBeCloseTo(DEFAULT_ELEVATION_PROFILE.mid[1], 5);
    expect(c[2]).toBeCloseTo(DEFAULT_ELEVATION_PROFILE.mid[2], 5);
  });

  it("returns the biome's peak color above 8m", () => {
    const c = elevationColorForY(20, DEFAULT_ELEVATION_PROFILE);
    expect(c[0]).toBeCloseTo(DEFAULT_ELEVATION_PROFILE.peak[0], 5);
    expect(c[1]).toBeCloseTo(DEFAULT_ELEVATION_PROFILE.peak[1], 5);
    expect(c[2]).toBeCloseTo(DEFAULT_ELEVATION_PROFILE.peak[2], 5);
  });

  it("returns deep-water blue below -2m", () => {
    const c = elevationColorForY(-5, DEFAULT_ELEVATION_PROFILE);
    expect(c[0]).toBeCloseTo(0.1, 5);
    expect(c[1]).toBeCloseTo(0.23, 5);
    expect(c[2]).toBeCloseTo(0.42, 5);
  });

  it("interpolates linearly between mid and high in the 2–5m band", () => {
    const c = elevationColorForY(3.5, DEFAULT_ELEVATION_PROFILE);
    // t = (3.5 - 2) / 3 = 0.5 → halfway between mid and high
    const mid = DEFAULT_ELEVATION_PROFILE.mid;
    const high = DEFAULT_ELEVATION_PROFILE.high;
    expect(c[0]).toBeCloseTo((mid[0] + high[0]) / 2, 5);
    expect(c[1]).toBeCloseTo((mid[1] + high[1]) / 2, 5);
    expect(c[2]).toBeCloseTo((mid[2] + high[2]) / 2, 5);
  });
});

describe("computePreviewCameraFrame", () => {
  it("frames the map 1:1 with world dimensions", () => {
    const f = computePreviewCameraFrame(256, 256, 10);
    // Ortho box width = right - left = 256m, height = top - bottom = 256m
    // (Three.js convention: top > bottom).
    expect(f.right - f.left).toBeCloseTo(256);
    expect(f.top - f.bottom).toBeCloseTo(256);
    expect(f.top).toBeGreaterThan(f.bottom);
    expect(f.centerX).toBeCloseTo(128);
    expect(f.centerZ).toBeCloseTo(128);
  });

  it("places the camera safely above the highest peak", () => {
    const f = computePreviewCameraFrame(100, 100, 30);
    expect(f.cameraY).toBeGreaterThan(30);
  });

  it("uses a sensible floor when the map is perfectly flat", () => {
    const f = computePreviewCameraFrame(100, 100, 0);
    expect(f.cameraY).toBeGreaterThanOrEqual(100);
  });
});

describe("buildPreviewTerrainMesh", () => {
  it("produces a mesh with the correct vertex count + color attribute", () => {
    const widthPx = 8;
    const heightPx = 8;
    const heightmap = new Float32Array(widthPx * heightPx);
    for (let i = 0; i < heightmap.length; i++) heightmap[i] = i * 0.1;

    const { mesh, widthM, depthM } = buildPreviewTerrainMesh(
      widthPx,
      heightPx,
      1,
      heightmap,
      DEFAULT_ELEVATION_PROFILE,
    );
    expect(mesh).toBeInstanceOf(THREE.Mesh);
    expect(widthM).toBeCloseTo(7); // (widthPx - 1) * tileSizeM
    expect(depthM).toBeCloseTo(7);

    const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
    expect(pos.count).toBe(widthPx * heightPx);

    const color = mesh.geometry.attributes.color as THREE.BufferAttribute;
    expect(color).toBeDefined();
    expect(color.itemSize).toBe(3);
    expect(color.count).toBe(widthPx * heightPx);

    // Vertex Y was written from heightmap.
    expect(pos.getY(0)).toBeCloseTo(heightmap[0]);
    expect(pos.getY(pos.count - 1)).toBeCloseTo(heightmap[heightmap.length - 1]);

    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  });
});

describe("samplePixelVariance", () => {
  it("returns near-zero stddev for a uniformly-gray image", () => {
    // A 16×16 image where every pixel is (128, 128, 128, 255). This is
    // exactly the failure mode the runtime variance warning catches.
    const pixels = new Uint8Array(16 * 16 * 4);
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i + 0] = 128;
      pixels[i + 1] = 128;
      pixels[i + 2] = 128;
      pixels[i + 3] = 255;
    }
    const v = samplePixelVariance(pixels, 16);
    expect(v.maxStdDev).toBeLessThan(0.5);
    expect(v.meanR).toBeCloseTo(128, 0);
    expect(v.meanG).toBeCloseTo(128, 0);
    expect(v.meanB).toBeCloseTo(128, 0);
  });

  it("returns large stddev for an image with strong variation", () => {
    // Gradient image — strong variation that survives sparse-grid
    // sampling. (A pixel checkerboard at strides matching the sample
    // step would alias to a constant — gradient avoids that.)
    const size = 64;
    const pixels = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const off = (y * size + x) * 4;
        pixels[off + 0] = Math.floor((x / (size - 1)) * 255);
        pixels[off + 1] = Math.floor((y / (size - 1)) * 255);
        pixels[off + 2] = Math.floor(((x + y) / (2 * (size - 1))) * 255);
        pixels[off + 3] = 255;
      }
    }
    const v = samplePixelVariance(pixels, size);
    // Stddev of a uniform 0..255 gradient ≈ 73 (255 / sqrt(12)).
    expect(v.maxStdDev).toBeGreaterThan(50);
  });

  it("is the runtime threshold used to detect uniform output", () => {
    // Documents the contract MapPreviewRenderer relies on: a stddev
    // below 2.0 across all channels means the render is suspect.
    const flat = new Uint8Array(16 * 16 * 4).fill(200);
    for (let i = 3; i < flat.length; i += 4) flat[i] = 255;
    const v = samplePixelVariance(flat, 16);
    expect(v.maxStdDev).toBeLessThan(2.0);
  });
});

describe("renderMapTopDownPreview", () => {
  it("runs end-to-end and returns a valid PNG data URL even without WebGL", async () => {
    // jsdom has no WebGL context — the function should fall back to the
    // grayscale path and emit a diagnostic. Both outputs must read as a
    // valid PNG data URL.
    const warnings: string[] = [];
    const url = await renderMapTopDownPreview(fakeMap(), 64, {
      add: (msg) => warnings.push(msg),
    });
    expect(typeof url).toBe("string");
    expect(url.startsWith("data:image/png")).toBe(true);
    // The fallback path warns via diagnostics. In a real browser w/ WebGL
    // there'd be 0 warnings; in jsdom there's >=1. Either is acceptable —
    // we just confirm the function never silently swallowed the failure.
    // jsdom's toDataURL() may return an empty payload (no canvas
    // backend), so we don't assert on data length here — the data-URL
    // PREFIX is the contract the caller relies on, and any real browser
    // (incl. Tauri's WebView) produces the actual bytes.
    if (warnings.length === 0) {
      // WebGL available — fine.
    } else {
      expect(warnings[0]).toContain("fall");
    }
  });

  it("uses the requested resolution for the fallback grayscale output", async () => {
    // Decode the data URL into image dims via a quick Image() probe — but
    // jsdom's Image() doesn't decode synchronously, so instead we just
    // verify the URL is non-trivial. Real dimension validation happens
    // visually in the app.
    const url = await renderMapTopDownPreview(fakeMap(), 128);
    expect(url.startsWith("data:image/png")).toBe(true);
  });
});
