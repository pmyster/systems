/**
 * RaiseTerrainCommand — applies a positive Gaussian-disc delta to the
 * heightmap and remembers the pre-edit AND post-edit value for each
 * touched pixel so do/undo/redo are all exact and merge-safe.
 *
 * Why both prev AND next snapshots:
 *   - `undo()` restores prev — straightforward.
 *   - `redo()` after multiple merges must replay the FULL accumulated
 *     stroke, not just the first sub-stroke. If we kept only the first
 *     params, redo would lose all the later brush-drag steps. Storing
 *     `nextHeights` alongside `prevHeights` makes redo equivalent to
 *     "copy nextHeights back into the heightmap" — cheap and exact.
 *
 * Lazy snapshot:
 *   `prevHeights` only stores the FIRST value seen at each index across
 *   the whole merged stroke. `nextHeights` is always the most recent
 *   applied value. That way after a long drag, undo restores the
 *   pre-stroke surface in one step.
 */

import type { Command } from "./Command";
import { mapStore, _accumulateDirty } from "../state/mapStore";
import { HEIGHTMAP_M_PER_PIXEL } from "../coords/constants";
import { forEachPixelInDisc } from "./_diskFalloff";

export interface RaiseTerrainParams {
  /** Brush center in world meters (X, Z). */
  worldX: number;
  worldZ: number;
  /** Brush radius in world meters. */
  radiusM: number;
  /** Peak height delta in meters (positive raises). */
  strength: number;
  /** ms-since-epoch for merge windowing. Defaults to Date.now(). */
  timestamp?: number;
}

export class RaiseTerrainCommand implements Command {
  readonly kind: string = "RaiseTerrain";
  readonly timestamp: number;
  private readonly prevHeights = new Map<number, number>();
  private readonly nextHeights = new Map<number, number>();
  /** Has the first `do()` already happened? */
  private firstApplied = false;

  constructor(private readonly initialParams: RaiseTerrainParams) {
    this.timestamp = initialParams.timestamp ?? Date.now();
  }

  do(): void {
    if (!this.firstApplied) {
      // First-time application — actually compute the stroke.
      this.applyStroke(this.initialParams);
      this.firstApplied = true;
    } else {
      // Redo path — copy `nextHeights` back into the heightmap.
      const { terrain, _markTerrainDirty } = mapStore.getState();
      const heightmap = terrain.heightmap;
      for (const [idx, next] of this.nextHeights) {
        heightmap[idx] = next;
        _accumulateDirty(idx);
      }
      _markTerrainDirty();
    }
  }

  undo(): void {
    const { terrain, _markTerrainDirty } = mapStore.getState();
    const heightmap = terrain.heightmap;
    for (const [idx, prev] of this.prevHeights) {
      heightmap[idx] = prev;
      _accumulateDirty(idx);
    }
    _markTerrainDirty();
  }

  merge(other: Command): boolean {
    if (!(other instanceof RaiseTerrainCommand)) return false;
    // Apply the other command's effect through THIS command's snapshot
    // maps so the merged history stays consistent.
    this.applyStroke(other.initialParams);
    return true;
  }

  /**
   * Apply a single brush-stroke step: walks the disc, captures pre-edit
   * heights into `prevHeights` (only the FIRST time each index is seen),
   * mutates the heightmap, then records the post-edit value into
   * `nextHeights`.
   *
   * Sign convention: positive `strength` raises. Lower is the same code
   * with negated strength — see LowerTerrainCommand for the wrapper.
   */
  protected applyStroke(p: RaiseTerrainParams): void {
    const { terrain, _markTerrainDirty } = mapStore.getState();
    const { widthPx, heightPx, heightmap } = terrain;
    const cx = p.worldX / HEIGHTMAP_M_PER_PIXEL;
    const cy = p.worldZ / HEIGHTMAP_M_PER_PIXEL;
    const rPx = p.radiusM / HEIGHTMAP_M_PER_PIXEL;
    const peak = p.strength;
    forEachPixelInDisc(cx, cy, rPx, widthPx, heightPx, (idx, w) => {
      if (!this.prevHeights.has(idx)) {
        this.prevHeights.set(idx, heightmap[idx]);
      }
      const newVal = heightmap[idx] + peak * w;
      heightmap[idx] = newVal;
      this.nextHeights.set(idx, newVal);
      _accumulateDirty(idx);
    });
    _markTerrainDirty();
  }
}
