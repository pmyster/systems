// PhysicsConstitution.cs
// Derives gameplay statistics from raw physical parameters stored in schematics.
// All arithmetic matches the physics.md spec.  No magic numbers are hardcoded
// outside the documented constants below.

using System;
using System.Collections.Generic;
using UnityEngine;

namespace ChildOfLight.Core
{
    // ─────────────────────────────────────────────
    //  Result structs
    // ─────────────────────────────────────────────

    [Serializable]
    public struct ChassisStats
    {
        /// <summary>Top speed in metres per second (derived from engine power).</summary>
        public float MaxSpeedMs;

        /// <summary>Maximum range in metres before fuel exhaustion (float.MaxValue if electric).</summary>
        public float RangeM;

        /// <summary>Hull hit-points derived from armor thickness, material and surface area.</summary>
        public float ArmorHp;

        /// <summary>The resolved ArmorMaterial enum (used for penetration math).</summary>
        public ArmorMaterial Material;

        public override string ToString() =>
            $"Speed={MaxSpeedMs:F1} m/s  Range={RangeM:F0} m  HP={ArmorHp:F0}";
    }

    [Serializable]
    public struct PartStats
    {
        /// <summary>Muzzle velocity in m/s (kinetic weapons).</summary>
        public float MuzzleVelocityMs;

        /// <summary>Kinetic energy at muzzle in Joules.</summary>
        public float KineticEnergyJ;

        /// <summary>Penetration depth against reference steel armour in mm.</summary>
        public float PenetrationMm;

        /// <summary>Minimum seconds between shots (cooldown).</summary>
        public float CooldownS;

        /// <summary>Effective engagement range in metres (read directly from part field).</summary>
        public float EffectiveRangeM;

        /// <summary>The resolved weapon type enum.</summary>
        public WeaponType WType;

        public override string ToString() =>
            $"Vel={MuzzleVelocityMs:F0} m/s  KE={KineticEnergyJ / 1000f:F1} kJ  Pen={PenetrationMm:F1} mm  CD={CooldownS:F2} s  Range={EffectiveRangeM:F0} m";
    }

    // ─────────────────────────────────────────────
    //  Armour material constants
    // ─────────────────────────────────────────────

    public static class ArmorConstants
    {
        public const float SalvagedSteel   = 1.0f;
        public const float AlloyComposite  = 1.8f;
        public const float CeramicLayered  = 2.5f;
        public const float ExoticLattice   = 4.0f;

        public static float FactorFor(ArmorMaterial mat) => mat switch
        {
            ArmorMaterial.SalvagedSteel  => SalvagedSteel,
            ArmorMaterial.AlloyComposite => AlloyComposite,
            ArmorMaterial.CeramicLayered => CeramicLayered,
            ArmorMaterial.ExoticLattice  => ExoticLattice,
            _                            => SalvagedSteel
        };

        /// <summary>Parse the JSON snake_case material string into the enum.</summary>
        public static ArmorMaterial Parse(string s) => s switch
        {
            "alloy_composite"  => ArmorMaterial.AlloyComposite,
            "ceramic_layered"  => ArmorMaterial.CeramicLayered,
            "exotic_lattice"   => ArmorMaterial.ExoticLattice,
            _                  => ArmorMaterial.SalvagedSteel
        };
    }

    // ─────────────────────────────────────────────
    //  Physics Constitution — static derivation engine
    // ─────────────────────────────────────────────

    public static class PhysicsConstitution
    {
        // Physical ceilings — no unit can exceed these regardless of engine size.
        private const float MaxSpeedCapMs = 40f;   // ~144 kph
        private const float MinSpeedMs    = 0.5f;  // prevent sqrt returning 0 for tiny engines

        // ── Public entry points ──────────────────

        /// <summary>
        /// Derive all chassis-level gameplay stats from a <see cref="UnitChassis"/>.
        /// Call this once when a unit is initialised; cache the result on the component.
        /// </summary>
        public static ChassisStats DeriveFromChassis(UnitChassis chassis)
        {
            if (chassis == null) throw new ArgumentNullException(nameof(chassis));

            var mat = ArmorConstants.Parse(chassis.HullArmorMaterial);

            return new ChassisStats
            {
                MaxSpeedMs = DeriveMaxSpeed(chassis.EngineKw, chassis.DrivetrainEfficiency, chassis.MassKg),
                RangeM     = DeriveRange(chassis.FuelCapacityMj, chassis.FuelConsumptionRateMjs,
                                         DeriveMaxSpeed(chassis.EngineKw, chassis.DrivetrainEfficiency, chassis.MassKg)),
                ArmorHp    = DeriveArmorHp(chassis.HullArmorThicknessMm, mat, chassis.MassKg),
                Material   = mat
            };
        }

        /// <summary>
        /// Derive weapon / other stats from a single <see cref="PartSchematic"/>.
        /// Non-weapon parts return a zeroed <see cref="PartStats"/> with WType == None.
        /// </summary>
        public static PartStats DeriveFromPart(PartSchematic part)
        {
            if (part == null) throw new ArgumentNullException(nameof(part));

            var wType = ParseWeaponType(part.WeaponTypeStr);

            if (wType == WeaponType.None || wType == WeaponType.Beam)
            {
                // Non-kinetic weapons or non-weapon parts: return basic range info only.
                return new PartStats
                {
                    WType          = wType,
                    EffectiveRangeM = part.EffectiveRangeM,
                    CooldownS      = DeriveKineticCooldown(part) // reuse cooldown even for beam
                };
            }

            // Kinetic & Missile paths use the kinetic equations.
            float muzzleVel = DeriveKineticMuzzleVelocity(part.PropellantEnergyMj, part.ProjectileMassKg);
            float ke        = DeriveKineticEnergy(part.ProjectileMassKg, muzzleVel);
            float pen       = DeriveKineticPenetration(ke, ArmorMaterial.SalvagedSteel); // vs reference steel
            float cooldown  = DeriveKineticCooldown(part);

            return new PartStats
            {
                MuzzleVelocityMs = muzzleVel,
                KineticEnergyJ   = ke,
                PenetrationMm    = pen,
                CooldownS        = cooldown,
                EffectiveRangeM  = part.EffectiveRangeM,
                WType            = wType
            };
        }

        /// <summary>
        /// Helper: collect DeriveFromPart results for all parts on a unit schematic.
        /// Only weapon parts (WType != None) are returned.
        /// </summary>
        public static List<PartStats> DeriveWeaponStats(UnitSchematic schematic)
        {
            var results = new List<PartStats>();
            if (schematic?.Parts == null) return results;

            foreach (var part in schematic.Parts)
            {
                var stats = DeriveFromPart(part);
                if (stats.WType != WeaponType.None)
                    results.Add(stats);
            }
            return results;
        }

        // ── Internal equations ───────────────────

        /// <summary>
        /// max_speed_ms = sqrt( 2 * engine_kW * 1000 * efficiency / mass_kg )
        /// Clamped to [MinSpeedMs, MaxSpeedCapMs].
        /// </summary>
        private static float DeriveMaxSpeed(float engineKw, float efficiency, float massKg)
        {
            if (massKg <= 0f)
            {
                Debug.LogWarning("[PhysicsConstitution] Chassis mass_kg is zero or negative — defaulting to 1 kg.");
                massKg = 1f;
            }
            if (engineKw <= 0f) return MinSpeedMs;

            double raw = Math.Sqrt(2.0 * engineKw * 1000.0 * efficiency / massKg);
            return Mathf.Clamp((float)raw, MinSpeedMs, MaxSpeedCapMs);
        }

        /// <summary>
        /// range_m = (fuel_capacity_MJ / fuel_consumption_rate_MJs) * max_speed_ms
        /// If fuel_consumption_rate_MJs == 0 → electric unit, range = float.MaxValue.
        /// </summary>
        private static float DeriveRange(float fuelCapMj, float consumptionMjs, float maxSpeedMs)
        {
            if (consumptionMjs <= 0f) return float.MaxValue;   // electric / grid-powered
            float enduranceS = fuelCapMj / consumptionMjs;
            return enduranceS * maxSpeedMs;
        }

        /// <summary>
        /// armor_hp = thickness_mm * material_factor * (mass_kg ^ 0.67 / 100)
        /// The mass-derived exponent approximates the physical surface area of a scaled vehicle.
        /// </summary>
        private static float DeriveArmorHp(float thicknessMm, ArmorMaterial mat, float massKg)
        {
            float factor      = ArmorConstants.FactorFor(mat);
            float surfaceFactor = Mathf.Pow(Mathf.Max(massKg, 1f), 0.67f) / 100f;
            return thicknessMm * factor * surfaceFactor;
        }

        /// <summary>
        /// muzzle_velocity_ms = sqrt( 2 * propellant_energy_MJ * 1e6 / projectile_mass_kg )
        /// </summary>
        private static float DeriveKineticMuzzleVelocity(float propellantEnergyMj, float projectileMassKg)
        {
            if (projectileMassKg <= 0f || propellantEnergyMj <= 0f) return 0f;
            double raw = Math.Sqrt(2.0 * propellantEnergyMj * 1e6 / projectileMassKg);
            return (float)raw;
        }

        /// <summary>KE = 0.5 * m * v²</summary>
        private static float DeriveKineticEnergy(float massKg, float velocityMs)
        {
            return 0.5f * massKg * velocityMs * velocityMs;
        }

        /// <summary>
        /// penetration_mm = kinetic_energy_J / (armor_material_factor * 1e6)
        /// Evaluated against the reference material provided (typically SalvagedSteel for a universal value).
        /// </summary>
        public static float DeriveKineticPenetration(float kineticEnergyJ, ArmorMaterial referenceMaterial)
        {
            float factor = ArmorConstants.FactorFor(referenceMaterial);
            if (factor <= 0f) return 0f;
            return kineticEnergyJ / (factor * 1_000_000f);
        }

        /// <summary>
        /// cooldown_s = (barrel_thermal_capacity_MJ - per_shot_heat_MJ) / cooling_rate_MJs
        /// Clamped to ≥ 0.
        /// </summary>
        private static float DeriveKineticCooldown(PartSchematic part)
        {
            if (part.CoolingRateMjs <= 0f) return 10f;  // effectively no active cooling
            float remainingCapacity = part.BarrelThermalCapacityMj - part.PerShotHeatMj;
            if (remainingCapacity <= 0f) return 0f;     // heat never accumulates past limit
            return Mathf.Max(0f, remainingCapacity / part.CoolingRateMjs);
        }

        private static WeaponType ParseWeaponType(string s) => s?.ToLowerInvariant() switch
        {
            "kinetic"   => WeaponType.Kinetic,
            "explosive" => WeaponType.Explosive,
            "beam"      => WeaponType.Beam,
            "missile"   => WeaponType.Missile,
            _           => WeaponType.None
        };
    }
}
