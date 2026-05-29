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
 */

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type * as THREE from "three";

interface MeshAssets {
  readonly meshSource: THREE.Group | null;
  readonly setMeshSource: (g: THREE.Group | null) => void;
  readonly skinImage: HTMLImageElement | null;
  readonly setSkinImage: (img: HTMLImageElement | null) => void;
}

const MeshAssetContext = createContext<MeshAssets | null>(null);

export function MeshAssetProvider({ children }: { children: ReactNode }) {
  const [meshSource, setMeshSource] = useState<THREE.Group | null>(null);
  const [skinImage, setSkinImage] = useState<HTMLImageElement | null>(null);
  const value = useMemo<MeshAssets>(
    () => ({ meshSource, setMeshSource, skinImage, setSkinImage }),
    [meshSource, skinImage],
  );
  return <MeshAssetContext.Provider value={value}>{children}</MeshAssetContext.Provider>;
}

export function useMeshAssets(): MeshAssets {
  const ctx = useContext(MeshAssetContext);
  if (!ctx) throw new Error("useMeshAssets must be used within MeshAssetProvider");
  return ctx;
}
