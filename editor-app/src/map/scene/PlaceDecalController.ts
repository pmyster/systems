/**
 * PlaceDecalController — pointer input → place-decal-on-terrain pipeline.
 *
 * Mirrors PlaceObjectController. Gated on `tool === "decal"`. Left click
 * on terrain emits a PlaceDecalCommand with a fresh UUID, snapshot of the
 * current activeDecalKind / decalScale / decalOpacity, and a random
 * Y-rotation so successive scorches don't tile suspiciously.
 *
 * Stack-up against PlaceObjectController:
 *   Both watch the same canvas; the `state.tool` gate ensures at most one
 *   consumes any given click.
 */

import * as THREE from "three";

import { mapCommandBus } from "../commands/CommandBus";
import { PlaceDecalCommand } from "../commands/PlaceDecalCommand";
import { useMapStore } from "../state/mapStore";
import type { DecalInstance } from "../state/mapStore";

import { decalRegistry } from "./decals";
import type { TerrainMesh } from "./TerrainMesh";

export class PlaceDecalController {
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly terrain: TerrainMesh,
  ) {
    canvas.addEventListener("pointerdown", this.onPointerDown);
  }

  private screenToTerrainHit(
    clientX: number,
    clientY: number,
  ): THREE.Vector3 | null {
    const rect = this.canvas.getBoundingClientRect();
    this.ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hits = this.raycaster.intersectObject(this.terrain.mesh, false);
    return hits[0]?.point ?? null;
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const state = useMapStore.getState();
    if (state.tool !== "decal") return;
    const hit = this.screenToTerrainHit(e.clientX, e.clientY);
    if (!hit) return;
    const kind = state.activeDecalKind;
    const def = decalRegistry.get(kind);
    if (!def) {
      console.warn(
        `[PlaceDecalController] No decal registered for kind '${kind}'.`,
      );
      return;
    }
    e.preventDefault();
    // Rotation: if randomRotation is on, jitter per-stamp to avoid the
    // visible tiling pattern. Otherwise honour the manual yaw the user
    // dialed in via the rotation slider.
    const rotation = state.decalRandomRotation
      ? Math.random() * Math.PI * 2
      : state.decalRotation;
    const instance: DecalInstance = {
      id: crypto.randomUUID(),
      decalKind: kind,
      position: { x: hit.x, y: hit.y, z: hit.z },
      rotation,
      scale: state.decalScale,
      opacity: state.decalOpacity,
    };
    mapCommandBus.execute(new PlaceDecalCommand(instance));
  };

  dispose(): void {
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
  }
}
