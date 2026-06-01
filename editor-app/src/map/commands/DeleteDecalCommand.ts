/**
 * DeleteDecalCommand — removes a DecalInstance from the store.
 *
 * Mirrors DeleteObjectCommand: full pre-delete snapshot captured at
 * construction so undo restores the SAME decal (same id, transform, etc).
 */

import type { Command } from "./Command";
import { mapStore } from "../state/mapStore";
import type { DecalInstance } from "../state/mapStore";

export class DeleteDecalCommand implements Command {
  readonly kind = "DeleteDecal";
  readonly timestamp: number;
  private readonly snapshot: DecalInstance;

  /**
   * Pass either an id (snapshotted from the store NOW) or a full decal
   * (already-snapshotted). The id-form is the safer default.
   */
  constructor(idOrDecal: string | DecalInstance, timestamp?: number) {
    if (typeof idOrDecal === "string") {
      const { decals } = mapStore.getState();
      const found = decals[idOrDecal];
      if (!found) {
        throw new Error(
          `DeleteDecalCommand: no decal with id ${idOrDecal} in store`,
        );
      }
      this.snapshot = found;
    } else {
      this.snapshot = idOrDecal;
    }
    this.timestamp = timestamp ?? Date.now();
  }

  do(): void {
    const { decals, _setDecals } = mapStore.getState();
    if (!(this.snapshot.id in decals)) return;
    const next = { ...decals };
    delete next[this.snapshot.id];
    _setDecals(next);
  }

  undo(): void {
    const { decals, _setDecals } = mapStore.getState();
    _setDecals({ ...decals, [this.snapshot.id]: this.snapshot });
  }
}
