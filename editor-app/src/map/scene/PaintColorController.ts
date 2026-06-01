/**
 * PaintColorController — pointer input → color-paint pipeline.
 *
 * Mirrors PaintMaterialController. Gated on `tool === "color-paint"`.
 * Left-button drag raycasts the terrain, converts the world XZ hit
 * point into color-paint pixel coordinates, parses the current hex
 * color to {r,g,b}, and fires one PaintColorCommand per pointermove
 * tick. The CommandBus's same-kind merge window collapses a continuous
 * drag into a single undoable stroke (provided the color and erase
 * mode don't change mid-drag).
 *
 * The color-paint buffer follows the splatmap dimensions (the store
 * keeps them in sync), so the same world→pixel math applies.
 */

import * as THREE from "three";

import { mapCommandBus } from "../commands/CommandBus";
import { PaintColorCommand } from "../commands/PaintColorCommand";
import { HEIGHTMAP_M_PER_PIXEL } from "../coords/constants";
import { useMapStore } from "../state/mapStore";

import type { TerrainMesh } from "./TerrainMesh";

/**
 * Parse a "#rrggbb" CSS hex string into 0..255 RGB components.
 * Falls back to red (255, 0, 0) on malformed input — loud-over-silent:
 * we log a WARN so a regression in the picker UI surfaces.
 */
function parseHexColor(hex: string): { r: number; g: number; b: number } {
  const cleaned = hex.startsWith("#") ? hex.slice(1) : hex;
  if (cleaned.length !== 6 || /[^0-9a-fA-F]/.test(cleaned)) {
    console.warn(
      `[PaintColorController] malformed hex color '${hex}', falling back to red`,
    );
    return { r: 255, g: 0, b: 0 };
  }
  return {
    r: parseInt(cleaned.slice(0, 2), 16),
    g: parseInt(cleaned.slice(2, 4), 16),
    b: parseInt(cleaned.slice(4, 6), 16),
  };
}

export class PaintColorController {
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

  private isColorPaintTool(): boolean {
    return useMapStore.getState().tool === "color-paint";
  }

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.isDragging || !this.isColorPaintTool()) return;
    const hit = this.screenToWorldHit(e.clientX, e.clientY);
    if (!hit) return;
    this.tickStroke(hit.x, hit.z);
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    if (!this.isColorPaintTool()) return;
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
    // PaintMaterialController and BrushController).
  };

  private tickStroke(worldX: number, worldZ: number): void {
    const state = useMapStore.getState();
    const cp = state.colorPaint;
    const auth = state.colorPaintAuthoring;
    const terrainWidthM =
      (state.terrain.widthPx - 1) * HEIGHTMAP_M_PER_PIXEL;
    const terrainDepthM =
      (state.terrain.heightPx - 1) * HEIGHTMAP_M_PER_PIXEL;
    // World → color-paint pixel coords. Allow fractional — the disc
    // iterator floors/ceils internally for the bbox.
    const pxX = (worldX / terrainWidthM) * cp.widthPx;
    const pxY = (worldZ / terrainDepthM) * cp.heightPx;
    const pxPerM = cp.widthPx / terrainWidthM;
    const radiusPx = auth.radiusM * pxPerM;
    // Bail when the cursor is fully outside the buffer — creating an
    // empty command and pushing it to the bus wastes undo slots.
    if (
      pxX < -radiusPx ||
      pxX > cp.widthPx + radiusPx ||
      pxY < -radiusPx ||
      pxY > cp.heightPx + radiusPx
    ) {
      return;
    }
    const color = parseHexColor(auth.color);
    const cmd = new PaintColorCommand({
      centerPxX: pxX,
      centerPxY: pxY,
      radiusPx,
      strength: auth.strength,
      color,
      eraseMode: auth.eraseMode,
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
