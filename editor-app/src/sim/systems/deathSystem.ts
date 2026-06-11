/**
 * /sim/systems/deathSystem.ts — Phase 1 Week 3
 *
 * Walks every entity tagged Dead. For each:
 *   - Emit a "death" event on the FIRST tick of being dead (so the
 *     render side can spawn rubble exactly once).
 *   - After DESPAWN_DELAY_TICKS ticks, remove the entity so its
 *     instance slot can be reused.
 *
 * The "first tick" detection compares Dead.atTick against the
 * current tick. Subsequent ticks see Dead.atTick < currentTick and
 * skip the event emission.
 *
 * Weapon-instance children of a dead unit are NOT removed here — they
 * become inert (weaponFireSystem checks owner Dead/Health each tick
 * and skips) until the owner's despawn timer fires. At that point we
 * also despawn the weapon entities so the world doesn't leak.
 *
 * Sim-purity: typed-array reads only.
 */

import { hasComponent, query, removeEntity } from "bitecs";

import type { SimEventLog } from "../events";
import {
  Dead,
  OwnerEid,
  TeamId,
  WeaponInstanceTag,
  type SimWorld,
} from "../world";

/**
 * Sim ticks (1/30 sec each) to keep a dead entity around for visuals.
 * 60 ticks = 2 seconds — enough for a rubble decal animation.
 */
export const DESPAWN_DELAY_TICKS = 60;

const DEAD_QUERY = [Dead];

export function deathSystem(
  world: SimWorld,
  events: SimEventLog,
  currentTick: number,
): void {
  const dead = query(world, DEAD_QUERY);
  if (dead.length === 0) return;

  for (let i = 0; i < dead.length; i++) {
    const eid = dead[i];
    const atTick = Dead.atTick[eid];

    // First tick of death — emit event.
    if (atTick === currentTick) {
      events.push({
        kind: "death",
        tick: currentTick,
        entityEid: eid,
        teamId: hasComponent(world, eid, TeamId) ? TeamId.value[eid] : 0,
      });
    }

    // Despawn window elapsed: remove the entity. Also clean up any
    // owned WeaponInstance entities so they don't leak.
    if (currentTick - atTick >= DESPAWN_DELAY_TICKS) {
      const weapons = query(world, [WeaponInstanceTag, OwnerEid]);
      for (let j = 0; j < weapons.length; j++) {
        const w = weapons[j];
        if (OwnerEid.value[w] === eid) {
          removeEntity(world, w);
        }
      }
      removeEntity(world, eid);
    }
  }
}
