/**
 * MapPreviewRenderer — Phase 2 Stage 1 polish
 *
 * Renders a beautiful top-down 3D view of a LoadedMap to a PNG data URL.
 * Used by the Match Setup "Place Buildings" step so the owner can drop
 * building tokens onto an actual picture of his battlefield (biome colors,
 * elevation shading, sun-lit normals) instead of the previous unreadable
 * grayscale heightmap.
 *
 * Visual recipe (mirrors the Map Editor's authored look without importing
 * its scene module — see the architectural-call note below):
 *
 *   1. PlaneGeometry sized to the map's world dimensions, one segment per
 *      heightmap pixel (so silhouettes are sharp).
 *   2. The heightmap is written into each vertex's Y component → the
 *      terrain has real elevation that reads under raked sunlight.
 *   3. Per-vertex COLOR is computed CPU-side by interpolating the biome's
 *      `elevationProfile` (mid/high/peak above water; fixed deep-water /
 *      shallow / wet-sand for y<0). Same color stops the editor's
 *      TerrainMesh shader uses — so a Mars map reads rust-red, Pasture
 *      green, Volcanic black-with-orange peaks, etc.
 *   4. Lighting: one DirectionalLight (sun) + one HemisphereLight, both
 *      configured from the biome's `atmosphere`. Same as the editor.
 *   5. Ortho camera positioned at (cx, +Y_high, cz) looking down −Y, with
 *      `left/right/top/bottom` framed to the world dimensions exactly.
 *      → The rendered image is 1:1 with world meters; PlaceBuildingsStep's
 *        existing pixel↔meter math keeps working unchanged.
 *   6. Background painted with the atmosphere's skyHorizon color so the
 *      out-of-map margin reads as sky/air rather than charcoal void.
 *   7. Fog DISABLED — same rationale as the editor's
 *      ENABLE_MAP_EDITOR_FOG = false: fog is wonderful for in-game
 *      atmosphere but actively HURTS readability in a top-down placement
 *      view (it greys out distant elevation contrast). The brief calls
 *      this out explicitly.
 *
 * Architectural call — copied vs. imported the Map Editor's materials:
 *   The brief said "Don't import directly — it's editor code, not runtime."
 *   I respected that and built the preview's terrain from scratch using a
 *   plain MeshStandardMaterial with vertexColors, applying the biome's
 *   `elevationProfile` stops CPU-side. The result reproduces the editor's
 *   *biome identity* (every biome's dominant color signature) without
 *   inheriting the shader-injection complexity (splatmap tile texture
 *   pipeline, color-paint overlay sampling, noise-driven color variance).
 *   Those polish layers can be added later if needed — for placement
 *   decisions the top-down biome silhouette is the load-bearing signal.
 *
 * Loud-over-silent (CLAUDE.md rule #1):
 *   The renderer construction is wrapped in try/catch. On failure (WebGL
 *   context unavailable — jsdom tests, OOM, lost context, etc.) we WARN
 *   via the optional diagnostics collector and fall back to the legacy
 *   grayscale heightmap data URL. The preview NEVER silently produces a
 *   blank canvas — either the 3D render lands, or the grayscale fallback
 *   does, with the user told why.
 *
 * Resolution / pixel↔meter mapping:
 *   The default 1024×1024 px output for a 256×256 m map gives 4 px/m. The
 *   caller (PlaceBuildingsStep) does its pixel↔meter conversion off the
 *   canvas's pixel dimensions, so any returned image dimensions work —
 *   the function returns a square PNG of the requested side length, and
 *   the placement math reads the size off `<canvas width=...>`.
 */

import * as THREE from "three";

import type { LoadedMap } from "../loader/mapLoader";
import {
  DEFAULT_ATMOSPHERE,
  DEFAULT_ELEVATION_PROFILE,
  type BiomeAtmosphere,
  type ElevationProfile,
} from "../../map/scene/biomes";

/** Diagnostics-style sink. Kept structural so we don't pull LoadDiagnostics
 *  into a render-time util just to push warnings.
 */
export interface PreviewDiagnostics {
  add(message: string, detail?: unknown): void;
}

/** Universal water-tone stops — identical to the editor's terrain shader. */
const DEEP_WATER: readonly [number, number, number] = [0.1, 0.23, 0.42];
const SHALLOW: readonly [number, number, number] = [0.23, 0.54, 0.69];
const WET_SAND: readonly [number, number, number] = [0.54, 0.44, 0.31];

/** Linear mix between two RGB tuples. */
function mixRgb(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  t: number,
): [number, number, number] {
  const ct = Math.max(0, Math.min(1, t));
  return [a[0] + (b[0] - a[0]) * ct, a[1] + (b[1] - a[1]) * ct, a[2] + (b[2] - a[2]) * ct];
}

/**
 * Color a single vertex by world-Y, using the biome's elevation profile.
 * Mirrors the smoothstep ladder in TerrainMesh's `elevationColor()` GLSL —
 * water tones fixed, above-water reads from the biome's mid/high/peak.
 */
export function elevationColorForY(
  y: number,
  profile: ElevationProfile,
): [number, number, number] {
  if (y < -2.0) return [DEEP_WATER[0], DEEP_WATER[1], DEEP_WATER[2]];
  if (y < -0.5) return mixRgb(DEEP_WATER, SHALLOW, (y + 2.0) / 1.5);
  if (y < 0.0) return mixRgb(SHALLOW, WET_SAND, (y + 0.5) / 0.5);
  if (y < 0.5) return mixRgb(WET_SAND, profile.mid, y / 0.5);
  if (y < 2.0) return [profile.mid[0], profile.mid[1], profile.mid[2]];
  if (y < 5.0) return mixRgb(profile.mid, profile.high, (y - 2.0) / 3.0);
  if (y < 8.0) return mixRgb(profile.high, profile.peak, (y - 5.0) / 3.0);
  return [profile.peak[0], profile.peak[1], profile.peak[2]];
}

/**
 * Build a vertex-colored, lit terrain mesh sized to (widthM × depthM)
 * with `widthPx × heightPx` segments. The returned mesh is anchored at
 * world origin (corner at 0,0,0) — same convention as RuntimeTerrain
 * and the editor's TerrainMesh.
 *
 * Exposed for testing — pure mesh construction, no renderer needed.
 */
export function buildPreviewTerrainMesh(
  widthPx: number,
  heightPx: number,
  tileSizeM: number,
  heightmap: Float32Array,
  profile: ElevationProfile,
): { mesh: THREE.Mesh; widthM: number; depthM: number } {
  const widthM = (widthPx - 1) * tileSizeM;
  const depthM = (heightPx - 1) * tileSizeM;

  const geometry = new THREE.PlaneGeometry(widthM, depthM, widthPx - 1, heightPx - 1);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(widthM / 2, 0, depthM / 2);

  const posAttr = geometry.attributes.position as THREE.BufferAttribute;
  const n = Math.min(heightmap.length, posAttr.count);
  // Apply heightmap → vertex Y. Same row-major indexing as
  // RuntimeTerrain (`i = row * widthPx + col`).
  for (let i = 0; i < n; i++) posAttr.setY(i, heightmap[i]);
  posAttr.needsUpdate = true;
  geometry.computeVertexNormals();

  // Per-vertex color from biome elevation profile. CPU-side cost is
  // O(verts) — for a 257×257 map that's ~66k color writes, done once
  // per render. Cheap.
  const colors = new Float32Array(posAttr.count * 3);
  for (let i = 0; i < posAttr.count; i++) {
    const y = posAttr.getY(i);
    const [r, g, b] = elevationColorForY(y, profile);
    colors[i * 3 + 0] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  // White base color → vertex colors come through unmodulated.
  // Roughness matches the editor's terrain so the sun reads as a soft
  // raked light rather than a chrome-y specular highlight.
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.95,
    metalness: 0.0,
    side: THREE.FrontSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "MapPreviewTerrain";
  return { mesh, widthM, depthM };
}

/**
 * Compute the camera ortho frustum + height for a given map dimension.
 * Pulled out so tests can verify framing math without spinning up a
 * renderer.
 */
export function computePreviewCameraFrame(
  widthM: number,
  depthM: number,
  maxHeightM: number,
): {
  left: number;
  right: number;
  top: number;
  bottom: number;
  cameraY: number;
  centerX: number;
  centerZ: number;
} {
  // Frame exactly the map's world dimensions. With the camera looking
  // straight down -Y and `up = (0, 0, -1)` (north-up convention so the
  // image's +X is world +X and +Y is world +Z — i.e. pxX↔worldX,
  // pxY↔worldZ), the ortho box maps 1:1 to world meters.
  const centerX = widthM / 2;
  const centerZ = depthM / 2;
  return {
    // Half-extents centered on the map middle.
    left: -widthM / 2,
    right: widthM / 2,
    top: -depthM / 2,
    bottom: depthM / 2,
    // Position the camera safely above the highest peak. Cheap padding
    // so the near plane doesn't clip; the ortho projection is
    // height-invariant anyway.
    cameraY: Math.max(maxHeightM + 50, 100),
    centerX,
    centerZ,
  };
}

/** Sample the max height in the heightmap — used for camera placement. */
function maxHeightOf(heightmap: Float32Array): number {
  let m = -Infinity;
  for (let i = 0; i < heightmap.length; i++) {
    if (heightmap[i] > m) m = heightmap[i];
  }
  return Number.isFinite(m) ? m : 0;
}

/**
 * Render a 1×1-with-world top-down preview of the given LoadedMap and
 * return a PNG data URL.
 *
 * Pure async / one-shot. The off-screen WebGLRenderer is constructed,
 * used, and disposed — the live game renderer (if any) is untouched.
 *
 * On any WebGL failure (no context, render-target read failure, etc.)
 * this WARNs through `diagnostics` and falls back to the grayscale
 * heightmap data URL. The caller can use the returned URL without
 * checking which path produced it — but it will never be empty.
 */
export async function renderMapTopDownPreview(
  map: LoadedMap,
  resolutionPx: number = 1024,
  diagnostics?: PreviewDiagnostics,
): Promise<string> {
  try {
    return await renderViaWebGL(map, resolutionPx);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    diagnostics?.add(
      `MapPreviewRenderer failed (${msg}); falling back to grayscale heightmap.`,
      e,
    );
    // Loud-over-silent: emit a console warn even if no diagnostics sink
    // was passed — the user still gets *some* preview (grayscale), but
    // a dev with F12 open sees the cause.
    // eslint-disable-next-line no-console
    console.warn("[MapPreviewRenderer] 3D render failed, falling back:", e);
    return renderGrayscaleFallback(map, resolutionPx);
  }
}

/**
 * The real path. Builds an off-screen scene + ortho camera, renders to a
 * WebGLRenderTarget, reads pixels back, paints into a 2D canvas, returns
 * the data URL. Disposes every resource before returning.
 */
async function renderViaWebGL(
  map: LoadedMap,
  resolutionPx: number,
): Promise<string> {
  const widthPx = map.manifest.terrain.widthPx;
  const heightPx = map.manifest.terrain.heightPx;
  const tileM = map.manifest.terrain.tileSizeM ?? 1;

  // Atmosphere + elevation profile fall back to the v3/v4 defaults for
  // pre-migration maps. Loud-over-silent isn't needed here: those
  // defaults match the legacy daylight rig exactly so old maps render
  // identically to how they used to.
  const profile = map.manifest.elevationProfile ?? DEFAULT_ELEVATION_PROFILE;
  const atmosphere: BiomeAtmosphere =
    map.manifest.atmosphere ?? DEFAULT_ATMOSPHERE;

  // Off-screen renderer — separate instance so we don't touch any live
  // game state. preserveDrawingBuffer is unnecessary because we render
  // to a RenderTarget and read pixels from it directly.
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(resolutionPx, resolutionPx, false);

  const scene = new THREE.Scene();
  // Background = sky horizon — keeps off-map margins from reading as
  // void. Fog stays null (see header rationale).
  scene.background = new THREE.Color(
    atmosphere.skyHorizon[0],
    atmosphere.skyHorizon[1],
    atmosphere.skyHorizon[2],
  );
  scene.fog = null;

  // Lights — sun + hemi, configured from the biome atmosphere. Same
  // construction shape as MapSceneManager so the preview reads
  // tonally consistent with the editor.
  const sun = new THREE.DirectionalLight(0xffffff, atmosphere.sunIntensity);
  sun.color.setRGB(
    atmosphere.sunColor[0],
    atmosphere.sunColor[1],
    atmosphere.sunColor[2],
  );
  // Sun positioned high and slightly off-axis so terrain reads with
  // raked shadow shading rather than flat noon light (which would
  // wash out elevation contrast — the exact problem we're solving).
  const widthM = (widthPx - 1) * tileM;
  const depthM = (heightPx - 1) * tileM;
  sun.position.set(widthM * 0.7, widthM * 1.2, depthM * 0.3);
  sun.target.position.set(widthM / 2, 0, depthM / 2);
  scene.add(sun);
  scene.add(sun.target);

  const hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, atmosphere.hemiIntensity);
  hemi.color.setRGB(
    atmosphere.hemiSky[0],
    atmosphere.hemiSky[1],
    atmosphere.hemiSky[2],
  );
  hemi.groundColor.setRGB(
    atmosphere.hemiGround[0],
    atmosphere.hemiGround[1],
    atmosphere.hemiGround[2],
  );
  scene.add(hemi);

  // Terrain mesh.
  const { mesh: terrain } = buildPreviewTerrainMesh(
    widthPx,
    heightPx,
    tileM,
    map.heightmap,
    profile,
  );
  scene.add(terrain);

  // Water plane at y=0 — only shows where the heightmap dips below sea
  // level (deep water tones already authored into elevationColorForY,
  // but a translucent plane above gives the shore the proper wet sheen).
  // We keep it small + cheap — no shader, just a tinted PlaneGeometry.
  const waterGeom = new THREE.PlaneGeometry(widthM, depthM, 1, 1);
  waterGeom.rotateX(-Math.PI / 2);
  waterGeom.translate(widthM / 2, 0, depthM / 2);
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x2a5a9a,
    transparent: true,
    opacity: 0.55,
    roughness: 0.4,
    metalness: 0.2,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const water = new THREE.Mesh(waterGeom, waterMat);
  water.position.y = -0.05;
  water.renderOrder = 1;
  scene.add(water);

  // Camera — ortho, looking straight down. Frame the world dimensions
  // exactly so image space = world space.
  const maxH = maxHeightOf(map.heightmap);
  const frame = computePreviewCameraFrame(widthM, depthM, maxH);
  const camera = new THREE.OrthographicCamera(
    frame.left,
    frame.right,
    frame.top,
    frame.bottom,
    0.1,
    frame.cameraY + 200,
  );
  camera.position.set(frame.centerX, frame.cameraY, frame.centerZ);
  // Look at the map center (straight down).
  camera.lookAt(frame.centerX, 0, frame.centerZ);
  // Override `up` so the image's +Y axis points to world +Z (north-down
  // in image space matches the editor's worldZ-increasing convention,
  // which PlaceBuildingsStep already assumes when mapping canvas Y to
  // worldZ).
  camera.up.set(0, 0, -1);
  camera.lookAt(frame.centerX, 0, frame.centerZ);

  // Render to a RenderTarget so we can readPixels deterministically
  // regardless of whether the renderer canvas is in the DOM.
  const renderTarget = new THREE.WebGLRenderTarget(resolutionPx, resolutionPx, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
  });

  renderer.setRenderTarget(renderTarget);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);

  const pixels = new Uint8Array(resolutionPx * resolutionPx * 4);
  renderer.readRenderTargetPixels(
    renderTarget,
    0,
    0,
    resolutionPx,
    resolutionPx,
    pixels,
  );

  // Paint into a 2D canvas. WebGL pixel rows are bottom-up; flip into
  // top-down so the resulting PNG reads like the rendered scene.
  const canvas = document.createElement("canvas");
  canvas.width = resolutionPx;
  canvas.height = resolutionPx;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    renderTarget.dispose();
    renderer.dispose();
    disposeScene(scene);
    throw new Error("MapPreviewRenderer: 2D canvas context unavailable");
  }
  const imageData = ctx.createImageData(resolutionPx, resolutionPx);
  const rowBytes = resolutionPx * 4;
  for (let y = 0; y < resolutionPx; y++) {
    const srcRow = (resolutionPx - 1 - y) * rowBytes;
    const dstRow = y * rowBytes;
    for (let x = 0; x < rowBytes; x++) {
      imageData.data[dstRow + x] = pixels[srcRow + x];
    }
  }
  ctx.putImageData(imageData, 0, 0);
  const dataUrl = canvas.toDataURL("image/png");

  // Cleanup — every GPU resource we touched. Three.js doesn't auto-free
  // and orphaned WebGL contexts cap at ~16 in most browsers, so leaking
  // one per match-load would gradually break the app.
  renderTarget.dispose();
  renderer.dispose();
  disposeScene(scene);

  return dataUrl;
}

/**
 * Walk the scene graph disposing every geometry, material, and texture
 * we built. Safe to call on a scene that's already partially disposed.
 */
function disposeScene(scene: THREE.Scene): void {
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = (mesh as { material?: THREE.Material | THREE.Material[] }).material;
    if (Array.isArray(mat)) {
      for (const m of mat) m.dispose();
    } else if (mat) {
      mat.dispose();
    }
  });
}

/**
 * Grayscale fallback path — used when WebGL is unavailable (jsdom in
 * tests, lost context, OOM). Same image-shape contract as the WebGL
 * path so PlaceBuildingsStep can use either interchangeably.
 *
 * This is intentionally a pure 2D-canvas operation so it works in jsdom.
 */
function renderGrayscaleFallback(map: LoadedMap, resolutionPx: number): string {
  const widthPx = map.manifest.terrain.widthPx;
  const heightPx = map.manifest.terrain.heightPx;
  const heightmap = map.heightmap;

  let minH = Infinity;
  let maxH = -Infinity;
  for (let i = 0; i < heightmap.length; i++) {
    if (heightmap[i] < minH) minH = heightmap[i];
    if (heightmap[i] > maxH) maxH = heightmap[i];
  }
  const range = maxH - minH;

  // Build at heightmap resolution first, then scale up via drawImage.
  const lowCanvas = document.createElement("canvas");
  lowCanvas.width = widthPx;
  lowCanvas.height = heightPx;
  const lowCtx = lowCanvas.getContext("2d");
  if (!lowCtx) {
    // Last-resort empty data URL — should be unreachable on any
    // platform that has a 2D context. Still loud:
    // eslint-disable-next-line no-console
    console.error("[MapPreviewRenderer] no 2D context — returning blank PNG");
    return "data:image/png;base64,";
  }
  const imageData = lowCtx.createImageData(widthPx, heightPx);
  for (let i = 0; i < heightmap.length; i++) {
    const n = range > 1e-6 ? (heightmap[i] - minH) / range : 0.5;
    const g = Math.floor(n * 255);
    imageData.data[i * 4 + 0] = g;
    imageData.data[i * 4 + 1] = g;
    imageData.data[i * 4 + 2] = g;
    imageData.data[i * 4 + 3] = 255;
  }
  lowCtx.putImageData(imageData, 0, 0);

  const outCanvas = document.createElement("canvas");
  outCanvas.width = resolutionPx;
  outCanvas.height = resolutionPx;
  const outCtx = outCanvas.getContext("2d");
  if (!outCtx) {
    // eslint-disable-next-line no-console
    console.error("[MapPreviewRenderer] no 2D context on output canvas");
    return "data:image/png;base64,";
  }
  outCtx.imageSmoothingEnabled = false;
  outCtx.drawImage(lowCanvas, 0, 0, resolutionPx, resolutionPx);
  return outCanvas.toDataURL("image/png");
}
