/**
 * /sim/systems/targetAcquisitionSystem.ts — Phase 1 Week 3
 *
 * Per A.3 of synthesis: per-hardpoint targeting. Each WeaponInstance
 * entity acquires its OWN target. The owning unit's TargetOf reflects
 * the "primary" target (any weapon's target) so stanceSystem can
 * derive pursuit destinations from it.
 *
 * Algorithm:
 *
 *   For each weapon instance with a valid owner not in HoldFire stance:
 *     1. If WeaponTarget is already valid AND target is alive AND
 *        target is inside ScanRange AND not on our team → keep it
 *        (anti-thrash). Else clear.
 *     2. Scan all units with the OPPOSING TeamId within ScanRange.
 *        Compute a utility score for each candidate:
 *
 *          score = w_match * effectivenessVsZone
 *                + w_focus * (1 - health.current/max)
 *                + w_prox  * (1 - dist / scan_range)
 *
 *        where effectivenessVsZone is a quick lookup of the front-zone
 *        matchup from the damage table (the side/rear cone is too
 *        position-dependent to precompute here — pickHitZone runs at
 *        impact time).
 *     3. Best candidate above threshold wins. Else clear.
 *
 * Sim-purity: typed-array reads only. No clocks, no Math.random.
 */

import { query, hasComponent, addComponent } from "bitecs";

import {
  Dead,
  Health,
  InCombat,
  OwnerEid,
  Position,
  ScanRange,
  Stance,
  StanceValue,
  TargetOf,
  TeamId,
  UnitTypeId,
  WeaponInstanceTag,
  WeaponRange,
  WeaponTarget,
  Renderable,
  NO_ENTITY,
  type SimWorld,
} from "../world";

// Weights tuned so proximity dominates at long range, focus-fire takes
// over once an enemy is wounded, and matchup nudges the choice between
// two equidistant equal-health enemies. Sum should be ~1.0 for
// intuition; absolute scale doesn't matter — only relative ranking.
const W_MATCHUP = 0.25;
const W_FOCUS = 0.3;
const W_PROX = 0.45;

/** Minimum score below which we consider "no acceptable target". */
const MIN_ACQUIRE_SCORE = 0.2;

const UNIT_QUERY = [TeamId, Position, Health, Renderable, UnitTypeId];
const WEAPON_QUERY = [WeaponInstanceTag, OwnerEid, WeaponTarget, WeaponRange];

export function targetAcquisitionSystem(world: SimWorld): void {
  const allUnits = query(world, UNIT_QUERY);
  // Build per-team lookup once — small lists, cheap, avoids O(N²).
  // We could use a uniform grid for big maps; Phase 1 has ≤ ~100
  // entities so a flat list is fast enough.
  const aliveByTeam = new Map<number, number[]>();
  for (let i = 0; i < allUnits.length; i++) {
    const eid = allUnits[i];
    if (hasComponent(world, eid, Dead)) continue;
    if (Health.current[eid] <= 0) continue;
    if (hasComponent(world, eid, WeaponInstanceTag)) continue; // skip weapon entities
    const t = TeamId.value[eid];
    let list = aliveByTeam.get(t);
    if (!list) {
      list = [];
      aliveByTeam.set(t, list);
    }
    list.push(eid);
  }

  const weapons = query(world, WEAPON_QUERY);

  for (let i = 0; i < weapons.length; i++) {
    const w = weapons[i];
    const owner = OwnerEid.value[w];
    if (owner === NO_ENTITY) {
      WeaponTarget.value[w] = NO_ENTITY;
      continue;
    }
    // HoldFire owners had their WeaponTarget cleared by stanceSystem;
    // skip them to save the scan.
    if (Stance.value[owner] === StanceValue.HoldFire) {
      WeaponTarget.value[w] = NO_ENTITY;
      continue;
    }
    if (hasComponent(world, owner, Dead)) {
      WeaponTarget.value[w] = NO_ENTITY;
      continue;
    }

    const ownerTeam = TeamId.value[owner];
    const ox = Position.x[owner];
    const oz = Position.z[owner];
    const scan = ScanRange.value[owner];
    const scan2 = scan * scan;

    // Anti-thrash: validate existing target.
    const existing = WeaponTarget.value[w];
    let keepExisting = false;
    if (existing !== NO_ENTITY) {
      const stillAlive =
        !hasComponent(world, existing, Dead) &&
        Health.current[existing] > 0 &&
        TeamId.value[existing] !== ownerTeam;
      if (stillAlive) {
        const dx = Position.x[existing] - ox;
        const dz = Position.z[existing] - oz;
        if (dx * dx + dz * dz <= scan2) keepExisting = true;
      }
    }

    let bestEid = keepExisting ? existing : NO_ENTITY;
    let bestScore = keepExisting ? MIN_ACQUIRE_SCORE : 0;

    // Scan every opposing-team alive unit.
    for (const [teamId, list] of aliveByTeam) {
      if (teamId === ownerTeam) continue;
      for (let j = 0; j < list.length; j++) {
        const cand = list[j];
        if (cand === owner) continue;
        const dx = Position.x[cand] - ox;
        const dz = Position.z[cand] - oz;
        const d2 = dx * dx + dz * dz;
        if (d2 > scan2) continue;
        const dist = Math.sqrt(d2);

        // Score components.
        // proximity: 1 at zero distance → 0 at scan range.
        const prox = 1 - dist / Math.max(scan, 0.001);

        // focus-fire: bias toward wounded enemies.
        const hMax = Math.max(Health.max[cand], 1);
        const focus = 1 - Health.current[cand] / hMax;

        // matchup: front-zone proxy. Since we don't know the impact
        // hit zone here (depends on impact-time geometry), we use a
        // neutral 1.0 — the damage formula picks zone at impact. A
        // more elaborate scorer would peek at the target's front
        // material and bias kinetic vs energy weapons; v1 keeps it
        // simple.
        const matchup = 1.0;

        const score =
          W_MATCHUP * matchup + W_FOCUS * focus + W_PROX * prox;

        if (score > bestScore) {
          bestScore = score;
          bestEid = cand;
        }
      }
    }

    WeaponTarget.value[w] = bestEid;

    // Mirror to the owning unit. We pick the FIRST weapon's target each
    // pass — over multiple ticks this stabilises on the primary target.
    // (TargetOf is informational for stanceSystem's pursuit logic.)
    if (bestEid !== NO_ENTITY) {
      // Only overwrite TargetOf if the current one is dead or NO_ENTITY,
      // so the unit's primary target doesn't ping-pong between weapons.
      const cur = TargetOf.value[owner];
      const curValid =
        cur !== NO_ENTITY &&
        !hasComponent(world, cur, Dead) &&
        Health.current[cur] > 0;
      if (!curValid) {
        TargetOf.value[owner] = bestEid;
      }
      if (!hasComponent(world, owner, InCombat)) {
        addComponent(world, owner, InCombat);
      }
    }
  }

  // Final pass: any unit whose TargetOf points at a dead entity needs a
  // cleanup. (Acquisition may have skipped this owner if every weapon
  // was overheat-locked.)
  for (let i = 0; i < allUnits.length; i++) {
    const eid = allUnits[i];
    if (hasComponent(world, eid, WeaponInstanceTag)) continue;
    const t = TargetOf.value[eid];
    if (t === NO_ENTITY) continue;
    if (hasComponent(world, t, Dead) || Health.current[t] <= 0) {
      TargetOf.value[eid] = NO_ENTITY;
    }
  }
}
