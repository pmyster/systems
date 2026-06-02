/**
 * /sim/systems/impactSystem.ts — Phase 1 Week 3
 *
 * Consumes ImpactEvents produced by projectileSystem and applies the
 * 8-step damage formula (see /sim/damage.ts) to the target's Health.
 *
 * The damage formula needs the target's per-zone armor + the
 * projectile's authored schematic — both are looked up via callbacks
 * passed in by the runtime (since the registries live on the runtime
 * side, but the systems live in /sim).
 *
 * Per the brief:
 *   - Hit zone is picked from the projectile's incoming direction
 *     relative to the target's forward axis (pickHitZone).
 *   - Impact angle for the obliquity term is approximated as the
 *     angle between the target's forward axis and the projectile
 *     direction. v1 keeps this simple — a 1-cos relationship gives
 *     plausible obliquity without per-mesh geometry.
 *   - On Health.current ≤ 0, tag Dead. Death event emission lives in
 *     deathSystem so multiple impacts on the same tick collapse to one
 *     death log line.
 *
 * Sim-purity: pure typed-array reads, single Math.cos.
 */

import { addComponent, hasComponent } from "bitecs";

import type { ProjectileSchematic } from "../../types/projectile";
import type {
  ArmorMaterial,
  ArmorZone,
  ZoneArmor,
} from "../../types/vulnerability";
import type { SimEventLog } from "../events";
import { computeDamage, pickHitZone } from "../damage";
import {
  Dead,
  Health,
  Rotation,
  type SimWorld,
} from "../world";
import type { ImpactEvent } from "./projectileSystem";

/**
 * Resolve a unit's per-zone armor record. Returns undefined if the
 * target is gone or the vulnerability isn't authored — caller skips
 * with a one-time warn.
 */
export type ZoneArmorLookup = (
  unitEid: number,
  zone: ArmorZone,
) => ZoneArmor | undefined;

export type ProjectileLookup = (
  typeId: number,
) => ProjectileSchematic | undefined;

const warnedMissingTarget = new Set<number>();
const warnedMissingSchema = new Set<number>();
export function _resetImpactWarnings(): void {
  warnedMissingTarget.clear();
  warnedMissingSchema.clear();
}

/**
 * Extract a unit's forward axis (XZ) from its Rotation quaternion. The
 * mesh-convention forward direction is +Z (THREE.js's
 * getWorldDirection convention used everywhere else in this codebase).
 */
function forwardFromRotation(eid: number): { fx: number; fz: number } {
  // Rotate (0, 0, 1) by quaternion (qx,qy,qz,qw):
  //   fx = 2*(qx*qz + qw*qy)
  //   fz = 1 - 2*(qx*qx + qy*qy)
  const qx = Rotation.x[eid];
  const qy = Rotation.y[eid];
  const qz = Rotation.z[eid];
  const qw = Rotation.w[eid];
  const fx = 2 * (qx * qz + qw * qy);
  const fz = 1 - 2 * (qx * qx + qy * qy);
  const len = Math.hypot(fx, fz) || 1;
  return { fx: fx / len, fz: fz / len };
}

export function impactSystem(
  world: SimWorld,
  impacts: readonly ImpactEvent[],
  events: SimEventLog,
  currentTick: number,
  lookupProjectile: ProjectileLookup,
  lookupZoneArmor: ZoneArmorLookup,
): void {
  if (impacts.length === 0) return;

  for (let i = 0; i < impacts.length; i++) {
    const ev = impacts[i];
    const target = ev.targetEid;
    if (hasComponent(world, target, Dead)) continue;
    if (Health.current[target] <= 0) continue;

    const schematic = lookupProjectile(ev.schemaId);
    if (!schematic) {
      if (!warnedMissingSchema.has(ev.schemaId)) {
        console.warn(
          `[impactSystem] no schematic for projectile schemaId ${ev.schemaId} — skipping`,
        );
        warnedMissingSchema.add(ev.schemaId);
      }
      continue;
    }

    // Pick hit zone from target's forward axis vs incoming dir.
    const { fx, fz } = forwardFromRotation(target);
    // The "attacker direction" is the unit vector FROM target TO
    // attacker. Projectile travels in (dirX, dirZ); attacker is in
    // the OPPOSITE direction.
    const ax = -ev.dirX;
    const az = -ev.dirZ;
    const hitZone: ArmorZone = pickHitZone(fx, fz, ax, az);

    const zoneArmor = lookupZoneArmor(target, hitZone);
    if (!zoneArmor) {
      if (!warnedMissingTarget.has(target)) {
        console.warn(
          `[impactSystem] target eid ${target} has no zone armor for ${hitZone}; skipping`,
        );
        warnedMissingTarget.add(target);
      }
      continue;
    }

    // Compute impact angle: simple proxy = angle between target
    // forward and projectile direction. Head-on hits (dirX,dirZ ≈
    // -fx,-fz) give cos = 1; grazing hits give cos ≈ 0.
    const dot = -(fx * ev.dirX + fz * ev.dirZ);
    const cosA = Math.max(-1, Math.min(1, dot));
    const impactAngleRad = Math.acos(cosA);

    const dmg = computeDamage({
      projectile: schematic,
      hitZone,
      zoneThicknessMm: zoneArmor.thickness_mm,
      zoneMaterial: zoneArmor.material as ArmorMaterial,
      distanceM: ev.distanceM,
      maxRangeM: Math.max(1, ev.distanceM, 100), // floor avoids zero-divide
      impactAngleRad,
    });

    Health.current[target] = Math.max(
      0,
      Health.current[target] - dmg.finalDamage,
    );

    events.push({
      kind: "impact",
      tick: currentTick,
      targetEid: target,
      attackerEid: ev.ownerWeaponEid,
      x: ev.x,
      y: ev.y,
      z: ev.z,
      damage: dmg.finalDamage,
      hitZone,
    });

    if (Health.current[target] <= 0 && !hasComponent(world, target, Dead)) {
      addComponent(world, target, Dead);
      Dead.atTick[target] = currentTick;
    }
  }
}
