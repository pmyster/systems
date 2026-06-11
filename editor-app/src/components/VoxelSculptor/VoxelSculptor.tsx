/**
 * VoxelSculptor — left-pane 3D voxel chassis editor.
 *
 * Lift of tools/voxel-editor/index.html into React idiom. The pane owns:
 *   - The Three.js scene (mount/unmount).
 *   - The render loop (rAF; paused while the tab is hidden).
 *   - ResizeObserver-driven camera/renderer resize.
 *   - Pointer + keyboard input → orbit camera + voxel ops.
 *   - The Three.js voxel-mesh reconciliation effect.
 *   - Component-local UI state for material, tool mode, and the
 *     scene-fixture visibility toggles.
 *
 * Voxel state itself is *controlled* — the parent owns the `voxels`
 * VoxelMap and receives every change through `onVoxelsChange`.
 *
 * Design rules (DESIGN.md Principle 2 + the brief):
 *   - Voxel coords are physical inputs. The component never derives
 *     "stat-y" information into voxels; only Map<coord, materialId>.
 *   - No `any`; strict TypeScript everywhere.
 *   - Scene is diff-reconciled, not full-rebuilt each frame.
 *   - All listeners + GPU resources are torn down on unmount.
 *
 * Lift sources (see docs/editor-app-tauri-lift-map.md "Prototype 2"):
 *   - scene plumbing: lines 222-309   → scene.ts
 *   - orbit camera:  lines 234-247   → controls.ts
 *   - raycast pick:  lines 401-462   → picking.ts
 *   - pointer + key: lines 467-602   → input.tsx
 *   - render loop:   lines 539-543   → here
 *   - palette UI:    lines 547-571   → palette.tsx
 *   - toolbar UI:    lines 116-160   → tools.tsx
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import {
  CELL_VOLUME_M3,
  MATERIAL_BY_ID,
  computeVoxelStats,
  hexString,
} from "../../lib";
import type {
  BoundingBox,
  Faction,
  MaterialId,
  VoxelMap,
} from "../../types";
import { applyOrbit, createOrbitState } from "./controls";
import { useKeyboardInput, usePointerInput } from "./input";
import type { CursorCell } from "./picking";
import { Palette } from "./palette";
import { createSculptScene, type SculptScene } from "./scene";
import { Tools, type ToolMode } from "./tools";

// ---------------------------------------------------------------------------
// Public props.
// ---------------------------------------------------------------------------

export interface VoxelSculptorProps {
  /** Controlled voxel state. */
  readonly voxels: VoxelMap;
  /** Called whenever a voxel edit produces a new map. */
  readonly onVoxelsChange: (next: VoxelMap) => void;
  /** Faction whose palette is previewed. */
  readonly faction: Faction;
  /** Mirror-X paint toggle (controlled). */
  readonly mirrorX: boolean;
  /**
   * Whether the parent toggles mirror-X. If omitted, the component
   * falls back to a stub that throws — the parent is expected to wire
   * mirror state through state too, even though it's a single bool.
   * For the integration agent: thread this from the same store that
   * owns `voxels`.
   */
  readonly onMirrorXChange?: (mirror: boolean) => void;
}

// ---------------------------------------------------------------------------
// Internal helpers.
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
// Inline styles (the pane chrome lives in App.css; the inner layout
// is component-local).
// ---------------------------------------------------------------------------

const styles = {
  shell: {
    display: "grid",
    gridTemplateColumns: "240px 1fr",
    height: "100%",
    width: "100%",
    minHeight: 0,
    minWidth: 0,
    background: "#0a0d12",
    color: "#d8dde6",
  } as const,
  sidebar: {
    overflowY: "auto" as const,
    padding: 12,
    background: "#161619",
    borderRight: "1px solid #2a2a2f",
    display: "flex",
    flexDirection: "column" as const,
    gap: 12,
    minHeight: 0,
  },
  sectionHeading: {
    fontSize: 11,
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
    color: "#8a93a3",
    fontWeight: 600,
    margin: 0,
  },
  canvasWrap: {
    position: "relative" as const,
    minHeight: 0,
    minWidth: 0,
    overflow: "hidden",
    background: "#0a0d12",
  },
  overlay: {
    position: "absolute" as const,
    top: 10,
    left: 10,
    pointerEvents: "none" as const,
    background: "rgba(10,13,18,0.7)",
    border: "1px solid #3a4150",
    borderRadius: 4,
    padding: "4px 8px",
    fontFamily: "SF Mono, Menlo, Consolas, monospace",
    fontSize: 11,
    color: "#8a93a3",
  },
  overlayValue: {
    color: "#c9a55c",
    fontWeight: 600,
  },
  statsRow: {
    display: "flex",
    justifyContent: "space-between" as const,
    padding: "2px 0",
    fontSize: 12,
  },
  statsLabel: { color: "#8a93a3" },
  statsValue: {
    fontFamily: "SF Mono, Menlo, Consolas, monospace",
    fontWeight: 600,
  },
} as const;

function formatBoundingBox(b: BoundingBox | null): string {
  if (!b) return "—";
  return `${b.max[0] - b.min[0] + 1}x${b.max[1] - b.min[1] + 1}x${b.max[2] - b.min[2] + 1}`;
}

function formatMass(massKg: number): string {
  return massKg < 1000 ? `${massKg.toFixed(0)} kg` : `${(massKg / 1000).toFixed(1)} t`;
}

// ---------------------------------------------------------------------------
// Component.
// ---------------------------------------------------------------------------

export function VoxelSculptor(props: VoxelSculptorProps) {
  const { voxels, onVoxelsChange, faction, mirrorX, onMirrorXChange } = props;

  // ----- Local UI state ----------------------------------------------------

  const [material, setMaterial] = useState<MaterialId>("armor");
  const [tool, setTool] = useState<ToolMode>("add");
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [showRegion, setShowRegion] = useState<boolean>(true);
  const [cursor, setCursor] = useState<CursorCell | null>(null);

  // ----- Scene refs --------------------------------------------------------

  // The container the renderer's canvas mounts under.
  const containerRef = useRef<HTMLDivElement | null>(null);
  // The Three.js scene bundle (created on mount, disposed on unmount).
  const sceneRef = useRef<SculptScene | null>(null);
  // Orbit state lives in a ref so it survives across renders without
  // triggering the (expensive) scene-rebuild effect.
  const orbitRef = useRef(createOrbitState());
  // Mesh-per-coord, keyed by "x,y,z" — reconciled from `voxels` on every
  // change. The scene is the secondary store; the prop is the primary.
  const meshMapRef = useRef<Map<string, THREE.Mesh>>(new Map());
  // Canvas element (filled once renderer.domElement is mounted) — drives
  // the pointer hook's effect-dependency.
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);

  // ----- Mount: build scene, attach canvas --------------------------------

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const sceneBundle = createSculptScene();
    sceneRef.current = sceneBundle;
    container.appendChild(sceneBundle.renderer.domElement);
    setCanvas(sceneBundle.renderer.domElement);
    applyOrbit(sceneBundle.camera, orbitRef.current);

    return () => {
      // Reconciled meshes — dispose then clear (the scene.dispose() will
      // catch any stragglers but doing it here is cheap and explicit).
      for (const mesh of meshMapRef.current.values()) {
        sceneBundle.voxelGroup.remove(mesh);
        disposeVoxelMesh(mesh);
      }
      meshMapRef.current.clear();

      // Detach + dispose Three resources.
      if (sceneBundle.renderer.domElement.parentNode === container) {
        container.removeChild(sceneBundle.renderer.domElement);
      }
      sceneBundle.dispose();
      sceneRef.current = null;
      setCanvas(null);
    };
  }, []);

  // ----- Reconcile voxels → scene meshes ----------------------------------

  useEffect(() => {
    const sceneBundle = sceneRef.current;
    if (!sceneBundle) return;
    const group = sceneBundle.voxelGroup;
    const meshMap = meshMapRef.current;

    // Remove meshes whose coord is no longer present OR whose material changed.
    for (const [k, mesh] of meshMap) {
      const next = voxels.get(k);
      if (!next) {
        group.remove(mesh);
        disposeVoxelMesh(mesh);
        meshMap.delete(k);
      } else {
        // Detect material change by reading userData.
        const ud = mesh.userData as { material?: MaterialId };
        if (ud.material !== next) {
          group.remove(mesh);
          disposeVoxelMesh(mesh);
          meshMap.delete(k);
        }
      }
    }

    // Add meshes for coords newly present.
    for (const [k, mat] of voxels) {
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
  }, [voxels]);

  // ----- Reflect material into cursor color -------------------------------

  useEffect(() => {
    const sceneBundle = sceneRef.current;
    if (!sceneBundle) return;
    const def = MATERIAL_BY_ID[material];
    sceneBundle.cursorMesh.material.color.setHex(def.color);
    sceneBundle.cursorEdge.material.color.setHex(def.color);
  }, [material]);

  // ----- Reflect mirror state into the indicator plane --------------------

  useEffect(() => {
    const sceneBundle = sceneRef.current;
    if (!sceneBundle) return;
    sceneBundle.mirrorPlane.visible = mirrorX;
  }, [mirrorX]);

  // ----- Reflect grid + region visibility ---------------------------------

  useEffect(() => {
    const sceneBundle = sceneRef.current;
    if (!sceneBundle) return;
    sceneBundle.gridHelper.visible = showGrid;
  }, [showGrid]);

  useEffect(() => {
    const sceneBundle = sceneRef.current;
    if (!sceneBundle) return;
    sceneBundle.regionBox.visible = showRegion;
  }, [showRegion]);

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
      // Wake immediately when the tab returns so the next paint is fresh.
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
    // Tie to canvas so the loop starts only once renderer.domElement
    // is mounted and re-binds if the scene is ever re-created.
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

  // ----- Pointer + keyboard inputs ----------------------------------------

  // Stable refs to the voxel-group children so the pointer hook sees the
  // current mesh list every frame.
  const voxelMeshes = useMemo<readonly THREE.Object3D[]>(() => {
    return Array.from(meshMapRef.current.values());
  }, [voxels]);

  const sceneBundleForInput = sceneRef.current;

  usePointerInput({
    canvas,
    // Non-null assertion: the hook short-circuits when canvas is null,
    // and `canvas` only becomes non-null after sceneBundle is set.
    camera: sceneBundleForInput?.camera ?? new THREE.PerspectiveCamera(),
    orbit: orbitRef.current,
    voxels,
    material,
    mirrorX,
    voxelMeshes,
    ground: sceneBundleForInput?.ground ?? new THREE.Object3D(),
    cursorMesh: sceneBundleForInput?.cursorMesh ?? new THREE.Object3D(),
    cursorEdge: sceneBundleForInput?.cursorEdge ?? new THREE.Object3D(),
    onVoxelsChange,
    onCursorChange: setCursor,
  });

  useKeyboardInput({
    onSelectMaterial: setMaterial,
    onToggleMirror: useCallback(() => {
      if (onMirrorXChange) onMirrorXChange(!mirrorX);
    }, [onMirrorXChange, mirrorX]),
    onToggleGrid: useCallback(() => setShowGrid((g) => !g), []),
  });

  // ----- Clear all --------------------------------------------------------

  const handleClear = useCallback(() => {
    // Produce an empty map; the reconciliation effect tears the meshes down.
    onVoxelsChange(new Map());
  }, [onVoxelsChange]);

  // ----- Stats readout ----------------------------------------------------

  const stats = useMemo(() => computeVoxelStats(voxels), [voxels]);

  // ----- Render -----------------------------------------------------------

  return (
    <div style={styles.shell}>
      <aside style={styles.sidebar}>
        <Palette active={material} onSelect={setMaterial} faction={faction} />

        <div>
          <h3 style={styles.sectionHeading}>Stats</h3>
          <div style={styles.statsRow}>
            <span style={styles.statsLabel}>Voxels</span>
            <span style={styles.statsValue}>{stats.voxelCount}</span>
          </div>
          <div style={styles.statsRow}>
            <span style={styles.statsLabel}>Mass</span>
            <span style={styles.statsValue}>{formatMass(stats.massKg)}</span>
          </div>
          <div style={styles.statsRow}>
            <span style={styles.statsLabel}>Bounding box</span>
            <span style={styles.statsValue}>
              {formatBoundingBox(stats.boundingBox)}
            </span>
          </div>
          <div style={styles.statsRow}>
            <span style={styles.statsLabel}>Cell</span>
            <span style={styles.statsValue}>{CELL_VOLUME_M3.toFixed(3)} m³</span>
          </div>
        </div>

        <Tools
          tool={tool}
          onToolChange={setTool}
          mirrorX={mirrorX}
          onMirrorChange={(m) => {
            if (onMirrorXChange) onMirrorXChange(m);
          }}
          showGrid={showGrid}
          onShowGridChange={setShowGrid}
          showRegion={showRegion}
          onShowRegionChange={setShowRegion}
          onClear={handleClear}
          voxelCount={stats.voxelCount}
        />

        <div>
          <h3 style={styles.sectionHeading}>Controls</h3>
          <div
            style={{
              padding: 10,
              background: "#232831",
              borderRadius: 4,
              borderLeft: "2px solid #c9a55c",
              fontSize: 11,
              color: "#8a93a3",
              lineHeight: 1.5,
            }}
          >
            <strong>Mouse</strong>
            <br />
            Left-click add · Right-click remove
            <br />
            Left-drag orbit · Middle-drag pan · Wheel zoom
            <br />
            <br />
            <strong>Keys</strong>
            <br />
            1–6 material · M mirror · G grid
          </div>
        </div>
      </aside>

      <div style={styles.canvasWrap} ref={containerRef}>
        <div style={styles.overlay}>
          <span>cursor: </span>
          <span style={styles.overlayValue}>
            {cursor
              ? `(${cursor.x},${cursor.y},${cursor.z})${cursor.inside ? "" : " x"}`
              : "—"}
          </span>
          {" · "}
          <span>
            faction{" "}
            <span style={{ color: hexString(0xc9a55c), fontWeight: 600 }}>
              {faction}
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
