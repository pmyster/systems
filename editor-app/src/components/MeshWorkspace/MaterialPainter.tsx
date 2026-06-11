/**
 * MaterialPainter — 3D surface-brush material painter.
 *
 * The user paints materials directly on the rendered 3D voxel model,
 * Substance-Painter style. Left-drag paints with the active brush
 * material; right-drag orbits the camera; the wheel zooms. A working
 * copy of the voxel map collects every edit; Apply commits it.
 *
 * Reuses the VoxelSculptor's scene factory, orbit controls, picking
 * helpers, and per-voxel mesh builders so the look matches the sculptor
 * byte-for-byte. The actual material edits are delegated to the pure
 * functions in src/lib/material-ops.ts (paintBrush / floodFill /
 * assignShellCore / assignHeightBands / swapMaterial).
 *
 * Image base-coat (the legacy box-projection inference) survives as a
 * compact secondary path: "Load image…" reads ImageData off an
 * off-screen canvas and runs inferMaterialsFromImage over the working
 * map.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
} from "react";
import * as THREE from "three";

import {
  GRID_SIZE,
  MATERIAL_BY_ID,
  MATERIALS,
  assignHeightBands,
  assignShellCore,
  computeNormalization,
  floodFill,
  paintBrush,
} from "../../lib";
import type { NormalizationParams } from "../../lib";
import type { MaterialId, MutableVoxelMap, VoxelMap } from "../../types/voxel";
import {
  applyOrbit,
  clampDistance,
  clampElevation,
  createOrbitState,
  panOrbit,
} from "../VoxelSculptor/controls";
import {
  getIntersect,
  resolveRemoveCell,
  type CursorCell,
} from "../VoxelSculptor/picking";
import { createSculptScene, type SculptScene } from "../VoxelSculptor/scene";
import { hexToRgb, inferMaterialsFromImage } from "./color-inference";

// ---------------------------------------------------------------------------
// Props (kept identical so MeshWorkspace needs no change).
// ---------------------------------------------------------------------------

export interface MaterialPainterProps {
  voxels: VoxelMap;
  /**
   * Optional source mesh (the same THREE.Group the MeshViewer is showing).
   * When present, the painter enables a "Mesh" surface-paint mode that
   * raycasts onto the mesh triangles and maps the hit point to the
   * underlying voxel cell. When absent (or null), Mesh mode is hidden
   * and only Voxel-cell mode is available.
   *
   * Passing the mesh is OPT-IN per the owner brief: voxel-only authors
   * (legacy starter-pack units, procedural buildings) keep the
   * pre-existing voxel-cell painting unchanged. Mesh authors get the
   * artist-friendly paint-what-you-see UX while voxels remain the
   * source of truth for physics.
   */
  mesh?: THREE.Group | null;
  onApply: (updated: MutableVoxelMap) => void;
  onCancel: () => void;
}

type BrushSize = 1 | 2 | 3;
type PaintMode = "brush" | "fill";

/**
 * Painting surface selection. "voxel" preserves the legacy per-cell
 * picker (raycast hits the voxel cubes directly). "mesh" raycasts the
 * actual mesh surface and maps the hit point to the voxel that
 * contains it — the artist-friendly mode the owner asked for. Default
 * is "mesh" when a mesh prop is present, "voxel" otherwise.
 */
type PaintSurface = "mesh" | "voxel";

// ---------------------------------------------------------------------------
// Mesh helpers (mirrors VoxelSculptor's buildVoxelMesh / disposeVoxelMesh).
// ---------------------------------------------------------------------------

/** Build a single voxel mesh in the sculptor's per-cell style. */
function buildVoxelMesh(materialId: MaterialId): THREE.Mesh {
  const mat = MATERIAL_BY_ID[materialId];
  const geom = new THREE.BoxGeometry(1, 1, 1);
  const meshMat = new THREE.MeshStandardMaterial({
    color: mat.color,
    roughness: mat.id === "glass" ? 0.2 : 0.7,
    metalness: mat.id === "armor" ? 0.4 : 0.1,
    transparent: mat.id === "glass",
    opacity: mat.id === "glass" ? 0.6 : 1.0,
    emissive:
      mat.id === "engine" ? 0x551a0c : mat.id === "hardpoint" ? 0x4a3a1c : 0x000000,
    emissiveIntensity: mat.id === "engine" ? 0.5 : mat.id === "hardpoint" ? 0.6 : 0,
  });
  const mesh = new THREE.Mesh(geom, meshMat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Dispose one voxel mesh's GPU resources. */
function disposeVoxelMesh(mesh: THREE.Mesh): void {
  mesh.geometry.dispose();
  const mat = mesh.material;
  if (Array.isArray(mat)) {
    for (const m of mat) m.dispose();
  } else {
    mat.dispose();
  }
}

// ---------------------------------------------------------------------------
// Pure helpers.
// ---------------------------------------------------------------------------

/**
 * Convert a raycast hit (in world-grid space, where voxel cell `(x,y,z)` lives
 * at world `[x, x+1) × [y, y+1) × [z, z+1)`) into the integer voxel cell it
 * falls inside. Returns null when the hit is outside the editable grid.
 *
 * EXPORTED so tests can verify the conversion without spinning up a scene.
 * The painter holds the SAME invariant the voxel renderer holds: cell
 * `(x,y,z)`'s mesh is positioned at `(x+0.5, y+0.5, z+0.5)`, so flooring
 * the world coord gives the cell index.
 */
export function meshHitToVoxelCell(
  hit: THREE.Vector3,
  gridSize: number = GRID_SIZE,
): { x: number; y: number; z: number } | null {
  const x = Math.floor(hit.x);
  const y = Math.floor(hit.y);
  const z = Math.floor(hit.z);
  if (x < 0 || x >= gridSize) return null;
  if (y < 0 || y >= gridSize) return null;
  if (z < 0 || z >= gridSize) return null;
  return { x, y, z };
}

/**
 * Apply a normalization (computeNormalization output) directly onto a
 * cloned mesh group so its world-space coordinates land in voxel-grid
 * space. After this transform, raycasting against the mesh and flooring
 * the hit point yields the voxel cell the hit falls inside.
 *
 * Equivalent to the voxelizer's `worldToGrid(meshVertex, params)`:
 *   gridX = (worldX - meshCenter.x) * scale + gridCenter.x
 *   gridY = (worldY - meshCenter.y) * scale + gridCenter.y
 *   gridZ = (worldZ - meshCenter.z) * scale + gridCenter.z
 *
 * Implemented as a translate-then-scale on the group's transform so
 * three.js does the math on every vertex via the world matrix — no
 * geometry mutation, the clone is safely disposable on tear-down.
 */
function alignMeshToVoxelGrid(
  group: THREE.Group,
  params: NormalizationParams,
): void {
  // Compose: gridPos = (worldPos - meshCenter) * scale + gridCenter
  //                  = worldPos * scale + (gridCenter - meshCenter * scale)
  // three.js applies T then R then S; the equivalent root transform is:
  //   group.scale = scale
  //   group.position = gridCenter - meshCenter * scale
  group.scale.setScalar(params.scale);
  group.position.set(
    params.gridCenter.x - params.meshCenter.x * params.scale,
    params.gridCenter.y - params.meshCenter.y * params.scale,
    params.gridCenter.z - params.meshCenter.z * params.scale,
  );
}

/** Convert a MATERIALS catalog hex number to a CSS color string. */
function matColorCss(hex: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgb(${r},${g},${b})`;
}

/** Build a summary string like "Armor: 120 · Hull: 88 · Engine: 12". */
function buildSummary(working: MutableVoxelMap): string {
  const counts = new Map<MaterialId, number>();
  for (const id of working.values()) {
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const parts: string[] = [];
  for (const mat of MATERIALS) {
    const n = counts.get(mat.id);
    if (n !== undefined && n > 0) parts.push(`${mat.name}: ${n}`);
  }
  return parts.join(" · ");
}

/**
 * Read ImageData from a File using an off-screen canvas.
 * The canvas is shrunk to 0×0 and removed after reading (memory hygiene).
 */
function readImageData(file: File): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("FileReader error"));
    reader.onload = (evt) => {
      const dataUrl = evt.target?.result;
      if (typeof dataUrl !== "string") {
        reject(new Error("FileReader did not produce a string"));
        return;
      }
      const img = new Image();
      img.onerror = () => reject(new Error("Image decode error"));
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        document.body.appendChild(canvas);
        try {
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            reject(new Error("Could not get 2D context"));
            return;
          }
          ctx.drawImage(img, 0, 0);
          resolve(ctx.getImageData(0, 0, canvas.width, canvas.height));
        } finally {
          // Memory hygiene — shrink and detach the canvas.
          canvas.width = 0;
          canvas.height = 0;
          document.body.removeChild(canvas);
        }
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

// ---------------------------------------------------------------------------
// Styles.
// ---------------------------------------------------------------------------

const GOLD = "#c9a55c";

const S = {
  root: {
    display: "flex",
    flexDirection: "row",
    width: "100%",
    height: "100%",
    minHeight: 0,
    minWidth: 0,
    background: "#0a0d12",
    color: "#d8dde6",
    fontFamily: "system-ui, sans-serif",
    fontSize: 13,
  } satisfies CSSProperties,

  sidebar: {
    width: 220,
    flexShrink: 0,
    overflowY: "auto",
    padding: 12,
    background: "#161619",
    borderRight: "1px solid #2a2a2f",
    display: "flex",
    flexDirection: "column",
    gap: 14,
    minHeight: 0,
  } satisfies CSSProperties,

  heading: {
    fontSize: 14,
    fontWeight: 700,
    letterSpacing: "0.05em",
    color: "#c8cad4",
    margin: 0,
  } satisfies CSSProperties,

  sectionHeading: {
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "#8a93a3",
    fontWeight: 600,
    margin: "0 0 6px 0",
  } satisfies CSSProperties,

  swatchGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: 6,
  } satisfies CSSProperties,

  swatch: (color: string, active: boolean): CSSProperties => ({
    height: 38,
    borderRadius: 4,
    background: color,
    cursor: "pointer",
    border: active ? `2px solid ${GOLD}` : "2px solid #2a2e38",
    boxSizing: "border-box",
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "center",
    fontSize: 9,
    fontWeight: 700,
    color: "rgba(0,0,0,0.7)",
    textShadow: "0 1px 0 rgba(255,255,255,0.25)",
    paddingBottom: 2,
    userSelect: "none",
  }),

  btnRow: {
    display: "flex",
    gap: 6,
  } satisfies CSSProperties,

  toggleBtn: (active: boolean, disabled?: boolean): CSSProperties => ({
    flex: 1,
    padding: "6px 0",
    borderRadius: 3,
    border: active ? `1px solid ${GOLD}` : "1px solid #3a4150",
    background: active ? "#2a2620" : "#232831",
    color: disabled ? "#4a4f5a" : active ? GOLD : "#d8dde6",
    fontFamily: "inherit",
    fontSize: 12,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
  }),

  smartBtn: {
    width: "100%",
    padding: "7px 8px",
    borderRadius: 3,
    border: "1px solid #3a4150",
    background: "#232831",
    color: "#d8dde6",
    fontFamily: "inherit",
    fontSize: 11,
    cursor: "pointer",
    textAlign: "left",
    marginBottom: 5,
  } satisfies CSSProperties,

  summary: {
    color: "#8a8d9a",
    fontSize: 11,
    lineHeight: 1.5,
    margin: 0,
  } satisfies CSSProperties,

  hint: {
    padding: 8,
    background: "#232831",
    borderRadius: 4,
    borderLeft: `2px solid ${GOLD}`,
    fontSize: 11,
    color: "#8a93a3",
    lineHeight: 1.5,
  } satisfies CSSProperties,

  actionRow: {
    display: "flex",
    gap: 8,
    marginTop: "auto",
  } satisfies CSSProperties,

  actionBtn: (variant: "apply" | "cancel"): CSSProperties => ({
    flex: 1,
    padding: "8px 0",
    borderRadius: 3,
    border: "none",
    fontFamily: "inherit",
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.08em",
    cursor: "pointer",
    background: variant === "apply" ? "#c0392b" : "#1e2330",
    color: variant === "apply" ? "#fff" : "#8a8d9a",
  }),

  canvasWrap: {
    position: "relative",
    flex: 1,
    minHeight: 0,
    minWidth: 0,
    overflow: "hidden",
    background: "#0a0d12",
  } satisfies CSSProperties,

  overlay: {
    position: "absolute",
    top: 10,
    left: 10,
    pointerEvents: "none",
    background: "rgba(10,13,18,0.7)",
    border: "1px solid #3a4150",
    borderRadius: 4,
    padding: "4px 8px",
    fontFamily: "SF Mono, Menlo, Consolas, monospace",
    fontSize: 11,
    color: "#8a93a3",
  } satisfies CSSProperties,

  overlayValue: {
    color: GOLD,
    fontWeight: 600,
  } satisfies CSSProperties,

  error: {
    color: "#e05050",
    margin: 0,
    fontSize: 11,
  } satisfies CSSProperties,
} as const;

// ---------------------------------------------------------------------------
// Component.
// ---------------------------------------------------------------------------

export function MaterialPainter({
  voxels,
  mesh,
  onApply,
  onCancel,
}: MaterialPainterProps) {
  // ----- Working copy + tool state ----------------------------------------

  const [working, setWorking] = useState<MutableVoxelMap>(() => new Map(voxels));
  const [brushMaterial, setBrushMaterial] = useState<MaterialId>("armor");
  const [brushSize, setBrushSize] = useState<BrushSize>(1);
  const [mode, setMode] = useState<PaintMode>("brush");
  // Paint surface: mesh-surface raycast vs voxel-cell raycast. Default
  // to "mesh" when a mesh prop was passed, "voxel" otherwise — the
  // owner's preferred default is "paint what you see" any time it's
  // available.
  const [paintSurface, setPaintSurface] = useState<PaintSurface>(
    mesh ? "mesh" : "voxel",
  );
  // hoverCell is the active voxel cell the cursor is over (in either
  // mode). Additionally we capture the live world hit-point in mesh
  // mode so the status bar can surface it ("mesh @ world 1.2, 0.8, 3.4
  // → voxel (6,6,1)"). Held in a single state object so the readout is
  // consistent across renders.
  const [hoverState, setHoverState] = useState<{
    cell: CursorCell | null;
    meshHit: THREE.Vector3 | null;
  }>({ cell: null, meshHit: null });
  const [error, setError] = useState<string | null>(null);

  // ----- Scene refs --------------------------------------------------------

  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<SculptScene | null>(null);
  const orbitRef = useRef(createOrbitState());
  const meshMapRef = useRef<Map<string, THREE.Mesh>>(new Map());
  // Cloned source mesh added to the painter's scene for mesh-mode
  // raycasting. The clone is independent (own geometry + materials)
  // so disposing it on tear-down or surface-change can't corrupt the
  // master in MeshViewer.
  const meshCloneRef = useRef<THREE.Group | null>(null);
  // Latest normalization params used to align the mesh clone to the
  // voxel grid. Stashed for diagnostics and potential future use
  // (e.g. surfacing the mapping in the HUD); the raycast itself
  // doesn't need them — the clone is already in grid space.
  const meshNormRef = useRef<NormalizationParams | null>(null);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);

  // File-input ref for the image base-coat path.
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Latest state read by stable pointer-listener closures (avoids stale
  // closures without re-binding listeners mid-drag).
  const liveRef = useRef({ working, brushMaterial, brushSize, mode, paintSurface });
  liveRef.current = { working, brushMaterial, brushSize, mode, paintSurface };

  // ----- Mount: build scene, attach canvas --------------------------------

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const sceneBundle = createSculptScene();
    sceneRef.current = sceneBundle;
    // Hide sculptor-only fixtures we don't need; keep the grid.
    sceneBundle.mirrorPlane.visible = false;
    sceneBundle.regionBox.visible = false;
    sceneBundle.cursorMesh.visible = false;
    sceneBundle.cursorEdge.visible = false;
    container.appendChild(sceneBundle.renderer.domElement);
    setCanvas(sceneBundle.renderer.domElement);
    applyOrbit(sceneBundle.camera, orbitRef.current);

    return () => {
      for (const mesh of meshMapRef.current.values()) {
        sceneBundle.voxelGroup.remove(mesh);
        disposeVoxelMesh(mesh);
      }
      meshMapRef.current.clear();
      // Dispose the mesh clone (if mesh mode left one). The clone owns
      // independent geometry + overlay materials; freeing them here
      // mirrors the voxel-mesh cleanup above so we don't leak GPU
      // resources on unmount.
      const clone = meshCloneRef.current;
      if (clone) {
        sceneBundle.scene.remove(clone);
        clone.traverse((node) => {
          if (node instanceof THREE.Mesh) {
            node.geometry.dispose();
            const mats = Array.isArray(node.material) ? node.material : [node.material];
            for (const m of mats) m.dispose();
          }
        });
        meshCloneRef.current = null;
        meshNormRef.current = null;
      }
      if (sceneBundle.renderer.domElement.parentNode === container) {
        container.removeChild(sceneBundle.renderer.domElement);
      }
      sceneBundle.dispose();
      sceneRef.current = null;
      setCanvas(null);
    };
  }, []);

  // ----- Mesh clone for mesh-surface raycasting ---------------------------
  //
  // When mesh-surface paint mode is active AND a source mesh is available,
  // deep-clone the mesh into the painter's scene aligned to voxel-grid
  // space. The clone is positioned/scaled via `alignMeshToVoxelGrid` so
  // that raycast hits in world coords map DIRECTLY to voxel cells via
  // `meshHitToVoxelCell` (floor of the world coord). When mesh mode is
  // off OR the source mesh is null, the clone is removed and disposed.
  //
  // We use a slightly translucent override material so the underlying
  // voxel cells stay visible during paint — the artist sees "this surface
  // → that cell" mapping live as they hover.

  useEffect(() => {
    const sceneBundle = sceneRef.current;
    if (!sceneBundle) return undefined;

    // Tear down any prior clone before deciding whether to mount a new one.
    const prior = meshCloneRef.current;
    if (prior) {
      sceneBundle.scene.remove(prior);
      prior.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          node.geometry.dispose();
          const mats = Array.isArray(node.material) ? node.material : [node.material];
          for (const m of mats) m.dispose();
        }
      });
      meshCloneRef.current = null;
      meshNormRef.current = null;
    }

    if (paintSurface !== "mesh" || mesh === null || mesh === undefined) {
      return undefined;
    }

    // Compute normalization against the SOURCE mesh (not the clone), so
    // we share params with the voxelizer's view of the same mesh. Then
    // clone, align, and add. computeNormalization can return null on a
    // degenerate (empty) mesh — surface that loud-over-silent rather
    // than silently rendering nothing.
    const norm = computeNormalization(mesh);
    if (norm === null) {
      // eslint-disable-next-line no-console
      console.warn(
        "[MaterialPainter] mesh paint mode: source mesh has no usable " +
          "bounding box (empty or degenerate). Falling back to voxel mode.",
      );
      setPaintSurface("voxel");
      return undefined;
    }

    const clone = mesh.clone(true);
    clone.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.geometry = node.geometry.clone();
        // Override with a translucent material so painted voxels remain
        // visible through the mesh surface. The original material is
        // owned by the source mesh — never touched here.
        const overlay = new THREE.MeshStandardMaterial({
          color: 0xc9a55c,
          roughness: 0.7,
          metalness: 0.05,
          transparent: true,
          opacity: 0.35,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
        node.material = overlay;
      }
    });
    alignMeshToVoxelGrid(clone, norm);
    clone.name = "MaterialPainterMeshClone";
    sceneBundle.scene.add(clone);
    meshCloneRef.current = clone;
    meshNormRef.current = norm;

    return undefined;
    // The cleanup runs at the top of the next effect (or unmount) — the
    // explicit teardown above handles both paths.
  }, [mesh, paintSurface]);

  // ----- Reconcile working → scene meshes ---------------------------------

  useEffect(() => {
    const sceneBundle = sceneRef.current;
    if (!sceneBundle) return;
    const group = sceneBundle.voxelGroup;
    const meshMap = meshMapRef.current;

    // Remove meshes whose coord is gone OR whose material changed.
    for (const [k, mesh] of meshMap) {
      const next = working.get(k);
      if (!next) {
        group.remove(mesh);
        disposeVoxelMesh(mesh);
        meshMap.delete(k);
      } else {
        const ud = mesh.userData as { material?: MaterialId };
        if (ud.material !== next) {
          group.remove(mesh);
          disposeVoxelMesh(mesh);
          meshMap.delete(k);
        }
      }
    }

    // Add meshes for coords newly present (or rebuilt after a material change).
    for (const [k, mat] of working) {
      if (meshMap.has(k)) continue;
      const parts = k.split(",");
      if (parts.length !== 3) continue;
      const x = Number(parts[0]);
      const y = Number(parts[1]);
      const z = Number(parts[2]);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        continue;
      }
      const mesh = buildVoxelMesh(mat);
      mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
      mesh.userData = { material: mat };
      group.add(mesh);
      meshMap.set(k, mesh);
    }
  }, [working]);

  // ----- Render loop (rAF, paused while hidden) ---------------------------

  useEffect(() => {
    const sceneBundle = sceneRef.current;
    if (!sceneBundle) return undefined;

    let rafId = 0;
    let stopped = false;

    const frame = (): void => {
      if (stopped) return;
      if (document.visibilityState !== "hidden") {
        sceneBundle.renderer.render(sceneBundle.scene, sceneBundle.camera);
      }
      rafId = requestAnimationFrame(frame);
    };
    rafId = requestAnimationFrame(frame);

    const onVisibility = (): void => {
      if (document.visibilityState !== "hidden") {
        sceneBundle.renderer.render(sceneBundle.scene, sceneBundle.camera);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stopped = true;
      cancelAnimationFrame(rafId);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [canvas]);

  // ----- ResizeObserver on the container ----------------------------------

  useEffect(() => {
    const container = containerRef.current;
    const sceneBundle = sceneRef.current;
    if (!container || !sceneBundle) return undefined;

    const apply = (w: number, h: number): void => {
      if (w <= 0 || h <= 0) return;
      sceneBundle.camera.aspect = w / h;
      sceneBundle.camera.updateProjectionMatrix();
      sceneBundle.renderer.setSize(w, h, false);
    };

    apply(container.clientWidth, container.clientHeight);

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const cr = entry.contentRect;
        apply(cr.width, cr.height);
      }
    });
    ro.observe(container);
    return () => {
      ro.disconnect();
    };
  }, [canvas]);

  // ----- Pointer controls (own handlers; not VoxelSculptor's add/remove) --

  useEffect(() => {
    if (!canvas) return undefined;

    interface DragStart {
      readonly x: number;
      readonly y: number;
      readonly button: number;
      readonly az: number;
      readonly el: number;
      readonly tx: number;
      readonly ty: number;
      readonly tz: number;
    }
    let dragStart: DragStart | null = null;
    let isDragging = false;
    // Cells painted during the current stroke — skip re-painting them.
    const paintedThisStroke = new Set<string>();

    const sceneBundle = sceneRef.current;
    if (!sceneBundle) return undefined;

    /**
     * Pick a voxel cell from a pointer position. Two paths:
     *
     *   - MESH mode: raycast against the cloned mesh surface (positioned
     *     in voxel-grid space). The hit point's `floor(x,y,z)` is the
     *     voxel cell. Also returns the raw world hit so the HUD can
     *     surface "mesh @ world ... → voxel ..." for the owner.
     *   - VOXEL mode: legacy behaviour — raycast against the voxel cubes
     *     and use the picked-cell logic.
     *
     * Returns null when no usable hit is found.
     */
    const pickCell = (
      clientX: number,
      clientY: number,
    ): {
      cell: CursorCell;
      meshHit: THREE.Vector3 | null;
    } | null => {
      const live = liveRef.current;

      if (live.paintSurface === "mesh" && meshCloneRef.current !== null) {
        // Mesh raycast — uses the painter's own raycaster so we don't
        // depend on getIntersect's voxel-mesh interface.
        const rect = canvas.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return null;
        const ndc = new THREE.Vector2(
          ((clientX - rect.left) / rect.width) * 2 - 1,
          -((clientY - rect.top) / rect.height) * 2 + 1,
        );
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(ndc, sceneBundle.camera);
        const hits = raycaster.intersectObject(meshCloneRef.current, true);
        if (hits.length === 0) return null;
        const hit = hits[0];
        const cell = meshHitToVoxelCell(hit.point);
        if (cell === null) return null;
        // resolveRemoveCell expects an `Intersect` shape; for mesh mode
        // we synthesise a CursorCell directly. `inside` is always true
        // here — meshHitToVoxelCell only returns cells in-bounds.
        return {
          cell: { x: cell.x, y: cell.y, z: cell.z, inside: true },
          meshHit: hit.point.clone(),
        };
      }

      // Voxel-cell mode (legacy).
      const meshes = Array.from(meshMapRef.current.values());
      const result = getIntersect(
        canvas,
        sceneBundle.camera,
        meshes,
        sceneBundle.ground,
        clientX,
        clientY,
      );
      if (!result || result.type !== "voxel") return null;
      const cell = resolveRemoveCell(result);
      if (!cell || !cell.inside) return null;
      return { cell, meshHit: null };
    };

    /** Cast against the current surface and paint the picked cell. */
    const paintAt = (clientX: number, clientY: number): void => {
      const picked = pickCell(clientX, clientY);
      if (picked === null) return;
      const cell = picked.cell;

      const live = liveRef.current;
      const strokeKey = `${cell.x},${cell.y},${cell.z}`;
      if (paintedThisStroke.has(strokeKey)) return;
      paintedThisStroke.add(strokeKey);

      if (live.mode === "fill") {
        setWorking(
          floodFill(live.working, cell.x, cell.y, cell.z, live.brushMaterial),
        );
      } else {
        setWorking(
          paintBrush(
            live.working,
            cell.x,
            cell.y,
            cell.z,
            live.brushMaterial,
            live.brushSize,
          ),
        );
      }
    };

    /** Update the hover-cell readout (no painting). */
    const updateHover = (clientX: number, clientY: number): void => {
      const picked = pickCell(clientX, clientY);
      if (picked === null) {
        setHoverState({ cell: null, meshHit: null });
        return;
      }
      setHoverState({ cell: picked.cell, meshHit: picked.meshHit });
    };

    const onContextMenu = (e: MouseEvent): void => {
      e.preventDefault();
    };

    const onPointerDown = (e: PointerEvent): void => {
      const orbit = orbitRef.current;
      isDragging = false;
      paintedThisStroke.clear();
      dragStart = {
        x: e.clientX,
        y: e.clientY,
        button: e.button,
        az: orbit.azimuth,
        el: orbit.elevation,
        tx: orbit.camTarget.x,
        ty: orbit.camTarget.y,
        tz: orbit.camTarget.z,
      };
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // setPointerCapture can throw if the pointer isn't active; ignore.
      }
      // Left button paints immediately on press.
      if (e.button === 0) {
        isDragging = true;
        paintAt(e.clientX, e.clientY);
      }
    };

    const onPointerMove = (e: PointerEvent): void => {
      if (dragStart) {
        const dx = e.clientX - dragStart.x;
        const dy = e.clientY - dragStart.y;
        if (dragStart.button === 0) {
          // Left-drag = paint stroke.
          paintAt(e.clientX, e.clientY);
          return;
        }
        if (!isDragging && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
          isDragging = true;
        }
        if (isDragging) {
          if (dragStart.button === 2) {
            // Right-drag = orbit.
            orbitRef.current.azimuth = dragStart.az - dx * 0.008;
            orbitRef.current.elevation = clampElevation(dragStart.el + dy * 0.008);
            applyOrbit(sceneBundle.camera, orbitRef.current);
          } else if (dragStart.button === 1) {
            // Middle-drag = pan.
            const speed = orbitRef.current.distance * 0.0025;
            orbitRef.current.camTarget.set(dragStart.tx, dragStart.ty, dragStart.tz);
            panOrbit(orbitRef.current, -dx * speed, dy * speed);
            applyOrbit(sceneBundle.camera, orbitRef.current);
          }
        }
        return;
      }
      // No button down — update hover readout.
      updateHover(e.clientX, e.clientY);
    };

    const onPointerUp = (e: PointerEvent): void => {
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      dragStart = null;
      isDragging = false;
      paintedThisStroke.clear();
    };

    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      orbitRef.current.distance = clampDistance(
        orbitRef.current.distance * (1 + e.deltaY * 0.0015),
      );
      applyOrbit(sceneBundle.camera, orbitRef.current);
    };

    canvas.addEventListener("contextmenu", onContextMenu);
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      canvas.removeEventListener("contextmenu", onContextMenu);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [canvas]);

  // ----- Smart-assign handlers --------------------------------------------

  const handleShellCore = useCallback(() => {
    setWorking((prev) => assignShellCore(prev, "armor", "hull"));
  }, []);

  const handleHeightBands = useCallback(() => {
    setWorking((prev) => assignHeightBands(prev, ["hull", "engine", "armor"]));
  }, []);

  const handleFillAll = useCallback(() => {
    setWorking((prev) => {
      const m = new Map(prev);
      for (const k of m.keys()) m.set(k, brushMaterial);
      return m;
    });
  }, [brushMaterial]);

  // ----- Image base-coat ---------------------------------------------------

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      try {
        const imageData = await readImageData(file);
        setWorking((prev) => inferMaterialsFromImage(prev, imageData, GRID_SIZE));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error reading image");
      }
    },
    [],
  );

  const handleInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) void handleFile(file);
      e.target.value = "";
    },
    [handleFile],
  );

  const handleLoadImageClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // ----- Apply / cancel ----------------------------------------------------

  const handleApply = useCallback(() => {
    onApply(working);
  }, [onApply, working]);

  // ----- Derived -----------------------------------------------------------

  const summary = useMemo(() => buildSummary(working), [working]);

  // ----- Render ------------------------------------------------------------

  return (
    <div style={S.root}>
      <aside style={S.sidebar}>
        <p style={S.heading}>MATERIAL PAINTER</p>

        {/* Paint surface toggle — Mesh vs Voxel cell.
            Mesh mode raycasts the visible mesh surface and auto-maps the hit
            to its underlying voxel (artist-friendly: paint what you see).
            Voxel mode raycasts the voxel cubes directly (legacy/power-user).
            The Mesh button is disabled when no source mesh is available. */}
        <div>
          <h3 style={S.sectionHeading}>Paint surface</h3>
          <div style={S.btnRow}>
            <button
              type="button"
              disabled={!mesh}
              style={S.toggleBtn(paintSurface === "mesh", !mesh)}
              onClick={() => {
                if (mesh) setPaintSurface("mesh");
              }}
              title={
                mesh
                  ? "Paint on the visible mesh surface; the system maps each click to the underlying voxel."
                  : "No mesh available — import a mesh first to enable Mesh paint mode."
              }
            >
              Mesh
            </button>
            <button
              type="button"
              style={S.toggleBtn(paintSurface === "voxel")}
              onClick={() => setPaintSurface("voxel")}
              title="Paint the voxel cells directly (legacy mode)."
            >
              Voxel
            </button>
          </div>
        </div>

        {/* Material palette */}
        <div>
          <h3 style={S.sectionHeading}>Material</h3>
          <div style={S.swatchGrid}>
            {MATERIALS.map((mat) => (
              <div
                key={mat.id}
                role="button"
                tabIndex={0}
                title={mat.name}
                style={S.swatch(matColorCss(mat.color), brushMaterial === mat.id)}
                onClick={() => setBrushMaterial(mat.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") setBrushMaterial(mat.id);
                }}
              >
                {mat.name}
              </div>
            ))}
          </div>
        </div>

        {/* Mode toggle */}
        <div>
          <h3 style={S.sectionHeading}>Tool</h3>
          <div style={S.btnRow}>
            <button
              type="button"
              style={S.toggleBtn(mode === "brush")}
              onClick={() => setMode("brush")}
            >
              Brush
            </button>
            <button
              type="button"
              style={S.toggleBtn(mode === "fill")}
              onClick={() => setMode("fill")}
            >
              Fill (bucket)
            </button>
          </div>
        </div>

        {/* Brush size */}
        <div>
          <h3 style={S.sectionHeading}>Brush size</h3>
          <div style={S.btnRow}>
            {([1, 2, 3] as const).map((sz) => (
              <button
                key={sz}
                type="button"
                disabled={mode === "fill"}
                style={S.toggleBtn(brushSize === sz, mode === "fill")}
                onClick={() => setBrushSize(sz)}
              >
                {sz}
              </button>
            ))}
          </div>
        </div>

        {/* Smart assign */}
        <div>
          <h3 style={S.sectionHeading}>Smart assign</h3>
          <button type="button" style={S.smartBtn} onClick={handleShellCore}>
            Shell → Armor, Core → Hull
          </button>
          <button type="button" style={S.smartBtn} onClick={handleHeightBands}>
            Height Bands
          </button>
          <button type="button" style={S.smartBtn} onClick={handleFillAll}>
            Fill all with {MATERIAL_BY_ID[brushMaterial].name}
          </button>
        </div>

        {/* Image base coat (secondary) */}
        <div>
          <h3 style={S.sectionHeading}>Image base coat</h3>
          <button type="button" style={S.smartBtn} onClick={handleLoadImageClick}>
            Load image…
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".jpg,.jpeg,.png,.webp"
            style={{ display: "none" }}
            onChange={handleInputChange}
          />
          {error !== null && <p style={S.error}>{error}</p>}
        </div>

        {/* Counts */}
        {summary.length > 0 && <p style={S.summary}>{summary}</p>}

        {/* Controls hint */}
        <div style={S.hint}>
          Left-drag paint · Right-drag orbit · Wheel zoom
          {paintSurface === "mesh" && (
            <>
              <br />
              <span style={{ color: "#c9a55c" }}>Mesh mode:</span> click the
              visible surface; the voxel underneath gets painted.
            </>
          )}
        </div>

        {/* Apply / Cancel */}
        <div style={S.actionRow}>
          <button type="button" style={S.actionBtn("apply")} onClick={handleApply}>
            APPLY
          </button>
          <button type="button" style={S.actionBtn("cancel")} onClick={onCancel}>
            CANCEL
          </button>
        </div>
      </aside>

      <div style={S.canvasWrap} ref={containerRef}>
        <div style={S.overlay}>
          <span>hover: </span>
          {paintSurface === "mesh" && hoverState.meshHit !== null ? (
            <>
              <span style={S.overlayValue}>
                {`mesh @ world ${hoverState.meshHit.x.toFixed(1)}, ${hoverState.meshHit.y.toFixed(1)}, ${hoverState.meshHit.z.toFixed(1)}`}
              </span>
              {" → "}
              <span style={S.overlayValue}>
                {hoverState.cell
                  ? `voxel (${hoverState.cell.x},${hoverState.cell.y},${hoverState.cell.z})`
                  : "voxel —"}
              </span>
            </>
          ) : (
            <span style={S.overlayValue}>
              {hoverState.cell
                ? `(${hoverState.cell.x},${hoverState.cell.y},${hoverState.cell.z})`
                : "—"}
            </span>
          )}
          {" · "}
          <span>
            brush{" "}
            <span style={S.overlayValue}>{MATERIAL_BY_ID[brushMaterial].name}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
