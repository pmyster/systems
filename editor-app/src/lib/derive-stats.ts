/**
 * Derived-stat calculator.
 *
 * Lifted verbatim from tools/editor/index.html lines 513-615
 * (`deriveStats`). Equations unchanged — typed inputs and outputs only.
 *
 * Per DESIGN.md Principle 2 (Derived-stat discipline):
 *
 *   These numbers are ILLUSTRATIVE. The Schematic stores physical
 *   inputs (mass, engine_kW, propellant_energy_MJ, etc.); the game
 *   engine recomputes derived stats at load time using the canonical
 *   physics formulas in docs/physics.md. The editor's preview here
 *   uses *simplified* versions of those formulas so the player gets
 *   an immediate sense of what their inputs imply. The preview's
 *   numbers MUST NEVER be written back into the Schematic. The output
 *   type `DerivedStats` is intentionally separate from `UnitSchematic`
 *   to make that boundary a compile-time error.
 *
 * Per DESIGN.md Principle 4 (Invariance), changing these formulas does
 * NOT invalidate already-saved units. Each unit carries the
 * physics_version it was authored under; the engine resolves it
 * against whatever ruleset was published at that version. The editor
 * always shows preview numbers using *current* formulas, which can
 * diverge from a unit's authored version — that's expected.
 */

import type { UnitSchematic } from "../types/unit";
import type {
  DerivedStats,
  DerivedWeaponBallistics,
} from "../types/derived";
import type {
  PartSchematic,
  WeaponPart,
} from "../types/part";
import { isWeapon } from "../types/part";

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

/** Cast 0/undefined to 0; pass everything else through. */
function num(v: number | undefined | null): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function derivePartsPower(parts: readonly PartSchematic[]): number {
  let total = 0;
  for (const p of parts) total += num(p.power_draw_kW);
  return total;
}

function deriveMobilityMultiplier(parts: readonly PartSchematic[]): number {
  let m = 1;
  for (const p of parts) {
    if (p.category === "mobility_aux" && p.mobility_bonus_speed != null) {
      m *= p.mobility_bonus_speed;
    }
  }
  return m;
}

function deriveShieldTotals(parts: readonly PartSchematic[]): {
  capacity: number;
  regen: number;
} {
  let capacity = 0;
  let regen = 0;
  for (const p of parts) {
    if (p.category === "defense") {
      capacity += num(p.shield_capacity_MJ);
      regen += num(p.shield_regen_rate_MJs);
    }
  }
  return { capacity, regen };
}

function deriveArmorBonus(parts: readonly PartSchematic[]): number {
  let bonus = 0;
  for (const p of parts) {
    if (p.category === "defense") bonus += num(p.armor_bonus_mm);
  }
  return bonus;
}

function deriveTotalMass(unit: UnitSchematic): number {
  let total = num(unit.chassis.mass_kg);
  for (const p of unit.parts ?? []) total += num(p.mass_kg);
  return total;
}

// ---------------------------------------------------------------------------
// Per-weapon ballistics.
// ---------------------------------------------------------------------------

/**
 * Lift of the per-weapon block from tools/editor/index.html lines
 * 585-612. Returns a sparsely-populated record per weapon — fields
 * that don't apply (e.g. muzzle velocity on a beam) are simply
 * omitted.
 */
function deriveWeapon(w: WeaponPart): DerivedWeaponBallistics {
  const out: {
    -readonly [K in keyof DerivedWeaponBallistics]: DerivedWeaponBallistics[K];
  } = {
    name: w.name,
    type: w.weapon_type,
  };

  if (w.weapon_type === "kinetic" || w.weapon_type === "thermal") {
    const projMass = num(w.projectile_mass_kg);
    const propellant = num(w.propellant_energy_MJ);
    if (projMass > 0) {
      // muzzle velocity (with thermal-loss factor 0.3)
      const mv = Math.sqrt((2 * propellant * 1e6) / projMass) * 0.3;
      out.muzzle_velocity_mps = mv;
      out.effective_range_m = mv * 2;
      out.impact_energy_kJ = (0.5 * projMass * mv * mv) / 1000;
    }
  } else if (w.weapon_type === "beam") {
    const propellant = num(w.propellant_energy_MJ);
    out.effective_range_m = propellant * 200;
    out.impact_energy_kJ = propellant * 1000;
  }

  // Cooldown: time between shots to keep heat sustainable.
  const cool = num(w.cooling_rate_MJs);
  const perShot = num(w.per_shot_heat_MJ);
  if (cool > 0 && perShot > 0) {
    if (perShot <= cool) {
      out.sustainable_shots_per_sec = cool / perShot;
      out.time_between_shots_s = perShot / cool;
    } else {
      const barrelCap = num(w.barrel_thermal_capacity_MJ);
      out.shots_to_overheat = Math.floor(barrelCap / perShot);
      out.time_between_shots_s = perShot / cool;
      out.vent_duration_s = barrelCap / cool;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Top-level derivation.
// ---------------------------------------------------------------------------

/**
 * Compute the full derived-stat readout for a unit.
 *
 * Pure function — never mutates `unit`, never produces a value that
 * should be persisted on the Schematic. Safe to call on every keystroke.
 */
export function deriveStats(unit: UnitSchematic): DerivedStats {
  const c = unit.chassis;
  const parts: readonly PartSchematic[] = unit.parts ?? [];
  const mass_t = num(c.mass_kg) / 1000;

  // ----- Speed (simplified power-to-mass) -----------------------------------
  let speed = 0;
  if (c.chassis_class !== "static_structure" && mass_t > 0) {
    speed =
      (num(c.engine_kW) * num(c.drivetrain_efficiency)) / (mass_t + 5);
    speed *= deriveMobilityMultiplier(parts);
  }

  // ----- Power balance ------------------------------------------------------
  const totalPartPower = derivePartsPower(parts);

  // ----- Fuel range (cruise = 50% power, 70% top speed) ---------------------
  let range_m = 0;
  const fuelRate = num(c.fuel_consumption_rate_MJs);
  const fuelCap = num(c.fuel_capacity_MJ);
  if (fuelRate > 0 && fuelCap > 0) {
    const cruise_speed = speed * 0.7;
    const cruise_burn = fuelRate * 0.5;
    const time_at_cruise = fuelCap / cruise_burn;
    range_m = cruise_speed * time_at_cruise;
  }

  // ----- Battery endurance (idle drain) -------------------------------------
  let battery_endurance_s = 0;
  const batteryCap = num(c.battery_capacity_MJ);
  if (batteryCap > 0 && totalPartPower > 0) {
    battery_endurance_s = (batteryCap * 1000) / totalPartPower; // kJ / kW = s
  }

  // ----- Solar charge time --------------------------------------------------
  let solar_charge_s = 0;
  const solarArea = num(c.solar_collection_area_m2);
  if (batteryCap > 0 && solarArea > 0) {
    const solar_W = solarArea * 200; // 200 W/m^2 average
    solar_charge_s = (batteryCap * 1e6) / solar_W;
  }

  // ----- Armor + shields ----------------------------------------------------
  const effective_armor_mm = num(c.armor_thickness_mm) + deriveArmorBonus(parts);
  const shields = deriveShieldTotals(parts);

  // ----- Total mass ---------------------------------------------------------
  const total_mass_kg = deriveTotalMass(unit);

  // ----- Per-weapon ---------------------------------------------------------
  const weapons: DerivedWeaponBallistics[] = [];
  for (const p of parts) {
    if (isWeapon(p)) weapons.push(deriveWeapon(p));
  }

  return {
    speed_mps: speed,
    speed_kmh: speed * 3.6,
    total_part_power_kW: totalPartPower,
    power_balance_kW: num(c.engine_kW) - totalPartPower,
    fuel_range_km: range_m / 1000,
    battery_endurance_s,
    solar_full_charge_s: solar_charge_s,
    effective_armor_mm,
    total_shield_MJ: shields.capacity,
    total_shield_regen_MJs: shields.regen,
    total_mass_kg,
    weapons,
  };
}
