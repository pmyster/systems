/**
 * LowerTerrainCommand — identical shape to RaiseTerrainCommand but
 * inverts the sign of `strength` before applying.
 *
 * Kept as a separate command kind (rather than just feeding a negative
 * strength to Raise) so:
 *   1. Undo history shows "Lower" vs "Raise" rather than just "sculpt".
 *   2. Merge windowing won't accidentally combine a raise and a lower
 *     stroke (different `kind` strings -> they can't merge).
 */

import type { Command } from "./Command";
import {
  RaiseTerrainCommand,
  type RaiseTerrainParams,
} from "./RaiseTerrainCommand";

export type LowerTerrainParams = RaiseTerrainParams;

export class LowerTerrainCommand extends RaiseTerrainCommand {
  readonly kind: string = "LowerTerrain";

  constructor(params: LowerTerrainParams) {
    super({ ...params, strength: -params.strength });
  }

  // Override merge to only accept other LowerTerrainCommands.
  merge(other: Command): boolean {
    if (!(other instanceof LowerTerrainCommand)) return false;
    return super.merge(other);
  }
}
