/**
 * /sim/events.ts — Phase 1 Week 3
 *
 * Per-tick event log. Sim systems APPEND events here; render-side
 * consumers READ + CLEAR them once per frame.
 *
 * Why a flat array, not a pub-sub bus?
 *   - Render-side may run 0..N frames per sim tick (the clock is fixed,
 *     RAF is variable). A flat append-and-drain model lets the renderer
 *     consume "all events that landed since I last looked" without
 *     subscription bookkeeping.
 *   - Determinism: events are produced in deterministic system order;
 *     the log shape is identical for identical inputs. Render-side use
 *     is observation-only — events never feed back into sim state.
 *
 * Loud-over-silent:
 *   - drainAll() returns a defensive copy so callers can't accidentally
 *     hold a reference past clear().
 *   - Unknown event kinds in a consumer's switch should `console.warn`
 *     not silently skip (see ProjectileRenderer for the pattern).
 *
 * Sim-purity safe: no Three.js, no Date.now, no Math.random. Plain
 * primitives only.
 */

import type { ArmorZone } from "../types/vulnerability";

/** All event payloads use plain primitives so this module stays /sim-pure. */
export type SimEvent =
  /** A weapon fired a shot — render-side spawns a muzzle flash here. */
  | {
      readonly kind: "weapon_fired";
      readonly tick: number;
      readonly weaponEid: number;
      readonly ownerEid: number;
      readonly hardpointIdx: number;
      readonly x: number;
      readonly y: number;
      readonly z: number;
    }
  /** Projectile born this tick — render-side may spawn a tracer mesh. */
  | {
      readonly kind: "projectile_spawned";
      readonly tick: number;
      readonly projectileEid: number;
      readonly kindByte: number; // DeliveryKindValue
      readonly x: number;
      readonly y: number;
      readonly z: number;
      readonly tx: number;
      readonly ty: number;
      readonly tz: number;
    }
  /** Projectile despawned (impacted, ran out of range, or beam EOL). */
  | {
      readonly kind: "projectile_despawned";
      readonly tick: number;
      readonly projectileEid: number;
    }
  /** A unit got hit. Render-side draws decal + damage number. */
  | {
      readonly kind: "impact";
      readonly tick: number;
      readonly targetEid: number;
      readonly attackerEid: number;
      readonly x: number;
      readonly y: number;
      readonly z: number;
      readonly damage: number;
      readonly hitZone: ArmorZone;
    }
  /** A unit died this tick. Render-side switches to rubble mesh. */
  | {
      readonly kind: "death";
      readonly tick: number;
      readonly entityEid: number;
      readonly teamId: number;
    }
  /**
   * A ballistic projectile entered terrain — the hill / mountain
   * intercepted it before it reached its locked target. Render-side
   * spawns a ground scorch decal at (x, y, z). NO damage is applied —
   * the impactSystem never sees this event.
   *
   * Loud-over-silent: every blocked shot fires this event so the HUD's
   * "Terrain impacts: N" counter ticks up and the owner can SEE that
   * the hill is doing real work.
   */
  | {
      readonly kind: "projectile_impact_terrain";
      readonly tick: number;
      readonly projectileEid: number;
      readonly schemaId: number;
      readonly x: number;
      readonly y: number;
      readonly z: number;
    }
  /**
   * A beam projectile's instant raycast hit the terrain before reaching
   * its locked target — line-of-sight blocked by a hill. Render-side
   * spawns the same scorch decal type as projectile_impact_terrain.
   * NO damage applies. Separate event kind (not a flag on impact) so
   * the HUD counter can split them later if useful.
   */
  | {
      readonly kind: "beam_blocked_by_terrain";
      readonly tick: number;
      readonly projectileEid: number;
      readonly schemaId: number;
      readonly x: number;
      readonly y: number;
      readonly z: number;
    };

/**
 * Per-world event log. Owned by SimRunner so render-side can hold a
 * stable reference across frames. Drained by the runtime view each RAF
 * frame.
 */
export class SimEventLog {
  private events: SimEvent[] = [];

  push(e: SimEvent): void {
    this.events.push(e);
  }

  /** Read-only view of pending events. Does NOT clear. */
  peek(): readonly SimEvent[] {
    return this.events;
  }

  /**
   * Pop everything currently in the log. The caller takes ownership of
   * the returned array; subsequent push() calls go into a fresh buffer.
   */
  drainAll(): SimEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  /** Test-only / hard-reset helper. */
  clear(): void {
    this.events.length = 0;
  }

  size(): number {
    return this.events.length;
  }
}
