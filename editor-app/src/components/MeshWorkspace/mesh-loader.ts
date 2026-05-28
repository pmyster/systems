/**
 * Mesh loading utilities for the Mesh Workspace viewer.
 *
 * Supports GLB/GLTF via Three.js GLTFLoader. Both entry points
 * centre and normalise the returned group so any mesh fits
 * comfortably in the viewer (max dimension ≈ 8 units).
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// ---------------------------------------------------------------------------
// Internal helpers.
// ---------------------------------------------------------------------------

/**
 * Centre and scale a group so:
 *   - Bounding-box centre sits at world origin.
 *   - Longest axis of the bounding box is 8 units.
 *
 * Mutates `group` in place and returns it for convenience.
 */
function normaliseGroup(group: THREE.Group): THREE.Group {
  const box = new THREE.Box3().setFromObject(group);
  const centre = new THREE.Vector3();
  box.getCenter(centre);

  // Translate so centre is at origin.
  group.position.sub(centre);

  // Scale so max dimension = 8.
  const size = new THREE.Vector3();
  box.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z);
  if (maxDim > 0) {
    const scale = 8 / maxDim;
    group.scale.setScalar(scale);
  }

  return group;
}

// ---------------------------------------------------------------------------
// Public API.
// ---------------------------------------------------------------------------

/**
 * Load a GLB/GLTF file from a file-path string.
 * Returns the root Group, centred and normalised to max 8 units.
 */
export async function loadGlbFromPath(path: string): Promise<THREE.Group> {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(path);
  const root = gltf.scene as THREE.Group;
  return normaliseGroup(root);
}

/**
 * Load a mesh from a raw ArrayBuffer (for file-drag / Tauri file-read support).
 * Returns the root Group, centred and normalised to max 8 units.
 */
export async function loadGlbFromBuffer(buffer: ArrayBuffer): Promise<THREE.Group> {
  const loader = new GLTFLoader();
  const gltf = await new Promise<Awaited<ReturnType<GLTFLoader["loadAsync"]>>>(
    (resolve, reject) => {
      loader.parse(buffer, "", resolve, reject);
    },
  );
  const root = gltf.scene as THREE.Group;
  return normaliseGroup(root);
}
