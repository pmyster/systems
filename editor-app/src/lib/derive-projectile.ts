/**
 * Derived stats for a Projectile Schematic.
 *
 * Per DESIGN.md Principle 2, these values are NEVER stored in the
 * projectile — they're recomputed from the schematic's physical
 * inputs every time the engine or the editor needs them. The numbers
 * the editor shows here are a STAT-PANEL ILLUSTRATION so the author
 * can reason about their schematic. The real engine values are
 * computed by the runtime physics pipeline and may differ.
 *
 * Loud-over-silent: any input shape we don't recognize returns the
 * SHAPE-NEUTRAL default (0) instead of throwing. The author still
 * sees the row; it just reads 0 — which signals "this stat does not
 * apply to this delivery/effect combo." When the projectile changes
 * to a kind that DOES define the stat, the same row fills in.
 */

import type {
  DerivedProjectileStats,
  ProjectileSchematic,
} from "../types/projectile";

/**
 * Pure: same input → same output, no I/O, no mutation. Safe to call
 * on every keystroke from the form.
 */
export function deriveProjectileStats(
  p: ProjectileSchematic,
): DerivedProjectileStats {
  return {
    kinetic_energy_kj: kineticEnergyKj(p),
    recoil_impulse_ns: recoilImpulseNs(p),
    est_penetration_mm: estPenetrationMm(p),
    est_blast_radius_m: estBlastRadiusM(p),
    est_beam_intensity_kwm2: estBeamIntensityKwM2(p),
  };
}

/**
 * KE = ½·m·v². Returned in kJ. Only meaningful for ballistic, guided,
 * and dropped delivery (anything with a moving mass at impact).
 */
function kineticEnergyKj(p: ProjectileSchematic): number {
  const v = velocityForKE(p);
  if (v <= 0 || p.mass_kg <= 0) return 0;
  return 0.5 * p.mass_kg * v * v / 1000;
}

/**
 * Best-effort impact velocity for the KE panel. Ballistic uses muzzle
 * velocity. Guided uses a rough rocket-equation upper bound from
 * thrust*1s / mass (1s burn proxy — the author can mentally adjust).
 * Dropped uses sqrt(2·g·h) at a 100m reference altitude. Beam returns 0
 * (KE doesn't apply). Placed returns 0.
 */
function velocityForKE(p: ProjectileSchematic): number {
  switch (p.delivery_params.kind) {
    case "ballistic":
      return p.delivery_params.muzzle_velocity_mps;
    case "guided": {
      const m = Math.max(p.mass_kg, 0.001);
      // Δv ≈ (thrust · burn_time) / mass; use 1s as a comparison proxy.
      return p.delivery_params.thrust_n / m;
    }
    case "dropped": {
      const G = 9.81;
      const REF_H_M = 100;
      return Math.sqrt(2 * G * REF_H_M);
    }
    case "beam":
    case "placed":
      return 0;
    default: {
      // Shape-neutral fallback. If a new delivery kind is added and
      // this switch isn't extended, the row reads 0 rather than NaN.
      // The TS compiler also flags the missing case via _exh.
      const _exh: never = p.delivery_params;
      void _exh;
      return 0;
    }
  }
}

/**
 * Recoil impulse (N·s) = m · v_muzzle. Ballistic-only; everything else
 * has no recoil at the firing platform.
 */
function recoilImpulseNs(p: ProjectileSchematic): number {
  if (p.delivery_params.kind !== "ballistic") return 0;
  return p.mass_kg * p.delivery_params.muzzle_velocity_mps;
}

/**
 * Stat-panel penetration estimate (mm). Kinetic-effect only.
 *
 * Documented placeholder: P ≈ k · σ · v · cos(0) — a hand-tuned
 * proportional model where:
 *   - σ is sectional density (kg/m²)
 *   - v is impact velocity (m/s, ballistic-only proxy)
 *   - k is a material constant (steel=1.0, tungsten=1.6, du=1.9,
 *     composite=0.8) reflecting relative penetration efficiency.
 *
 * This is NOT the engine value. Real penetration depends on target
 * hardness, obliquity, projectile shape, and the engine's armor model.
 * This row exists so the author can see "ballpark — is this AP or
 * not?" at a glance.
 */
function estPenetrationMm(p: ProjectileSchematic): number {
  if (p.effect_params.kind !== "kinetic") return 0;
  const v = velocityForKE(p);
  if (v <= 0) return 0;
  const k =
    p.effect_params.penetrator_material === "tungsten"
      ? 1.6
      : p.effect_params.penetrator_material === "du"
        ? 1.9
        : p.effect_params.penetrator_material === "composite"
          ? 0.8
          : 1.0; // steel default
  // Empirical coefficient calibrated so a 1 kg/m² tungsten dart at
  // 1000 m/s yields ~80 mm RHA-equivalent — close enough to the
  // common DE-penetration heuristic to be useful at a glance.
  const C = 0.05;
  return C * k * p.effect_params.sectional_density_kgm2 * v;
}

/**
 * Cube-root scaling on yield. Explosive-effect only.
 *
 * Documented placeholder: R ≈ k · ∛Y where Y is blast yield in MJ.
 * k chosen so 1 MJ ≈ 3 m radius (TNT-equivalent ~250 g). The engine
 * computes the real blast volume from a pressure-integrated model.
 */
function estBlastRadiusM(p: ProjectileSchematic): number {
  if (p.effect_params.kind !== "explosive") return 0;
  const Y = p.effect_params.blast_yield_mj;
  if (Y <= 0) return 0;
  const K = 3;
  return K * Math.cbrt(Y);
}

/**
 * Beam-spot intensity (kW/m²) at a 1 km reference range. Beam-only.
 *
 * Documented placeholder: intensity = power / spot_area, where
 * spot_radius = range · divergence (small-angle). At 1 km with the
 * authored divergence (mrad → rad), the spot radius is divergence_mrad
 * meters; intensity = P / (π r²). Real engine values may add
 * absorption losses.
 */
function estBeamIntensityKwM2(p: ProjectileSchematic): number {
  if (p.delivery_params.kind !== "beam") return 0;
  const REF_RANGE_M = 1000;
  const divergence_rad = p.delivery_params.divergence_mrad * 0.001;
  const spot_radius_m = REF_RANGE_M * divergence_rad;
  if (spot_radius_m <= 0) {
    // Perfect-collimation edge case: report power per square cm at
    // 1m as an upper bound rather than infinity.
    return p.delivery_params.beam_power_kw / (Math.PI * 0.005 * 0.005);
  }
  const area_m2 = Math.PI * spot_radius_m * spot_radius_m;
  return p.delivery_params.beam_power_kw / area_m2;
}
