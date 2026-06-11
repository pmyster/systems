/**
 * MapSceneManager — owns the Three.js scene, renderer, camera, and the
 * render loop. Lives OUTSIDE React so the rAF loop doesn't trigger
 * re-renders and so we can dispose deterministically on unmount.
 *
 * Week-2 day-2 additions:
 *   - DecalRenderer subtree reconciling `store.decals`.
 *   - PlaceDecalController for `tool === "decal"`.
 *   - SplatmapTexture uniform pushed into the terrain shader.
 *   - PaintMaterialController for `tool === "paint"`.
 *   - Splatmap revision subscription → texture re-upload.
 */

import * as THREE from "three";

import { HEIGHTMAP_M_PER_PIXEL } from "../coords/constants";
import { _setSceneManagerForThumbnails } from "../io/projectIo";
import {
  _drainColorPaintDirty,
  _drainDirty,
  _drainSplatDirty,
  mapStore,
} from "../state/mapStore";
import type { BiomeAtmosphere } from "./biomes";
import { BrushController } from "./BrushController";
import { BrushDecal } from "./BrushDecal";
import { ColorPaintTexture } from "./ColorPaintTexture";
import { DecalRenderer } from "./DecalRenderer";
import { GizmoController } from "./GizmoController";
import { PaintColorController } from "./PaintColorController";
import { PaintMaterialController } from "./PaintMaterialController";
import { PlaceDecalController } from "./PlaceDecalController";
import { PlaceObjectController } from "./PlaceObjectController";
import { PrefabRenderer } from "./PrefabRenderer";
import { RtsOrbitCamera } from "./RtsOrbitCamera";
import { ScatterController } from "./ScatterController";
import { SelectionController } from "./SelectionController";
import { SkyDome } from "./SkyDome";
import { SplatmapTexture } from "./SplatmapTexture";
import { TerrainMesh } from "./TerrainMesh";
import { captureThumbnail } from "./thumbnailCapture";
import { WaterPlane } from "./WaterPlane";

/**
 * Master kill-switch for Map Editor fog. The owner reported (2026-06-04)
 * that distance fog was blocking visibility while editing — fog is great
 * for in-game atmosphere but actively hurts the level-editor workflow,
 * where you need to see the whole map clearly at any zoom.
 *
 * Set this to `true` to restore the per-biome fog (atmosphere data model
 * still carries fogColor / fogNear / fogFar — only the actual scene.fog
 * assignment is gated). Atmosphere subscriber and applyAtmosphere() will
 * resume writing scene.fog from the active BiomeAtmosphere unchanged.
 */
const ENABLE_MAP_EDITOR_FOG = false;

export class MapSceneManager {
  readonly scene: THREE.Scene;
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  readonly cameraController: RtsOrbitCamera;
  private rafHandle: number | null = null;
  private storeUnsub: (() => void) | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private disposed = false;
  private readonly canvas: HTMLCanvasElement;
  // Terrain + water + splatmap + brush/place/paint/scatter controllers are
  // recreated whenever the map dimensions change (setupNewMap path), so they
  // are mutable references rather than readonly. Selection/gizmo/prefab/
  // decal renderers are dimension-agnostic and constructed once.
  private terrain!: TerrainMesh;
  private splatmapTexture!: SplatmapTexture;
  private colorPaintTexture!: ColorPaintTexture;
  private waterPlane!: WaterPlane;
  private brushController!: BrushController;
  private placeController!: PlaceObjectController;
  private placeDecalController!: PlaceDecalController;
  private paintController!: PaintMaterialController;
  private paintColorController!: PaintColorController;
  private scatterController!: ScatterController;
  private readonly decal: BrushDecal;
  private readonly prefabRenderer: PrefabRenderer;
  private readonly decalRenderer: DecalRenderer;
  private readonly selectionController: SelectionController;
  private readonly gizmoController: GizmoController;
  private readonly axes: THREE.AxesHelper;
  private readonly skyDome: SkyDome;
  private readonly hemi: THREE.HemisphereLight;
  private readonly sun: THREE.DirectionalLight;
  private lastUploadedRevision = -1;
  private lastUploadedSplatRevision = -1;
  private lastSplatDataRef: Uint8Array | null = null;
  private lastUploadedColorPaintRevision = -1;
  private lastColorPaintDataRef: Uint8Array | null = null;
  private lastTerrainWidthPx = -1;
  private lastTerrainHeightPx = -1;
  private lastBrushRadius: number;
  private lastTool: string;
  private lastObjectsRef: object | null = null;
  private lastDecalsRef: object | null = null;
  private lastSelectionId: string | null = null;
  private lastSelectionKind: string = "none";
  private lastElevationProfileRef: object | null = null;
  private lastSplatMix = Number.NaN;
  private lastAtmosphereRef: object | null = null;
  private lastColorVariance = Number.NaN;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly container: HTMLElement,
  ) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    // Background is also driven by the atmosphere subscriber below
    // (skyHorizon tone — matches the SkyDome horizon band so the fog at
    // distance reads coherently against an uncovered patch of sky).
    this.scene.background = new THREE.Color(0xc8e6ff);
    // Fog is gated by ENABLE_MAP_EDITOR_FOG (see top of file). Owner
    // disabled it 2026-06-04 — it blocked visibility while editing. The
    // biome atmosphere data model (fogColor/fogNear/fogFar) is preserved
    // so runtime/game scenes can still use it; only the editor's
    // scene.fog uniform is suppressed.
    if (ENABLE_MAP_EDITOR_FOG) {
      // Fog gets fully rewritten by the atmosphere subscriber below; this
      // initial allocation just keeps the scene legal until the first push.
      this.scene.fog = new THREE.Fog(0xc8e6ff, 100, 500);
    } else {
      this.scene.fog = null;
      console.info(
        "[map-editor] fog disabled — set ENABLE_MAP_EDITOR_FOG = true in MapSceneManager.ts to restore",
      );
    }

    // preserveDrawingBuffer: true so the eyedropper
    // (PaintColorController.sampleColorAt) can call gl.readPixels()
    // from a click handler — i.e. AFTER the browser has presented the
    // last frame. Without it, the backbuffer is invalidated post-
    // present and readPixels returns zeros (black). Small perf/memory
    // cost; acceptable for an editor at 60fps.
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(window.devicePixelRatio);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 5000);
    this.camera.position.set(80, 60, 80);
    this.camera.lookAt(64, 0, 64);

    this.cameraController = new RtsOrbitCamera(this.camera, canvas, {
      x: 64,
      y: 0,
      z: 64,
    });

    this.skyDome = new SkyDome(1500);
    this.scene.add(this.skyDome.mesh);

    // Per-biome atmosphere lighting — sun + hemi colors/intensities get
    // pushed by the atmosphere subscriber on init and on every store
    // change (New Map biome switch, project load). The placeholder values
    // here are just to satisfy the THREE constructors; applyAtmosphere()
    // below overwrites them before the first frame renders.
    this.hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 1.0);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.0);
    this.sun.position.set(100, 200, 80);
    this.sun.target.position.set(64, 0, 64);
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    const initialState = mapStore.getState();

    this.axes = new THREE.AxesHelper(4);
    this.scene.add(this.axes);

    this.decal = new BrushDecal(initialState.brush.radiusM);
    this.scene.add(this.decal.mesh);
    this.lastBrushRadius = initialState.brush.radiusM;
    this.lastTool = initialState.tool;

    this.prefabRenderer = new PrefabRenderer();
    this.scene.add(this.prefabRenderer.root);
    this.prefabRenderer.sync(initialState.objects);
    this.lastObjectsRef = initialState.objects;

    this.decalRenderer = new DecalRenderer();
    this.scene.add(this.decalRenderer.root);
    this.decalRenderer.sync(initialState.decals);
    this.lastDecalsRef = initialState.decals;

    // Build the dimension-dependent objects (terrain, water, splatmap GPU
    // texture, and the four input controllers that hold a terrain ref).
    // Extracted into a method so setupNewMap can rebuild them when the
    // user picks a different map size.
    this.buildTerrainAndControllers();

    this.gizmoController = new GizmoController(
      this.camera,
      canvas,
      this.prefabRenderer,
      this.scene,
    );
    this.selectionController = new SelectionController(
      canvas,
      this.camera,
      this.prefabRenderer,
      this.gizmoController,
    );
    this.lastSelectionId = initialState.selection.id;
    this.lastSelectionKind = initialState.selection.kind;
    if (
      initialState.selection.kind === "object" &&
      initialState.selection.id
    ) {
      this.gizmoController.attachTo(initialState.selection.id);
    }

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);
    this.handleResize();

    // Seed the elevation-profile cache so the first store-subscribe call
    // is a no-op (otherwise we'd write the uniforms once before the
    // shader has compiled, which is harmless but produces a stray
    // console line on some drivers).
    this.lastElevationProfileRef = initialState.elevationProfile;
    this.lastSplatMix = initialState.splatToElevationMix;
    // Push the initial profile immediately — the shader uniforms were
    // seeded with DEFAULT values in TerrainMesh's onBeforeCompile, but
    // the store may carry a different biome's profile (e.g. after a
    // mid-session reset). Cheap to call; idempotent.
    this.terrain.setElevationProfile(
      initialState.elevationProfile,
      initialState.splatToElevationMix,
    );
    // Same for color variance — push it to the shader once at init.
    this.lastColorVariance = initialState.colorVariance;
    this.terrain.setColorVariance(initialState.colorVariance);
    // Push the initial atmosphere — paints sky/sun/hemi/fog/background.
    // Required because the constructor seeded the lights with placeholder
    // values; without this they'd render with white-on-white until the
    // first store change.
    this.lastAtmosphereRef = initialState.atmosphere;
    this.applyAtmosphere(initialState.atmosphere);

    this.storeUnsub = mapStore.subscribe((s) => {
      // Dimension change → tear down + rebuild terrain/water/splatmap +
      // input controllers. Must run BEFORE the revision/data subscribers
      // below so we point them at the fresh objects, not the stale ones.
      if (
        s.terrain.widthPx !== this.lastTerrainWidthPx ||
        s.terrain.heightPx !== this.lastTerrainHeightPx
      ) {
        this.recreateTerrain();
        // recreateTerrain() resyncs the cached revision/data refs from
        // the store, so the per-frame branches below are no-ops on the
        // tick that recreated everything.
        return;
      }
      // Per-biome elevation gradient / mix change → write shader uniforms.
      // Reference compare is enough — store always replaces these wholesale
      // when setupNewMap() or a load runs (never mutates in place).
      if (
        s.elevationProfile !== this.lastElevationProfileRef ||
        s.splatToElevationMix !== this.lastSplatMix
      ) {
        this.lastElevationProfileRef = s.elevationProfile;
        this.lastSplatMix = s.splatToElevationMix;
        this.terrain.setElevationProfile(
          s.elevationProfile,
          s.splatToElevationMix,
        );
      }
      // Per-biome atmosphere change → repaint sky/sun/hemi/fog/background.
      if (s.atmosphere !== this.lastAtmosphereRef) {
        this.lastAtmosphereRef = s.atmosphere;
        this.applyAtmosphere(s.atmosphere);
      }
      // Color variance change → update terrain shader uniform.
      if (s.colorVariance !== this.lastColorVariance) {
        this.lastColorVariance = s.colorVariance;
        this.terrain.setColorVariance(s.colorVariance);
      }
      // Terrain revision → push heightmap diff to GPU.
      if (s.terrain.revision !== this.lastUploadedRevision) {
        this.lastUploadedRevision = s.terrain.revision;
        const drained = _drainDirty();
        if (!drained || drained.size === 0) {
          this.terrain.applyHeightmap(s.terrain.heightmap);
        } else if (drained.size > 1000) {
          this.terrain.applyHeightmap(s.terrain.heightmap);
        } else {
          this.terrain.applyDirtyPixels(s.terrain.heightmap, drained);
        }
      }
      // Splatmap revision → re-upload to GPU.
      //
      // Two cases:
      //   1. Same backing Uint8Array as before → mutated in place by
      //      PaintMaterialCommand. Full re-upload via needsUpdate=true
      //      is fine at 128×128×4 = 64 KB.
      //   2. Different reference → load path replaced the buffer
      //      wholesale. Re-point the DataTexture at the new bytes.
      if (s.splatmap.revision !== this.lastUploadedSplatRevision) {
        this.lastUploadedSplatRevision = s.splatmap.revision;
        if (s.splatmap.data !== this.lastSplatDataRef) {
          this.lastSplatDataRef = s.splatmap.data;
          this.splatmapTexture.replaceData(s.splatmap.data);
        } else {
          this.splatmapTexture.updateRegion();
        }
        // Drain dirty marks even though we don't use them yet — keeps
        // the accumulator from growing unboundedly across strokes.
        _drainSplatDirty();
      }
      // Color-paint revision → re-upload to GPU. Same two-case logic as
      // splatmap: same backing buffer = full re-upload via needsUpdate;
      // different reference (load / new map) = point the DataTexture at
      // the new bytes and rebind the shader uniform.
      if (s.colorPaint.revision !== this.lastUploadedColorPaintRevision) {
        this.lastUploadedColorPaintRevision = s.colorPaint.revision;
        if (s.colorPaint.data !== this.lastColorPaintDataRef) {
          this.lastColorPaintDataRef = s.colorPaint.data;
          this.colorPaintTexture.replaceData(s.colorPaint.data);
          // Rebind in case the underlying texture object was disposed
          // and recreated (e.g. dimension change → recreateTerrain
          // path). Idempotent when the texture handle hasn't changed.
          this.terrain.setColorPaintTexture(this.colorPaintTexture.texture);
        } else {
          this.colorPaintTexture.updateRegion();
        }
        _drainColorPaintDirty();
      }
      if (s.brush.radiusM !== this.lastBrushRadius) {
        this.lastBrushRadius = s.brush.radiusM;
        this.decal.setRadius(s.brush.radiusM);
      }
      if (s.tool !== this.lastTool) {
        this.lastTool = s.tool;
        if (s.tool !== "sculpt-raise" && s.tool !== "sculpt-lower") {
          this.decal.hide();
        }
        // (color-paint is a tint brush; the existing sculpt brush ring
        // is not appropriate for it. A color-matched ring is deferred.)
      }
      if (s.objects !== this.lastObjectsRef) {
        this.lastObjectsRef = s.objects;
        this.prefabRenderer.sync(s.objects);
        if (
          this.lastSelectionKind === "object" &&
          this.lastSelectionId !== null
        ) {
          this.gizmoController.attachTo(
            this.lastSelectionId in s.objects ? this.lastSelectionId : null,
          );
        }
      }
      if (s.decals !== this.lastDecalsRef) {
        this.lastDecalsRef = s.decals;
        this.decalRenderer.sync(s.decals);
      }
      if (
        s.selection.id !== this.lastSelectionId ||
        s.selection.kind !== this.lastSelectionKind
      ) {
        this.lastSelectionId = s.selection.id;
        this.lastSelectionKind = s.selection.kind;
        if (s.selection.kind === "object" && s.selection.id) {
          this.gizmoController.attachTo(s.selection.id);
        } else {
          this.gizmoController.attachTo(null);
        }
      }
    });

    // Register with projectIo so Save can grab a viewport thumbnail
    // without each call site having to thread the scene manager through.
    // Cleared in dispose() to keep the module-singleton honest.
    _setSceneManagerForThumbnails(this);

    const tick = (): void => {
      if (this.disposed) return;
      this.cameraController.update();
      this.renderer.render(this.scene, this.camera);
      this.rafHandle = requestAnimationFrame(tick);
    };
    this.rafHandle = requestAnimationFrame(tick);
  }

  getTerrainMesh(): TerrainMesh {
    return this.terrain;
  }

  /**
   * Build (or rebuild) the dimension-dependent scene objects from the
   * current store state: splatmap GPU texture, terrain mesh, water plane,
   * and the four input controllers that hold a terrain reference (brush,
   * place-object, place-decal, paint, scatter).
   *
   * Idempotent: safe to call after a previous build. The caller is
   * responsible for disposing the old objects FIRST via
   * `tearDownTerrainAndControllers` if there was a previous build.
   */
  private buildTerrainAndControllers(): void {
    const state = mapStore.getState();

    // Splatmap GPU texture, backed by the store's Uint8Array. Must be
    // constructed BEFORE the TerrainMesh so we can hand its
    // .texture to the shader uniform.
    this.splatmapTexture = new SplatmapTexture(
      state.splatmap.widthPx,
      state.splatmap.heightPx,
      state.splatmap.data,
    );
    this.lastUploadedSplatRevision = state.splatmap.revision;
    this.lastSplatDataRef = state.splatmap.data;

    // Color-paint overlay GPU texture, also backed by a store Uint8Array.
    // Must be constructed BEFORE TerrainMesh so we can pass its texture
    // to the shader uniform at compile time — the shader only declares
    // the colorPaint sampler when given an initial texture.
    this.colorPaintTexture = new ColorPaintTexture(
      state.colorPaint.widthPx,
      state.colorPaint.heightPx,
      state.colorPaint.data,
    );
    this.lastUploadedColorPaintRevision = state.colorPaint.revision;
    this.lastColorPaintDataRef = state.colorPaint.data;

    this.terrain = new TerrainMesh(
      state.terrain.widthPx,
      state.terrain.heightPx,
      state.terrain.heightmap,
      this.splatmapTexture.texture,
      undefined,
      this.colorPaintTexture.texture,
    );
    this.scene.add(this.terrain.mesh);
    this.lastUploadedRevision = state.terrain.revision;
    this.lastTerrainWidthPx = state.terrain.widthPx;
    this.lastTerrainHeightPx = state.terrain.heightPx;

    const waterWidthM = (state.terrain.widthPx - 1) * HEIGHTMAP_M_PER_PIXEL;
    const waterDepthM = (state.terrain.heightPx - 1) * HEIGHTMAP_M_PER_PIXEL;
    this.waterPlane = new WaterPlane(waterWidthM, waterDepthM);
    this.scene.add(this.waterPlane.mesh);

    this.brushController = new BrushController(
      this.canvas,
      this.camera,
      this.terrain,
      this.decal,
    );
    this.placeController = new PlaceObjectController(
      this.canvas,
      this.camera,
      this.terrain,
    );
    this.placeDecalController = new PlaceDecalController(
      this.canvas,
      this.camera,
      this.terrain,
    );
    this.paintController = new PaintMaterialController(
      this.canvas,
      this.camera,
      this.terrain,
    );
    this.paintColorController = new PaintColorController(
      this.canvas,
      this.camera,
      this.terrain,
      this.renderer,
    );
    this.scatterController = new ScatterController(
      this.canvas,
      this.camera,
      this.terrain,
    );
  }

  /**
   * Dispose the dimension-dependent objects built by
   * `buildTerrainAndControllers`. Removes the meshes from the scene
   * graph and unsubscribes input listeners so the next build starts
   * from a clean canvas.
   */
  private tearDownTerrainAndControllers(): void {
    this.brushController.dispose();
    this.placeController.dispose();
    this.placeDecalController.dispose();
    this.paintController.dispose();
    this.paintColorController.dispose();
    this.scatterController.dispose();
    this.scene.remove(this.terrain.mesh);
    this.scene.remove(this.waterPlane.mesh);
    this.terrain.dispose();
    this.waterPlane.dispose();
    this.splatmapTexture.dispose();
    this.colorPaintTexture.dispose();
  }

  /**
   * Tear down + rebuild every dimension-dependent object after a
   * `setupNewMap` mutation changed `terrain.widthPx` / `terrain.heightPx`.
   * Also re-centres the camera on the new map and zooms out
   * proportionally so the new world sits in frame.
   */
  private recreateTerrain(): void {
    this.tearDownTerrainAndControllers();
    this.buildTerrainAndControllers();

    const state = mapStore.getState();
    const widthM = (state.terrain.widthPx - 1) * HEIGHTMAP_M_PER_PIXEL;
    const heightM = (state.terrain.heightPx - 1) * HEIGHTMAP_M_PER_PIXEL;
    this.cameraController.setFocus({ x: widthM / 2, y: 0, z: heightM / 2 });
    this.cameraController.setDistance(Math.max(widthM, heightM) * 0.8);
    // New TerrainMesh starts with DEFAULT uniforms — re-seed from the
    // store so a Mars→Pasture biome switch lands with the right gradient
    // (the subscriber's reference check will see "same as cache" and skip
    // a redundant write on the next tick).
    this.terrain.setElevationProfile(
      state.elevationProfile,
      state.splatToElevationMix,
    );
    this.lastElevationProfileRef = state.elevationProfile;
    this.lastSplatMix = state.splatToElevationMix;
    // Same for color variance — the rebuilt shader starts at DEFAULT, push
    // the live store value back in so a Mars→Pasture biome switch carries
    // its patchy variance through.
    this.terrain.setColorVariance(state.colorVariance);
    this.lastColorVariance = state.colorVariance;
  }

  /**
   * Render the current scene + camera to a 256×256 PNG for use as a
   * project thumbnail. Spins up a transient WebGLRenderer so the live
   * viewport is untouched. See `./thumbnailCapture.ts` for the rationale.
   */
  captureThumbnail(size = 256): Uint8Array {
    return captureThumbnail(this.scene, this.camera, size);
  }

  /**
   * Push a BiomeAtmosphere into the live scene — SkyDome uniforms, sun
   * color + intensity, hemi-light tints, fog, and the scene background
   * fallback color.
   *
   * Called once on construction with the initial store atmosphere, then on
   * every subsequent change observed by the store subscriber. THREE
   * objects are mutated in place (cheap; no GC churn).
   */
  private applyAtmosphere(atm: BiomeAtmosphere): void {
    this.skyDome.setColors(atm.skyTop, atm.skyHorizon, atm.skyGround);
    this.sun.color.setRGB(atm.sunColor[0], atm.sunColor[1], atm.sunColor[2]);
    this.sun.intensity = atm.sunIntensity;
    this.hemi.color.setRGB(atm.hemiSky[0], atm.hemiSky[1], atm.hemiSky[2]);
    this.hemi.groundColor.setRGB(
      atm.hemiGround[0],
      atm.hemiGround[1],
      atm.hemiGround[2],
    );
    this.hemi.intensity = atm.hemiIntensity;
    // Replace the fog wholesale — Three accepts a new Fog directly on the
    // scene and adopts its uniforms on the next frame.
    // Gated on ENABLE_MAP_EDITOR_FOG: when off, the BiomeAtmosphere's
    // fog fields are read but never applied to the live scene. The data
    // is preserved on disk + in memory so runtime/game can still use it.
    if (ENABLE_MAP_EDITOR_FOG) {
      this.scene.fog = new THREE.Fog(
        new THREE.Color(atm.fogColor[0], atm.fogColor[1], atm.fogColor[2]),
        atm.fogNear,
        atm.fogFar,
      );
    }
    // Scene background reads as a fallback color where the SkyDome doesn't
    // cover (e.g. behind the far plane at extreme angles). Match the
    // horizon band so the seam is invisible.
    if (this.scene.background instanceof THREE.Color) {
      this.scene.background.setRGB(
        atm.skyHorizon[0],
        atm.skyHorizon[1],
        atm.skyHorizon[2],
      );
    } else {
      this.scene.background = new THREE.Color(
        atm.skyHorizon[0],
        atm.skyHorizon[1],
        atm.skyHorizon[2],
      );
    }
  }

  private handleResize(): void {
    const { width, height } = this.container.getBoundingClientRect();
    if (width <= 0 || height <= 0) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    _setSceneManagerForThumbnails(null);
    if (this.rafHandle !== null) cancelAnimationFrame(this.rafHandle);
    this.storeUnsub?.();
    this.resizeObserver?.disconnect();
    this.brushController.dispose();
    this.placeController.dispose();
    this.placeDecalController.dispose();
    this.paintController.dispose();
    this.paintColorController.dispose();
    this.scatterController.dispose();
    this.selectionController.dispose();
    this.gizmoController.dispose();
    this.cameraController.dispose();

    this.terrain.dispose();
    this.splatmapTexture.dispose();
    this.colorPaintTexture.dispose();
    this.decal.dispose();
    this.prefabRenderer.dispose();
    this.decalRenderer.dispose();
    this.axes.dispose();
    this.skyDome.dispose();
    this.waterPlane.dispose();
    // Free the WebGL context slot — `renderer.dispose()` only releases
    // Three.js bookkeeping. See MeshWorkspace/scene.ts for the matching
    // fix on the unit-editor side.
    this.renderer.forceContextLoss();
    this.renderer.dispose();
  }
}
