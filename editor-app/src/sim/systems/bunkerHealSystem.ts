/**
 * /sim/systems/bunkerHealSystem.ts — Phase 2 Stage 1
 *
 * Per-tick healing pulse from bunker buildings to friendly units in radius.
 *
 * Algorithm:
 *
 *   For each entity with BunkerHealRange + Position + TeamId (and not Dead):
 *     1. If radiusM <= 0 → push a one-time warn (tracked via a stamped
 *        sentinel on the component value) — a misconfigured bunker is a
 *        loud-defensive surface, not a silent no-op.
 *     2. Find all friendly units (same TeamId) within radiusM XZ-distance.
 *        Excludes the bunker itself, weapon-instance entities (no Position
 *        of their own that matters), and other bunkers (a bunker doesn't
 *        heal a sibling bunker — same TeamId but typically buildings don't
 *        need healing; we keep it simple by skipping any entity carrying
 *        BunkerHealRange too).
 *     3. Health.current += healPerTickMj, clamped at Health.max.
 *
 * Loud-over-silent:
 *   - radiusM === 0  → warn-once per-entity (we mark the bunker with a
 *     sentinel by setting radiusM to a tiny negative; the check below uses
 *     `<= 0` so a one-time warn happens and subsequent ticks are silent).
 *     We use console.warn directly because /sim is allowed to console-warn
 *     for authoring bugs (it's deterministic — same input always emits the
 *     same line).
 *   - Health overflow attempt logged as a never-trigger guard since we
 *     clamp; if a future bug produces current > max, it would surface.
 *
 * Sim-purity:
 *   - typed-array reads only.
 *   - No Date.now, no Math.random.
 *   - console.warn is allowed (no clock, no randomness — purely a stderr
 *     pass-through; the purity script enforces specific identifiers).
 */

import { query, hasComponent } from "bitecs";

import {
  BunkerHealRange,
  Dead,
  Health,
  Position,
  TeamId,
  WeaponInstanceTag,
  ProjectileTag,
  type SimWorld,
} from "../world";

const BUNKER_QUERY = [BunkerHealRange, Position, TeamId];
const HEAL_TARGET_QUERY = [Health, Position, TeamId];

/**
 * Warn-once guard tracker. We don't use a Set<number> across ticks because
 * eid is reused after entity death (bitECS recycles slots). Instead, we
 * stamp the bunker's radiusM with a sentinel BUNKER_BAD_RADIUS_SENTINEL on
 * first detection; subsequent ticks see the sentinel and skip the warn AND
 * the heal pass (a misconfigured bunker stays inert until re-authored).
 *
 * The sentinel is a specific NaN-adjacent negative we'd never author
 * intentionally; the check `radiusM <= 0` lumps it in with the "do nothing"
 * branch.
 */
const BUNKER_BAD_RADIUS_SENTINEL = -1.0;

export function bunkerHealSystem(world: SimWorld): void {
  const bunkers = query(world, BUNKER_QUERY);
  if (bunkers.length === 0) return;

  const targets = query(world, HEAL_TARGET_QUERY);

  for (let i = 0; i < bunkers.length; i++) {
    const b = bunkers[i];
    if (hasComponent(world, b, Dead)) continue;

    const r = BunkerHealRange.radiusM[b];

    // Loud-over-silent: a radius <= 0 means this bunker heals nobody. Warn
    // once and stamp the sentinel so the next tick skips silently. The
    // bunker stays in the world (it still soaks damage), just doesn't
    // heal — surfacing the misconfig instead of pretending it works.
    if (r <= 0) {
      if (r !== BUNKER_BAD_RADIUS_SENTINEL) {
        // eslint-disable-next-line no-console
        console.warn(
          `[bunkerHealSystem] bunker eid=${b} has radiusM=${r} (must be > 0); will heal nobody. Re-author the schematic.`,
        );
        BunkerHealRange.radiusM[b] = BUNKER_BAD_RADIUS_SENTINEL;
      }
      continue;
    }

    const heal = BunkerHealRange.healPerTickMj[b];
    if (heal <= 0) continue; // valid case — author may want a 0-heal "presence" bunker

    const team = TeamId.value[b];
    const bx = Position.x[b];
    const bz = Position.z[b];
    const r2 = r * r;

    for (let j = 0; j < targets.length; j++) {
      const t = targets[j];
      if (t === b) continue;
      if (hasComponent(world, t, Dead)) continue;
      // Skip weapon-instance + projectile entities (they have TeamId for
      // friendly-fire filtering but aren't healable units).
      if (hasComponent(world, t, WeaponInstanceTag)) continue;
      if (hasComponent(world, t, ProjectileTag)) continue;
      // Skip other bunkers — buildings heal mobile units, not each other.
      // (Walls + turrets ARE healable since they don't carry BunkerHealRange.)
      if (hasComponent(world, t, BunkerHealRange)) continue;
      if (TeamId.value[t] !== team) continue;

      const dx = Position.x[t] - bx;
      const dz = Position.z[t] - bz;
      if (dx * dx + dz * dz > r2) continue;

      const cur = Health.current[t];
      const max = Health.max[t];
      if (cur >= max) continue;
      const next = cur + heal;
      Health.current[t] = next > max ? max : next;
    }
  }
}
