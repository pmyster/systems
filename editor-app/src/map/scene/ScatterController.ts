/**
 * ScatterController — pointer input → scatter-brush placement pipeline.
 *
 * Behavior:
 *   - Active only while `state.tool === "scatter"`. Left-button press
 *     captures the pointer and starts a drag; pointermove events fire a
 *     "scatter tick" at most every `tickIntervalMs`.
 *   - Each tick samples the terrain under the cursor, picks N points in
 *     a disc of radius `scatter.radiusM` around the hit (uniform disc
 *     sampling — `sqrt(rand)` keeps density uniform per unit area), and
 *     emits one ScatterObjectsCommand carrying N instance snapshots.
 *   - The CommandBus merge policy folds every tick of a single drag into
 *     one undo entry. See ScatterObjectsCommand.ts for the rationale.
 *
 * Why a separate controller (vs piggybacking on PlaceObjectController):
 *   - Different command type (bulk vs single).
 *   - Drag semantics (hold-to-paint) vs click semantics.
 *   - Future scatter-specific affordances (preview ring at brush radius)
 *     belong here, not on the place controller.
 *
 * Defensive notes:
 *   - The terrain raycast can miss when the cursor is over sky/sea past
 *     the heightmap extent. We skip silently in that case — no command,
 *     no error log spam — matching PlaceObjectController's behaviour.
 *   - If the active prefab id doesn't resolve to a registered prefab we
 *     log once per tick at WARN. This is loud-over-silent: a typo in the
 *     manifest or a missing GLB shows up immediately instead of a
 *     mysterious "nothing happens".
 */

import * as THREE from "three";

import { mapCommandBus } from "../commands/CommandBus";
import { ScatterObjectsCommand } from "../commands/ScatterObjectsCommand";
import { useMapStore, type InstanceObject } from "../state/mapStore";

import { prefabRegistry } from "./prefabs";
import {
  alignToNormal,
  sampleTerrainNormal,
  sampleTerrainY,
} from "./_terrainSampling";
import type { TerrainMesh } from "./TerrainMesh";

export class ScatterController {
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private isDragging = false;
  private lastTickMs = 0;
  /** ~12 scatter ticks per second while dragging. */
  private readonly tickIntervalMs = 80;
  private warnedMissingPrefab = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly terrain: TerrainMesh,
  ) {
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
  }

  private screenToHit(
    clientX: number,
    clientY: number,
  ): THREE.Intersection | null {
    const rect = this.canvas.getBoundingClientRect();
    this.ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.ndc, this.camera);
    return this.raycaster.intersectObject(this.terrain.mesh, false)[0] ?? null;
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const state = useMapStore.getState();
    if (state.tool !== "scatter") return;
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    this.isDragging = true;
    this.lastTickMs = performance.now();
    this.tickScatter(e.clientX, e.clientY);
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.isDragging) return;
    const now = performance.now();
    if (now - this.lastTickMs < this.tickIntervalMs) return;
    this.lastTickMs = now;
    this.tickScatter(e.clientX, e.clientY);
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (!this.isDragging) return;
    this.isDragging = false;
    if (this.canvas.hasPointerCapture(e.pointerId)) {
      this.canvas.releasePointerCapture(e.pointerId);
    }
  };

  private tickScatter(clientX: number, clientY: number): void {
    const state = useMapStore.getState();
    const hit = this.screenToHit(clientX, clientY);
    if (!hit) return;
    const def = prefabRegistry.get(state.activePrefabId);
    if (!def) {
      if (!this.warnedMissingPrefab) {
        console.warn(
          `[ScatterController] No prefab registered for '${state.activePrefabId}'.`,
        );
        this.warnedMissingPrefab = true;
      }
      return;
    }
    this.warnedMissingPrefab = false;
    const { radiusM, density, scaleJitter, randomRotation } = state.scatter;

    const instances: InstanceObject[] = [];
    for (let i = 0; i < density; i++) {
      // Uniform disc sample: angle uniform, radius = sqrt(rand)*R to
      // counter the polar-density bias.
      const t = 2 * Math.PI * Math.random();
      const r = Math.sqrt(Math.random()) * radiusM;
      const px = hit.point.x + Math.cos(t) * r;
      const pz = hit.point.z + Math.sin(t) * r;
      const py = sampleTerrainY(this.terrain.mesh, px, pz);
      if (py === null) continue; // sample fell off the heightmap
      const scaleVal = 1 + (Math.random() * 2 - 1) * scaleJitter;
      // Slope-align rotation, then mix in random Y-rotation if requested.
      const normal = sampleTerrainNormal(this.terrain.mesh, px, pz);
      const tilt = normal
        ? alignToNormal(normal)
        : { x: 0, y: 0, z: 0 };
      const rotY = tilt.y + (randomRotation ? Math.random() * Math.PI * 2 : 0);
      instances.push({
        id: crypto.randomUUID(),
        prefabId: state.activePrefabId,
        position: { x: px, y: py, z: pz },
        rotation: { x: tilt.x, y: rotY, z: tilt.z },
        scale: {
          x: def.defaultScale.x * scaleVal,
          y: def.defaultScale.y * scaleVal,
          z: def.defaultScale.z * scaleVal,
        },
        properties: {},
      });
    }
    if (instances.length === 0) return;
    mapCommandBus.execute(new ScatterObjectsCommand({ instances }));
  }

  dispose(): void {
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
  }
}
