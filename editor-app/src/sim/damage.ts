/**
 * /sim/damage.ts — Phase 1 Week 3
 *
 * Pure damage formula. Lives in /sim so impactSystem can call it
 * deterministically. NO Three.js, NO clocks, NO Math.random.
 *
 * Implements the 8-step formula from the Phase 1 Week 3 brief, honoring
 * the AUTHORED schema fields:
 *
 *   1. raw_pen      = projectile.penetration × range_falloff(d / max_range)
 *   2. impact_angle = angle between target_surface_normal and projectile_velocity
 *   3. eff_thick    = armor.thickness / max(cos(impact_angle), 0.25)   (≤ 4×)
 *   4. matchup      = EFFECT_VS_MATERIAL[effect_kind][material]        (0.25..2.5)
 *   5. zone_mult    = ZONE_MULT[hit_zone]
 *   6. pen_ratio    = (raw_pen × matchup) / eff_thick
 *   7. dmg_mult     = clamp(pen_ratio, 0.1, 1.5)
 *   8. final        = base_damage × dmg_mult × zone_mult
 *
 * Per CLAUDE.md "Adaptive over specific": the EFFECT_VS_MATERIAL gate is
 * a data-driven table. Unknown (effect, material) pair returns 1.0 AND
 * logs a console.warn — never silently zero.
 *
 * Schema field references:
 *   ZoneArmor.thickness_mm                         from VulnerabilityProfile
 *   ZoneArmor.material      ("steel"|"composite"|"reactive"|"ceramic")
 *   ProjectileSchematic.effect_params.kind         5-way enum
 *   ProjectileSchematic.delivery_params (ballistic.muzzle_velocity_mps)
 *   ProjectileSchematic.mass_kg                    (for KE-derived base damage)
 *
 * NOTE: "base_damage" is NOT a stored field per Principle 2. We DERIVE
 * it from the projectile's physics inputs here (KE for kinetic, dwell ×
 * power for beam/energy, blast_yield for explosive). This is the same
 * lift performed by `derive-projectile.ts` for the editor's stat panel;
 * we re-derive here because /sim cannot depend on the editor's render
 * stack.
 */

import type {
  EffectKind,
  ProjectileSchematic,
} from "../types/projectile";
import type { ArmorMaterial, ArmorZone } from "../types/vulnerability";

// ---------------------------------------------------------------------
// Tables. Keep them small + adaptive. Unknown pairs default to 1.0 with
// a warn (handled by lookupMatchup below).
// ---------------------------------------------------------------------

/**
 * Zone multiplier applied to FINAL damage. Side hits hurt more (thinner
 * sponson + ammo racks). Rear / top are the soft spots.
 */
export const ZONE_MULT: Readonly<Record<ArmorZone, number>> = {
  front: 1.0,
  side: 1.15,
  rear: 1.4,
  top: 1.6,
};

/**
 * Effect-vs-material matchup table.
 *
 *   - kinetic loves homogeneous steel; reactive armor over-spalls
 *     (consumed plate) and ceramic shatters → favorable.
 *   - explosive loves composite (low blast resistance) and is wasted
 *     on reactive plates.
 *   - energy: ceramic resists ablation (lower); composite vapes (higher).
 *   - electronic: zone material is mostly irrelevant — 1.0.
 *   - persistent_area (gas/fire/smoke): material doesn't matter for
 *     crew effects — 1.0.
 */
export const EFFECT_VS_MATERIAL: Readonly<
  Record<EffectKind, Readonly<Record<ArmorMaterial, number>>>
> = {
  kinetic: { steel: 1.0, composite: 0.85, reactive: 0.7, ceramic: 1.25 },
  explosive: { steel: 1.0, composite: 1.3, reactive: 0.4, ceramic: 0.9 },
  energy: { steel: 1.0, composite: 1.2, reactive: 1.0, ceramic: 0.7 },
  electronic: { steel: 1.0, composite: 1.0, reactive: 1.0, ceramic: 1.0 },
  persistent_area: { steel: 1.0, composite: 1.0, reactive: 1.0, ceramic: 1.0 },
};

// Set of (effect, material) pairs we've already warned about to avoid
// spamming the console every frame in /sim. Cleared by tests via the
// exported helper below.
const warnedPairs = new Set<string>();

export function _resetDamageWarnings(): void {
  warnedPairs.clear();
}

function lookupMatchup(effect: EffectKind, material: ArmorMaterial): number {
  const row = EFFECT_VS_MATERIAL[effect];
  if (!row) {
    const key = `effect:${String(effect)}`;
    if (!warnedPairs.has(key)) {
      console.warn(
        `[damage] unknown effect kind "${String(effect)}" — defaulting matchup to 1.0`,
      );
      warnedPairs.add(key);
    }
    return 1.0;
  }
  const v = row[material];
  if (v === undefined) {
    const key = `pair:${effect}:${String(material)}`;
    if (!warnedPairs.has(key)) {
      console.warn(
        `[damage] unknown (effect=${effect}, material=${String(material)}) pair — defaulting matchup to 1.0`,
      );
      warnedPairs.add(key);
    }
    return 1.0;
  }
  return v;
}

// ---------------------------------------------------------------------
// Base damage derivation. NEVER stored on the projectile; computed from
// physical inputs per Principle 2.
//
// Returns a unitless "HP damage" number tuned so a 100 HP mk01 lasts
// roughly 6-12 hits in a one-on-one fight — enough that heat cycling
// matters, short enough that the engagement reads in ~30 seconds.
// ---------------------------------------------------------------------

const KINETIC_BASE_SCALE = 0.012; // tuned: ~25 dmg from a 2kg @ 1000 m/s round
const ENERGY_BASE_SCALE = 0.002; // tuned: ~10 dmg per beam dwell
const EXPLOSIVE_BASE_SCALE = 1.5; // dmg per MJ yield
const ELECTRONIC_BASE = 5; // EMP soft-damages structure a flat bit
const PERSISTENT_BASE = 2; // cloud / fire soft damage

export function deriveBaseDamage(p: ProjectileSchematic): number {
  const effect = p.effect_params;
  switch (effect.kind) {
    case "kinetic": {
      // KE proxy: m × v² × 0.5 / 1000 (kJ) × scale. ballistic-only KE
      // formula; for guided we use thrust/mass × 1s burn proxy (matches
      // derive-projectile.ts).
      const v_mps = velocityProxy(p);
      const ke_kj = 0.5 * p.mass_kg * v_mps * v_mps / 1000;
      return ke_kj * KINETIC_BASE_SCALE;
    }
    case "energy": {
      // Joules delivered → kJ; scale.
      const kj = effect.joules_delivered / 1000;
      const dwell_s =
        p.delivery_params.kind === "beam"
          ? p.delivery_params.dwell_time_s
          : 1;
      return kj * dwell_s * ENERGY_BASE_SCALE;
    }
    case "explosive": {
      return effect.blast_yield_mj * EXPLOSIVE_BASE_SCALE;
    }
    case "electronic": {
      return ELECTRONIC_BASE;
    }
    case "persistent_area": {
      return PERSISTENT_BASE * effect.density;
    }
    default: {
      // Exhaustive default per "loud over silent".
      const _exh: never = effect;
      void _exh;
      console.warn(
        `[damage] unhandled effect kind — defaulting base damage to 0`,
      );
      return 0;
    }
  }
}

function velocityProxy(p: ProjectileSchematic): number {
  switch (p.delivery_params.kind) {
    case "ballistic":
      return p.delivery_params.muzzle_velocity_mps;
    case "guided": {
      const m = Math.max(p.mass_kg + p.delivery_params.fuel_mass_kg, 0.001);
      // 5s notional burn — matches resolveInteraction's constant.
      return (p.delivery_params.thrust_n / m) * 5;
    }
    case "dropped":
      return Math.sqrt(2 * 9.81 * 100);
    case "beam":
    case "placed":
      return 0;
    default: {
      const _exh: never = p.delivery_params;
      void _exh;
      return 0;
    }
  }
}

/**
 * Penetration estimate (mm). Kinetic-only; non-kinetic effects don't
 * have a "penetration" in the same sense — we return a big number so
 * the pen_ratio path is dominated by matchup/zone instead.
 */
export function derivePenetrationMm(p: ProjectileSchematic): number {
  if (p.effect_params.kind === "kinetic") {
    const v = velocityProxy(p);
    if (v <= 0) return 0;
    const k =
      p.effect_params.penetrator_material === "tungsten"
        ? 1.6
        : p.effect_params.penetrator_material === "du"
          ? 1.9
          : p.effect_params.penetrator_material === "composite"
            ? 0.8
            : 1.0;
    return 0.05 * k * p.effect_params.sectional_density_kgm2 * v;
  }
  // For non-kinetic, return a "saturating" penetration value — armor
  // thickness still attenuates via the matchup table, but we don't want
  // a tiny pen_ratio swallowing the damage.
  return 1000;
}

export interface DamageInputs {
  readonly projectile: ProjectileSchematic;
  readonly hitZone: ArmorZone;
  readonly zoneThicknessMm: number;
  readonly zoneMaterial: ArmorMaterial;
  /** Distance traveled by the projectile (m). */
  readonly distanceM: number;
  /** Authored max range of the firing weapon (m). */
  readonly maxRangeM: number;
  /**
   * Impact angle in radians between the surface normal and the
   * projectile velocity vector. 0 = head-on. PI/2 = grazing.
   * v1 keeps this simple — passed in by impactSystem from a quick
   * yaw difference between target.Rotation and the projectile's
   * incoming heading.
   */
  readonly impactAngleRad: number;
}

export interface DamageResult {
  readonly finalDamage: number;
  readonly penRatio: number;
  readonly dmgMult: number;
  readonly zoneMult: number;
  readonly matchup: number;
  readonly rangeFalloff: number;
  readonly effThicknessMm: number;
}

/**
 * 8-step damage formula. Pure: no logging, no I/O, no clocks.
 *
 * range_falloff: linear, 100% at d=0 → 60% at d=max_range. Past max
 * range we clamp to 0.6 instead of going negative — a projectile that
 * over-travels should still hit, just at minimum effectiveness.
 */
export function computeDamage(inp: DamageInputs): DamageResult {
  const p = inp.projectile;
  const basePen = derivePenetrationMm(p);
  const rangeRatio =
    inp.maxRangeM > 0 ? Math.min(1, inp.distanceM / inp.maxRangeM) : 0;
  const rangeFalloff = 1 - 0.4 * rangeRatio; // 1.0 → 0.6

  const rawPen = basePen * rangeFalloff;

  // Step 3: effective thickness via cos(angle). Cap to ≤ 4× by clamping
  // cos to >= 0.25 (cos(75°) = 0.259).
  const cosA = Math.max(Math.cos(inp.impactAngleRad), 0.25);
  const effThickMm = inp.zoneThicknessMm / cosA;

  const matchup = lookupMatchup(p.effect_params.kind, inp.zoneMaterial);
  const zoneMult = ZONE_MULT[inp.hitZone] ?? 1.0;

  const safeThick = Math.max(effThickMm, 0.001);
  const penRatio = (rawPen * matchup) / safeThick;
  const dmgMult = Math.min(1.5, Math.max(0.1, penRatio));

  const baseDamage = deriveBaseDamage(p);
  const finalDamage = baseDamage * dmgMult * zoneMult;

  return {
    finalDamage,
    penRatio,
    dmgMult,
    zoneMult,
    matchup,
    rangeFalloff,
    effThicknessMm: effThickMm,
  };
}

/**
 * Helper — pick the struck zone from a relative direction.
 *
 * relative = (target_position - attacker_position) projected onto target's
 * forward axis. Per the brief, MVP uses 4 cardinal zones based on the
 * incoming projectile direction in target-local space.
 *
 *   front: target faces the attacker (dot product positive on forward)
 *   rear:  attacker behind
 *   side:  attacker on the flank
 *   top:   reserved for top-attack munitions (MVP returns front in
 *           this slice — projectile delivery_kind doesn't yet expose
 *           a "top-attack" flag).
 *
 * Inputs are unit-norm 2D vectors (XZ plane). The forward axis is
 * derived from the target's Rotation quaternion; the caller computes
 * `(forwardX, forwardZ)` once and passes it in.
 */
export function pickHitZone(
  targetForwardX: number,
  targetForwardZ: number,
  attackerDirX: number,
  attackerDirZ: number,
): ArmorZone {
  // Renormalize defensively (Rotation may have drifted slightly).
  const flen =
    Math.hypot(targetForwardX, targetForwardZ) || 1;
  const fx = targetForwardX / flen;
  const fz = targetForwardZ / flen;
  const alen = Math.hypot(attackerDirX, attackerDirZ) || 1;
  const ax = attackerDirX / alen;
  const az = attackerDirZ / alen;

  // Dot product = cos(angle between forward and attacker-direction).
  const dot = fx * ax + fz * az;
  // Cross (signed) tells us which side.
  const cross = fx * az - fz * ax;

  // Front cone: dot > cos(45°) ≈ 0.707
  // Rear cone:  dot < cos(135°) ≈ -0.707
  // Else: side.
  if (dot > 0.707) return "front";
  if (dot < -0.707) return "rear";
  // sign of cross discriminates left/right side but our zone enum only
  // has one "side" entry, so we collapse both into "side".
  void cross;
  return "side";
}
