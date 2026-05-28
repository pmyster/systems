/**
 * MeshWorkspace — left-pane component for the v0.2 mesh/template flow.
 *
 * Layout (top to bottom):
 *   1. Section label "MESH WORKSPACE"
 *   2. TemplateGallery — 9 clickable template cards (3×3 grid)
 *   3. MeshViewer — Three.js canvas, flex-grow: 1
 *   4. Toolbar — Import Mesh / AI Generate / Auto-Voxelize / Paint Materials
 *
 * Selecting a template calls template.buildGeometry() to get a fresh Group
 * that is passed straight into MeshViewer.  Importing a file replaces the
 * template mesh.  Auto-Voxelize runs voxelizeMesh on the current mesh and
 * propagates results via onVoxelsUpdated.  Paint Materials overlays the
 * MaterialPainter component.
 */

import { useEffect, useRef, useState, type CSSProperties } from "react";
import * as THREE from "three";
import { open } from "@tauri-apps/plugin-dialog";

import { TEMPLATES } from "../../lib/templates";
import { voxelizeMesh } from "../../lib/voxelizer";
import type { MaterialId, MutableVoxelMap } from "../../types/voxel";
import { loadGlbFromPath } from "./mesh-loader";
import { MaterialPainter } from "./MaterialPainter";
import { MeshViewer } from "./MeshViewer";
import { TemplateGallery } from "./TemplateGallery";

// ---------------------------------------------------------------------------
// Props.
// ---------------------------------------------------------------------------

export interface MeshWorkspaceProps {
  /** Called whenever a new voxel map is ready (after auto-voxelize or material paint). */
  onVoxelsUpdated: (voxels: Map<string, MaterialId>) => void;
  /** The current voxel map (needed by MaterialPainter). */
  voxels: ReadonlyMap<string, MaterialId>;
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

/**
 * Dispose all geometries and materials in a THREE.Group.
 * Traverses the whole sub-tree so nested groups are handled.
 */
function disposeGroup(group: THREE.Group): void {
  group.traverse((node: THREE.Object3D) => {
    if (!(node instanceof THREE.Mesh)) return;
    const mesh = node as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (mat && typeof (mat as THREE.Material).dispose === "function") {
        (mat as THREE.Material).dispose();
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Styles.
// ---------------------------------------------------------------------------

const S = {
  root: {
    display: "flex",
    flexDirection: "column",
    width: "100%",
    height: "100%",
    minHeight: 0,
    background: "#0a0d12",
    fontFamily: "system-ui, sans-serif",
    position: "relative",
  } satisfies CSSProperties,

  sectionLabel: {
    fontSize: 10,
    letterSpacing: "0.08em",
    color: "#6b7280",
    textTransform: "uppercase",
    padding: "6px 10px",
    flexShrink: 0,
  } satisfies CSSProperties,

  viewerWrapper: {
    flex: 1,
    minHeight: 0,
    position: "relative",
  } satisfies CSSProperties,

  toolbar: {
    display: "flex",
    gap: 6,
    padding: 8,
    background: "#111827",
    flexShrink: 0,
    flexWrap: "wrap",
  } satisfies CSSProperties,

  btn: {
    background: "#232831",
    color: "#d8dde6",
    border: "1px solid #3a4150",
    padding: "5px 10px",
    borderRadius: 4,
    cursor: "pointer",
    fontSize: 12,
    fontFamily: "inherit",
    lineHeight: "1",
  } satisfies CSSProperties,

  btnDisabled: {
    opacity: 0.4,
    cursor: "not-allowed",
  } satisfies CSSProperties,

  statusText: {
    fontSize: 11,
    color: "#c9a55c",
    display: "flex",
    alignItems: "center",
    padding: "0 4px",
  } satisfies CSSProperties,
} as const;

// ---------------------------------------------------------------------------
// Component.
// ---------------------------------------------------------------------------

export function MeshWorkspace({ onVoxelsUpdated, voxels }: MeshWorkspaceProps) {
  const [currentMesh, setCurrentMesh] = useState<THREE.Group | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [showPainter, setShowPainter] = useState(false);
  const [loading, setLoading] = useState(false);
  const [voxelizing, setVoxelizing] = useState(false);

  // Keep a ref so the dispose effect can always reach the latest mesh.
  const currentMeshRef = useRef<THREE.Group | null>(null);

  // Dispose the OLD mesh whenever currentMesh changes, then update the ref.
  useEffect(() => {
    const prev = currentMeshRef.current;
    if (prev !== null && prev !== currentMesh) {
      disposeGroup(prev);
    }
    currentMeshRef.current = currentMesh;
  }, [currentMesh]);

  // Dispose current mesh on unmount.
  useEffect(() => {
    return () => {
      if (currentMeshRef.current !== null) {
        disposeGroup(currentMeshRef.current);
        currentMeshRef.current = null;
      }
    };
  }, []);

  // -------------------------------------------------------------------------
  // Template selection.
  // -------------------------------------------------------------------------

  const handleTemplateSelect = (id: string): void => {
    const tpl = TEMPLATES.find((t) => t.id === id);
    if (!tpl) return;

    setSelectedTemplateId(id);
    // buildGeometry() returns a fresh Group each call.
    const newGroup = tpl.buildGeometry();
    setCurrentMesh(newGroup);
  };

  // -------------------------------------------------------------------------
  // Import Mesh.
  // -------------------------------------------------------------------------

  const handleImport = async (): Promise<void> => {
    if (loading) return;
    try {
      const picked = await open({
        filters: [{ name: "Mesh files", extensions: ["glb", "gltf", "obj"] }],
        multiple: false,
      });
      if (typeof picked !== "string") return; // user cancelled or multiple selected unexpectedly
      setLoading(true);
      const group = await loadGlbFromPath(picked);
      setSelectedTemplateId(null); // clear template selection — mesh is now from file
      setCurrentMesh(group);
    } catch {
      // Swallow — user cancelled or loader error; don't crash the pane.
    } finally {
      setLoading(false);
    }
  };

  // -------------------------------------------------------------------------
  // Auto-Voxelize.
  // -------------------------------------------------------------------------

  const handleVoxelize = async (): Promise<void> => {
    if (!currentMesh || voxelizing) return;
    setVoxelizing(true);
    // Yield to the browser to repaint the "Voxelizing…" label before the
    // synchronous ray-march saturates the thread.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    try {
      const result: MutableVoxelMap = voxelizeMesh(currentMesh);
      onVoxelsUpdated(result);
    } finally {
      setVoxelizing(false);
    }
  };

  // -------------------------------------------------------------------------
  // Material Painter.
  // -------------------------------------------------------------------------

  const handlePainterApply = (updated: MutableVoxelMap): void => {
    onVoxelsUpdated(updated);
    setShowPainter(false);
  };

  const handlePainterCancel = (): void => {
    setShowPainter(false);
  };

  // -------------------------------------------------------------------------
  // Derived flags.
  // -------------------------------------------------------------------------

  const hasMesh = currentMesh !== null;
  const hasVoxels = voxels.size > 0;

  // -------------------------------------------------------------------------
  // Render.
  // -------------------------------------------------------------------------

  return (
    <div style={S.root}>
      {/* Header */}
      <div style={S.sectionLabel}>Mesh Workspace</div>

      {/* Template gallery */}
      <TemplateGallery
        selectedId={selectedTemplateId}
        onSelect={handleTemplateSelect}
      />

      {/* 3D viewer — grows to fill available space */}
      <div style={S.viewerWrapper}>
        <MeshViewer mesh={currentMesh} />

        {/* MaterialPainter overlay */}
        {showPainter && (
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              overflowY: "auto",
              zIndex: 10,
            }}
          >
            <MaterialPainter
              voxels={voxels}
              onApply={handlePainterApply}
              onCancel={handlePainterCancel}
            />
          </div>
        )}
      </div>

      {/* Toolbar */}
      <div style={S.toolbar}>
        {/* 1. Import Mesh */}
        <button
          type="button"
          style={{ ...S.btn, ...(loading ? S.btnDisabled : undefined) }}
          disabled={loading}
          onClick={() => { void handleImport(); }}
          title="Import a GLB, GLTF, or OBJ file"
        >
          {loading ? "Loading…" : "Import Mesh"}
        </button>

        {/* 2. AI Generate — disabled, v0.2b */}
        <button
          type="button"
          style={{ ...S.btn, ...S.btnDisabled }}
          disabled
          title="Coming in v0.2b"
          aria-disabled
        >
          AI Generate
        </button>

        {/* 3. Auto-Voxelize */}
        <button
          type="button"
          style={{ ...S.btn, ...(!hasMesh || voxelizing ? S.btnDisabled : undefined) }}
          disabled={!hasMesh || voxelizing}
          onClick={() => { void handleVoxelize(); }}
          title={hasMesh ? "Auto-voxelize the current mesh" : "Load a mesh first"}
        >
          {voxelizing ? "Voxelizing…" : "Auto-Voxelize"}
        </button>

        {/* 4. Paint Materials */}
        <button
          type="button"
          style={{ ...S.btn, ...(!hasVoxels ? S.btnDisabled : undefined) }}
          disabled={!hasVoxels}
          onClick={() => setShowPainter(true)}
          title={hasVoxels ? "Paint materials on voxels" : "Voxelize first"}
        >
          Paint Materials
        </button>
      </div>
    </div>
  );
}
