/**
 * MapSceneManager — owns the Three.js scene, renderer, camera, and the
 * render loop. Lives OUTSIDE React so the rAF loop doesn't trigger
 * re-renders and so we can dispose deterministically on unmount.
 *
 * Day 3 contents:
 *   - Dark-themed scene background + hemisphere + directional lighting.
 *   - TerrainMesh driven from `mapStore.terrain.heightmap`. Per-pixel
 *     dirty-set updates during a stroke, full re-upload on revision
 *     changes that come without dirty hints (initial mount, undo of a
 *     pre-existing bulk change, future load/reset).
 *   - BrushDecal + BrushController for hover preview and left-drag
 *     sculpt input.
 *   - A faint grid helper kept as spatial reference.
 *   - RtsOrbitCamera wired to the canvas (middle/right buttons —
 *     BrushController takes left for sculpting).
 *   - ResizeObserver on the host container so the camera + renderer
 *     follow layout changes.
 *
 * Store integration:
 *   We subscribe and on each store snapshot diff:
 *     - terrain.revision bumped → drain dirty pixels and upload them.
 *       Null drain = full re-upload (initial mount / bulk change).
 *     - brush.radiusM changed → resize the brush decal.
 *     - tool changed → hide the decal if we left sculpt mode.
 */

import * as THREE from "three";

import { mapStore, _drainDirty } from "../state/mapStore";
import { BrushController } from "./BrushController";
import { BrushDecal } from "./BrushDecal";
import { GizmoController } from "./GizmoController";
import { PlaceObjectController } from "./PlaceObjectController";
import { PrefabRenderer } from "./PrefabRenderer";
import { RtsOrbitCamera } from "./RtsOrbitCamera";
import { SelectionController } from "./SelectionController";
import { TerrainMesh } from "./TerrainMesh";

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
  private readonly decal: BrushDecal;
  private readonly brushController: BrushController;
  private readonly prefabRenderer: PrefabRenderer;
  private readonly placeController: PlaceObjectController;
  private readonly selectionController: SelectionController;
  private readonly gizmoController: GizmoController;
  private readonly grid: THREE.GridHelper;
  private lastUploadedRevision = -1;
  private lastBrushRadius: number;
  private lastTool: string;
  private lastObjectsRef: object | null = null;
  private lastSelectionId: string | null = null;
  private lastSelectionKind: string = "none";

  constructor(
    canvas: HTMLCanvasElement,
    private readonly container: HTMLElement,
  ) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1d22);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 5000);
    this.camera.position.set(80, 60, 80);
    this.camera.lookAt(64, 0, 64); // map center for default 128m map.

    // RTS orbit cam — focus at the map center.
    this.cameraController = new RtsOrbitCamera(this.camera, canvas, {
      x: 64,
      y: 0,
      z: 64,
    });

    // Lighting — same recipe as the Battlefield Preview so feels match.
    const hemi = new THREE.HemisphereLight(0xc8e6ff, 0x4a4030, 0.8);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff8e8, 1.2);
    sun.position.set(100, 200, 80);
    this.scene.add(sun);

    // Terrain mesh — pulls the initial heightmap snapshot. Subsequent
    // changes flow through the store subscription below.
    const initialState = mapStore.getState();
    this.terrain = new TerrainMesh(
      initialState.terrain.widthPx,
      initialState.terrain.heightPx,
      initialState.terrain.heightmap,
    );
    this.scene.add(this.terrain.mesh);
    this.lastUploadedRevision = initialState.terrain.revision;

    // Faint grid as a spatial-reference overlay, sitting slightly below
    // sea level so the terrain occludes it where it has any height.
    this.grid = new THREE.GridHelper(128, 128, 0x303644, 0x21242c);
    this.grid.position.set(64, -0.02, 64);
    (this.grid.material as THREE.Material).transparent = true;
    (this.grid.material as THREE.Material).opacity = 0.35;
    this.scene.add(this.grid);

    // Brush decal + controller.
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

    // Prefab subsystem — Day 5. Order matters: build renderer first,
    // then the controllers that depend on it.
    this.prefabRenderer = new PrefabRenderer();
    this.scene.add(this.prefabRenderer.root);
    // Seed the renderer with any objects already in the store (load path).
    this.prefabRenderer.sync(initialState.objects);
    this.lastObjectsRef = initialState.objects;

    this.placeController = new PlaceObjectController(
      canvas,
      this.camera,
      this.terrain,
    );
    // Construct gizmo BEFORE selection so the selection controller can
    // gate raycasts on `gizmo.controls.axis` (avoids deselect-during-drag).
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
    // Match initial selection (likely "none" but be defensive against
    // load-with-selection in future).
    this.lastSelectionId = initialState.selection.id;
    this.lastSelectionKind = initialState.selection.kind;
    if (
      initialState.selection.kind === "object" &&
      initialState.selection.id
    ) {
      this.gizmoController.attachTo(initialState.selection.id);
    }

    // Resize handling.
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);
    this.handleResize();

    // Store subscription — diff snapshots and react to the bits we care
    // about. Zustand v5 subscribe is "any change in state" so we must
    // gate every action on a real value change.
    this.storeUnsub = mapStore.subscribe((s) => {
      // Terrain revision → push heightmap diff to GPU.
      //
      // Three paths:
      //   1. Drained set is null — no per-pixel hints; bulk path.
      //   2. Drained set is "large" (Reset Terrain, big bulk undo, etc.) —
      //      treat as bulk so normals get recomputed in one pass instead
      //      of leaving a stroke-shaped seam waiting on a finalizeStroke
      //      that will never come.
      //   3. Drained set is small — typical stroke-tick path; defer
      //      normals until the BrushController calls finalizeStroke().
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
      // Brush radius → resize the decal.
      if (s.brush.radiusM !== this.lastBrushRadius) {
        this.lastBrushRadius = s.brush.radiusM;
        this.decal.setRadius(s.brush.radiusM);
      }
      // Tool change → hide decal if we left sculpt mode.
      if (s.tool !== this.lastTool) {
        this.lastTool = s.tool;
        if (s.tool !== "sculpt-raise" && s.tool !== "sculpt-lower") {
          this.decal.hide();
        }
      }
      // Objects map changed → reconcile prefab nodes. Reference-compare
      // is enough because every store mutator that touches objects (the
      // command pipeline + load) replaces the map wholesale.
      if (s.objects !== this.lastObjectsRef) {
        this.lastObjectsRef = s.objects;
        this.prefabRenderer.sync(s.objects);
        // Re-attach the gizmo if it was pointing at an id that just
        // came/went (load + undo of place + redo of delete all need this).
        if (
          this.lastSelectionKind === "object" &&
          this.lastSelectionId !== null
        ) {
          this.gizmoController.attachTo(
            this.lastSelectionId in s.objects ? this.lastSelectionId : null,
          );
        }
      }
      // Selection changed → attach / detach the transform gizmo.
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

    // Start the render loop.
    const tick = (): void => {
      if (this.disposed) return;
      this.cameraController.update();
      this.renderer.render(this.scene, this.camera);
      this.rafHandle = requestAnimationFrame(tick);
    };
    this.rafHandle = requestAnimationFrame(tick);
  }

  /** For debug / external callers (e.g. future hit-tests). */
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
    this.selectionController.dispose();
    this.gizmoController.dispose();
    this.cameraController.dispose();

    // Free GPU resources for everything we own.
    this.terrain.dispose();
    this.decal.dispose();
    this.prefabRenderer.dispose();
    this.grid.geometry.dispose();
    (this.grid.material as THREE.Material).dispose();
    this.renderer.dispose();
  }
}
