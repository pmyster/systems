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
import { _pushColorRecent, useMapStore } from "../state/mapStore";

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
    private readonly renderer: THREE.WebGLRenderer,
  ) {
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointerleave", this.onPointerLeave);
    // Alt held → switch to crosshair so the user sees they're in
    // eyedropper mode. Window-level because the keypress can happen
    // while the cursor is outside the canvas.
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
  }

  /**
   * Sample the rendered pixel at `(clientX, clientY)` from the WebGL
   * backbuffer and return it as a "#rrggbb" hex string. Returns null on
   * read failure (e.g., context lost) — caller silently no-ops, which
   * is fine because the user can simply click again.
   *
   * WebGL framebuffer coords are bottom-up, so the Y axis must be
   * flipped relative to DOM client coords. DPI is also applied — on a
   * retina display the framebuffer is 2× wider/taller than the CSS box.
   *
   * Note: this reads whatever is currently in the backbuffer. The
   * pointerdown handler runs synchronously after the last
   * requestAnimationFrame paint, so the pixel matches what the user
   * actually clicked on.
   */
  private sampleColorAt(clientX: number, clientY: number): string | null {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const canvasX = Math.round((clientX - rect.left) * dpr);
    const canvasYTop = Math.round((clientY - rect.top) * dpr);
    const fbHeight = this.renderer.domElement.height;
    const fbWidth = this.renderer.domElement.width;
    const canvasYBottom = fbHeight - canvasYTop - 1;
    // Bounds check — readPixels outside the framebuffer is a silent
    // no-op that leaves the pixel buffer as zeros (i.e. would return
    // black). Surface this with a warn rather than poisoning recents.
    if (
      canvasX < 0 ||
      canvasX >= fbWidth ||
      canvasYBottom < 0 ||
      canvasYBottom >= fbHeight
    ) {
      console.warn(
        `[Eyedropper] sample coords out of framebuffer: ` +
          `(${canvasX}, ${canvasYBottom}) vs ${fbWidth}x${fbHeight}`,
      );
      return null;
    }
    const gl = this.renderer.getContext();
    const pixel = new Uint8Array(4);
    try {
      gl.readPixels(
        canvasX,
        canvasYBottom,
        1,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        pixel,
      );
    } catch (e) {
      console.warn("[Eyedropper] readPixels failed:", e);
      return null;
    }
    const toHex = (v: number) => v.toString(16).padStart(2, "0");
    return ("#" + toHex(pixel[0]) + toHex(pixel[1]) + toHex(pixel[2])).toLowerCase();
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== "Alt") return;
    if (useMapStore.getState().tool !== "color-paint") return;
    this.canvas.style.cursor = "crosshair";
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.key !== "Alt") return;
    this.canvas.style.cursor = "";
  };

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
    e.preventDefault();

    // EYEDROPPER MODE — Alt+left-click samples the rendered pixel
    // under the cursor and sets it as the active paint color. We
    // intentionally do NOT enter drag mode here; the user releases and
    // can immediately paint with the sampled color on the next click.
    if (e.altKey) {
      const hex = this.sampleColorAt(e.clientX, e.clientY);
      if (hex) {
        const state = useMapStore.getState();
        state.setColorPaintColor(hex);
        _pushColorRecent(hex);
      }
      return;
    }

    const hit = this.screenToWorldHit(e.clientX, e.clientY);
    if (!hit) return;
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
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.canvas.style.cursor = "";
  }
}
