/**
 * /sim/systems/stanceSystem.ts — Phase 1 Week 3
 *
 * Per-tick stance enforcement. Runs BEFORE targetAcquisitionSystem so
 * the acquisition pass sees an already-cleared TargetOf on HoldFire
 * units, and so Aggressive units have their leash bumped before
 * pursuit is computed.
 *
 * Stance enum (from world.ts):
 *   0 Aggressive — pursue up to 1.5× ScanRange
 *   1 Defensive  — pursue up to 0.5× ScanRange (the brief's default)
 *   2 HoldGround — fire from current spot, never pursue
 *   3 HoldFire   — never fire (clears every owned WeaponTarget + TargetOf)
 *
 * Pursuit is realised by writing MovementTarget on the unit when its
 * acquired target's distance exceeds weapon range but is inside the
 * leash radius. The actual XZ stepping is performed by movementSystem
 * later in the tick — stanceSystem only sets the destination.
 *
 * Sim-purity: no Date.now / Math.random / Three.js. Pure typed-array
 * reads.
 */

import { query } from "bitecs";

import {
  InCombat,
  LeashOrigin,
  MovementTarget,
  OwnerEid,
  Position,
  ScanRange,
  Stance,
  StanceValue,
  TargetOf,
  WeaponInstanceTag,
  WeaponTarget,
  NO_ENTITY,
  type SimWorld,
} from "../world";
import { removeComponent } from "bitecs";

const UNIT_QUERY = [Position, Stance, ScanRange, LeashOrigin, TargetOf];
const WEAPON_QUERY = [WeaponInstanceTag, OwnerEid, WeaponTarget];

/**
 * Leash multiplier per stance. Defensive (the default) uses 0.5×
 * ScanRange per the brief; Aggressive 1.5×; HoldGround 0 (no pursuit);
 * HoldFire 0 (no engagement at all).
 */
function leashMultiplier(stance: number): number {
  switch (stance) {
    case StanceValue.Aggressive:
      return 1.5;
    case StanceValue.Defensive:
      return 0.5;
    case StanceValue.HoldGround:
      return 0; // engage in range but never chase
    case StanceValue.HoldFire:
      return 0;
    default:
      return 0.5; // adaptive default
  }
}

export function stanceSystem(world: SimWorld): void {
  // First pass: HoldFire units clear their TargetOf and every owned
  // weapon's WeaponTarget. We do this BEFORE the pursuit pass so a unit
  // freshly switched to HoldFire doesn't keep chasing.
  const units = query(world, UNIT_QUERY);
  for (let i = 0; i < units.length; i++) {
    const eid = units[i];
    if (Stance.value[eid] === StanceValue.HoldFire) {
      TargetOf.value[eid] = NO_ENTITY;
      // Tag-clear: drop InCombat if present. removeComponent is a
      // no-op when the component isn't present, so this is safe.
      removeComponent(world, eid, InCombat);
    }
  }

  // Clear WeaponTarget on weapons whose owner is HoldFire.
  const weapons = query(world, WEAPON_QUERY);
  for (let i = 0; i < weapons.length; i++) {
    const w = weapons[i];
    const owner = OwnerEid.value[w];
    if (owner === NO_ENTITY) continue;
    if (Stance.value[owner] === StanceValue.HoldFire) {
      WeaponTarget.value[w] = NO_ENTITY;
    }
  }

  // Second pass: pursuit. For each unit with a valid target that's
  // outside weapon range but inside the leash circle, set MovementTarget
  // to the target's current XZ position. HoldGround skips this. Inside
  // weapon range (best estimate = 0.4 × ScanRange — finer tuning is
  // per-weapon, not unit-wide), clear hasTarget so the unit stops to
  // shoot.
  for (let i = 0; i < units.length; i++) {
    const eid = units[i];
    const stance = Stance.value[eid];
    if (stance === StanceValue.HoldFire) continue;

    const tgt = TargetOf.value[eid];
    if (tgt === NO_ENTITY) continue;

    const px = Position.x[eid];
    const pz = Position.z[eid];
    const tx = Position.x[tgt];
    const tz = Position.z[tgt];
    const dx = tx - px;
    const dz = tz - pz;
    const distToTarget2 = dx * dx + dz * dz;

    // "Engagement range" = roughly the closer arc inside which we stop
    // and fire. Use 0.5 × ScanRange as a "weapons can reach" proxy —
    // weaponFireSystem already gates true firing on per-weapon range
    // and overheat. Pragmatic and matches the synthesis brief.
    const scan = ScanRange.value[eid];
    const fireBand = scan * 0.5;
    if (distToTarget2 < fireBand * fireBand) {
      // In range: stop pursuing.
      MovementTarget.hasTarget[eid] = 0;
      continue;
    }

    // Out of fire band — pursuit only if stance allows AND target is
    // inside the leash circle from LeashOrigin.
    const mult = leashMultiplier(stance);
    if (mult <= 0) {
      MovementTarget.hasTarget[eid] = 0;
      continue;
    }
    const leashR = scan * mult;
    const lx = LeashOrigin.x[eid];
    const lz = LeashOrigin.z[eid];
    const ldx = tx - lx;
    const ldz = tz - lz;
    const targetFromLeash2 = ldx * ldx + ldz * ldz;
    if (targetFromLeash2 > leashR * leashR) {
      // Target outside leash — refuse pursuit, drop target.
      TargetOf.value[eid] = NO_ENTITY;
      MovementTarget.hasTarget[eid] = 0;
      removeComponent(world, eid, InCombat);
      continue;
    }

    // Pursue.
    MovementTarget.x[eid] = tx;
    MovementTarget.y[eid] = 0;
    MovementTarget.z[eid] = tz;
    MovementTarget.hasTarget[eid] = 1;
  }
}
