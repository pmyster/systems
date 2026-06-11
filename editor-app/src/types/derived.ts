/**
 * Derived-stat types — the output of src/lib/derive-stats.ts.
 *
 * Per DESIGN.md Principle 2 (Derived-stat discipline):
 *   - These are *computed*, never authored.
 *   - They are never written back into the Schematic.
 *   - The engine recomputes them at load time from the physical inputs;
 *     the editor's version is illustrative only and may diverge from
 *     the engine's authoritative numbers.
 *
 * Mirrors the shape produced by deriveStats() at
 * tools/editor/index.html lines 513-615. Every number here is
 * lifted verbatim from those formulas; if you change them, mark
 * the divergence in the source and bump unit physics_version.
 */

import type { WeaponType } from "./part";

// ---------------------------------------------------------------------------
// Per-weapon derived ballistics.
// ---------------------------------------------------------------------------

export interface DerivedWeaponBallistics {
  readonly name: string;
  readonly type: WeaponType | undefined;

  // Kinetic / thermal projectiles.
  readonly muzzle_velocity_mps?: number;
  readonly effective_range_m?: number;
  readonly impact_energy_kJ?: number;

  // Heat / sustained fire.
  readonly sustainable_shots_per_sec?: number;
  readonly time_between_shots_s?: number;
  readonly shots_to_overheat?: number;
  readonly vent_duration_s?: number;
}

// ---------------------------------------------------------------------------
// Whole-unit derived stats.
// ---------------------------------------------------------------------------

/**
 * The full preview pack. Field names match the prototype's `stats`
 * object keys so the lift is byte-identical for ports of
 * renderDerived().
 */
export interface DerivedStats {
  // Mobility.
  readonly speed_mps: number;
  readonly speed_kmh: number;

  // Power balance.
  readonly total_part_power_kW: number;
  readonly power_balance_kW: number;

  // Range / endurance.
  readonly fuel_range_km: number;
  readonly battery_endurance_s: number;
  readonly solar_full_charge_s: number;

  // Defense.
  readonly effective_armor_mm: number;
  readonly total_shield_MJ: number;
  readonly total_shield_regen_MJs: number;

  // Mass.
  readonly total_mass_kg: number;

  // Per-weapon.
  readonly weapons: readonly DerivedWeaponBallistics[];
}
