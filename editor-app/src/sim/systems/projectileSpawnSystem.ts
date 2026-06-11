/**
 * /sim/systems/projectileSpawnSystem.ts — Phase 1 Week 3
 *
 * Drains the PendingProjectileSpawn queue produced by
 * weaponFireSystem and materialises a projectile ECS entity per spawn.
 *
 * Entity components:
 *   Position           — current world XYZ
 *   Velocity           — m/s vector (Y-up); ballistic uses initial
 *                        muzzle velocity, beam stamps zero (lifetime=1
 *                        sim tick, no integration)
 *   ProjectileTag      — empty marker
 *   ProjectileTeam     — for friendly-fire guard
 *   ProjectileOwner    — back-ref to firing weapon
 *   ProjectileTarget   — locked target (used for guided + as
 *                        proximity proxy)
 *   ProjectileKind     — ui8 discriminator (DeliveryKindValue)
 *   ProjectileSchemaId — index into the ProjectileRegistry (for the
 *                        impact resolver)
 *   ProjectileDistance — accumulates traveled distance (m)
 *   ProjectileMaxRange — authored max range (m)
 *   ProjectileOrigin   — spawn point (for distance + beam-line render)
 *   ProjectileLifetimeMs — ms remaining; ballistic = derived from range
 *                          / speed; beam = 50 ms flash.
 *
 * Determinism: the queue is iterated in append order, and entity
 * allocation in bitECS is sequential. Same inputs → same eids.
 */

import { addComponent, addEntity } from "bitecs";

import type { ProjectileSchematic } from "../../types/projectile";
import type { SimEventLog } from "../events";
import {
  DeliveryKindValue,
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
  Velocity,
  type SimWorld,
} from "../world";
import type { PendingProjectileSpawn } from "./weaponFireSystem";

export type ProjectileLookup = (
  typeId: number,
) => ProjectileSchematic | undefined;

// Bumped from 50ms → 1000ms 2026-06-09 for diagnostic visibility.
// Owner can't see/screenshot beams that flash for 1.5 frames. At 1 second
// the beam holds long enough to inspect muzzle position + direction of fire.
// Revisit once we have a per-projectile-schematic beam_lifetime_ms field
// for proper authored values per weapon (long laser pulse vs short pulse vs
// instant-blink combat sim).
const BEAM_LIFETIME_MS = 1000;

export function projectileSpawnSystem(
  world: SimWorld,
  spawns: readonly PendingProjectileSpawn[],
  lookupProjectile: ProjectileLookup,
  events: SimEventLog,
  currentTick: number,
): void {
  for (let i = 0; i < spawns.length; i++) {
    const s = spawns[i];
    const schematic = lookupProjectile(s.projectileTypeId);
    if (!schematic) {
      // weaponFireSystem already warned; skip silently here to
      // avoid duplicate logs.
      continue;
    }

    const eid = addEntity(world);

    addComponent(world, eid, ProjectileTag);
    addComponent(world, eid, Renderable);

    addComponent(world, eid, Position);
    Position.x[eid] = s.originX;
    Position.y[eid] = s.originY;
    Position.z[eid] = s.originZ;

    addComponent(world, eid, ProjectileOrigin);
    ProjectileOrigin.x[eid] = s.originX;
    ProjectileOrigin.y[eid] = s.originY;
    ProjectileOrigin.z[eid] = s.originZ;

    addComponent(world, eid, ProjectileOwner);
    ProjectileOwner.value[eid] = s.weaponEid;

    addComponent(world, eid, ProjectileTeam);
    ProjectileTeam.value[eid] = s.teamId;

    addComponent(world, eid, ProjectileTarget);
    ProjectileTarget.value[eid] = s.targetEid;

    addComponent(world, eid, ProjectileSchemaId);
    ProjectileSchemaId.value[eid] = s.projectileTypeId;

    addComponent(world, eid, ProjectileDistance);
    ProjectileDistance.value[eid] = 0;

    addComponent(world, eid, ProjectileMaxRange);
    ProjectileMaxRange.value[eid] = s.rangeM;

    const kind = schematic.delivery_params.kind;
    let kindByte: number = DeliveryKindValue.Ballistic;
    let speed = 0;
    let lifeMs = 1500; // default fallback

    if (kind === "ballistic") {
      kindByte = DeliveryKindValue.Ballistic;
      speed = schematic.delivery_params.muzzle_velocity_mps;
      lifeMs = (s.rangeM / Math.max(speed, 1)) * 1000 * 1.5;
    } else if (kind === "beam") {
      kindByte = DeliveryKindValue.Beam;
      // Beams resolve via projectileSystem with an instant-hit on the
      // FIRST tick of their lifetime. Velocity stays zero.
      speed = 0;
      lifeMs = BEAM_LIFETIME_MS;
    } else if (kind === "guided") {
      kindByte = DeliveryKindValue.Guided;
      // v1 fallback: treat guided like a ballistic round at cruise.
      speed = 400;
      lifeMs = (s.rangeM / Math.max(speed, 1)) * 1000 * 1.5;
    } else if (kind === "placed") {
      kindByte = DeliveryKindValue.Placed;
      speed = 0;
      lifeMs = 200; // placed proxies as a quick "drop on owner spot"
    } else if (kind === "dropped") {
      kindByte = DeliveryKindValue.Dropped;
      speed = 50;
      lifeMs = 2000;
    } else {
      const _exh: never = kind;
      void _exh;
      console.warn(
        `[projectileSpawnSystem] unknown delivery kind for projectile ${schematic.id}`,
      );
    }

    addComponent(world, eid, ProjectileKind);
    ProjectileKind.value[eid] = kindByte;

    addComponent(world, eid, Velocity);
    Velocity.x[eid] = s.dirX * speed;
    Velocity.y[eid] = 0;
    Velocity.z[eid] = s.dirZ * speed;

    addComponent(world, eid, ProjectileLifetimeMs);
    ProjectileLifetimeMs.value[eid] = lifeMs;

    // Compute target end-point for beam render (so render-side knows
    // where to draw the line). Position.{x,y,z} on the target is the
    // visual endpoint when the projectile is a beam; for ballistic it
    // just informs an initial tracer direction.
    const tx = s.originX + s.dirX * s.rangeM;
    const tz = s.originZ + s.dirZ * s.rangeM;
    events.push({
      kind: "projectile_spawned",
      tick: currentTick,
      projectileEid: eid,
      kindByte,
      x: s.originX,
      y: s.originY,
      z: s.originZ,
      tx,
      ty: s.originY,
      tz,
    });
  }
}
