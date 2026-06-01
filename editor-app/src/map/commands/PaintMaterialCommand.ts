/**
 * PaintMaterialCommand — paint a single tick of a splatmap brush.
 *
 * Splatmap layout reminder:
 *   Each pixel is an RGBA quadruple. Channel = weight for one of 4
 *   hardcoded materials (R=grass, G=dirt, B=sand, A=scorched). A
 *   pixel's "active" material is the one with the highest weight; the
 *   shader normalizes the channels and blends material colors.
 *
 * Paint math (per pixel inside the brush disc):
 *   delta = round(255 * strength * gaussianWeight)
 *   target channel += delta   (capped at 255)
 *   each other channel -= round(delta * (currentValue / 255) / 3)
 *   (other channels can't go below 0)
 *
 * The non-target reduction is proportional so a pixel that's already
 * majority-target keeps its bias, and we don't blow past 255 in
 * aggregate. Pure "replace" semantics would feel too aggressive — the
 * gradient between materials is the whole reason a splatmap exists.
 *
 * Merge: two PaintMaterialCommand instances within the bus's 500ms
 * window collapse into one undo entry IFF they paint the same material.
 * Cross-material strokes get separate entries — feels right for the
 * undo model.
 */

import type { Command } from "./Command";
import {
  _accumulateSplatDirty,
  type MaterialIndex,
  useMapStore,
} from "../state/mapStore";

import { forEachPixelInDisc } from "./_diskFalloff";

export interface PaintMaterialParams {
  /** Splatmap pixel coordinates (NOT world meters). */
  centerPxX: number;
  centerPxY: number;
  radiusPx: number;
  /** 0-1 paint intensity per tick. */
  strength: number;
  materialIndex: MaterialIndex;
}

export class PaintMaterialCommand implements Command {
  readonly kind = "PaintMaterial";
  readonly timestamp: number;
  /** key = pixelIdx*4 + channel; value = original byte before any paint. */
  private prevValues = new Map<number, number>();
  private params: PaintMaterialParams;

  constructor(params: PaintMaterialParams, timestamp?: number) {
    this.params = params;
    this.timestamp = timestamp ?? Date.now();
  }

  do(): void {
    const state = useMapStore.getState();
    const sm = state.splatmap;
    const data = sm.data;
    const w = sm.widthPx;
    const h = sm.heightPx;
    const targetCh = this.params.materialIndex;
    const baseStrength = this.params.strength;
    forEachPixelInDisc(
      this.params.centerPxX,
      this.params.centerPxY,
      this.params.radiusPx,
      w,
      h,
      (idx, weight) => {
        const base = idx * 4;
        const delta = Math.round(255 * baseStrength * weight);
        if (delta === 0) return;
        for (let c = 0; c < 4; c++) {
          const key = base + c;
          if (!this.prevValues.has(key)) this.prevValues.set(key, data[key]);
          if (c === targetCh) {
            data[key] = Math.min(255, data[key] + delta);
          } else {
            // Proportional reduction — pixels already non-target take a
            // bigger hit than pixels that were already mostly target.
            const reduce = Math.round((delta * data[key]) / 255 / 3);
            data[key] = Math.max(0, data[key] - reduce);
          }
        }
        _accumulateSplatDirty(idx);
      },
    );
    state._markSplatmapDirty();
  }

  undo(): void {
    const state = useMapStore.getState();
    const data = state.splatmap.data;
    for (const [key, v] of this.prevValues) {
      data[key] = v;
      _accumulateSplatDirty(Math.floor(key / 4));
    }
    state._markSplatmapDirty();
  }

  /**
   * Merge another paint command into this one if same material. We keep
   * the EARLIEST `prevValues[key]` so a stroke that paints the same
   * pixel multiple times still undoes back to its true pre-stroke state.
   */
  merge(other: Command): boolean {
    if (!(other instanceof PaintMaterialCommand)) return false;
    if (other.params.materialIndex !== this.params.materialIndex) return false;
    for (const [k, v] of other.prevValues) {
      if (!this.prevValues.has(k)) this.prevValues.set(k, v);
    }
    return true;
  }
}
