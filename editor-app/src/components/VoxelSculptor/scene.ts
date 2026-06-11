/**
 * Pure Three.js scene factory for the Voxel Sculptor.
 *
 * Lifted from tools/voxel-editor/index.html lines 222-309. The factory
 * builds the scene, perspective camera, renderer, three-light rig,
 * ground plane, grid helper, build-region wireframe, mirror plane
 * indicator, and the translucent voxel cursor. It is intentionally
 * dumb — it owns no React state, no event listeners, no animation.
 * React effects drive everything that varies over time.
 *
 * The caller is responsible for:
 *   - Mounting renderer.domElement under a container ref.
 *   - Driving the render loop (renderer.render(scene, camera)).
 *   - Calling dispose() on unmount.
 */

import * as THREE from "three";

import { GRID_SIZE } from "../../lib";

// ---------------------------------------------------------------------------
// Sculpt scene type.
// ---------------------------------------------------------------------------

/**
 * Bundle of Three.js objects the React hooks need to drive a sculpt
 * scene. Returned by createSculptScene().
 */
export interface SculptScene {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly ground: THREE.Mesh;
  readonly gridHelper: THREE.GridHelper;
  readonly regionBox: THREE.LineSegments;
  readonly mirrorPlane: THREE.Mesh;
  readonly cursorMesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
  readonly cursorEdge: THREE.LineSegments<
    THREE.EdgesGeometry,
    THREE.LineBasicMaterial
  >;
  /** Group that owns one Mesh per voxel; the React effect reconciles this. */
  readonly voxelGroup: THREE.Group;
  /** Tear down all GPU resources and remove all child meshes. */
  readonly dispose: () => void;
}

// ---------------------------------------------------------------------------
// Factory.
// ---------------------------------------------------------------------------

/**
 * Build a fresh sculpt scene. Returns objects the consumer wires into
 * its render loop, input handlers, and resize observer.
 *
 * The renderer's DOM element is NOT appended to the page here — the
 * mount effect does that against a div ref. Same with sizing; the
 * effect calls renderer.setSize() once it has measured the container.
 */
export function createSculptScene(): SculptScene {
  // ----- Scene + camera + renderer -----------------------------------------

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0d12);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // ----- Lighting (ambient + sun + rim) ------------------------------------

  const ambient = new THREE.AmbientLight(0xb0b8c8, 0.5);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xfff0d8, 0.95);
  sun.position.set(20, 30, 15);
  sun.castShadow = true;
  sun.shadow.mapSize.width = 1024;
  sun.shadow.mapSize.height = 1024;
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 80;
  sun.shadow.camera.left = -20;
  sun.shadow.camera.right = 30;
  sun.shadow.camera.top = 30;
  sun.shadow.camera.bottom = -10;
  scene.add(sun);

  const rim = new THREE.DirectionalLight(0x6b8eb3, 0.25);
  rim.position.set(-15, 10, -10);
  scene.add(rim);

  // ----- Ground plane ------------------------------------------------------

  const groundGeom = new THREE.PlaneGeometry(GRID_SIZE * 3, GRID_SIZE * 3);
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x14171e,
    roughness: 0.9,
    metalness: 0,
  });
  const ground = new THREE.Mesh(groundGeom, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(GRID_SIZE / 2, 0, GRID_SIZE / 2);
  ground.receiveShadow = true;
  scene.add(ground);

  // ----- Grid helper -------------------------------------------------------

  const gridHelper = new THREE.GridHelper(GRID_SIZE, GRID_SIZE, 0x3a4150, 0x252b38);
  gridHelper.position.set(GRID_SIZE / 2, 0.01, GRID_SIZE / 2);
  scene.add(gridHelper);

  // ----- Build-region wireframe -------------------------------------------

  const regionGeom = new THREE.BoxGeometry(GRID_SIZE, GRID_SIZE, GRID_SIZE);
  const regionEdges = new THREE.EdgesGeometry(regionGeom);
  const regionMat = new THREE.LineBasicMaterial({
    color: 0x2a3040,
    transparent: true,
    opacity: 0.5,
  });
  const regionBox = new THREE.LineSegments(regionEdges, regionMat);
  regionBox.position.set(GRID_SIZE / 2, GRID_SIZE / 2, GRID_SIZE / 2);
  scene.add(regionBox);
  // The original BoxGeometry isn't added to the scene; dispose to free it.
  regionGeom.dispose();

  // ----- Mirror plane indicator -------------------------------------------

  const mirrorPlaneGeom = new THREE.PlaneGeometry(GRID_SIZE, GRID_SIZE);
  const mirrorPlaneMat = new THREE.MeshBasicMaterial({
    color: 0xc9a55c,
    transparent: true,
    opacity: 0.08,
    side: THREE.DoubleSide,
  });
  const mirrorPlane = new THREE.Mesh(mirrorPlaneGeom, mirrorPlaneMat);
  mirrorPlane.rotation.y = Math.PI / 2;
  mirrorPlane.position.set(GRID_SIZE / 2, GRID_SIZE / 2, GRID_SIZE / 2);
  mirrorPlane.visible = false;
  scene.add(mirrorPlane);

  // ----- Cursor preview (translucent box + bright edges) -------------------

  const cursorMat = new THREE.MeshBasicMaterial({
    color: 0xc9a55c,
    transparent: true,
    opacity: 0.3,
  });
  const cursorBoxGeom = new THREE.BoxGeometry(1, 1, 1);
  const cursorMesh = new THREE.Mesh(cursorBoxGeom, cursorMat);
  cursorMesh.visible = false;
  scene.add(cursorMesh);

  const cursorEdgeBoxGeom = new THREE.BoxGeometry(1, 1, 1);
  const cursorEdgesGeom = new THREE.EdgesGeometry(cursorEdgeBoxGeom);
  cursorEdgeBoxGeom.dispose();
  const cursorEdgeMat = new THREE.LineBasicMaterial({ color: 0xc9a55c });
  const cursorEdge = new THREE.LineSegments(cursorEdgesGeom, cursorEdgeMat);
  cursorEdge.visible = false;
  scene.add(cursorEdge);

  // ----- Voxel group (populated by the React effect) -----------------------

  const voxelGroup = new THREE.Group();
  voxelGroup.name = "voxels";
  scene.add(voxelGroup);

  // ----- Dispose -----------------------------------------------------------

  const dispose = (): void => {
    // Voxel meshes (rebuilt from props, but caller may dispose them itself
    // before calling dispose(); this is the safety net.)
    voxelGroup.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.geometry.dispose();
        const mat = node.material;
        if (Array.isArray(mat)) {
          for (const m of mat) m.dispose();
        } else {
          mat.dispose();
        }
      }
    });
    voxelGroup.clear();
    scene.remove(voxelGroup);

    // Scene fixtures
    groundGeom.dispose();
    groundMat.dispose();
    gridHelper.geometry.dispose();
    // GridHelper material may be an array.
    const gh = gridHelper.material as THREE.Material | THREE.Material[];
    if (Array.isArray(gh)) {
      for (const m of gh) m.dispose();
    } else {
      gh.dispose();
    }
    regionEdges.dispose();
    regionMat.dispose();
    mirrorPlaneGeom.dispose();
    mirrorPlaneMat.dispose();
    cursorBoxGeom.dispose();
    cursorMat.dispose();
    cursorEdgesGeom.dispose();
    cursorEdgeMat.dispose();

    // Free the WebGL context slot — see MeshWorkspace/scene.ts for the
    // matching fix and the "Too many active WebGL contexts" rationale.
    renderer.forceContextLoss();
    renderer.dispose();
  };

  return {
    scene,
    camera,
    renderer,
    ground,
    gridHelper,
    regionBox,
    mirrorPlane,
    cursorMesh,
    cursorEdge,
    voxelGroup,
    dispose,
  };
}
