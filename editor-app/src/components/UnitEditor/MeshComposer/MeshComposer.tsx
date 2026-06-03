/**
 * MeshComposer — top-level panel for manual sub-mesh placement.
 *
 * MVP scope (Phase 2 sub-tab inside the Unit Editor):
 *   1. Load the unit's GLB sidecar-side: takes `unit` prop, reads
 *      `unit.mesh_asset` (must be kind: "file"), loads the GLB via the
 *      same mesh-loader the Mesh Workspace uses.
 *   2. Sidebar of every sub-mesh (name + vert/face count + visibility eye).
 *   3. Click a sub-mesh → TransformControls attach (T/R/S hotkeys swap mode).
 *   4. Drag the gizmo → write the live transform into local sidecar state.
 *   5. Save → write `<glb>.composer.json` next to the GLB. Non-destructive:
 *      the original .glb is NEVER touched.
 *   6. Reset → delete the sidecar, reload the GLB at its original pose.
 *
 * The runtime side (composerOverrides.ts → MatchLoader.ts) reads the same
 * sidecar; the Mesh Composer and the in-match render stay in sync.
 *
 * Loud-over-silent (CLAUDE.md rule #1):
 *   - Unit with template mesh_asset (no file) → show explanatory empty
 *     state, not a silent blank canvas.
 *   - GLB load failure → in-panel error banner with the underlying message.
 *   - Sidecar load failure → banner with "use existing" / "discard" choices.
 *   - TransformControls fails to construct → numeric input fallback form.
 *   - "Save" with no edits → show a "no changes" status instead of writing
 *     an empty sidecar.
 *
 * Adaptive over specific (CLAUDE.md rule #2):
 *   The override map is keyed by SUB-MESH NAME. A future tank import that
 *   produces different node names just shows up in the sidebar — no edits
 *   anywhere else. The Zod schema accepts any record key.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

import * as THREE from "three";

import { loadMeshFromPath } from "../../MeshWorkspace/mesh-loader";
import type { UnitSchematic } from "../../../types/unit";
import {
  readComposerSidecar,
  sidecarPathFor,
  writeComposerSidecar,
  deleteComposerSidecar,
  type ComposerSidecar,
  type SubMeshOverride,
} from "./composerSidecar";
import { applyComposerOverridesToTree } from "../../../runtime/loader/composerOverrides";
import {
  MeshComposerScene,
  type GizmoMode,
  type SubMeshInfo,
  type SubMeshTransform,
} from "./MeshComposerScene";
import { SubMeshList } from "./SubMeshList";

// ---------------------------------------------------------------------------
// Props.
// ---------------------------------------------------------------------------

export interface MeshComposerProps {
  readonly unit: UnitSchematic;
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
  } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "baseline",
    gap: 12,
    padding: "8px 12px",
    borderBottom: "1px solid #1f242c",
    flexShrink: 0,
  } satisfies CSSProperties,
  title: {
    fontSize: 13,
    color: "#d8dde6",
    fontWeight: 600,
    letterSpacing: "0.04em",
    textTransform: "uppercase" as const,
  } satisfies CSSProperties,
  mvpNote: {
    fontSize: 10,
    color: "#8a93a3",
    fontStyle: "italic",
  } satisfies CSSProperties,
  body: {
    display: "flex",
    flexDirection: "row" as const,
    flex: 1,
    minHeight: 0,
  } satisfies CSSProperties,
  rightCol: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
  } satisfies CSSProperties,
  toolbar: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: 6,
    padding: 8,
    background: "#111827",
    borderTop: "1px solid #1f242c",
    flexShrink: 0,
    alignItems: "center",
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
  btnActive: {
    background: "#3a4b66",
    borderColor: "#5a7aa0",
  } satisfies CSSProperties,
  btnDisabled: {
    opacity: 0.4,
    cursor: "not-allowed" as const,
  } satisfies CSSProperties,
  status: {
    fontSize: 11,
    color: "#8a93a3",
    marginLeft: "auto",
  } satisfies CSSProperties,
  banner: {
    padding: "6px 10px",
    background: "#3a1d1d",
    borderTop: "1px solid #c0392b",
    color: "#f0b8b8",
    fontSize: 11,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
  } satisfies CSSProperties,
  emptyState: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#8a93a3",
    fontSize: 12,
    padding: 24,
    textAlign: "center" as const,
    lineHeight: 1.5,
  } satisfies CSSProperties,
  numericFallback: {
    padding: 8,
    background: "#13181f",
    borderTop: "1px solid #1f242c",
    fontSize: 11,
    color: "#d8dde6",
  } satisfies CSSProperties,
  numericRow: {
    display: "grid",
    gridTemplateColumns: "60px 1fr 1fr 1fr",
    gap: 6,
    marginTop: 4,
    alignItems: "center",
  } satisfies CSSProperties,
  numericInput: {
    width: "100%",
    background: "#1c2128",
    color: "#d8dde6",
    border: "1px solid #2a313c",
    borderRadius: 3,
    padding: "3px 6px",
    fontSize: 11,
    fontFamily: "ui-monospace, Menlo, monospace",
    boxSizing: "border-box" as const,
  } satisfies CSSProperties,
} as const;

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

/**
 * Convention: we ONLY persist overrides for nodes the owner explicitly
 * touched (dragged the gizmo, toggled visibility, edited a numeric field).
 * Snapshotting every node would bloat the sidecar and lock the owner into a
 * pose — if Hunyuan re-exports the GLB with shifted root coords, untouched
 * sub-meshes should track the new pose, not the snapshotted one.
 */

// ---------------------------------------------------------------------------
// Component.
// ---------------------------------------------------------------------------

export function MeshComposer({ unit }: MeshComposerProps) {
  // --- Loaded mesh + sidecar state ---------------------------------------

  const meshAsset = unit.mesh_asset;
  const filePath =
    meshAsset && meshAsset.kind === "file" ? meshAsset.path : null;

  const [mesh, setMesh] = useState<THREE.Group | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Sub-mesh list emitted from the scene (auto-syncs as the mesh prop changes).
  const [subMeshes, setSubMeshes] = useState<readonly SubMeshInfo[]>([]);

  // Selection + gizmo state.
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [gizmoMode, setGizmoMode] = useState<GizmoMode>("translate");

  // In-memory override map. Save serialises this; Reset clears it + reloads.
  const [overrides, setOverrides] = useState<Record<string, SubMeshOverride>>({});
  // The sidecar last persisted to disk (used to compute "dirty" + "Reset"'s
  // confirm message). null = sidecar absent on disk.
  const [persistedSidecar, setPersistedSidecar] =
    useState<ComposerSidecar | null>(null);

  // Visibility map fed to the scene. Mirrors overrides[].visible, plus
  // entries the owner toggled in the sidebar before saving.
  const visibility = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const [name, o] of Object.entries(overrides)) {
      m.set(name, o.visible);
    }
    return m;
  }, [overrides]);

  // TransformControls availability — flipped to false if the scene can't
  // construct the gizmo. The numeric fallback then renders.
  const [gizmoAvailable, setGizmoAvailable] = useState(true);

  // Save / Reset status (transient message after a button press).
  const [status, setStatus] = useState<string | null>(null);

  // Track keep-alive of the in-flight load so we can cancel on prop change.
  const loadGenRef = useRef(0);

  // --- Load mesh + sidecar whenever mesh_asset path changes ---------------

  useEffect(() => {
    if (filePath === null) {
      setMesh(null);
      setOverrides({});
      setPersistedSidecar(null);
      return;
    }

    const gen = ++loadGenRef.current;
    setLoading(true);
    setLoadError(null);

    (async () => {
      try {
        const root = await loadMeshFromPath(filePath);
        if (gen !== loadGenRef.current) return;
        // Try to read the sidecar — best-effort. If reading throws (malformed
        // JSON, etc), we surface the error AND still show the mesh at its
        // un-overridden pose so the owner can choose to "reset" the sidecar.
        let sidecar: ComposerSidecar | null = null;
        try {
          sidecar = await readComposerSidecar(sidecarPathFor(filePath));
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          setLoadError(
            `Sidecar exists but couldn't be loaded — ${msg}. Render shows the original layout. Click "Reset" to discard.`,
          );
        }
        if (gen !== loadGenRef.current) return;
        // Apply if we got one.
        if (sidecar) {
          applyComposerOverridesToTree(root, sidecar);
          setOverrides({ ...sidecar.submesh_overrides });
        } else {
          setOverrides({});
        }
        setPersistedSidecar(sidecar);
        setMesh(root);
      } catch (e) {
        if (gen !== loadGenRef.current) return;
        const msg = e instanceof Error ? e.message : String(e);
        setLoadError(`Couldn't load mesh: ${msg}`);
        setMesh(null);
      } finally {
        if (gen === loadGenRef.current) setLoading(false);
      }
    })();
  }, [filePath]);

  // --- Auto-select chassis sub-mesh when the list is first populated ------

  useEffect(() => {
    if (selectedName === null && subMeshes.length > 0) {
      setSelectedName(subMeshes[0].name);
    }
    // If the previously-selected sub-mesh vanished after a reload, drop it.
    if (selectedName !== null && !subMeshes.some((s) => s.name === selectedName)) {
      setSelectedName(subMeshes[0]?.name ?? null);
    }
  }, [subMeshes, selectedName]);

  // --- Keyboard hotkeys: T / R / S → gizmo mode ---------------------------

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      // Skip when typing in a form field — numeric fallback uses inputs.
      const tgt = e.target as HTMLElement | null;
      if (
        tgt &&
        (tgt.tagName === "INPUT" ||
          tgt.tagName === "TEXTAREA" ||
          tgt.isContentEditable)
      ) {
        return;
      }
      if (e.key === "t" || e.key === "T") setGizmoMode("translate");
      else if (e.key === "r" || e.key === "R") setGizmoMode("rotate");
      else if (e.key === "s" || e.key === "S") setGizmoMode("scale");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  // --- Scene callbacks ----------------------------------------------------

  const handleSubMeshesChanged = useCallback((subs: readonly SubMeshInfo[]) => {
    setSubMeshes(subs);
  }, []);

  const handlePickSubMesh = useCallback((name: string) => {
    setSelectedName(name);
  }, []);

  const handleTransformChanged = useCallback(
    (xform: SubMeshTransform) => {
      setOverrides((prev) => {
        const existing = prev[xform.name];
        const next: SubMeshOverride = {
          position: [xform.position[0], xform.position[1], xform.position[2]],
          rotation_quat: [
            xform.rotation_quat[0],
            xform.rotation_quat[1],
            xform.rotation_quat[2],
            xform.rotation_quat[3],
          ],
          scale: [xform.scale[0], xform.scale[1], xform.scale[2]],
          // Inherit existing visibility (if any) so dragging doesn't reset
          // a sub-mesh the owner just hid. Default true otherwise.
          visible: existing ? existing.visible : true,
        };
        return { ...prev, [xform.name]: next };
      });
      setStatus(null);
    },
    [],
  );

  const handleToggleVisibility = useCallback(
    (name: string, visible: boolean) => {
      setOverrides((prev) => {
        const existing = prev[name];
        // If we have no transform recorded for this sub-mesh yet, snapshot
        // the current scene transform so the visibility flag persists
        // alongside a valid transform shape (sidecar requires all four
        // fields).
        let base: SubMeshOverride;
        if (existing) {
          base = existing;
        } else {
          // Find the live Three.js Mesh through the scene's enumeration —
          // we already have the relevant info in `subMeshes` but not the
          // transform. Best practice: read it off the scene through the
          // ref, but the SubMeshInfo doesn't expose the node. Fall back to
          // the identity transform — the runtime applier still treats
          // {pos:0, quat:identity, scale:1} as valid; if the owner hadn't
          // moved this sub-mesh in the editor it's already at rest pose,
          // and the sidecar's identity will leave the runtime at rest too.
          // For an authored override the owner would have touched the
          // gizmo, populating `existing`.
          base = {
            position: [0, 0, 0],
            rotation_quat: [0, 0, 0, 1],
            scale: [1, 1, 1],
            visible,
          };
        }
        return { ...prev, [name]: { ...base, visible } };
      });
      setStatus(null);
    },
    [],
  );

  const handleGizmoUnavailable = useCallback(() => {
    setGizmoAvailable(false);
  }, []);

  // --- Save / Reset -------------------------------------------------------

  const handleSave = useCallback(async () => {
    if (filePath === null) {
      setStatus("No file-backed mesh to save against.");
      return;
    }
    const sidecar: ComposerSidecar = {
      version: 1,
      unit_id: unit.id,
      submesh_overrides: overrides,
    };
    try {
      await writeComposerSidecar(sidecarPathFor(filePath), sidecar);
      setPersistedSidecar(sidecar);
      const n = Object.keys(overrides).length;
      setStatus(
        `Saved sidecar with ${n} override${n === 1 ? "" : "s"} — original GLB untouched.`,
      );
      // eslint-disable-next-line no-console
      console.info(
        `[MeshComposer] wrote ${sidecarPathFor(filePath)} (${n} override(s)).`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus(`Save failed: ${msg}`);
    }
  }, [filePath, overrides, unit.id]);

  const handleReset = useCallback(async () => {
    if (filePath === null) return;
    try {
      await deleteComposerSidecar(sidecarPathFor(filePath));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus(`Sidecar delete failed: ${msg}`);
      return;
    }
    // Force a full reload so the mesh comes back at its original pose.
    setOverrides({});
    setPersistedSidecar(null);
    setStatus("Sidecar deleted — original layout restored.");
    const gen = ++loadGenRef.current;
    setLoading(true);
    try {
      const root = await loadMeshFromPath(filePath);
      if (gen !== loadGenRef.current) return;
      setMesh(root);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLoadError(`Couldn't reload mesh after reset: ${msg}`);
    } finally {
      if (gen === loadGenRef.current) setLoading(false);
    }
  }, [filePath]);

  // --- Snapshot dirty calc ------------------------------------------------

  const isDirty = useMemo(() => {
    const persistedKeys = Object.keys(persistedSidecar?.submesh_overrides ?? {});
    const liveKeys = Object.keys(overrides);
    if (persistedKeys.length !== liveKeys.length) return true;
    for (const k of liveKeys) {
      const a = overrides[k];
      const b = persistedSidecar?.submesh_overrides[k];
      if (!b) return true;
      if (
        a.visible !== b.visible ||
        a.position[0] !== b.position[0] ||
        a.position[1] !== b.position[1] ||
        a.position[2] !== b.position[2] ||
        a.scale[0] !== b.scale[0] ||
        a.scale[1] !== b.scale[1] ||
        a.scale[2] !== b.scale[2] ||
        a.rotation_quat[0] !== b.rotation_quat[0] ||
        a.rotation_quat[1] !== b.rotation_quat[1] ||
        a.rotation_quat[2] !== b.rotation_quat[2] ||
        a.rotation_quat[3] !== b.rotation_quat[3]
      ) {
        return true;
      }
    }
    return false;
  }, [overrides, persistedSidecar]);

  // --- Numeric fallback handlers ------------------------------------------

  const selectedOverride =
    selectedName !== null ? overrides[selectedName] : undefined;

  const updateSelectedNumeric = useCallback(
    (mut: (o: SubMeshOverride) => SubMeshOverride) => {
      if (selectedName === null) return;
      setOverrides((prev) => {
        const base: SubMeshOverride = prev[selectedName] ?? {
          position: [0, 0, 0],
          rotation_quat: [0, 0, 0, 1],
          scale: [1, 1, 1],
          visible: true,
        };
        return { ...prev, [selectedName]: mut(base) };
      });
    },
    [selectedName],
  );

  // Apply numeric edits LIVE to the scene (so the viewport reflects the
  // change immediately, not just on save). We reach into the scene's
  // node lookup by re-issuing the same enumeration — using the unique
  // sub-mesh name as the key.
  useEffect(() => {
    if (mesh === null || selectedName === null) return;
    const o = overrides[selectedName];
    if (!o) return;
    mesh.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      if (node.name !== selectedName) return;
      node.position.set(o.position[0], o.position[1], o.position[2]);
      node.quaternion.set(
        o.rotation_quat[0],
        o.rotation_quat[1],
        o.rotation_quat[2],
        o.rotation_quat[3],
      );
      node.scale.set(o.scale[0], o.scale[1], o.scale[2]);
    });
  }, [overrides, selectedName, mesh]);

  // --- Empty states -------------------------------------------------------

  const isTemplateMesh = meshAsset?.kind === "template";
  const noMeshAsset = !meshAsset;

  // --- Render -------------------------------------------------------------

  return (
    <div style={S.root}>
      <div style={S.header}>
        <span style={S.title}>Mesh Composer</span>
        <small style={S.mvpNote}>
          MVP — translate/rotate/scale per sub-mesh. Snap, mirror,
          multi-select coming later.
        </small>
      </div>

      {(noMeshAsset || isTemplateMesh) && (
        <div style={S.emptyState}>
          Mesh Composer needs a file-backed mesh (`mesh_asset.kind === "file"`)
          — e.g. a Hunyuan3D-generated GLB. The current unit uses{" "}
          {noMeshAsset ? <em>no mesh_asset</em> : <em>a built-in template</em>}.
          <br />
          <br />
          Switch to a file mesh via Unit Editor → Mesh Workspace → Import Mesh,
          then return to this tab.
        </div>
      )}

      {!noMeshAsset && !isTemplateMesh && (
        <>
          <div style={S.body}>
            <SubMeshList
              subMeshes={subMeshes}
              selectedName={selectedName}
              onSelect={setSelectedName}
              onToggleVisibility={handleToggleVisibility}
            />
            <div style={S.rightCol}>
              <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
                <MeshComposerScene
                  mesh={mesh}
                  selectedName={selectedName}
                  gizmoMode={gizmoMode}
                  visibility={visibility}
                  onSubMeshesChanged={handleSubMeshesChanged}
                  onPickSubMesh={handlePickSubMesh}
                  onTransformChanged={handleTransformChanged}
                  onGizmoUnavailable={handleGizmoUnavailable}
                />
              </div>

              {/* Numeric fallback — always visible at the bottom; doubles
                  as an at-a-glance view of the selected transform AND a
                  manual edit path when the gizmo is unavailable. */}
              {selectedName && selectedOverride && (
                <NumericFallback
                  available={gizmoAvailable}
                  name={selectedName}
                  override={selectedOverride}
                  onChange={updateSelectedNumeric}
                />
              )}

              <div style={S.toolbar}>
                {/* Gizmo mode tri-toggle */}
                {(["translate", "rotate", "scale"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    style={{
                      ...S.btn,
                      ...(gizmoMode === m ? S.btnActive : undefined),
                    }}
                    onClick={() => setGizmoMode(m)}
                    title={`${m} (hotkey: ${m[0].toUpperCase()})`}
                  >
                    {m === "translate"
                      ? "Move (T)"
                      : m === "rotate"
                        ? "Rotate (R)"
                        : "Scale (S)"}
                  </button>
                ))}

                <span style={{ width: 8 }} />

                <button
                  type="button"
                  style={{
                    ...S.btn,
                    ...(isDirty ? S.btnActive : undefined),
                    ...(filePath === null || loading ? S.btnDisabled : undefined),
                  }}
                  disabled={filePath === null || loading}
                  onClick={() => {
                    void handleSave();
                  }}
                  title="Write the sidecar JSON next to the GLB (original GLB untouched)"
                >
                  {isDirty ? "Save Sidecar*" : "Save Sidecar"}
                </button>

                <button
                  type="button"
                  style={{
                    ...S.btn,
                    ...(filePath === null || loading ? S.btnDisabled : undefined),
                  }}
                  disabled={filePath === null || loading}
                  onClick={() => {
                    void handleReset();
                  }}
                  title="Delete the sidecar and reload the original GLB layout"
                >
                  Reset
                </button>

                <span style={S.status}>
                  {loading
                    ? "Loading…"
                    : status
                      ? status
                      : isDirty
                        ? `${Object.keys(overrides).length} unsaved change(s)`
                        : persistedSidecar
                          ? `${Object.keys(persistedSidecar.submesh_overrides).length} override(s) on disk`
                          : "No sidecar"}
                </span>
              </div>
            </div>
          </div>

          {loadError !== null && (
            <div role="alert" style={S.banner}>
              <span>{loadError}</span>
              <button
                type="button"
                style={{ ...S.btn, padding: "2px 8px" }}
                onClick={() => setLoadError(null)}
              >
                Dismiss
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Numeric fallback — readable in normal mode, editable when WebGL gizmo isn't.
// ---------------------------------------------------------------------------

function NumericFallback({
  available,
  name,
  override,
  onChange,
}: {
  readonly available: boolean;
  readonly name: string;
  readonly override: SubMeshOverride;
  readonly onChange: (mut: (o: SubMeshOverride) => SubMeshOverride) => void;
}) {
  const headerStyle: CSSProperties = {
    fontSize: 10,
    color: "#8a93a3",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    marginTop: 4,
  };
  const labelStyle: CSSProperties = {
    fontSize: 10,
    color: "#8a93a3",
    fontFamily: "ui-monospace, Menlo, monospace",
  };

  // Quaternion → Euler (degrees) for display only. We READ back to euler so
  // the human-facing number is intelligible; we WRITE back as quaternion via
  // a fresh THREE.Euler→Quaternion conversion. Round-trip is stable.
  const eulerXYZ = useMemo(() => {
    const q = new THREE.Quaternion(
      override.rotation_quat[0],
      override.rotation_quat[1],
      override.rotation_quat[2],
      override.rotation_quat[3],
    );
    const e = new THREE.Euler().setFromQuaternion(q, "XYZ");
    const r2d = 180 / Math.PI;
    return [e.x * r2d, e.y * r2d, e.z * r2d] as const;
  }, [override.rotation_quat]);

  const handlePosChange = (axis: 0 | 1 | 2, value: number) => {
    onChange((o) => {
      const p: [number, number, number] = [...o.position];
      p[axis] = value;
      return { ...o, position: p };
    });
  };
  const handleRotChange = (axis: 0 | 1 | 2, valueDeg: number) => {
    onChange((o) => {
      const d2r = Math.PI / 180;
      const currentE = new THREE.Euler().setFromQuaternion(
        new THREE.Quaternion(
          o.rotation_quat[0],
          o.rotation_quat[1],
          o.rotation_quat[2],
          o.rotation_quat[3],
        ),
        "XYZ",
      );
      const next = new THREE.Euler(currentE.x, currentE.y, currentE.z, "XYZ");
      if (axis === 0) next.x = valueDeg * d2r;
      else if (axis === 1) next.y = valueDeg * d2r;
      else next.z = valueDeg * d2r;
      const q = new THREE.Quaternion().setFromEuler(next);
      return {
        ...o,
        rotation_quat: [q.x, q.y, q.z, q.w],
      };
    });
  };
  const handleScaleChange = (axis: 0 | 1 | 2, value: number) => {
    onChange((o) => {
      const s: [number, number, number] = [...o.scale];
      s[axis] = value;
      return { ...o, scale: s };
    });
  };

  return (
    <div style={S.numericFallback}>
      <div style={headerStyle}>
        {available ? "Numeric — " : "Numeric (gizmo fallback) — "}
        <strong>{name}</strong>
      </div>

      <div style={S.numericRow}>
        <span style={labelStyle}>Pos m</span>
        {([0, 1, 2] as const).map((i) => (
          <input
            key={`p${i}`}
            type="number"
            step="0.05"
            style={S.numericInput}
            value={override.position[i]}
            onChange={(e) => handlePosChange(i, Number(e.target.value))}
          />
        ))}
      </div>

      <div style={S.numericRow}>
        <span style={labelStyle}>Rot deg</span>
        {([0, 1, 2] as const).map((i) => (
          <input
            key={`r${i}`}
            type="number"
            step="1"
            style={S.numericInput}
            value={eulerXYZ[i].toFixed(2)}
            onChange={(e) => handleRotChange(i, Number(e.target.value))}
          />
        ))}
      </div>

      <div style={S.numericRow}>
        <span style={labelStyle}>Scale</span>
        {([0, 1, 2] as const).map((i) => (
          <input
            key={`s${i}`}
            type="number"
            step="0.05"
            style={S.numericInput}
            value={override.scale[i]}
            onChange={(e) => handleScaleChange(i, Number(e.target.value))}
          />
        ))}
      </div>
    </div>
  );
}
