/**
 * Mesh loading utilities for the Mesh Workspace viewer.
 *
 * Supports GLB / GLTF (GLTFLoader), OBJ (OBJLoader), and STL (STLLoader —
 * the format most wargaming / 3D-print models ship as). Files are read
 * through the Rust backend (read_unit_file for text, read_binary_file for
 * binary) rather than fetched by URL — a Tauri webview cannot fetch a raw
 * OS path, and dialog-picked paths are outside the fs-plugin scope.
 *
 * Every entry point centres and normalises the returned group so any mesh
 * fits comfortably in the viewer (max dimension ≈ 8 units) and has vertex
 * normals (so unlit OBJ files still shade correctly).
 */

import * as THREE from "three";
import { invoke } from "@tauri-apps/api/core";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { MTLLoader } from "three/addons/loaders/MTLLoader.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";

// ---------------------------------------------------------------------------
// Internal helpers.
// ---------------------------------------------------------------------------

/**
 * The world-space size (meters) we normalise every imported mesh's longest
 * bbox dimension to. Used by `normaliseGroup` AND surfaced in the returned
 * group's `userData.normalizedSizeM` so downstream consumers (battlefield
 * scaling via `chassis.length_m`, hardpoint migration) can read it without
 * hardcoding the constant in three places.
 */
const NORMALIZE_TARGET_M = 8;

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
 * Bake every interior node's local scale into the geometry vertices, then
 * reset that node's `scale` to (1, 1, 1). After this pass, every coordinate
 * system inside the mesh hierarchy is uniform — no per-node scale factors
 * remain to interfere with `THREE.Object3D.attach()` math.
 *
 * WHY THIS IS NECESSARY (the "wash"):
 *
 *   `Object3D.attach()` re-parents a node while preserving its world
 *   transform. Internally it walks the new parent's world-matrix inverse and
 *   the child's current world matrix. When the parent (or any ancestor) has
 *   a non-unit scale, the resulting LOCAL position the child ends up with is
 *   the world position DIVIDED by the parent's accumulated scale — a value
 *   that is correct ONLY IF every subsequent matrix recomposition keeps that
 *   same scale chain. In practice the rig system bakes a `baseQuat` but
 *   recomposes position from the un-scaled `node.position` (parent space),
 *   so a parent scale of 100 turns an authored hardpoint at (0, 2.36, 1.92)
 *   into a stored local of (0, 236, 192) — and it lands far off-mesh.
 *
 *   Baking the scales away pre-empts the problem: every node in the chain
 *   carries scale 1, so `attach()` and all downstream local-relative math
 *   are dimensionally consistent.
 *
 * IMPORTANT INVARIANTS:
 *
 *   1. The function recurses on each node's CHILDREN, never on the ROOT.
 *      The root's own scale is reserved for `normaliseGroup` to set
 *      immediately after — burying it now would force `normaliseGroup` to
 *      re-measure into a no-op.
 *   2. Geometry instances are CLONED before mutation. GLTF models commonly
 *      share one BufferGeometry across multiple meshes (instanced parts);
 *      mutating in place would scale every reference, not just this node's.
 *   3. Children's `position` is multiplied by the parent's scale BEFORE the
 *      parent's scale is reset, so the child lands at the same world
 *      position after the bake.
 */
function bakeNodeScales(root: THREE.Object3D): void {
  function bakeInterior(node: THREE.Object3D): void {
    // Capture this node's scale FIRST — we need it both for our own
    // geometry/children and to detect whether any work is required.
    const sx = node.scale.x;
    const sy = node.scale.y;
    const sz = node.scale.z;
    const hasNonUnitScale = sx !== 1 || sy !== 1 || sz !== 1;

    if (hasNonUnitScale) {
      // Bake into THIS node's geometry (if it has one). Clone first so we
      // never corrupt a shared BufferGeometry — instanced parts in a GLB
      // typically reference the same geometry from multiple meshes.
      if (node instanceof THREE.Mesh && node.geometry instanceof THREE.BufferGeometry) {
        node.geometry = node.geometry.clone();
        node.geometry.scale(sx, sy, sz);
      }
      // Push the scale through each child's parent-space position so its
      // world position is preserved once the parent's scale is reset. The
      // child's own SCALE is left alone — we'll bake that when we recurse.
      for (const child of node.children) {
        child.position.set(
          child.position.x * sx,
          child.position.y * sy,
          child.position.z * sz,
        );
      }
      node.scale.set(1, 1, 1);
    }

    // Recurse into children. We snapshot the children array because
    // re-assigning a geometry can in principle happen here; in practice the
    // scene graph children list is stable across this op, but copying the
    // reference makes the iteration safe under any future mutation.
    const kids = node.children.slice();
    for (const child of kids) {
      bakeInterior(child);
    }
  }

  // Start on the CHILDREN, not the root itself (see invariant #1).
  const rootKids = root.children.slice();
  for (const child of rootKids) {
    bakeInterior(child);
  }
}

/**
 * Centre and scale a group so:
 *   - Bounding-box centre sits at world origin.
 *   - Longest axis of the bounding box is NORMALIZE_TARGET_M meters.
 *
 * Mutates `group` in place and returns it for convenience.
 *
 * Runs `bakeNodeScales` as its first step so every interior node's local
 * scale is folded into its geometry BEFORE we compute the bounding box —
 * the bake doesn't change the rendered shape, but it does ensure no
 * non-unit scales remain to break downstream hardpoint attach() math.
 *
 * OPTION C — BAKE NORMALIZE SCALE INTO GEOMETRY:
 *
 *   After this function, the returned group has `scale = (1,1,1)`. The
 *   normalize factor `s = NORMALIZE_TARGET_M / maxDim` is folded into every
 *   mesh's geometry vertices AND into every immediate child's `position`.
 *   That keeps the rendered shape identical to the pre-Option-C behaviour
 *   (group.scale = s, geometry untouched) while making EVERY coordinate
 *   downstream of `group` interpretable as world meters when `group` itself
 *   has no parent scale applied (which is the case in both the Mesh Workspace
 *   viewer and the Battlefield Preview, modulo the chassis.length_m knob).
 *
 *   WHY: the TransformControls gizmo writes a hardpoint's local_position by
 *   converting world-space gizmo motion into the parent's local frame.
 *   When the parent has scale 0.005 (a turret authored in mm), a 1m gizmo
 *   drag becomes a local delta of 1/0.005 = 200 — and the form's "Pos"
 *   number bears no useful relationship to meters. Baking the scale away
 *   makes the form's Pos values DIRECTLY meters.
 *
 *   STASHED IN userData:
 *     - normalizeScale: the `s` factor we applied. Old units saved before
 *       this change need their hardpoint positions multiplied by this value
 *       to convert from pre-bake local units to world meters. Surviving
 *       through THREE.Object3D.clone() because clone copies userData JSON.
 *     - normalizedSizeM: the target size we normalised to (= NORMALIZE_TARGET_M).
 *       Read by `setMeshUnit` to convert chassis.length_m into an effective
 *       battlefield-only scale factor.
 */
function normaliseGroup(group: THREE.Group): THREE.Group {
  // Wash: bake all interior per-node scales into geometry. After this, every
  // node inside the hierarchy has scale (1,1,1) — only `group.scale` is
  // momentarily set below before being baked too.
  bakeNodeScales(group);
  ensureNormals(group);

  // Compute bbox before any transform on the group (starts at identity).
  const box = new THREE.Box3().setFromObject(group);
  if (box.isEmpty()) {
    // Even an empty bbox needs the bookkeeping so downstream code can rely
    // on these fields being present.
    group.userData.normalizeScale = 1;
    group.userData.normalizedSizeM = NORMALIZE_TARGET_M;
    return group;
  }

  const centre = new THREE.Vector3();
  box.getCenter(centre);

  const size = new THREE.Vector3();
  box.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z);
  const s = maxDim > 0 ? NORMALIZE_TARGET_M / maxDim : 1;

  if (s !== 1) {
    // Bake `s` into every mesh's geometry vertices. We CLONE first because
    // GLTF often instances one BufferGeometry across multiple meshes; in-place
    // mutation would scale every reference. Walking the whole tree is fine
    // — bakeNodeScales already ensured each interior node carries identity
    // scale, so the only remaining scale chain is the one we're collapsing
    // here.
    group.traverse((node) => {
      if (
        node instanceof THREE.Mesh &&
        node.geometry instanceof THREE.BufferGeometry
      ) {
        node.geometry = node.geometry.clone();
        node.geometry.scale(s, s, s);
      }
    });
    // Push `s` through each IMMEDIATE child's parent-space position so the
    // world position is preserved once the group's own scale is reset.
    // Interior descendants were already handled by bakeNodeScales (their
    // positions are in their parent's local frame — and that parent's scale
    // has been baked into ITS geometry, which doesn't affect child positions).
    for (const child of group.children) {
      child.position.multiplyScalar(s);
    }
  }
  // Explicit: no parent scale chain remains. Downstream coordinates are
  // in world meters.
  group.scale.setScalar(1);

  // Centre + floor in the now-baked (meters) frame. The original box was
  // measured BEFORE the bake, so its values are in pre-bake units — multiply
  // by `s` to express the offset in the post-bake (meters) frame.
  group.position.set(-s * centre.x, -s * box.min.y, -s * centre.z);

  // Stash bookkeeping so consumers know how to migrate / scale.
  group.userData.normalizeScale = s;
  group.userData.normalizedSizeM = NORMALIZE_TARGET_M;
  return group;
}

/** Lowercased file extension (without dot), or "" if none. */
function extensionOf(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot >= 0 ? path.slice(dot + 1).toLowerCase() : "";
}

/** Extract the directory portion of a file path (handles both / and \). */
function dirOf(filePath: string): string {
  const last = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return last >= 0 ? filePath.slice(0, last + 1) : "";
}

// ---------------------------------------------------------------------------
// Per-format parsers (operate on already-read data).
// ---------------------------------------------------------------------------

/** Parse OBJ text into a normalised group. */
export function loadObjFromText(text: string, loader?: OBJLoader): THREE.Group {
  const root = (loader ?? new OBJLoader()).parse(text);

  // OBJ face winding varies by exporter — some wind clockwise, some CCW.
  // Three.js defaults to FrontSide so back-faces are culled, making the mesh
  // invisible from outside when normals happen to point inward.  Force
  // DoubleSide on every material so OBJ imports are always visible.
  root.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      for (const mat of mats) {
        if (mat instanceof THREE.Material) {
          mat.side = THREE.DoubleSide;
          mat.needsUpdate = true;
        }
      }
    }
  });

  return normaliseGroup(root);
}

/**
 * Parse an STL ArrayBuffer (binary OR ASCII — STLLoader auto-detects) into a
 * normalised group. STL is geometry-only with no materials, so we wrap it in
 * a single mesh with a neutral default material; the user paints/skins it.
 */
export function loadStlFromBuffer(buffer: ArrayBuffer): THREE.Group {
  const geom = new STLLoader().parse(buffer);
  const material = new THREE.MeshStandardMaterial({
    color: 0xb5b5b5,
    roughness: 0.75,
    metalness: 0.1,
  });
  const mesh = new THREE.Mesh(geom, material);
  const group = new THREE.Group();
  group.add(mesh);
  return normaliseGroup(group);
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
export const SUPPORTED_MESH_EXTENSIONS = ["glb", "gltf", "obj", "stl"] as const;

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

    // Try to load the associated MTL file (OBJ separates geometry from
    // materials; without MTL every mesh loads as flat gray).  We strip
    // map_* (texture) directives because loading referenced image files via
    // the Tauri backend is not yet wired up — the user can apply a photo
    // skin via "Apply Skin" instead.
    const dir = dirOf(path);
    const mtlMatcher = /^mtllib\s+(.+)$/gm;
    let objLoader = new OBJLoader();

    if (dir.length > 0) {
      const mtlFilenames: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = mtlMatcher.exec(text)) !== null) {
        mtlFilenames.push(m[1].trim());
      }

      for (const mtlFilename of mtlFilenames) {
        try {
          const mtlPath = dir + mtlFilename;
          const mtlText = await invoke<string>("read_unit_file", { path: mtlPath });
          if (mtlText && mtlText.trim().length > 0) {
            // Strip texture-map directives; load colours only.
            const stripped = mtlText
              .split("\n")
              .filter((line) => !/^\s*map_/i.test(line))
              .join("\n");
            const mtlLoader = new MTLLoader();
            const materials = mtlLoader.parse(stripped, "");
            materials.preload();
            objLoader = objLoader.setMaterials(materials);
            break; // first successfully loaded MTL is enough
          }
        } catch {
          // MTL not found or unreadable — proceed without materials.
        }
      }
    }

    return loadObjFromText(text, objLoader);
  }

  if (ext === "glb" || ext === "gltf") {
    const bytes = await invoke<number[]>("read_binary_file", { path });
    const buffer = new Uint8Array(bytes).buffer;
    return loadGlbFromBuffer(buffer);
  }

  if (ext === "stl") {
    const bytes = await invoke<number[]>("read_binary_file", { path });
    const buffer = new Uint8Array(bytes).buffer;
    return loadStlFromBuffer(buffer);
  }

  throw new Error(
    `Unsupported mesh format ".${ext}". Supported: ${SUPPORTED_MESH_EXTENSIONS.map((e) => "." + e).join(", ")}.`,
  );
}
