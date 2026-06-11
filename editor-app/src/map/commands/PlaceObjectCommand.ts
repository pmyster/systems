/**
 * PlaceObjectCommand — adds an InstanceObject to the store.
 *
 * The full object (including id) is captured at construction so the
 * undo→redo cycle never regenerates an id. Stability matters because
 * other systems (selection, future bindings) may already be referencing
 * the id after redo.
 *
 * The id is the responsibility of the caller — typically via
 * `crypto.randomUUID()`. We do NOT regenerate here.
 */

import type { Command } from "./Command";
import { mapStore } from "../state/mapStore";
import type { InstanceObject } from "../state/mapStore";

export class PlaceObjectCommand implements Command {
  readonly kind = "PlaceObject";
  readonly timestamp: number;
  private readonly object: InstanceObject;

  constructor(object: InstanceObject, timestamp?: number) {
    this.object = object;
    this.timestamp = timestamp ?? Date.now();
  }

  do(): void {
    const { objects, _setObjects } = mapStore.getState();
    _setObjects({ ...objects, [this.object.id]: this.object });
  }

  undo(): void {
    const { objects, _setObjects } = mapStore.getState();
    if (!(this.object.id in objects)) return;
    const next = { ...objects };
    delete next[this.object.id];
    _setObjects(next);
  }
}
