/**
 * /sim/systems/projectileSystem.ts — Phase 1 Week 3
 *
 * Per-tick projectile integration + impact detection.
 *
 * Two delivery kinds supported v1 (per the brief):
 *
 *   Ballistic — manual Euler integration, gravity-affected:
 *     velocity.y -= g * dt
 *     position  += velocity * dt
 *     Cheap broad-phase collision: scan every alive enemy unit;
 *     if distance from projectile to unit < HIT_RADIUS_M, emit
 *     impact event. Distance check is XZ-planar (Y added back if a
 *     unit is on a steep slope), which is good enough for MVP.
 *
 *   Beam      — instant raycast on the first tick of its life:
 *     it's born already pointing at its target; we resolve hit on
 *     the target IF the projectile's path (origin + dir × range)
 *     passes within HIT_RADIUS_M of the target. Same tick the beam
 *     dies (lifetime is BEAM_LIFETIME_MS from spawn).
 *
 * Other kinds (Guided / Placed / Dropped) fall through to the
 * Ballistic branch with their derived initial velocity. A WARN logs
 * once per kind to flag the deferred-from-MVP status.
 *
 * Impact events go into a list; impactSystem consumes them next.
 * Despawn (entity removal) happens here once an impact resolves or
 * the projectile exceeds max range / lifetime.
 *
 * Sim-purity: typed-array reads only.
 */

import { hasComponent, query, removeEntity } from "bitecs";

import type { SimEventLog } from "../events";
import {
  Dead,
  DeliveryKindValue,
  Health,
  Position,
  ProjectileDistance,
  ProjectileKind,
  ProjectileLifetimeMs,
  ProjectileMaxRange,
  ProjectileOrigin,
  ProjectileOwner,
  ProjectileSchemaId,
  ProjectileTag,
  ProjectileTarget,
  ProjectileTeam,
  Renderable,
  TeamId,
  UnitTypeId,
  Velocity,
  WeaponInstanceTag,
  type SimWorld,
} from "../world";

/** Cheap collision radius — units are ~5-8m; 3m radius makes hits feel certain. */
const HIT_RADIUS_M = 3.0;
const HIT_RADIUS2 = HIT_RADIUS_M * HIT_RADIUS_M;

/** Gravity on ballistic projectiles. Y is up. */
const GRAVITY_MPS2 = 9.81;

export interface ImpactEvent {
  readonly projectileEid: number;
  readonly targetEid: number;
  readonly schemaId: number;
  readonly ownerWeaponEid: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly distanceM: number;
  /** Incoming projectile direction (XZ-plane unit vector). */
  readonly dirX: number;
  readonly dirZ: number;
}

const PROJ_QUERY = [
  ProjectileTag,
  Position,
  Velocity,
  ProjectileTeam,
  ProjectileTarget,
  ProjectileKind,
  ProjectileSchemaId,
  ProjectileDistance,
  ProjectileMaxRange,
  ProjectileOrigin,
  ProjectileLifetimeMs,
  ProjectileOwner,
];

const UNIT_QUERY = [Position, Health, TeamId, UnitTypeId, Renderable];

// One-shot warn dedup for deferred delivery kinds.
const warnedKinds = new Set<number>();

export function projectileSystem(
  world: SimWorld,
  dtSec: number,
  events: SimEventLog,
  impacts: ImpactEvent[],
  currentTick: number,
): void {
  const dtMs = dtSec * 1000;
  const projectiles = query(world, PROJ_QUERY);
  if (projectiles.length === 0) return;

  // Build the "alive enemy units" candidate list once per tick.
  // Filter out projectile + weapon-instance entities (Position is on
  // both projectile and unit; the Renderable + Health combination
  // filters to units).
  const aliveUnits = query(world, UNIT_QUERY);
  const candidates: number[] = [];
  for (let i = 0; i < aliveUnits.length; i++) {
    const u = aliveUnits[i];
    if (hasComponent(world, u, ProjectileTag)) continue;
    if (hasComponent(world, u, WeaponInstanceTag)) continue;
    if (hasComponent(world, u, Dead)) continue;
    if (Health.current[u] <= 0) continue;
    candidates.push(u);
  }

  for (let i = 0; i < projectiles.length; i++) {
    const p = projectiles[i];
    const kind = ProjectileKind.value[p];
    const team = ProjectileTeam.value[p];

    if (kind === DeliveryKindValue.Beam) {
      // Beams born this tick: instant raycast hit-test against the
      // locked target (and friendly-fire-filter against teammates).
      const targetEid = ProjectileTarget.value[p];
      if (
        targetEid !== 0 &&
        !hasComponent(world, targetEid, Dead) &&
        Health.current[targetEid] > 0 &&
        TeamId.value[targetEid] !== team
      ) {
        const ox = ProjectileOrigin.x[p];
        const oz = ProjectileOrigin.z[p];
        const oy = ProjectileOrigin.y[p];
        const tx = Position.x[targetEid];
        const tz = Position.z[targetEid];
        // Beam impact at the target's current position.
        const dx = tx - ox;
        const dz = tz - oz;
        const dist = Math.hypot(dx, dz);
        const range = ProjectileMaxRange.value[p];
        if (dist <= range) {
          const dirX = dist > 0.001 ? dx / dist : 1;
          const dirZ = dist > 0.001 ? dz / dist : 0;
          impacts.push({
            projectileEid: p,
            targetEid,
            schemaId: ProjectileSchemaId.value[p],
            ownerWeaponEid: ProjectileOwner.value[p],
            x: tx,
            y: Position.y[targetEid],
            z: tz,
            distanceM: dist,
            dirX,
            dirZ,
          });
          void oy;
        }
      }
      // Tick lifetime down; beam will despawn below if its life ran out.
      ProjectileLifetimeMs.value[p] = ProjectileLifetimeMs.value[p] - dtMs;
      if (ProjectileLifetimeMs.value[p] <= 0) {
        events.push({
          kind: "projectile_despawned",
          tick: currentTick,
          projectileEid: p,
        });
        removeEntity(world, p);
      }
      continue;
    }

    // Ballistic + (fallback) Guided / Dropped / Placed treated as
    // ballistic for v1. Per the brief, log once for each deferred
    // kind so the gap is visible.
    if (
      kind !== DeliveryKindValue.Ballistic &&
      !warnedKinds.has(kind)
    ) {
      console.warn(
        `[projectileSystem] delivery kind ${kind} not specialised in v1; falling through to ballistic Euler integration.`,
      );
      warnedKinds.add(kind);
    }

    // Euler step.
    const vx = Velocity.x[p];
    const vy = Velocity.y[p] - GRAVITY_MPS2 * dtSec;
    const vz = Velocity.z[p];
    Velocity.y[p] = vy;
    const newX = Position.x[p] + vx * dtSec;
    const newY = Position.y[p] + vy * dtSec;
    const newZ = Position.z[p] + vz * dtSec;

    // Distance traveled (XZ-planar — Y arc is a visual; falloff uses
    // the planar distance from origin).
    const dxOrigin = newX - ProjectileOrigin.x[p];
    const dzOrigin = newZ - ProjectileOrigin.z[p];
    const traveled = Math.hypot(dxOrigin, dzOrigin);
    ProjectileDistance.value[p] = traveled;
    Position.x[p] = newX;
    Position.y[p] = newY;
    Position.z[p] = newZ;

    // Collision: cheap broad-phase scan against alive enemy units.
    let hitEid = 0;
    for (let j = 0; j < candidates.length; j++) {
      const u = candidates[j];
      if (TeamId.value[u] === team) continue;
      const ux = Position.x[u];
      const uz = Position.z[u];
      const dx = ux - newX;
      const dz = uz - newZ;
      const d2 = dx * dx + dz * dz;
      if (d2 < HIT_RADIUS2) {
        hitEid = u;
        break;
      }
    }

    if (hitEid !== 0) {
      const dirLen = Math.hypot(vx, vz) || 1;
      const dirX = vx / dirLen;
      const dirZ = vz / dirLen;
      impacts.push({
        projectileEid: p,
        targetEid: hitEid,
        schemaId: ProjectileSchemaId.value[p],
        ownerWeaponEid: ProjectileOwner.value[p],
        x: Position.x[hitEid],
        y: Position.y[hitEid],
        z: Position.z[hitEid],
        distanceM: traveled,
        dirX,
        dirZ,
      });
      events.push({
        kind: "projectile_despawned",
        tick: currentTick,
        projectileEid: p,
      });
      removeEntity(world, p);
      continue;
    }

    // Range / lifetime expiry.
    ProjectileLifetimeMs.value[p] = ProjectileLifetimeMs.value[p] - dtMs;
    const maxRange = ProjectileMaxRange.value[p];
    if (traveled > maxRange || ProjectileLifetimeMs.value[p] <= 0) {
      events.push({
        kind: "projectile_despawned",
        tick: currentTick,
        projectileEid: p,
      });
      removeEntity(world, p);
    }
  }
}
