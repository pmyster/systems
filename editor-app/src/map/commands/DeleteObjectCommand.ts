/**
 * DeleteObjectCommand — removes an InstanceObject from the store.
 *
 * The full pre-delete snapshot is captured at construction so undo
 * restores the SAME object (same id, same prefab, same transform,
 * same properties). This is the symmetric inverse of PlaceObjectCommand.
 */

import type { Command } from "./Command";
import { mapStore } from "../state/mapStore";
import type { InstanceObject } from "../state/mapStore";

export class DeleteObjectCommand implements Command {
  readonly kind = "DeleteObject";
  readonly timestamp: number;
  private readonly snapshot: InstanceObject;

  /**
   * Pass either an object id (we'll snapshot from the store now) or a
   * full InstanceObject (already-snapshot). The id-form is safer because
   * it can't go stale between construction and `do()`.
   */
  constructor(idOrObject: string | InstanceObject, timestamp?: number) {
    if (typeof idOrObject === "string") {
      const { objects } = mapStore.getState();
      const found = objects[idOrObject];
      if (!found) {
        throw new Error(
          `DeleteObjectCommand: no object with id ${idOrObject} in store`,
        );
      }
      this.snapshot = found;
    } else {
      this.snapshot = idOrObject;
    }
    this.timestamp = timestamp ?? Date.now();
  }

  do(): void {
    const { objects, _setObjects } = mapStore.getState();
    if (!(this.snapshot.id in objects)) return;
    const next = { ...objects };
    delete next[this.snapshot.id];
    _setObjects(next);
  }

  undo(): void {
    const { objects, _setObjects } = mapStore.getState();
    _setObjects({ ...objects, [this.snapshot.id]: this.snapshot });
  }
}
