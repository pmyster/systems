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

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
} from "react";
import * as THREE from "three";
import { open } from "@tauri-apps/plugin-dialog";

import { TEMPLATES } from "../../lib/templates";
import { voxelizeMesh } from "../../lib/voxelizer";
import { useMeshAssets } from "../../state/mesh-assets";
import type { MeshAssetRef, UnitSchematic } from "../../types/unit";
import type { MaterialId, MutableVoxelMap } from "../../types/voxel";
import { loadGlbFromBuffer, loadMeshFromPath, SUPPORTED_MESH_EXTENSIONS } from "./mesh-loader";
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
  /** The unit being edited — its `mesh_asset` records which mesh to reload on open. */
  readonly unit: UnitSchematic;
  /** Persist a unit change (used to record `mesh_asset` when the mesh changes). */
  readonly onUnitChange: (next: UnitSchematic) => void;
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

export function MeshWorkspace({
  onVoxelsUpdated,
  voxels,
  unit,
  onUnitChange,
}: MeshWorkspaceProps) {
  const [currentMesh, setCurrentMesh] = useState<THREE.Group | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [showPainter, setShowPainter] = useState(false);
  const [loading, setLoading] = useState(false);
  const [voxelizing, setVoxelizing] = useState(false);
  // AI Generate is in flight (POSTing the photo → TripoSR server → GLB).
  const [generating, setGenerating] = useState(false);
  // Photo wrapped onto the mesh as a box-projected skin (null = no skin).
  const [skinImage, setSkinImage] = useState<HTMLImageElement | null>(null);
  // Surfaced when an import fails — shown in the toolbar (loud, not silent).
  const [importError, setImportError] = useState<string | null>(null);

  // Publish mesh + skin to the shared context so the Battlefield Preview can
  // render a deep-cloned copy. MeshViewer still owns/displays the master.
  // gizmoMode / selectedHardpointId drive the hardpoint TransformControls.
  const {
    setMeshSource,
    setSkinImage: publishSkin,
    gizmoMode,
    setGizmoMode,
    selectedHardpointId,
  } = useMeshAssets();

  // Keep a ref so the dispose effect can always reach the latest mesh.
  const currentMeshRef = useRef<THREE.Group | null>(null);
  // JSON.stringify of the mesh_asset ref currently loaded. Guards the
  // reload effect (Direction B): it only acts when the unit's incoming
  // mesh_asset differs from what we already have — preventing a ping-pong
  // with the handlers that WRITE the ref (Direction A).
  const appliedAssetRef = useRef<string | null>(null);
  // Hidden file input for the "Apply Skin" image picker.
  const skinInputRef = useRef<HTMLInputElement | null>(null);
  // Hidden file input for the "AI Generate" photo picker.
  const aiInputRef = useRef<HTMLInputElement>(null);

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

  // Mirror local mesh + skin into the shared context for the preview pane.
  useEffect(() => {
    setMeshSource(currentMesh);
  }, [currentMesh, setMeshSource]);
  useEffect(() => {
    publishSkin(skinImage);
  }, [skinImage, publishSkin]);

  // -------------------------------------------------------------------------
  // Direction B: a loaded unit's mesh_asset reloads the mesh (e.g. on Open).
  //
  // Keyed on the stringified ref. If it matches what we already have
  // (appliedAssetRef) — the no-op case right after Direction A — we skip.
  // Only a genuinely new ref (a different unit opened) triggers a reload.
  // -------------------------------------------------------------------------
  const meshAsset = unit.mesh_asset;
  const meshAssetKey = meshAsset ? JSON.stringify(meshAsset) : null;
  useEffect(() => {
    if (meshAssetKey === null) return undefined;
    if (meshAssetKey === appliedAssetRef.current) return undefined;
    // A new ref arrived from outside (Open). Reload the mesh it points at.
    // `meshAsset` is non-null here because meshAssetKey is non-null.
    const ref = meshAsset as MeshAssetRef;
    let cancelled = false;

    if (ref.kind === "template") {
      const tpl = TEMPLATES.find((t) => t.id === ref.template_id);
      if (tpl) {
        setCurrentMesh(tpl.buildGeometry());
        setSelectedTemplateId(ref.template_id);
        setSkinImage(null);
        appliedAssetRef.current = meshAssetKey;
        // Templates build geometry at true world scale already — no
        // normalize-bake factor exists, so no coordinate migration is
        // needed. We DO still want to stamp the unit as "world_m" so
        // subsequent loads skip this path and the file persists with the
        // current convention.
        if (unit.chassis.hardpoint_units_version !== "world_m") {
          onUnitChange({
            ...unit,
            chassis: { ...unit.chassis, hardpoint_units_version: "world_m" },
          });
        }
      } else {
        setImportError(
          `Couldn't reload mesh — unknown template "${ref.template_id}".`,
        );
      }
      return undefined;
    }

    // kind === "file": load asynchronously, guarding against unmount.
    const path = ref.path;
    void (async () => {
      try {
        const group = await loadMeshFromPath(path);
        if (cancelled) {
          disposeGroup(group);
          return;
        }
        setCurrentMesh(group);
        setSelectedTemplateId(null);
        setSkinImage(null);
        appliedAssetRef.current = meshAssetKey;

        // Option C migration — hardpoint positions authored before the
        // mesh-root scale was baked into geometry need a one-shot
        // multiplication by `normalizeScale` to land in world meters. The
        // unit's `chassis.hardpoint_units_version` flag records the
        // coordinate system in use:
        //   - "world_m"   → already in meters; do nothing.
        //   - "pre_bake"  → multiply by normalizeScale, warn, mark migrated.
        //   - undefined   → treat as "pre_bake" (legacy files predate the flag).
        // We update the in-memory unit only; the file on disk stays untouched
        // until the user saves, but every viewer downstream sees the migrated
        // values immediately — no drift between Mesh Workspace and Battlefield
        // Preview, no broken-looking arrow at the wrong position.
        const version = unit.chassis.hardpoint_units_version;
        const needsMigration = version !== "world_m";
        const ud = group.userData as { normalizeScale?: number };
        const s = typeof ud.normalizeScale === "number" ? ud.normalizeScale : 1;
        if (
          needsMigration &&
          s !== 1 &&
          unit.hardpoints &&
          unit.hardpoints.length > 0
        ) {
          const migrated = unit.hardpoints.map((h) => ({
            ...h,
            local_position: [
              h.local_position[0] * s,
              h.local_position[1] * s,
              h.local_position[2] * s,
            ] as readonly [number, number, number],
          }));
          // eslint-disable-next-line no-console
          console.warn(
            `[Migration] unit "${unit.id}" hardpoint positions converted ` +
              `from pre-bake to world meters (×${s.toFixed(6)}). Save to persist.`,
          );
          onUnitChange({
            ...unit,
            chassis: { ...unit.chassis, hardpoint_units_version: "world_m" },
            hardpoints: migrated,
          });
        } else if (needsMigration) {
          // No hardpoints to migrate (or normalize scale was 1 — same coords
          // either way). Still stamp the version so future saves carry the
          // new convention and future loads skip this branch.
          onUnitChange({
            ...unit,
            chassis: { ...unit.chassis, hardpoint_units_version: "world_m" },
          });
        }
      } catch (err) {
        if (cancelled) return;
        setImportError(
          `Couldn't reload mesh from ${path} — the file may have moved. Re-import it.`,
        );
        // eslint-disable-next-line no-console
        console.error("[MeshWorkspace] mesh reload failed:", err);
      }
    })();

    return () => {
      cancelled = true;
    };
    // meshAsset is derived from meshAssetKey; keying on the string is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meshAssetKey]);

  // -------------------------------------------------------------------------
  // Template selection.
  // -------------------------------------------------------------------------

  const handleTemplateSelect = (id: string): void => {
    const tpl = TEMPLATES.find((t) => t.id === id);
    if (!tpl) return;

    setSelectedTemplateId(id);
    setSkinImage(null); // skin belongs to the old mesh — don't carry it over
    // buildGeometry() returns a fresh Group each call.
    const newGroup = tpl.buildGeometry();
    setCurrentMesh(newGroup);

    // Direction A: record which mesh this unit now uses, and mark it applied
    // so Direction B's reload effect sees a match and does NOT reload.
    const ref: MeshAssetRef = { kind: "template", template_id: id };
    appliedAssetRef.current = JSON.stringify(ref);
    onUnitChange({ ...unit, mesh_asset: ref });
  };

  // -------------------------------------------------------------------------
  // Import Mesh.
  // -------------------------------------------------------------------------

  const handleImport = async (): Promise<void> => {
    if (loading) return;
    setImportError(null);
    let picked: string | null = null;
    try {
      const result = await open({
        filters: [
          { name: "Mesh files", extensions: [...SUPPORTED_MESH_EXTENSIONS] },
        ],
        multiple: false,
      });
      picked = typeof result === "string" ? result : null;
    } catch {
      // Dialog itself failed/cancelled — nothing to import.
      return;
    }
    if (picked === null) return; // user cancelled

    setLoading(true);
    try {
      const group = await loadMeshFromPath(picked);
      setSelectedTemplateId(null); // clear template selection — mesh is now from file
      setSkinImage(null); // skin belongs to the old mesh — don't carry it over
      setCurrentMesh(group);

      // Direction A: record the imported file as this unit's mesh, and mark it
      // applied so Direction B's reload effect sees a match and does NOT reload.
      const ref: MeshAssetRef = { kind: "file", path: picked };
      appliedAssetRef.current = JSON.stringify(ref);
      onUnitChange({ ...unit, mesh_asset: ref });
    } catch (err) {
      // Surface the failure — never silently drop an import the user asked for.
      const msg = err instanceof Error ? err.message : String(err);
      setImportError(`Import failed: ${msg}`);
      // eslint-disable-next-line no-console
      console.error("[MeshWorkspace] import failed:", err);
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
  // Apply / Remove Skin (box-projected photo wrap).
  // -------------------------------------------------------------------------

  const handleSkinClick = useCallback((): void => {
    if (skinImage !== null) {
      // Already skinned → this button is "Remove Skin".
      setSkinImage(null);
      return;
    }
    skinInputRef.current?.click();
  }, [skinImage]);

  const handleSkinFile = useCallback((file: File): void => {
    const reader = new FileReader();
    reader.onload = (evt) => {
      const dataUrl = evt.target?.result;
      if (typeof dataUrl !== "string") return;
      const img = new Image();
      img.onload = () => {
        setSkinImage(img);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }, []);

  const handleSkinInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>): void => {
      const file = e.target.files?.[0];
      if (file) handleSkinFile(file);
      e.target.value = ""; // allow re-picking the same file
    },
    [handleSkinFile],
  );

  // -------------------------------------------------------------------------
  // AI Generate (photo → local TripoSR server → GLB).
  // -------------------------------------------------------------------------

  const handleGenerate = useCallback(
    async (file: File): Promise<void> => {
      setImportError(null);
      setGenerating(true);
      try {
        const form = new FormData();
        form.append("image", file);
        const res = await fetch("http://127.0.0.1:8008/generate", {
          method: "POST",
          body: form,
        });
        if (!res.ok) {
          // Try to read the JSON error; fall back to status text.
          let detail = res.statusText;
          try {
            const j: unknown = await res.json();
            if (
              j !== null &&
              typeof j === "object" &&
              "error" in j &&
              typeof (j as { error: unknown }).error === "string"
            ) {
              detail = (j as { error: string }).error;
            }
          } catch {
            /* not json */
          }
          if (res.status === 503) {
            setImportError(
              "AI model is still warming up — wait a few seconds and try again.",
            );
          } else {
            setImportError(`AI generation failed: ${detail}`);
          }
          return;
        }
        const buf = await res.arrayBuffer();
        const group = await loadGlbFromBuffer(buf);
        setSelectedTemplateId(null);
        setSkinImage(null);
        setCurrentMesh(group);
      } catch (err) {
        // fetch throws (TypeError) when the server isn't running / unreachable.
        setImportError(
          "Can't reach the AI server. Start it: run triposr-server\\start-server.bat, " +
            "then try again. (Server must be listening on http://127.0.0.1:8008)",
        );
        // eslint-disable-next-line no-console
        console.error("[MeshWorkspace] AI generate failed:", err);
      } finally {
        setGenerating(false);
      }
    },
    [setImportError, setSelectedTemplateId, setSkinImage, setCurrentMesh],
  );

  const handleAiInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>): void => {
      const file = e.target.files?.[0];
      if (file) void handleGenerate(file);
      e.target.value = ""; // allow re-picking the same file
    },
    [handleGenerate],
  );

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
        <MeshViewer
          mesh={currentMesh}
          skinImage={skinImage}
          unit={unit}
          onUnitChange={onUnitChange}
        />

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

        {/* 2. AI Generate — photo → local TripoSR server → GLB */}
        <button
          type="button"
          style={{ ...S.btn, ...(generating ? S.btnDisabled : undefined) }}
          disabled={generating}
          onClick={() => aiInputRef.current?.click()}
          title="Generate a 3D mesh from a photo (local TripoSR server)"
        >
          {generating ? "Generating…" : "AI Generate"}
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

        {/* 5. Apply / Remove Skin (box-projected photo wrap) */}
        <button
          type="button"
          style={{ ...S.btn, ...(!hasMesh ? S.btnDisabled : undefined) }}
          disabled={!hasMesh}
          onClick={handleSkinClick}
          title={
            hasMesh
              ? skinImage !== null
                ? "Remove the projected photo skin"
                : "Wrap a photo onto the mesh (box projection)"
              : "Load a mesh first"
          }
        >
          {skinImage !== null ? "Remove Skin" : "Apply Skin"}
        </button>

        {/* Hardpoint gizmo mode — Move / Rotate / Off. The active button is
            highlighted; selecting "Off" detaches the TransformControls. The
            buttons are visible whether or not a hardpoint is currently
            selected so the artist can pre-pick a mode before clicking a row. */}
        <div
          style={{
            display: "flex",
            gap: 4,
            marginLeft: "auto",
            alignItems: "center",
          }}
          title={
            selectedHardpointId
              ? `Hardpoint "${selectedHardpointId}" — drag the gizmo to edit`
              : "Select a hardpoint in the form to attach the gizmo"
          }
        >
          <span style={{ fontSize: 10, color: "#8a93a3" }}>HP Gizmo</span>
          {(["translate", "rotate", "off"] as const).map((m) => (
            <button
              key={m}
              type="button"
              style={{
                ...S.btn,
                ...(gizmoMode === m ? { background: "#3a4b66" } : undefined),
              }}
              onClick={() => setGizmoMode(m)}
            >
              {m === "translate" ? "Move" : m === "rotate" ? "Rotate" : "Off"}
            </button>
          ))}
        </div>

        {/* Hidden picker for the skin image. */}
        <input
          ref={skinInputRef}
          type="file"
          accept=".jpg,.jpeg,.png,.webp"
          style={{ display: "none" }}
          onChange={handleSkinInputChange}
        />

        {/* Hidden picker for the AI Generate source photo. */}
        <input
          ref={aiInputRef}
          type="file"
          accept=".jpg,.jpeg,.png,.webp"
          style={{ display: "none" }}
          onChange={handleAiInputChange}
        />
      </div>

      {/* Import error banner — surfaced, never silently dropped. */}
      {importError !== null && (
        <div
          role="alert"
          style={{
            padding: "6px 10px",
            background: "#3a1d1d",
            borderTop: "1px solid #c0392b",
            color: "#f0b8b8",
            fontSize: 11,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span>{importError}</span>
          <button
            type="button"
            style={{ ...S.btn, padding: "2px 8px" }}
            onClick={() => setImportError(null)}
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
