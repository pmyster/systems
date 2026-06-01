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

import { HEIGHTMAP_M_PER_PIXEL } from "../coords/constants";
import { mapStore, _drainDirty } from "../state/mapStore";
import { BrushController } from "./BrushController";
import { BrushDecal } from "./BrushDecal";
import { GizmoController } from "./GizmoController";
import { PlaceObjectController } from "./PlaceObjectController";
import { PrefabRenderer } from "./PrefabRenderer";
import { RtsOrbitCamera } from "./RtsOrbitCamera";
import { ScatterController } from "./ScatterController";
import { SelectionController } from "./SelectionController";
import { SkyDome } from "./SkyDome";
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
  private readonly decal: BrushDecal;
  private readonly brushController: BrushController;
  private readonly prefabRenderer: PrefabRenderer;
  private readonly placeController: PlaceObjectController;
  private readonly scatterController: ScatterController;
  private readonly selectionController: SelectionController;
  private readonly gizmoController: GizmoController;
  private readonly axes: THREE.AxesHelper;
  private readonly skyDome: SkyDome;
  private readonly waterPlane: WaterPlane;
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
    // Background color is kept as a fallback but the SkyDome (added
    // below) actually fills the visible sky — we only see this color
    // for a single frame at startup before the dome geometry uploads.
    this.scene.background = new THREE.Color(0x1a1d22);
    // Linear fog blended toward the horizon color so distant terrain
    // dissolves into the sunset rather than stopping abruptly at the
    // map edge. near=80m, far=300m sits well past the 128m map extent
    // so close-up sculpting is unaffected and the edge fades smoothly
    // when the camera pulls back.
    this.scene.fog = new THREE.Fog(0xc97a4a, 80, 300);

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

    // Skydome — large inverted sphere with a procedural sunset gradient.
    // Added BEFORE lights so its renderOrder=-1000 is the first thing
    // drawn each frame (everything else overdraws it).
    this.skyDome = new SkyDome(1500);
    this.scene.add(this.skyDome.mesh);

    // Atmospheric lighting — warm directional "sun" coming in at a low
    // sunset angle, cool dusty-blue hemisphere fill, small cyan fill
    // light from the opposite side to keep shadows readable. Same
    // recipe philosophy as the Battlefield Preview but tuned for an
    // outdoor post-apoc dusk rather than a clean daytime PBR setup.
    // Slight intensity bump from the original recipe — the colored
    // terrain palette was reading a touch muddy under the previous
    // sunset values. 0.9 hemi + 1.6 sun preserves the warm/dusk feel
    // while letting the green/brown bands come through cleanly.
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

    // Water plane at y=0 covering the full map extent. Depressions
    // below sea level get the translucent blue overlay automatically.
    const waterWidthM =
      (initialState.terrain.widthPx - 1) * HEIGHTMAP_M_PER_PIXEL;
    const waterDepthM =
      (initialState.terrain.heightPx - 1) * HEIGHTMAP_M_PER_PIXEL;
    this.waterPlane = new WaterPlane(waterWidthM, waterDepthM);
    this.scene.add(this.waterPlane.mesh);

    // Grid helper retired — the colored terrain + sky now provide the
    // spatial reference the grid used to give us, and at y=-0.02 the
    // grid was bleeding through the translucent water plane in an
    // obvious shimmer. A small axes helper at origin replaces it as a
    // sanity-check for orientation during development.
    this.axes = new THREE.AxesHelper(4);
    this.scene.add(this.axes);

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
    this.scatterController = new ScatterController(
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
    this.scatterController.dispose();
    this.selectionController.dispose();
    this.gizmoController.dispose();
    this.cameraController.dispose();

    // Free GPU resources for everything we own.
    this.terrain.dispose();
    this.decal.dispose();
    this.prefabRenderer.dispose();
    this.axes.dispose();
    this.skyDome.dispose();
    this.waterPlane.dispose();
    this.renderer.dispose();
  }
}
