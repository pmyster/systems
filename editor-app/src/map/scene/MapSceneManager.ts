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
import {
  _drainDirty,
  _drainSplatDirty,
  mapStore,
} from "../state/mapStore";
import { BrushController } from "./BrushController";
import { BrushDecal } from "./BrushDecal";
import { DecalRenderer } from "./DecalRenderer";
import { GizmoController } from "./GizmoController";
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
import { WaterPlane } from "./WaterPlane";

export class MapSceneManager {
  readonly scene: THREE.Scene;
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  readonly cameraController: RtsOrbitCamera;
  private rafHandle: number | null = null;
  private storeUnsub: (() => void) | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private disposed = false;
  private readonly terrain: TerrainMesh;
  private splatmapTexture: SplatmapTexture;
  private readonly decal: BrushDecal;
  private readonly brushController: BrushController;
  private readonly prefabRenderer: PrefabRenderer;
  private readonly decalRenderer: DecalRenderer;
  private readonly placeController: PlaceObjectController;
  private readonly placeDecalController: PlaceDecalController;
  private readonly paintController: PaintMaterialController;
  private readonly scatterController: ScatterController;
  private readonly selectionController: SelectionController;
  private readonly gizmoController: GizmoController;
  private readonly axes: THREE.AxesHelper;
  private readonly skyDome: SkyDome;
  private readonly waterPlane: WaterPlane;
  private lastUploadedRevision = -1;
  private lastUploadedSplatRevision = -1;
  private lastSplatDataRef: Uint8Array | null = null;
  private lastBrushRadius: number;
  private lastTool: string;
  private lastObjectsRef: object | null = null;
  private lastDecalsRef: object | null = null;
  private lastSelectionId: string | null = null;
  private lastSelectionKind: string = "none";

  constructor(
    canvas: HTMLCanvasElement,
    private readonly container: HTMLElement,
  ) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1d22);
    this.scene.fog = new THREE.Fog(0xc97a4a, 80, 300);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
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

    const hemi = new THREE.HemisphereLight(0x6878a8, 0x5a4030, 0.9);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffd9a5, 1.6);
    sun.position.set(80, 60, 100);
    sun.target.position.set(64, 0, 64);
    this.scene.add(sun);
    this.scene.add(sun.target);
    const fill = new THREE.DirectionalLight(0x6080b8, 0.3);
    fill.position.set(-60, 40, -40);
    this.scene.add(fill);

    const initialState = mapStore.getState();

    // Splatmap GPU texture, backed by the store's Uint8Array. Must be
    // constructed BEFORE the TerrainMesh so we can hand its
    // .texture to the shader uniform.
    this.splatmapTexture = new SplatmapTexture(
      initialState.splatmap.widthPx,
      initialState.splatmap.heightPx,
      initialState.splatmap.data,
    );
    this.lastUploadedSplatRevision = initialState.splatmap.revision;
    this.lastSplatDataRef = initialState.splatmap.data;

    this.terrain = new TerrainMesh(
      initialState.terrain.widthPx,
      initialState.terrain.heightPx,
      initialState.terrain.heightmap,
      this.splatmapTexture.texture,
    );
    this.scene.add(this.terrain.mesh);
    this.lastUploadedRevision = initialState.terrain.revision;

    const waterWidthM =
      (initialState.terrain.widthPx - 1) * HEIGHTMAP_M_PER_PIXEL;
    const waterDepthM =
      (initialState.terrain.heightPx - 1) * HEIGHTMAP_M_PER_PIXEL;
    this.waterPlane = new WaterPlane(waterWidthM, waterDepthM);
    this.scene.add(this.waterPlane.mesh);

    this.axes = new THREE.AxesHelper(4);
    this.scene.add(this.axes);

    this.decal = new BrushDecal(initialState.brush.radiusM);
    this.scene.add(this.decal.mesh);
    this.lastBrushRadius = initialState.brush.radiusM;
    this.lastTool = initialState.tool;

    this.brushController = new BrushController(
      canvas,
      this.camera,
      this.terrain,
      this.decal,
    );

    this.prefabRenderer = new PrefabRenderer();
    this.scene.add(this.prefabRenderer.root);
    this.prefabRenderer.sync(initialState.objects);
    this.lastObjectsRef = initialState.objects;

    this.decalRenderer = new DecalRenderer();
    this.scene.add(this.decalRenderer.root);
    this.decalRenderer.sync(initialState.decals);
    this.lastDecalsRef = initialState.decals;

    this.placeController = new PlaceObjectController(
      canvas,
      this.camera,
      this.terrain,
    );
    this.placeDecalController = new PlaceDecalController(
      canvas,
      this.camera,
      this.terrain,
    );
    this.paintController = new PaintMaterialController(
      canvas,
      this.camera,
      this.terrain,
    );
    this.scatterController = new ScatterController(
      canvas,
      this.camera,
      this.terrain,
    );
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

    this.storeUnsub = mapStore.subscribe((s) => {
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
      if (s.brush.radiusM !== this.lastBrushRadius) {
        this.lastBrushRadius = s.brush.radiusM;
        this.decal.setRadius(s.brush.radiusM);
      }
      if (s.tool !== this.lastTool) {
        this.lastTool = s.tool;
        if (s.tool !== "sculpt-raise" && s.tool !== "sculpt-lower") {
          this.decal.hide();
        }
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
    if (this.rafHandle !== null) cancelAnimationFrame(this.rafHandle);
    this.storeUnsub?.();
    this.resizeObserver?.disconnect();
    this.brushController.dispose();
    this.placeController.dispose();
    this.placeDecalController.dispose();
    this.paintController.dispose();
    this.scatterController.dispose();
    this.selectionController.dispose();
    this.gizmoController.dispose();
    this.cameraController.dispose();

    this.terrain.dispose();
    this.splatmapTexture.dispose();
    this.decal.dispose();
    this.prefabRenderer.dispose();
    this.decalRenderer.dispose();
    this.axes.dispose();
    this.skyDome.dispose();
    this.waterPlane.dispose();
    this.renderer.dispose();
  }
}
