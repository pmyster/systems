/**
 * PaintColorCommand — paint a single tick of a color-paint brush onto
 * the terrain's RGBA tint overlay.
 *
 * Buffer layout:
 *   Each pixel is an RGBA quadruple. RGB carries the painted color, A
 *   carries the overlay opacity (0 = no overlay, 255 = full overlay).
 *   The terrain shader samples this texture and blends the painted
 *   color over the existing material+atmosphere mix while preserving
 *   the underlying texture luminance — so bump/PBR detail still reads
 *   through the painted region.
 *
 * Paint math (per pixel inside the brush disc):
 *   opacityDelta = round(255 * strength * gaussianWeight)
 *   if !eraseMode:
 *     RGB := target color (overwrite — simpler than additive blend)
 *     A  := min(255, A + opacityDelta)
 *   if eraseMode:
 *     A  := max(0, A - opacityDelta)
 *     if A == 0: RGB := 0  (don't leak stale color back on re-paint)
 *
 * Merge: two PaintColorCommand instances within the bus's same-kind
 * merge window collapse into one undo entry IFF they share the same
 * target color AND erase mode — otherwise the user logically started a
 * new stroke and should get a fresh undo entry.
 */

import type { Command } from "./Command";
import {
  _accumulateColorPaintDirty,
  useMapStore,
} from "../state/mapStore";

import { forEachPixelInDisc } from "./_diskFalloff";

export interface PaintColorParams {
  /** Color-paint pixel coordinates (NOT world meters). */
  centerPxX: number;
  centerPxY: number;
  radiusPx: number;
  /** 0-1 paint intensity per tick. */
  strength: number;
  /** Target color as 0..255 RGB. */
  color: { r: number; g: number; b: number };
  /** When true, subtract opacity instead of adding. */
  eraseMode: boolean;
}

export class PaintColorCommand implements Command {
  readonly kind = "PaintColor";
  readonly timestamp: number;
  /** key = pixelIdx*4 + channel; value = original byte before any paint. */
  private prevValues = new Map<number, number>();
  private params: PaintColorParams;

  constructor(params: PaintColorParams, timestamp?: number) {
    this.params = params;
    this.timestamp = timestamp ?? Date.now();
  }

  do(): void {
    const state = useMapStore.getState();
    const cp = state.colorPaint;
    const data = cp.data;
    const w = cp.widthPx;
    const h = cp.heightPx;
    const { color, eraseMode } = this.params;
    forEachPixelInDisc(
      this.params.centerPxX,
      this.params.centerPxY,
      this.params.radiusPx,
      w,
      h,
      (idx, weight) => {
        const base = idx * 4;
        const opacityDelta = Math.round(255 * this.params.strength * weight);
        if (opacityDelta === 0) return;
        // Snapshot all 4 bytes (RGB + A) on first touch so undo can
        // restore the exact pre-stroke pixel state regardless of which
        // bytes the stroke ends up mutating.
        for (let c = 0; c < 4; c++) {
          const key = base + c;
          if (!this.prevValues.has(key)) this.prevValues.set(key, data[key]);
        }
        if (eraseMode) {
          data[base + 3] = Math.max(0, data[base + 3] - opacityDelta);
          if (data[base + 3] === 0) {
            // Zero out RGB so a fully-erased pixel doesn't leak its
            // previous color back the next time it's repainted at a
            // different color.
            data[base + 0] = 0;
            data[base + 1] = 0;
            data[base + 2] = 0;
          }
        } else {
          const currentOpacity = data[base + 3];
          const newOpacity = Math.min(255, currentOpacity + opacityDelta);
          // Replace RGB with the target color. Blending would compound
          // mid-stroke into muddy averages — overwrite is what users
          // expect from a color brush.
          data[base + 0] = color.r;
          data[base + 1] = color.g;
          data[base + 2] = color.b;
          data[base + 3] = newOpacity;
        }
        _accumulateColorPaintDirty(idx);
      },
    );
    state._markColorPaintDirty();
  }

  undo(): void {
    const state = useMapStore.getState();
    const data = state.colorPaint.data;
    for (const [key, v] of this.prevValues) {
      data[key] = v;
      _accumulateColorPaintDirty(Math.floor(key / 4));
    }
    state._markColorPaintDirty();
  }

  /**
   * Merge another paint command into this one ONLY when same color +
   * same erase mode. Cross-color and cross-mode strokes stay separate so
   * the undo timeline matches user intuition ("undo took back my red
   * stroke, not the green one").
   *
   * Like PaintMaterialCommand we keep the EARLIEST `prevValues[key]` so
   * a pixel re-touched multiple times still undoes to its true
   * pre-stroke state.
   */
  merge(other: Command): boolean {
    if (!(other instanceof PaintColorCommand)) return false;
    const p = other.params;
    if (
      p.color.r !== this.params.color.r ||
      p.color.g !== this.params.color.g ||
      p.color.b !== this.params.color.b
    ) {
      return false;
    }
    if (p.eraseMode !== this.params.eraseMode) return false;
    for (const [k, v] of other.prevValues) {
      if (!this.prevValues.has(k)) this.prevValues.set(k, v);
    }
    return true;
  }
}
