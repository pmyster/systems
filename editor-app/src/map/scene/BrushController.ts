/**
 * BrushController — pointer input → raycast → sculpt command pipeline.
 *
 * Responsibilities:
 *   1. Track cursor over the terrain and reposition the BrushDecal so
 *     the user sees where the brush will land.
 *   2. On left-button drag, fire RaiseTerrain / LowerTerrain commands
 *     through the command bus on each pointermove tick.
 *   3. On pointerup, ask the TerrainMesh to recompute vertex normals
 *     once (NOT per tick — see TerrainMesh.applyDirtyPixels notes).
 *
 * Camera-vs-brush contract:
 *   Left button (button === 0) is owned by the brush — ONLY when the
 *   current tool is a sculpt tool. Middle/right buttons belong to the
 *   RtsOrbitCamera. We never call preventDefault on non-left buttons so
 *   the camera controller's listeners fire as normal.
 *
 * Stroke coalescing:
 *   The CommandBus has a 500ms same-kind merge window, so dozens of
 *   per-frame commands collapse into a single undoable stroke. Once the
 *   pointer is released we drop our reference to the stroke command so
 *   the next click starts a fresh entry on the next pointerdown.
 */

import * as THREE from "three";

import { mapStore } from "../state/mapStore";
import { mapCommandBus } from "../commands/CommandBus";
import { RaiseTerrainCommand } from "../commands/RaiseTerrainCommand";
import { LowerTerrainCommand } from "../commands/LowerTerrainCommand";
import type { TerrainMesh } from "./TerrainMesh";
import type { BrushDecal } from "./BrushDecal";

type StrokeCmd = RaiseTerrainCommand | LowerTerrainCommand;

export class BrushController {
  private isDragging = false;
  private currentStrokeCmd: StrokeCmd | null = null;
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly terrain: TerrainMesh,
    private readonly decal: BrushDecal,
  ) {
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointerleave", this.onPointerLeave);
  }

  /** Map screen coords → world hit point on the terrain mesh, or null. */
  private screenToWorldHit(
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

  private isSculptTool(): boolean {
    const tool = mapStore.getState().tool;
    return tool === "sculpt-raise" || tool === "sculpt-lower";
  }

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.isSculptTool()) {
      this.decal.hide();
      return;
    }
    const hit = this.screenToWorldHit(e.clientX, e.clientY);
    if (!hit) {
      this.decal.hide();
      return;
    }
    this.decal.show(hit.x, hit.z, hit.y);

    if (this.isDragging) {
      this.tickStroke(hit.x, hit.z);
    }
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return; // camera owns middle/right
    if (!this.isSculptTool()) return;
    const hit = this.screenToWorldHit(e.clientX, e.clientY);
    if (!hit) return;
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    this.isDragging = true;
    this.currentStrokeCmd = null;
    this.tickStroke(hit.x, hit.z);
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (!this.isDragging) return;
    this.isDragging = false;
    if (this.canvas.hasPointerCapture(e.pointerId)) {
      this.canvas.releasePointerCapture(e.pointerId);
    }
    if (this.currentStrokeCmd) {
      // Single normal recompute at the end of the stroke — see TerrainMesh.
      this.terrain.finalizeStroke();
      this.currentStrokeCmd = null;
    }
  };

  private onPointerLeave = (): void => {
    this.decal.hide();
  };

  private tickStroke(worldX: number, worldZ: number): void {
    const state = mapStore.getState();
    const isLower = state.tool === "sculpt-lower";
    const params = {
      worldX,
      worldZ,
      radiusM: state.brush.radiusM,
      strength: state.brush.strength,
    };
    const cmd: StrokeCmd = isLower
      ? new LowerTerrainCommand(params)
      : new RaiseTerrainCommand(params);
    mapCommandBus.execute(cmd);
    // Track the most-recent command so finalizeStroke fires once we
    // release the pointer. Merge logic on the bus may discard `cmd` in
    // favour of the existing top — that's fine; either way we want the
    // recompute on mouseup.
    this.currentStrokeCmd = cmd;
  }

  dispose(): void {
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointerleave", this.onPointerLeave);
  }
}
