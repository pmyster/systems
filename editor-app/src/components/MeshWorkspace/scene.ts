/**
 * Pure Three.js scene factory for the Mesh Workspace viewer.
 *
 * Analogous to VoxelSculptor/scene.ts but stripped down for mesh
 * viewing (no voxels, no cursor, no mirror plane, no region box).
 * The factory builds the scene, perspective camera, renderer,
 * three-light rig, ground plane, grid helper, and an empty mesh
 * group for the caller to populate.
 *
 * The caller is responsible for:
 *   - Mounting renderer.domElement under a container ref.
 *   - Driving the render loop (renderer.render(scene, camera)).
 *   - Calling dispose() on unmount.
 */

import * as THREE from "three";

// ---------------------------------------------------------------------------
// Mesh scene type.
// ---------------------------------------------------------------------------

/**
 * Bundle of Three.js objects the React hooks need to drive a mesh
 * viewer. Returned by createMeshScene().
 */
export interface MeshScene {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly ground: THREE.Mesh;
  readonly gridHelper: THREE.GridHelper;
  /** Group populated by the caller with the imported mesh. */
  readonly meshGroup: THREE.Group;
  /** Tear down all GPU resources. */
  readonly dispose: () => void;
}

// ---------------------------------------------------------------------------
// Factory.
// ---------------------------------------------------------------------------

/**
 * Build a fresh mesh-viewer scene. Returns objects the consumer wires
 * into its render loop and resize observer.
 *
 * The renderer's DOM element is NOT appended to the page here — the
 * mount effect does that against a div ref. Same with sizing; the
 * effect calls renderer.setSize() once it has measured the container.
 */
export function createMeshScene(): MeshScene {
  // ----- Scene + camera + renderer -----------------------------------------

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0d12);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // ----- Lighting (ambient + sun + rim) ------------------------------------

  const ambient = new THREE.AmbientLight(0xc4ccda, 0.9);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xfff4e0, 1.8);
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

  const rim = new THREE.DirectionalLight(0x8aa6c8, 0.45);
  rim.position.set(-15, 10, -10);
  scene.add(rim);

  // ----- Ground plane ------------------------------------------------------

  const groundGeom = new THREE.PlaneGeometry(40, 40);
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x14171e,
    roughness: 0.9,
    metalness: 0,
  });
  const ground = new THREE.Mesh(groundGeom, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // ----- Grid helper -------------------------------------------------------

  const gridHelper = new THREE.GridHelper(16, 16, 0x3a4150, 0x252b38);
  gridHelper.position.y = 0.01;
  scene.add(gridHelper);

  // ----- Mesh group (populated by the caller) ------------------------------

  const meshGroup = new THREE.Group();
  meshGroup.name = "mesh";
  scene.add(meshGroup);

  // ----- Dispose -----------------------------------------------------------

  const dispose = (): void => {
    // Traverse and dispose whatever the caller placed in the group.
    meshGroup.traverse((node) => {
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
    meshGroup.clear();
    scene.remove(meshGroup);

    // Scene fixtures
    groundGeom.dispose();
    groundMat.dispose();
    gridHelper.geometry.dispose();
    const gh = gridHelper.material as THREE.Material | THREE.Material[];
    if (Array.isArray(gh)) {
      for (const m of gh) m.dispose();
    } else {
      gh.dispose();
    }

    // `renderer.dispose()` releases Three.js bookkeeping (programs, render
    // targets) but does NOT free the underlying WebGL context. Browsers
    // cap that at ~16 simultaneous contexts per page; each tab swap that
    // mounts a new Three.js scene without releasing the old context eats
    // one slot. After ~12 swaps the GPU starts force-killing old contexts
    // (the user sees "Too many active WebGL contexts" warnings followed
    // by blank canvases). `forceContextLoss()` triggers the WEBGL_lose_context
    // extension which frees the slot immediately — the only call that
    // actually returns the context to the browser pool.
    renderer.forceContextLoss();
    renderer.dispose();
  };

  return {
    scene,
    camera,
    renderer,
    ground,
    gridHelper,
    meshGroup,
    dispose,
  };
}
