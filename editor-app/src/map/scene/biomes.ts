/**
 * Biome registry — procedural generators for new map starting terrain.
 *
 * Each `BiomeDef` produces a fresh `(heightmap, splatmap)` pair sized to
 * the caller's dimensions. The registry is data-driven (loud-over-silent):
 * adding a new biome means registering one more `BiomeDef` here; the modal
 * UI iterates `biomeRegistry.list()` so a new entry shows up automatically.
 *
 * Channel convention matches the rest of the splatmap pipeline:
 *   R = grass, G = dirt, B = sand, A = scorched.
 *
 * Heightmap values are world meters relative to sea level (y=0). The
 * water plane sits at y=0, so negative heights become water.
 *
 * Elevation profile:
 *   Each biome OWNS its above-water color gradient via `elevationProfile`.
 *   The TerrainMesh shader reads `mid/high/peak` uniforms to tint terrain
 *   based on world-Y (water is fixed universal blue). `splatToElevationMix`
 *   controls how much the painted splatmap dominates over the elevation
 *   tint — lower = more biome character bleeds through.
 *
 * Atmosphere (v4):
 *   Each biome ALSO owns its sky, sun, hemi, and fog values via
 *   `atmosphere`. MapSceneManager pushes these into the scene whenever the
 *   store's atmosphere reference changes (New Map / load). This is what
 *   gives Mars its rust sky, Bioluminescent its purple night, Volcanic its
 *   hot-orange smoke.
 *
 *   Plus `colorVariance` — a 0..1 shader-driven noise tint applied to the
 *   elevation gradient. Low = uniform (alpine snow); high = patchy organic
 *   variation (Pasture rolling green, bioluminescent moss).
 */

import { createNoise2D } from "simplex-noise";

/**
 * Per-biome above-water color gradient. Water (y < 0) is always universal
 * blue and NOT controlled here. The three stops are:
 *   - mid:  ~0..2m   (sea-level to gentle hills)
 *   - high: ~2..5m   (high ground)
 *   - peak: >5m      (mountain peaks / spires)
 *
 * Each color is sRGB linear-space-ish 0..1 RGB (matches existing fallback
 * colors in TerrainMesh). The shader interpolates between them with
 * smooth mixes — no need for the biome author to think in band terms.
 */
export interface ElevationProfile {
  readonly mid: readonly [number, number, number];
  readonly high: readonly [number, number, number];
  readonly peak: readonly [number, number, number];
}

/**
 * Per-biome atmosphere — sky, sun, hemi-light, fog. Pushed into the scene
 * by MapSceneManager when the store's `atmosphere` reference changes.
 *
 * All RGB values are 0..1 linear-space tuples (we serialise them as
 * tuples to keep manifest.json human-readable; THREE.Color.setRGB consumes
 * them directly).
 */
export interface BiomeAtmosphere {
  readonly skyTop: readonly [number, number, number];
  readonly skyHorizon: readonly [number, number, number];
  readonly skyGround: readonly [number, number, number];
  readonly sunColor: readonly [number, number, number];
  readonly sunIntensity: number;
  readonly hemiSky: readonly [number, number, number];
  readonly hemiGround: readonly [number, number, number];
  readonly hemiIntensity: number;
  readonly fogColor: readonly [number, number, number];
  readonly fogNear: number;
  readonly fogFar: number;
}

export interface BiomeDef {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** CSS color shown in the modal swatch — picks up the dominant ground tone. */
  readonly previewColor: string;
  readonly elevationProfile: ElevationProfile;
  /**
   * Mix ratio between elevation tint and painted splatmap. 0 = pure
   * elevation gradient, 1 = pure splatmap. Below 0.5 lets the biome's
   * color identity dominate; above 0.7 lets the painted material shine.
   */
  readonly splatToElevationMix: number;
  /** Sky, sun, hemi, fog values applied when this biome is selected. */
  readonly atmosphere: BiomeAtmosphere;
  /**
   * Procedural color variance, 0..1. Drives a noise-based tint shift on
   * the elevation gradient in-shader. 0 = perfectly uniform; 1 = strong
   * patchy organic variation. Mid values (~0.3–0.5) give the "rolling
   * pasture" or "alien moss" look without looking noisy.
   */
  readonly colorVariance: number;
  generate(
    widthPx: number,
    heightPx: number,
    splatWidthPx: number,
    splatHeightPx: number,
  ): {
    heightmap: Float32Array;
    splatmap: Uint8Array;
  };
}

function makeUniformSplat(
  sw: number,
  sh: number,
  channel: 0 | 1 | 2 | 3,
): Uint8Array {
  const out = new Uint8Array(sw * sh * 4);
  for (let i = 0; i < sw * sh; i++) {
    out[i * 4 + channel] = 255;
  }
  return out;
}

class BiomeRegistry {
  /** Insertion-ordered list so the New Map modal can group realistic-then-alien. */
  private ordered: BiomeDef[] = [];
  private byId = new Map<string, BiomeDef>();
  register(d: BiomeDef): void {
    if (!this.byId.has(d.id)) {
      this.ordered.push(d);
    } else {
      // Replacement: keep slot in order.
      const i = this.ordered.findIndex((b) => b.id === d.id);
      if (i >= 0) this.ordered[i] = d;
    }
    this.byId.set(d.id, d);
  }
  get(id: string): BiomeDef | undefined {
    return this.byId.get(id);
  }
  list(): readonly BiomeDef[] {
    return this.ordered;
  }
}

export const biomeRegistry = new BiomeRegistry();

// ===========================================================================
// EARTH — 8 realistic biomes (registered first so the modal lists them first)
// ===========================================================================

// 1. Pasture — flat plane, vivid green, strong patchy variance. User sculpts.
biomeRegistry.register({
  id: "pasture",
  name: "Pasture",
  description: "Lush green pasture fields — sculpt your own hills",
  previewColor: "#4fbb22",
  elevationProfile: {
    mid: [0.42, 0.78, 0.2],
    high: [0.55, 0.85, 0.28],
    peak: [0.7, 0.92, 0.35],
  },
  splatToElevationMix: 0.35,
  colorVariance: 0.55,
  atmosphere: {
    skyTop: [0.4, 0.65, 0.92],
    skyHorizon: [0.85, 0.92, 1.0],
    skyGround: [0.55, 0.75, 0.45],
    sunColor: [1.0, 0.96, 0.85],
    sunIntensity: 2.4,
    hemiSky: [0.78, 0.92, 1.0],
    hemiGround: [0.45, 0.7, 0.25],
    hemiIntensity: 1.3,
    fogColor: [0.85, 0.92, 1.0],
    fogNear: 150,
    fogFar: 600,
  },
  generate: (w, h, sw, sh) => {
    // FLAT — user sculpts hills themselves.
    const heightmap = new Float32Array(w * h);
    for (let i = 0; i < heightmap.length; i++) heightmap[i] = 0.5;
    return { heightmap, splatmap: makeUniformSplat(sw, sh, 0) };
  },
});

// 2. Grassland — wild rolling meadow, golden hour pastoral
biomeRegistry.register({
  id: "grass",
  name: "Grassland",
  description: "Wild rolling meadow — golden hour pastoral",
  previewColor: "#a8b540",
  elevationProfile: {
    mid: [0.5, 0.58, 0.22],
    high: [0.62, 0.55, 0.28],
    peak: [0.75, 0.62, 0.35],
  },
  splatToElevationMix: 0.55,
  colorVariance: 0.4,
  atmosphere: {
    skyTop: [0.45, 0.65, 0.85],
    skyHorizon: [0.95, 0.85, 0.65],
    skyGround: [0.5, 0.45, 0.3],
    sunColor: [1.0, 0.88, 0.65],
    sunIntensity: 2.6,
    hemiSky: [0.85, 0.8, 0.7],
    hemiGround: [0.55, 0.5, 0.3],
    hemiIntensity: 1.1,
    fogColor: [0.92, 0.85, 0.7],
    fogNear: 120,
    fogFar: 500,
  },
  generate: (w, h, sw, sh) => {
    const noise = createNoise2D();
    const heightmap = new Float32Array(w * h);
    for (let z = 0; z < h; z++) {
      for (let x = 0; x < w; x++) {
        const swell = noise(x * 0.012, z * 0.012) * 1.5;
        heightmap[z * w + x] = Math.max(0.3, 1.0 + swell);
      }
    }
    return { heightmap, splatmap: makeUniformSplat(sw, sh, 0) };
  },
});

// 3. Mountains — classic alpine with snow peaks
biomeRegistry.register({
  id: "mountains",
  name: "Mountains",
  description: "Alpine peaks with snow caps and crisp cold air",
  previewColor: "#7a8a9f",
  elevationProfile: {
    mid: [0.3, 0.45, 0.22],
    high: [0.45, 0.42, 0.38],
    peak: [0.98, 0.98, 1.0],
  },
  splatToElevationMix: 0.45,
  colorVariance: 0.15,
  atmosphere: {
    skyTop: [0.35, 0.55, 0.85],
    skyHorizon: [0.85, 0.92, 1.0],
    skyGround: [0.65, 0.75, 0.85],
    sunColor: [1.0, 0.98, 0.95],
    sunIntensity: 2.8,
    hemiSky: [0.8, 0.9, 1.0],
    hemiGround: [0.55, 0.55, 0.65],
    hemiIntensity: 1.2,
    fogColor: [0.85, 0.92, 1.0],
    fogNear: 100,
    fogFar: 500,
  },
  generate: (w, h, sw, sh) => {
    const noise = createNoise2D();
    const heightmap = new Float32Array(w * h);
    for (let z = 0; z < h; z++) {
      for (let x = 0; x < w; x++) {
        const fbm =
          noise(x * 0.015, z * 0.015) * 8 + noise(x * 0.05, z * 0.05) * 3;
        heightmap[z * w + x] = Math.max(0, fbm);
      }
    }
    return { heightmap, splatmap: makeUniformSplat(sw, sh, 0) };
  },
});

// 4. Forested Mountains — misty verdant peaks with exposed stone (China-style)
biomeRegistry.register({
  id: "forested-mountains",
  name: "Forested Mountains",
  description: "Misty verdant peaks with exposed stone — China-style",
  previewColor: "#2a5028",
  elevationProfile: {
    mid: [0.18, 0.42, 0.18],
    high: [0.15, 0.38, 0.18],
    peak: [0.55, 0.55, 0.5],
  },
  splatToElevationMix: 0.35,
  colorVariance: 0.3,
  atmosphere: {
    skyTop: [0.55, 0.7, 0.8],
    skyHorizon: [0.78, 0.85, 0.85],
    skyGround: [0.45, 0.55, 0.5],
    sunColor: [1.0, 0.95, 0.85],
    sunIntensity: 2.2,
    hemiSky: [0.7, 0.82, 0.85],
    hemiGround: [0.3, 0.45, 0.3],
    hemiIntensity: 1.3,
    fogColor: [0.8, 0.85, 0.82],
    fogNear: 80,
    fogFar: 400,
  },
  generate: (w, h, sw, sh) => {
    const noise = createNoise2D();
    const heightmap = new Float32Array(w * h);
    for (let z = 0; z < h; z++) {
      for (let x = 0; x < w; x++) {
        const fbm =
          noise(x * 0.018, z * 0.018) * 7 + noise(x * 0.06, z * 0.06) * 2;
        heightmap[z * w + x] = Math.max(0, fbm);
      }
    }
    return { heightmap, splatmap: makeUniformSplat(sw, sh, 0) };
  },
});

// 5. Desert — hot golden Sahara dunes under blazing sun
biomeRegistry.register({
  id: "desert",
  name: "Desert",
  description: "Hot golden Sahara dunes under blazing sun",
  previewColor: "#e8b048",
  elevationProfile: {
    mid: [0.92, 0.72, 0.32],
    high: [0.95, 0.78, 0.38],
    peak: [1.0, 0.85, 0.45],
  },
  splatToElevationMix: 0.4,
  colorVariance: 0.25,
  atmosphere: {
    skyTop: [0.55, 0.72, 0.92],
    skyHorizon: [1.0, 0.85, 0.55],
    skyGround: [0.85, 0.65, 0.35],
    sunColor: [1.0, 0.92, 0.75],
    sunIntensity: 3.2,
    hemiSky: [1.0, 0.88, 0.65],
    hemiGround: [0.8, 0.6, 0.3],
    hemiIntensity: 1.3,
    fogColor: [1.0, 0.88, 0.6],
    fogNear: 150,
    fogFar: 600,
  },
  generate: (w, h, sw, sh) => {
    const noise = createNoise2D();
    const heightmap = new Float32Array(w * h);
    for (let z = 0; z < h; z++) {
      for (let x = 0; x < w; x++) {
        const dune = (noise(x * 0.025, z * 0.025) + 1) * 1.2;
        const ripple = noise(x * 0.1, z * 0.1) * 0.3;
        heightmap[z * w + x] = 0.5 + dune + ripple;
      }
    }
    return { heightmap, splatmap: makeUniformSplat(sw, sh, 2) };
  },
});

// 6. Wasteland — cratered post-apocalyptic ground choked in dust
biomeRegistry.register({
  id: "wasteland",
  name: "Wasteland",
  description: "Cratered post-apocalyptic ground choked in dust",
  previewColor: "#5a3a26",
  elevationProfile: {
    mid: [0.32, 0.22, 0.15],
    high: [0.2, 0.14, 0.1],
    peak: [0.12, 0.08, 0.06],
  },
  splatToElevationMix: 0.45,
  colorVariance: 0.35,
  atmosphere: {
    skyTop: [0.55, 0.45, 0.3],
    skyHorizon: [0.75, 0.55, 0.35],
    skyGround: [0.42, 0.32, 0.22],
    sunColor: [1.0, 0.75, 0.5],
    sunIntensity: 1.8,
    hemiSky: [0.8, 0.6, 0.4],
    hemiGround: [0.4, 0.3, 0.2],
    hemiIntensity: 0.9,
    fogColor: [0.72, 0.55, 0.35],
    fogNear: 60,
    fogFar: 300,
  },
  generate: (w, h, sw, sh) => {
    const noiseTerrain = createNoise2D();
    const noiseCrater = createNoise2D();
    const noiseSplat = createNoise2D();
    const heightmap = new Float32Array(w * h);
    for (let z = 0; z < h; z++) {
      for (let x = 0; x < w; x++) {
        const base =
          1.8 +
          noiseTerrain(x * 0.02, z * 0.02) * 1.5 +
          noiseTerrain(x * 0.08, z * 0.08) * 0.5;
        const craterNoise = (noiseCrater(x * 0.04, z * 0.04) + 1) * 0.5;
        const craterMask =
          craterNoise > 0.78
            ? Math.pow((craterNoise - 0.78) / 0.22, 2) * 3
            : 0;
        heightmap[z * w + x] = base - craterMask;
      }
    }
    const splatmap = new Uint8Array(sw * sh * 4);
    for (let z = 0; z < sh; z++) {
      for (let x = 0; x < sw; x++) {
        const idx = (z * sw + x) * 4;
        const n = (noiseSplat(x * 0.06, z * 0.06) + 1) * 0.5;
        if (n > 0.6) {
          splatmap[idx + 1] = 60;
          splatmap[idx + 3] = 195;
        } else if (n > 0.3) {
          splatmap[idx + 1] = 180;
          splatmap[idx + 3] = 75;
        } else {
          splatmap[idx + 1] = 230;
          splatmap[idx + 3] = 25;
        }
      }
    }
    return { heightmap, splatmap };
  },
});

// 7. Wetlands — marshy lowlands shrouded in gray haze
biomeRegistry.register({
  id: "wetlands",
  name: "Wetlands",
  description: "Marshy lowlands shrouded in gray haze",
  previewColor: "#4a6a5a",
  elevationProfile: {
    mid: [0.32, 0.5, 0.25],
    high: [0.35, 0.52, 0.28],
    peak: [0.42, 0.58, 0.35],
  },
  splatToElevationMix: 0.6,
  colorVariance: 0.3,
  atmosphere: {
    skyTop: [0.6, 0.68, 0.72],
    skyHorizon: [0.82, 0.85, 0.85],
    skyGround: [0.5, 0.55, 0.55],
    sunColor: [0.95, 0.92, 0.85],
    sunIntensity: 1.8,
    hemiSky: [0.78, 0.82, 0.82],
    hemiGround: [0.4, 0.48, 0.4],
    hemiIntensity: 1.0,
    fogColor: [0.78, 0.82, 0.78],
    fogNear: 50,
    fogFar: 300,
  },
  generate: (w, h, sw, sh) => {
    const noise = createNoise2D();
    const heightmap = new Float32Array(w * h);
    for (let z = 0; z < h; z++) {
      for (let x = 0; x < w; x++) {
        const fbm =
          noise(x * 0.05, z * 0.05) * 1.5 + noise(x * 0.15, z * 0.15) * 0.4;
        heightmap[z * w + x] = fbm - 0.7;
      }
    }
    return { heightmap, splatmap: makeUniformSplat(sw, sh, 0) };
  },
});

// 8. Island — tropical island ringed by turquoise sea
biomeRegistry.register({
  id: "island",
  name: "Island",
  description: "Tropical island ringed by turquoise sea",
  previewColor: "#3a8ab0",
  elevationProfile: {
    mid: [0.45, 0.65, 0.32],
    high: [0.55, 0.62, 0.38],
    peak: [0.7, 0.65, 0.55],
  },
  splatToElevationMix: 0.55,
  colorVariance: 0.25,
  atmosphere: {
    skyTop: [0.3, 0.6, 0.95],
    skyHorizon: [0.85, 0.95, 1.0],
    skyGround: [0.5, 0.8, 0.9],
    sunColor: [1.0, 0.96, 0.85],
    sunIntensity: 3.0,
    hemiSky: [0.7, 0.92, 1.0],
    hemiGround: [0.4, 0.65, 0.5],
    hemiIntensity: 1.3,
    fogColor: [0.85, 0.95, 1.0],
    fogNear: 200,
    fogFar: 700,
  },
  generate: (w, h, sw, sh) => {
    const noise = createNoise2D();
    const heightmap = new Float32Array(w * h);
    const cx = w / 2,
      cz = h / 2;
    const maxR = Math.min(w, h) * 0.4;
    for (let z = 0; z < h; z++) {
      for (let x = 0; x < w; x++) {
        const dx = x - cx,
          dz = z - cz;
        const r = Math.sqrt(dx * dx + dz * dz);
        const falloff = 1.0 - Math.min(1.0, r / maxR);
        const elev = falloff * falloff * 3.5 - 1.8;
        const detail = noise(x * 0.05, z * 0.05) * 0.6;
        heightmap[z * w + x] = elev + detail;
      }
    }
    const splatmap = new Uint8Array(sw * sh * 4);
    const scx = sw / 2,
      scz = sh / 2;
    const smaxR = Math.min(sw, sh) * 0.35;
    for (let z = 0; z < sh; z++) {
      for (let x = 0; x < sw; x++) {
        const dx = x - scx,
          dz = z - scz;
        const r = Math.sqrt(dx * dx + dz * dz);
        const t = Math.min(1.0, r / smaxR);
        const idx = (z * sw + x) * 4;
        splatmap[idx + 0] = Math.round((1 - t * 0.6) * 255);
        splatmap[idx + 2] = Math.round(t * 0.6 * 255);
      }
    }
    return { heightmap, splatmap };
  },
});

// ===========================================================================
// ALIEN — 4 sci-fi biomes (registered after EARTH so the modal lists them last)
// ===========================================================================

// 9. Mars — red planet dust dunes under rust sky
biomeRegistry.register({
  id: "mars",
  name: "Mars",
  description: "Red planet dust dunes under rust sky",
  previewColor: "#d04020",
  elevationProfile: {
    mid: [0.95, 0.32, 0.15],
    high: [0.85, 0.25, 0.1],
    peak: [0.65, 0.2, 0.08],
  },
  splatToElevationMix: 0.15,
  colorVariance: 0.3,
  atmosphere: {
    skyTop: [0.65, 0.35, 0.2],
    skyHorizon: [0.95, 0.55, 0.25],
    skyGround: [0.55, 0.25, 0.15],
    sunColor: [1.0, 0.65, 0.4],
    sunIntensity: 2.4,
    hemiSky: [0.92, 0.55, 0.3],
    hemiGround: [0.65, 0.28, 0.15],
    hemiIntensity: 1.1,
    fogColor: [0.85, 0.45, 0.22],
    fogNear: 80,
    fogFar: 400,
  },
  generate: (w, h, sw, sh) => {
    const noise = createNoise2D();
    const heightmap = new Float32Array(w * h);
    for (let z = 0; z < h; z++) {
      for (let x = 0; x < w; x++) {
        const dune = (noise(x * 0.02, z * 0.02) + 1) * 1.5;
        heightmap[z * w + x] =
          0.8 + dune + noise(x * 0.08, z * 0.08) * 0.4;
      }
    }
    return { heightmap, splatmap: makeUniformSplat(sw, sh, 2) };
  },
});

// 10. Alien Pastel — pink spires above teal moss under twin moons
biomeRegistry.register({
  id: "alien-pastel",
  name: "Alien Pastel",
  description: "Pink spires above teal moss under twin moons",
  previewColor: "#e85aa8",
  elevationProfile: {
    mid: [0.3, 0.82, 0.65],
    high: [0.85, 0.45, 0.75],
    peak: [1.0, 0.7, 0.92],
  },
  splatToElevationMix: 0.15,
  colorVariance: 0.4,
  atmosphere: {
    skyTop: [0.85, 0.45, 0.75],
    skyHorizon: [1.0, 0.75, 0.85],
    skyGround: [0.55, 0.75, 0.85],
    sunColor: [1.0, 0.8, 0.92],
    sunIntensity: 1.8,
    hemiSky: [1.0, 0.65, 0.85],
    hemiGround: [0.3, 0.85, 0.7],
    hemiIntensity: 1.4,
    fogColor: [0.95, 0.65, 0.85],
    fogNear: 100,
    fogFar: 500,
  },
  generate: (w, h, sw, sh) => {
    const noise = createNoise2D();
    const heightmap = new Float32Array(w * h);
    for (let z = 0; z < h; z++) {
      for (let x = 0; x < w; x++) {
        const spire = Math.max(0, noise(x * 0.04, z * 0.04)) * 6;
        const base = noise(x * 0.015, z * 0.015) * 1 + 0.8;
        heightmap[z * w + x] = base + spire * spire * 0.5;
      }
    }
    return { heightmap, splatmap: makeUniformSplat(sw, sh, 0) };
  },
});

// 11. Bioluminescent — dark teal valleys aglow with cyan light
biomeRegistry.register({
  id: "bioluminescent",
  name: "Bioluminescent",
  description: "Dark teal valleys aglow with cyan light",
  previewColor: "#22d8b8",
  elevationProfile: {
    mid: [0.05, 0.25, 0.22],
    high: [0.1, 0.45, 0.6],
    peak: [0.3, 1.0, 0.92],
  },
  splatToElevationMix: 0.12,
  colorVariance: 0.45,
  atmosphere: {
    skyTop: [0.1, 0.05, 0.25],
    skyHorizon: [0.2, 0.15, 0.45],
    skyGround: [0.05, 0.15, 0.2],
    sunColor: [0.4, 0.85, 0.9],
    sunIntensity: 1.4,
    hemiSky: [0.25, 0.45, 0.85],
    hemiGround: [0.05, 0.3, 0.3],
    hemiIntensity: 1.0,
    fogColor: [0.15, 0.25, 0.4],
    fogNear: 60,
    fogFar: 300,
  },
  generate: (w, h, sw, sh) => {
    const noise = createNoise2D();
    const heightmap = new Float32Array(w * h);
    for (let z = 0; z < h; z++) {
      for (let x = 0; x < w; x++) {
        const fbm =
          noise(x * 0.02, z * 0.02) * 4 + noise(x * 0.06, z * 0.06) * 1;
        heightmap[z * w + x] = Math.max(0.5, 1.5 + fbm);
      }
    }
    return { heightmap, splatmap: makeUniformSplat(sw, sh, 0) };
  },
});

// 12. Volcanic — black obsidian under hot lava-red sky, jagged peaks + red lava
biomeRegistry.register({
  id: "volcanic",
  name: "Volcanic",
  description: "Black obsidian under hot lava-red sky",
  previewColor: "#cc2010",
  elevationProfile: {
    mid: [0.18, 0.12, 0.1],
    high: [0.08, 0.05, 0.05],
    peak: [1.0, 0.3, 0.05],
  },
  splatToElevationMix: 0.18,
  colorVariance: 0.35,
  atmosphere: {
    skyTop: [0.35, 0.15, 0.12],
    skyHorizon: [0.85, 0.3, 0.15],
    skyGround: [0.3, 0.1, 0.08],
    sunColor: [1.0, 0.5, 0.2],
    sunIntensity: 2.0,
    hemiSky: [0.95, 0.35, 0.18],
    hemiGround: [0.2, 0.08, 0.05],
    hemiIntensity: 1.0,
    fogColor: [0.65, 0.22, 0.12],
    fogNear: 50,
    fogFar: 280,
  },
  generate: (w, h, sw, sh) => {
    const noise = createNoise2D();
    const heightmap = new Float32Array(w * h);
    for (let z = 0; z < h; z++) {
      for (let x = 0; x < w; x++) {
        // Jagged peaks: ridge noise (abs(noise) → sharp valleys) layered
        // on top of fbm gives the obsidian-blade silhouette.
        const fbm = noise(x * 0.02, z * 0.02) * 5;
        const ridge = Math.abs(noise(x * 0.035, z * 0.035));
        const sharp = Math.pow(ridge, 0.5) * 5;
        heightmap[z * w + x] = Math.max(0, 1 + fbm + sharp);
      }
    }
    return { heightmap, splatmap: makeUniformSplat(sw, sh, 3) };
  },
});

/**
 * Set of biome ids classified as "EARTH" (realistic). The modal uses this
 * to draw the EARTH/ALIEN section labels — biomes not in this set are
 * rendered under the ALIEN heading.
 *
 * Loud-over-silent: if a future biome is added but missed here, it falls
 * to the ALIEN bucket visibly (a new card under the alien heading) rather
 * than silently disappearing — analogous to the "?" bucket pattern.
 */
export const EARTH_BIOME_IDS: ReadonlySet<string> = new Set([
  "pasture",
  "grass",
  "mountains",
  "forested-mountains",
  "desert",
  "wasteland",
  "wetlands",
  "island",
]);

/** Default elevation profile applied when loading a pre-v3 map (Grassland-equiv). */
export const DEFAULT_ELEVATION_PROFILE: ElevationProfile = {
  mid: [0.35, 0.55, 0.22],
  high: [0.45, 0.55, 0.3],
  peak: [0.55, 0.55, 0.4],
};
export const DEFAULT_SPLAT_TO_ELEVATION_MIX = 0.75;

/**
 * Default atmosphere applied when loading a pre-v4 map. Matches the
 * previous hardcoded MapSceneManager daylight rig so pre-v4 maps render
 * identically to how they did before the atmosphere system existed.
 */
export const DEFAULT_ATMOSPHERE: BiomeAtmosphere = {
  skyTop: [0.31, 0.56, 0.81], // 0x4f8fcf — previous SkyDome topColor
  skyHorizon: [0.78, 0.9, 1.0], // 0xc8e6ff — previous SkyDome horizonColor
  skyGround: [0.54, 0.63, 0.71], // 0x8aa0b5 — previous SkyDome groundColor
  sunColor: [1.0, 0.97, 0.91], // 0xfff8e8 — previous DirectionalLight color
  sunIntensity: 2.6,
  hemiSky: [0.78, 0.9, 1.0], // 0xc8e6ff — previous HemisphereLight sky
  hemiGround: [0.42, 0.63, 0.29], // 0x6ba14a — previous HemisphereLight ground
  hemiIntensity: 1.15,
  fogColor: [0.78, 0.9, 1.0], // 0xc8e6ff — previous Fog color
  fogNear: 100,
  fogFar: 500,
};

/** Default color variance applied when loading a pre-v4 map. */
export const DEFAULT_COLOR_VARIANCE = 0;
