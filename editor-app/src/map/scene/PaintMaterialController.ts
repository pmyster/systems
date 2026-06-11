/**
 * PaintMaterialController — pointer input → splatmap paint pipeline.
 *
 * Mirrors BrushController. Gated on `tool === "paint"`. Left-button drag
 * raycasts the terrain, converts the world XZ hit point into splatmap
 * pixel coordinates, and fires one PaintMaterialCommand per pointermove
 * tick. The CommandBus's same-kind merge window collapses a continuous
 * drag into a single undoable stroke (provided the material doesn't
 * change mid-drag).
 *
 * Splatmap pixel-coord conversion:
 *   pxX = (worldX / mapWidthM)  * splatWidthPx
 *   pxY = (worldZ / mapDepthM)  * splatHeightPx
 * — both can be fractional; the disc iterator handles that. The
 * heightmap and splatmap are intentionally different resolutions, so
 * we cannot reuse TerrainMesh.worldToPixelIndex.
 *
 * Radius conversion:
 *   radiusPx = paintBrushRadiusM * (splatWidthPx / mapWidthM)
 */

import * as THREE from "three";

import { mapCommandBus } from "../commands/CommandBus";
import { PaintMaterialCommand } from "../commands/PaintMaterialCommand";
import { HEIGHTMAP_M_PER_PIXEL } from "../coords/constants";
import { useMapStore } from "../state/mapStore";

import type { TerrainMesh } from "./TerrainMesh";

export class PaintMaterialController {
  private isDragging = false;
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly terrain: TerrainMesh,
  ) {
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointerleave", this.onPointerLeave);
  }

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

  private isPaintTool(): boolean {
    return useMapStore.getState().tool === "paint";
  }

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.isDragging || !this.isPaintTool()) return;
    const hit = this.screenToWorldHit(e.clientX, e.clientY);
    if (!hit) return;
    this.tickStroke(hit.x, hit.z);
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    if (!this.isPaintTool()) return;
    const hit = this.screenToWorldHit(e.clientX, e.clientY);
    if (!hit) return;
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    this.isDragging = true;
    this.tickStroke(hit.x, hit.z);
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (!this.isDragging) return;
    this.isDragging = false;
    if (this.canvas.hasPointerCapture(e.pointerId)) {
      this.canvas.releasePointerCapture(e.pointerId);
    }
  };

  private onPointerLeave = (): void => {
    // Don't end the stroke on leave — pointer capture keeps the drag
    // alive when the cursor briefly leaves the canvas (consistent with
    // BrushController).
  };

  private tickStroke(worldX: number, worldZ: number): void {
    const state = useMapStore.getState();
    const sm = state.splatmap;
    const terrainWidthM =
      (state.terrain.widthPx - 1) * HEIGHTMAP_M_PER_PIXEL;
    const terrainDepthM =
      (state.terrain.heightPx - 1) * HEIGHTMAP_M_PER_PIXEL;
    // World → splatmap pixel coords. Allow fractional — the disc
    // iterator floors/ceils internally for the bbox.
    const pxX = (worldX / terrainWidthM) * sm.widthPx;
    const pxY = (worldZ / terrainDepthM) * sm.heightPx;
    const pxPerM = sm.widthPx / terrainWidthM;
    const radiusPx = state.paint.radiusM * pxPerM;
    // Skip the tick when the cursor is fully outside the splatmap
    // bounds — the disc iterator would silently produce no work, but
    // creating an empty command and pushing it to the bus wastes undo
    // slots. Bounds check uses radiusPx (NOT radiusM) so meters and
    // pixels don't get cross-compared.
    if (
      pxX < -radiusPx ||
      pxX > sm.widthPx + radiusPx ||
      pxY < -radiusPx ||
      pxY > sm.heightPx + radiusPx
    ) {
      return;
    }
    const cmd = new PaintMaterialCommand({
      centerPxX: pxX,
      centerPxY: pxY,
      radiusPx,
      strength: state.paint.strength,
      materialIndex: state.paint.materialIndex,
    });
    mapCommandBus.execute(cmd);
  }

  dispose(): void {
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointerleave", this.onPointerLeave);
  }
}
