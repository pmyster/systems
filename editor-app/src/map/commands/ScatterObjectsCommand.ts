/**
 * ScatterObjectsCommand — bulk-place command for the Scatter brush.
 *
 * One scatter drag emits many "ticks"; each tick spawns N instances in a
 * disc around the cursor. Rather than push a PlaceObjectCommand per
 * instance (the undo history would balloon and `Ctrl+Z` would only roll
 * back a tiny fraction of one drag), we keep all instances spawned in a
 * single drag inside ONE ScatterObjectsCommand via `merge()`.
 *
 * Merge policy:
 *   - CommandBus only attempts merges when two consecutive commands share
 *     `kind` AND fall inside its mergeWindowMs (500ms). Scatter ticks fire
 *     every ~80ms while dragging, so every tick rolls into the leading
 *     command — one drag = one undo entry.
 *   - When the drag pauses for >500ms, a fresh command starts and the
 *     user gets a separate undo entry. That's intentional: a long pause
 *     is a deliberate handoff between scatter "passes".
 *
 * Snapshot semantics:
 *   The command owns FULL InstanceObject snapshots (including UUIDs),
 *   identical to PlaceObjectCommand. Undo deletes every snapshot's id
 *   from the store; redo re-inserts the same snapshots. UUIDs are stable
 *   across undo→redo cycles — other systems holding references survive.
 */

import type { Command } from "./Command";
import { useMapStore, type InstanceObject } from "../state/mapStore";

export class ScatterObjectsCommand implements Command {
  readonly kind = "scatterObjects";
  readonly timestamp = performance.now();
  /**
   * All instances belonging to this scatter drag. Grows as `merge()` folds
   * in subsequent ticks. The array is internal — callers never see it.
   */
  private readonly instances: InstanceObject[];

  constructor(params: { instances: InstanceObject[] }) {
    this.instances = params.instances;
  }

  do(): void {
    const state = useMapStore.getState();
    const next = { ...state.objects };
    for (const inst of this.instances) next[inst.id] = inst;
    state._setObjects(next);
  }

  undo(): void {
    const state = useMapStore.getState();
    const next = { ...state.objects };
    for (const inst of this.instances) delete next[inst.id];
    state._setObjects(next);
  }

  merge(other: Command): boolean {
    if (other instanceof ScatterObjectsCommand) {
      this.instances.push(...other.instances);
      return true;
    }
    return false;
  }
}
