/**
 * mesh-assets — shared context holding a REFERENCE to the master mesh and
 * its skin image. The master mesh is owned and displayed by MeshWorkspace's
 * MeshViewer (left pane). The Battlefield Preview (right pane) reads this
 * context to render the SAME unit as a mesh-first preview.
 *
 * CRITICAL: a single THREE.Object3D can only be parented to one scene. This
 * context exposes a reference only — consumers that render it MUST deep-clone
 * (geometry + materials) before adding it to their own scene. Never re-parent
 * the master here. See box-projection.ts#deepCloneGroup.
 *
 * Hardpoint selection state lives here too. It is a UI-only concern (which
 * hardpoint row the form is currently editing / which arrow the gizmo is
 * attached to in the Mesh Workspace) — it does NOT belong in the unit
 * Schematic because it is not persisted. Co-locating with mesh-assets keeps
 * the two left-pane UI-state islands together and avoids a second provider.
 */

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type * as THREE from "three";

interface MeshAssets {
  readonly meshSource: THREE.Group | null;
  readonly setMeshSource: (g: THREE.Group | null) => void;
  readonly skinImage: HTMLImageElement | null;
  readonly setSkinImage: (img: HTMLImageElement | null) => void;
  /**
   * Id of the hardpoint currently selected for gizmo editing in the Mesh
   * Workspace. Null = no selection (gizmo hidden). Setting an id that no
   * longer exists in the unit is harmless — the MeshViewer effect simply
   * detaches the gizmo when it can't find a matching arrow.
   */
  readonly selectedHardpointId: string | null;
  readonly setSelectedHardpointId: (id: string | null) => void;
  /**
   * Active TransformControls mode for the hardpoint gizmo. "off" detaches
   * the gizmo entirely; "translate" and "rotate" attach it in the matching
   * Three.js mode.
   */
  readonly gizmoMode: "translate" | "rotate" | "off";
  readonly setGizmoMode: (mode: "translate" | "rotate" | "off") => void;
  /**
   * Set of hardpoint ids currently checked in the fire-test bar's
   * "Hardpoints" row. Both viewers (MeshWorkspace + BattlefieldPreview)
   * tint these arrows cyan so the author can see at a glance which
   * sockets will fire on the next click. Per-session UI state — never
   * persisted to the unit JSON.
   *
   * Held as a ReadonlySet for value-equality friendliness in effects.
   * Pass a fresh Set instance to update (never mutate in place).
   */
  readonly fireSelectedHardpointIds: ReadonlySet<string>;
  readonly setFireSelectedHardpointIds: (ids: ReadonlySet<string>) => void;
}

const MeshAssetContext = createContext<MeshAssets | null>(null);

export function MeshAssetProvider({ children }: { children: ReactNode }) {
  const [meshSource, setMeshSource] = useState<THREE.Group | null>(null);
  const [skinImage, setSkinImage] = useState<HTMLImageElement | null>(null);
  const [selectedHardpointId, setSelectedHardpointId] = useState<string | null>(null);
  const [gizmoMode, setGizmoMode] = useState<"translate" | "rotate" | "off">(
    "translate",
  );
  const [fireSelectedHardpointIds, setFireSelectedHardpointIds] = useState<
    ReadonlySet<string>
  >(() => new Set<string>());
  const value = useMemo<MeshAssets>(
    () => ({
      meshSource,
      setMeshSource,
      skinImage,
      setSkinImage,
      selectedHardpointId,
      setSelectedHardpointId,
      gizmoMode,
      setGizmoMode,
      fireSelectedHardpointIds,
      setFireSelectedHardpointIds,
    }),
    [meshSource, skinImage, selectedHardpointId, gizmoMode, fireSelectedHardpointIds],
  );
  return <MeshAssetContext.Provider value={value}>{children}</MeshAssetContext.Provider>;
}

export function useMeshAssets(): MeshAssets {
  const ctx = useContext(MeshAssetContext);
  if (!ctx) throw new Error("useMeshAssets must be used within MeshAssetProvider");
  return ctx;
}
