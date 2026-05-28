/**
 * Archetype presets — one-click chassis + role quick-fill for the ChassisSection.
 *
 * Each preset carries realistic SI values consistent with the scale table in
 * docs/editor-app.md. Applying a preset patches `unit.chassis` and sets
 * `unit.role` in a single dispatch so the unit stays coherent.
 *
 * To add a new archetype: append an entry to ARCHETYPES. ChassisSection
 * renders the button array automatically — no other file needs editing.
 */

import type { ChassisClass, UnitChassis, UnitRole } from "../types/unit";

export interface ArchetypePreset {
  readonly id: string;
  readonly label: string;
  readonly role: UnitRole;
  readonly chassisClass: ChassisClass;
  readonly chassis: Partial<UnitChassis>;
}

export const ARCHETYPES: readonly ArchetypePreset[] = [
  // Scout — fast, light, wheeled
  {
    id: "scout",
    label: "Scout",
    role: "scout",
    chassisClass: "ground_wheeled",
    chassis: {
      chassis_class: "ground_wheeled",
      mass_kg: 4500,
      engine_kW: 320,
      drivetrain_efficiency: 0.82,
      energy_source: "fuel_cell",
      fuel_capacity_MJ: 180,
      fuel_consumption_rate_MJs: 0.6,
      armor_material: "salvaged_steel",
      armor_thickness_mm: 15,
      thermal_capacity_MJ: 20,
      hardpoint_count: 2,
      compatibility_tags: ["wheeled", "all_weather"],
    },
  },

  // Light Attack — fast tracked, light cannon
  {
    id: "light_attack",
    label: "Light Tank",
    role: "light_attack",
    chassisClass: "ground_tracked",
    chassis: {
      chassis_class: "ground_tracked",
      mass_kg: 12000,
      engine_kW: 550,
      drivetrain_efficiency: 0.72,
      energy_source: "fuel_cell",
      fuel_capacity_MJ: 350,
      fuel_consumption_rate_MJs: 1.1,
      armor_material: "salvaged_steel",
      armor_thickness_mm: 40,
      thermal_capacity_MJ: 60,
      hardpoint_count: 3,
      compatibility_tags: ["tracked"],
    },
  },

  // Main Battle — balanced tracked
  {
    id: "main_battle",
    label: "MBT",
    role: "main_battle",
    chassisClass: "ground_tracked",
    chassis: {
      chassis_class: "ground_tracked",
      mass_kg: 35000,
      engine_kW: 880,
      drivetrain_efficiency: 0.7,
      energy_source: "fuel_cell",
      fuel_capacity_MJ: 800,
      fuel_consumption_rate_MJs: 2.2,
      armor_material: "alloy_composite",
      armor_thickness_mm: 120,
      thermal_capacity_MJ: 150,
      hardpoint_count: 4,
      compatibility_tags: ["tracked"],
    },
  },

  // Heavy Assault — slow, thick armor
  {
    id: "heavy_assault",
    label: "Heavy",
    role: "heavy_assault",
    chassisClass: "ground_tracked",
    chassis: {
      chassis_class: "ground_tracked",
      mass_kg: 80000,
      engine_kW: 1200,
      drivetrain_efficiency: 0.65,
      energy_source: "hybrid",
      fuel_capacity_MJ: 1800,
      fuel_consumption_rate_MJs: 4.0,
      armor_material: "ceramic_layered",
      armor_thickness_mm: 280,
      thermal_capacity_MJ: 400,
      hardpoint_count: 5,
      compatibility_tags: ["tracked"],
    },
  },

  // Artillery — slow, huge range
  {
    id: "artillery",
    label: "Artillery",
    role: "artillery",
    chassisClass: "ground_tracked",
    chassis: {
      chassis_class: "ground_tracked",
      mass_kg: 25000,
      engine_kW: 480,
      drivetrain_efficiency: 0.66,
      energy_source: "fuel_cell",
      fuel_capacity_MJ: 600,
      fuel_consumption_rate_MJs: 1.5,
      armor_material: "salvaged_steel",
      armor_thickness_mm: 30,
      thermal_capacity_MJ: 80,
      hardpoint_count: 2,
      compatibility_tags: ["tracked"],
    },
  },

  // Support — medium, lots of hardpoints, hybrid power
  {
    id: "support",
    label: "Support",
    role: "support",
    chassisClass: "ground_wheeled",
    chassis: {
      chassis_class: "ground_wheeled",
      mass_kg: 18000,
      engine_kW: 420,
      drivetrain_efficiency: 0.8,
      energy_source: "hybrid",
      fuel_capacity_MJ: 500,
      fuel_consumption_rate_MJs: 1.0,
      battery_capacity_MJ: 120,
      battery_recharge_rate_MJs: 0.4,
      armor_material: "salvaged_steel",
      armor_thickness_mm: 25,
      thermal_capacity_MJ: 100,
      hardpoint_count: 6,
      compatibility_tags: ["wheeled", "all_weather"],
    },
  },

  // Air Fighter — fast, lightweight fixed-wing
  {
    id: "air_fighter",
    label: "Fighter",
    role: "air_fighter",
    chassisClass: "air_fixed_wing",
    chassis: {
      chassis_class: "air_fixed_wing",
      mass_kg: 8500,
      engine_kW: 1800,
      drivetrain_efficiency: 0.9,
      energy_source: "fuel_cell",
      fuel_capacity_MJ: 900,
      fuel_consumption_rate_MJs: 5.0,
      armor_material: "salvaged_steel",
      armor_thickness_mm: 8,
      thermal_capacity_MJ: 40,
      hardpoint_count: 4,
      compatibility_tags: [],
    },
  },

  // Gunship — slow, heavy rotary, lots of weapons
  {
    id: "gunship",
    label: "Gunship",
    role: "gunship",
    chassisClass: "air_rotary",
    chassis: {
      chassis_class: "air_rotary",
      mass_kg: 14000,
      engine_kW: 1200,
      drivetrain_efficiency: 0.78,
      energy_source: "fuel_cell",
      fuel_capacity_MJ: 1200,
      fuel_consumption_rate_MJs: 4.0,
      armor_material: "alloy_composite",
      armor_thickness_mm: 35,
      thermal_capacity_MJ: 80,
      hardpoint_count: 6,
      compatibility_tags: [],
    },
  },

  // Naval — displacement hull, fusion powered
  {
    id: "naval",
    label: "Warship",
    role: "naval",
    chassisClass: "naval_surface",
    chassis: {
      chassis_class: "naval_surface",
      mass_kg: 180000,
      engine_kW: 2800,
      drivetrain_efficiency: 0.75,
      energy_source: "fusion",
      fuel_capacity_MJ: 8000,
      fuel_consumption_rate_MJs: 3.5,
      armor_material: "alloy_composite",
      armor_thickness_mm: 90,
      thermal_capacity_MJ: 800,
      hardpoint_count: 8,
      compatibility_tags: ["displacement_hull", "amphibious"],
    },
  },

  // Structure — static tower, grid-tethered, no engine
  {
    id: "structure",
    label: "Tower",
    role: "structure",
    chassisClass: "static_structure",
    chassis: {
      chassis_class: "static_structure",
      mass_kg: 5000,
      engine_kW: 0,
      drivetrain_efficiency: 0,
      energy_source: "grid_tethered",
      battery_capacity_MJ: 500,
      battery_recharge_rate_MJs: 2.0,
      armor_material: "ceramic_layered",
      armor_thickness_mm: 200,
      thermal_capacity_MJ: 300,
      hardpoint_count: 3,
      compatibility_tags: [],
    },
  },
];
