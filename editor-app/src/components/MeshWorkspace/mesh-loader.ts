/**
 * Mesh loading utilities for the Mesh Workspace viewer.
 *
 * Supports GLB / GLTF (Three.js GLTFLoader) and OBJ (OBJLoader). Files are
 * read through the Rust backend (read_unit_file for text, read_binary_file
 * for binary) rather than fetched by URL — a Tauri webview cannot fetch a
 * raw OS path, and dialog-picked paths are outside the fs-plugin scope.
 *
 * Every entry point centres and normalises the returned group so any mesh
 * fits comfortably in the viewer (max dimension ≈ 8 units) and has vertex
 * normals (so unlit OBJ files still shade correctly).
 */

import * as THREE from "three";
import { invoke } from "@tauri-apps/api/core";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";

// ---------------------------------------------------------------------------
// Internal helpers.
// ---------------------------------------------------------------------------

/** Ensure every mesh has vertex normals (OBJ files often ship without). */
function ensureNormals(group: THREE.Object3D): void {
  group.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      const geom = node.geometry as THREE.BufferGeometry;
      if (!geom.getAttribute("normal")) {
        geom.computeVertexNormals();
      }
    }
  });
}

/**
 * Centre and scale a group so:
 *   - Bounding-box centre sits at world origin.
 *   - Longest axis of the bounding box is 8 units.
 *
 * Mutates `group` in place and returns it for convenience.
 */
function normaliseGroup(group: THREE.Group): THREE.Group {
  ensureNormals(group);

  const box = new THREE.Box3().setFromObject(group);
  const centre = new THREE.Vector3();
  box.getCenter(centre);
  group.position.sub(centre);

  const size = new THREE.Vector3();
  box.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z);
  if (maxDim > 0) {
    group.scale.setScalar(8 / maxDim);
  }

  return group;
}

/** Lowercased file extension (without dot), or "" if none. */
function extensionOf(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot >= 0 ? path.slice(dot + 1).toLowerCase() : "";
}

// ---------------------------------------------------------------------------
// Per-format parsers (operate on already-read data).
// ---------------------------------------------------------------------------

/** Parse OBJ text into a normalised group. */
export function loadObjFromText(text: string): THREE.Group {
  const root = new OBJLoader().parse(text);
  return normaliseGroup(root);
}

/**
 * Load a mesh from a raw ArrayBuffer (GLB, or self-contained GLTF).
 * Returns the root Group, centred and normalised to max 8 units.
 */
export async function loadGlbFromBuffer(buffer: ArrayBuffer): Promise<THREE.Group> {
  const loader = new GLTFLoader();
  const gltf = await new Promise<Awaited<ReturnType<GLTFLoader["loadAsync"]>>>(
    (resolve, reject) => {
      loader.parse(buffer, "", resolve, reject);
    },
  );
  return normaliseGroup(gltf.scene as THREE.Group);
}

// ---------------------------------------------------------------------------
// Public API: read a file from disk (via Rust) and parse by extension.
// ---------------------------------------------------------------------------

/** Supported import extensions. */
export const SUPPORTED_MESH_EXTENSIONS = ["glb", "gltf", "obj"] as const;

/**
 * Load any supported mesh from an absolute file-path. Reads the file through
 * the Rust backend (so it works inside the Tauri webview) and dispatches to
 * the correct loader based on the file extension.
 *
 * Throws an Error with a human-readable message on unsupported extension or
 * read/parse failure — the caller is expected to surface it (loud, not silent).
 */
export async function loadMeshFromPath(path: string): Promise<THREE.Group> {
  const ext = extensionOf(path);

  if (ext === "obj") {
    const text = await invoke<string>("read_unit_file", { path });
    if (!text || text.trim().length === 0) {
      throw new Error("OBJ file is empty.");
    }
    return loadObjFromText(text);
  }

  if (ext === "glb" || ext === "gltf") {
    const bytes = await invoke<number[]>("read_binary_file", { path });
    const buffer = new Uint8Array(bytes).buffer;
    return loadGlbFromBuffer(buffer);
  }

  throw new Error(
    `Unsupported mesh format ".${ext}". Supported: ${SUPPORTED_MESH_EXTENSIONS.map((e) => "." + e).join(", ")}.`,
  );
}
