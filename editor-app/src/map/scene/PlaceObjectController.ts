/**
 * PlaceObjectController — pointer input → place-on-terrain pipeline.
 *
 * Wired separately from BrushController so each input controller stays
 * single-purpose. Both watch the same canvas; gating on `state.tool`
 * means at most one will react to any given click.
 *
 * Behavior:
 *   - Left click on terrain while tool === "place" → emit a
 *     PlaceObjectCommand with a fresh UUID. The command is undoable.
 *   - Newly placed object is auto-selected so the gizmo attaches
 *     immediately for follow-up dragging.
 *   - We construct the full InstanceObject BEFORE building the command
 *     (the existing PlaceObjectCommand API takes the object directly —
 *     see Day 2). That keeps the id stable across undo/redo because the
 *     command holds the snapshot.
 */

import * as THREE from "three";

import { mapCommandBus } from "../commands/CommandBus";
import { PlaceObjectCommand } from "../commands/PlaceObjectCommand";
import { useMapStore } from "../state/mapStore";
import type { InstanceObject } from "../state/mapStore";

import { prefabRegistry } from "./prefabs";
import { alignToNormal, sampleTerrainNormal } from "./_terrainSampling";
import type { TerrainMesh } from "./TerrainMesh";

export class PlaceObjectController {
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
    if (e.button !== 0) return; // left click only — camera owns the rest
    const state = useMapStore.getState();
    if (state.tool !== "place") return;
    const hit = this.screenToTerrainHit(e.clientX, e.clientY);
    if (!hit) return;
    const activePrefabId = state.activePrefabId;
    const def = prefabRegistry.get(activePrefabId);
    if (!def) {
      console.warn(
        `[PlaceObjectController] No prefab registered for '${activePrefabId}'.`,
      );
      return;
    }
    e.preventDefault();
    // Slope-align: sample the terrain normal under the hit point and
    // tilt the prefab's local +Y to match (clamped). On flat ground this
    // is identity; on slopes the prefab leans naturally.
    const normal = sampleTerrainNormal(this.terrain.mesh, hit.x, hit.z);
    const rotation = normal ? alignToNormal(normal) : { x: 0, y: 0, z: 0 };
    const instance: InstanceObject = {
      id: crypto.randomUUID(),
      prefabId: activePrefabId,
      position: { x: hit.x, y: hit.y, z: hit.z },
      rotation,
      scale: { ...def.defaultScale },
      properties: {},
    };
    const cmd = new PlaceObjectCommand(instance);
    mapCommandBus.execute(cmd);
    // Auto-select the newly placed object so the gizmo attaches.
    state._setSelection({ kind: "object", id: instance.id });
  };

  dispose(): void {
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
  }
}
