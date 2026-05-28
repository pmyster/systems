// UnitSchematic.cs
// C# data classes mirroring the JSON unit schema.
// Requires: com.unity.nuget.newtonsoft-json

using System;
using System.Collections.Generic;
using Newtonsoft.Json;
using UnityEngine;

namespace ChildOfLight.Core
{
    // ─────────────────────────────────────────────
    //  Enumerations
    // ─────────────────────────────────────────────

    public enum UnitRole
    {
        Scout,
        LightAttack,
        MainBattle,
        HeavyAssault,
        Artillery,
        Support,
        AirFighter,
        Gunship,
        Naval,
        Structure,
        Elite
    }

    public enum ArmorMaterial
    {
        SalvagedSteel,
        AlloyComposite,
        CeramicLayered,
        ExoticLattice
    }

    public enum WeaponType
    {
        Kinetic,
        Explosive,
        Beam,
        Missile,
        None
    }

    public enum Faction
    {
        Reclaimer,   // player
        Bulwark,     // defensive AI
        Signal,      // info-war AI
        CinderCrown  // aggressive AI
    }

    // ─────────────────────────────────────────────
    //  Part schematic (simplified — full schema in part.schema.json)
    // ─────────────────────────────────────────────

    [Serializable]
    public class PartSchematic
    {
        [JsonProperty("part_id")]
        public string PartId = string.Empty;

        [JsonProperty("name")]
        public string Name = string.Empty;

        [JsonProperty("part_type")]
        public string PartType = string.Empty;   // "weapon", "engine", "armor", "sensor", etc.

        // --- Armor fields ---
        [JsonProperty("armor_thickness_mm")]
        public float ArmorThicknessMm = 0f;

        [JsonProperty("armor_material")]
        public string ArmorMaterial = "salvaged_steel";

        // --- Engine fields ---
        [JsonProperty("engine_kw")]
        public float EngineKw = 0f;

        [JsonProperty("drivetrain_efficiency")]
        public float DrivetrainEfficiency = 0.85f;

        [JsonProperty("fuel_capacity_mj")]
        public float FuelCapacityMj = 0f;

        [JsonProperty("fuel_consumption_rate_mjs")]
        public float FuelConsumptionRateMjs = 0f;

        // --- Weapon fields (kinetic) ---
        [JsonProperty("weapon_type")]
        public string WeaponTypeStr = "none";

        [JsonProperty("propellant_energy_mj")]
        public float PropellantEnergyMj = 0f;

        [JsonProperty("projectile_mass_kg")]
        public float ProjectileMassKg = 0f;

        [JsonProperty("barrel_thermal_capacity_mj")]
        public float BarrelThermalCapacityMj = 0f;

        [JsonProperty("per_shot_heat_mj")]
        public float PerShotHeatMj = 0f;

        [JsonProperty("cooling_rate_mjs")]
        public float CoolingRateMjs = 1f;

        [JsonProperty("effective_range_m")]
        public float EffectiveRangeM = 100f;

        // --- Mass contribution ---
        [JsonProperty("mass_kg")]
        public float MassKg = 500f;
    }

    // ─────────────────────────────────────────────
    //  Chassis
    // ─────────────────────────────────────────────

    [Serializable]
    public class UnitChassis
    {
        [JsonProperty("chassis_id")]
        public string ChassisId = string.Empty;

        [JsonProperty("name")]
        public string Name = string.Empty;

        [JsonProperty("mass_kg")]
        public float MassKg = 5000f;

        [JsonProperty("hull_armor_thickness_mm")]
        public float HullArmorThicknessMm = 50f;

        [JsonProperty("hull_armor_material")]
        public string HullArmorMaterial = "salvaged_steel";

        [JsonProperty("engine_kw")]
        public float EngineKw = 300f;

        [JsonProperty("drivetrain_efficiency")]
        public float DrivetrainEfficiency = 0.85f;

        [JsonProperty("fuel_capacity_mj")]
        public float FuelCapacityMj = 500f;

        [JsonProperty("fuel_consumption_rate_mjs")]
        public float FuelConsumptionRateMjs = 0.5f;

        [JsonProperty("part_slots")]
        public int PartSlots = 4;
    }

    // ─────────────────────────────────────────────
    //  Costs
    // ─────────────────────────────────────────────

    [Serializable]
    public class UnitCosts
    {
        [JsonProperty("power")]
        public int Power = 0;

        [JsonProperty("scrap")]
        public int Scrap = 0;

        [JsonProperty("alloy")]
        public int Alloy = 0;

        [JsonProperty("build_time_s")]
        public float BuildTimeS = 30f;
    }

    // ─────────────────────────────────────────────
    //  Top-level UnitSchematic
    // ─────────────────────────────────────────────

    [Serializable]
    public class UnitSchematic
    {
        [JsonProperty("schema_version")]
        public string SchemaVersion = "1.0";

        [JsonProperty("unit_id")]
        public string UnitId = string.Empty;

        [JsonProperty("name")]
        public string Name = string.Empty;

        [JsonProperty("description")]
        public string Description = string.Empty;

        [JsonProperty("faction")]
        public string FactionStr = "reclaimer";

        [JsonProperty("role")]
        public string RoleStr = "scout";

        [JsonProperty("chassis")]
        public UnitChassis Chassis = new UnitChassis();

        [JsonProperty("parts")]
        public List<PartSchematic> Parts = new List<PartSchematic>();

        [JsonProperty("costs")]
        public UnitCosts Costs = new UnitCosts();

        [JsonProperty("tags")]
        public List<string> Tags = new List<string>();

        // ── Convenience accessors ──

        public UnitRole Role => RoleStr switch
        {
            "scout"         => UnitRole.Scout,
            "light_attack"  => UnitRole.LightAttack,
            "main_battle"   => UnitRole.MainBattle,
            "heavy_assault" => UnitRole.HeavyAssault,
            "artillery"     => UnitRole.Artillery,
            "support"       => UnitRole.Support,
            "air_fighter"   => UnitRole.AirFighter,
            "gunship"       => UnitRole.Gunship,
            "naval"         => UnitRole.Naval,
            "structure"     => UnitRole.Structure,
            "elite"         => UnitRole.Elite,
            _               => UnitRole.Scout
        };

        public Faction Faction => FactionStr switch
        {
            "bulwark"      => Faction.Bulwark,
            "signal"       => Faction.Signal,
            "cinder_crown" => Faction.CinderCrown,
            _              => Faction.Reclaimer
        };
    }
}
