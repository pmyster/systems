/**
 * PlaceDecalCommand — adds a DecalInstance to the store.
 *
 * Mirrors PlaceObjectCommand exactly: the full snapshot (including id) is
 * captured at construction so undo→redo never regenerates an id. Stable
 * ids matter because selection / future bindings can reference them.
 */

import type { Command } from "./Command";
import { mapStore } from "../state/mapStore";
import type { DecalInstance } from "../state/mapStore";

export class PlaceDecalCommand implements Command {
  readonly kind = "PlaceDecal";
  readonly timestamp: number;
  private readonly decal: DecalInstance;

  constructor(decal: DecalInstance, timestamp?: number) {
    this.decal = decal;
    this.timestamp = timestamp ?? Date.now();
  }

  do(): void {
    const { decals, _setDecals } = mapStore.getState();
    _setDecals({ ...decals, [this.decal.id]: this.decal });
  }

  undo(): void {
    const { decals, _setDecals } = mapStore.getState();
    if (!(this.decal.id in decals)) return;
    const next = { ...decals };
    delete next[this.decal.id];
    _setDecals(next);
  }
}
