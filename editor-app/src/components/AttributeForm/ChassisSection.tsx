/**
 * ChassisSection — physical-input fields on the unit's chassis.
 *
 * Per DESIGN.md Principle 2, every field here is a *physical input*:
 * mass, engine power, drivetrain efficiency, energy source, fuel /
 * battery capacities, thermal capacity, armor thickness, compatibility
 * tags. Speed, range, endurance — those live in DerivedStatsPanel.
 *
 * The `mass_kg` field is editable as a fallback, but the real source
 * for chassis mass is the voxel sculpt — the VoxelSculptor pane writes
 * `chassis.voxel_data`, and the integration layer is expected to roll
 * the voxel mass into chassis.mass_kg before save. For v0.1 the form
 * shows a help note explaining the relationship.
 *
 * Lift source: tools/editor/index.html lines 179-248.
 */

import { type ReactNode } from "react";

import { ARCHETYPES, type ArchetypePreset } from "../../lib/archetypes";
import {
  ARMOR_MATERIALS,
  CHASSIS_CLASSES,
  COMPATIBILITY_TAGS,
  ENERGY_SOURCES,
  humanizeEnum,
} from "../../lib/enums";
import type {
  ArmorMaterial,
  ChassisClass,
  CompatibilityTag,
  EnergySource,
  UnitChassis,
  UnitSchematic,
} from "../../types/unit";

import {
  NumberField,
  SelectField,
} from "./fields";
import styles from "./AttributeForm.module.css";

interface ChassisSectionProps {
  readonly unit: UnitSchematic;
  readonly onUnitChange: (next: UnitSchematic) => void;
}

export function ChassisSection(props: ChassisSectionProps): ReactNode {
  const { unit, onUnitChange } = props;
  const c = unit.chassis;

  // Helper: patch a single chassis field.
  // We use a typed key set rather than a generic <K extends keyof
  // UnitChassis> because the optional-vs-required nuance trips up
  // TypeScript when the value is undefined. The explicit overload is
  // simpler and less error-prone.
  function patch(next: Partial<UnitChassis>): void {
    onUnitChange({
      ...unit,
      chassis: { ...c, ...next },
    });
  }

  // Tag toggle — add if absent, remove if present.
  function toggleTag(tag: CompatibilityTag): void {
    const current = c.compatibility_tags ?? [];
    const exists = current.includes(tag);
    const next = exists
      ? current.filter((t) => t !== tag)
      : [...current, tag];
    patch({ compatibility_tags: next });
  }

  const tags = c.compatibility_tags ?? [];

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionHeader}>
        Chassis
        <span className={styles.sectionBadge}>physical inputs only</span>
      </h3>

      {/* Archetype quick-fill — sets role + all chassis fields in one click */}
      {((): ReactNode => {
        const mobile = ARCHETYPES.filter(
          (a: ArchetypePreset) =>
            a.chassisClass !== "static_structure" && a.chassisClass !== "static_wall",
        );
        const towers = ARCHETYPES.filter(
          (a: ArchetypePreset) =>
            a.chassisClass === "static_structure" && a.id !== "structure",
        );
        const walls = ARCHETYPES.filter(
          (a: ArchetypePreset) => a.chassisClass === "static_wall",
        );
        // Legacy "structure / Tower" preset
        const legacyStructure = ARCHETYPES.filter(
          (a: ArchetypePreset) => a.id === "structure",
        );

        function applyArchetype(a: ArchetypePreset): void {
          onUnitChange({ ...unit, role: a.role, chassis: { ...c, ...a.chassis } });
        }

        function groupButtons(archetypes: readonly ArchetypePreset[]): ReactNode {
          return archetypes.map((a) => (
            <button
              key={a.id}
              type="button"
              className={styles.archetypeBtn}
              title={`Fill as ${a.label}`}
              onClick={() => applyArchetype(a)}
            >
              {a.label}
            </button>
          ));
        }

        return (
          <div className={styles.row}>
            <label className={styles.label}>Archetype</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              <span style={{ fontSize: 10, color: "#6b7280", width: "100%", marginBottom: 2 }}>
                — Mobile —
              </span>
              {groupButtons(mobile)}
              <span style={{ fontSize: 10, color: "#6b7280", width: "100%", marginTop: 4, marginBottom: 2 }}>
                — Structures —
              </span>
              {groupButtons(legacyStructure)}
              {groupButtons(towers)}
              <span style={{ fontSize: 10, color: "#6b7280", width: "100%", marginTop: 4, marginBottom: 2 }}>
                — Walls —
              </span>
              {groupButtons(walls)}
            </div>
          </div>
        );
      })()}

      <SelectField<ChassisClass>
        label="Class"
        value={c.chassis_class}
        options={CHASSIS_CLASSES}
        onChange={(chassis_class) => patch({ chassis_class })}
      />

      <NumberField
        label="Mass"
        unit="kg"
        value={c.mass_kg}
        onChange={(mass_kg) => patch({ mass_kg })}
        min={1}
        step={100}
        help="computed from voxel data once VoxelSculptor integration lands"
      />

      <NumberField
        label="Engine"
        unit="kW"
        value={c.engine_kW}
        onChange={(engine_kW) => patch({ engine_kW })}
        min={0}
        step={10}
      />

      <NumberField
        label="Drivetrain Eff."
        value={c.drivetrain_efficiency}
        onChange={(drivetrain_efficiency) => patch({ drivetrain_efficiency })}
        min={0}
        max={1}
        step={0.05}
        help="0-1; tracked ~0.7; wheeled ~0.82; legged ~0.55"
      />

      <SelectField<EnergySource>
        label="Energy Source"
        value={c.energy_source}
        options={ENERGY_SOURCES}
        onChange={(energy_source) => patch({ energy_source })}
      />

      <NumberField
        label="Thermal Cap."
        unit="MJ"
        value={c.thermal_capacity_MJ}
        onChange={(thermal_capacity_MJ) => patch({ thermal_capacity_MJ })}
        min={0}
        step={10}
      />

      <NumberField
        label="Fuel Capacity"
        unit="MJ"
        value={c.fuel_capacity_MJ}
        onChange={(fuel_capacity_MJ) => patch({ fuel_capacity_MJ })}
        min={0}
        step={10}
      />

      <NumberField
        label="Fuel Rate"
        unit="MJ/s"
        value={c.fuel_consumption_rate_MJs}
        onChange={(fuel_consumption_rate_MJs) =>
          patch({ fuel_consumption_rate_MJs })
        }
        min={0}
        step={0.1}
        help="at full engine power; cruise burn is ~50% of this"
      />

      <NumberField
        label="Battery"
        unit="MJ"
        value={c.battery_capacity_MJ}
        onChange={(battery_capacity_MJ) => patch({ battery_capacity_MJ })}
        min={0}
        step={10}
      />

      <NumberField
        label="Battery Recharge"
        unit="MJ/s"
        value={c.battery_recharge_rate_MJs}
        onChange={(battery_recharge_rate_MJs) =>
          patch({ battery_recharge_rate_MJs })
        }
        min={0}
        step={0.1}
      />

      <NumberField
        label="Solar Area"
        unit="m²"
        value={c.solar_collection_area_m2}
        onChange={(solar_collection_area_m2) =>
          patch({ solar_collection_area_m2 })
        }
        min={0}
        step={0.5}
      />

      <SelectField<ArmorMaterial>
        label="Armor Material"
        value={c.armor_material}
        options={ARMOR_MATERIALS}
        onChange={(armor_material) => patch({ armor_material })}
      />

      <NumberField
        label="Armor Thickness"
        unit="mm"
        value={c.armor_thickness_mm}
        onChange={(armor_thickness_mm) => patch({ armor_thickness_mm })}
        min={0}
        step={5}
      />

      <NumberField
        label="Hardpoint Count"
        value={c.hardpoint_count}
        onChange={(hardpoint_count) =>
          patch({ hardpoint_count: Math.max(0, Math.round(hardpoint_count)) })
        }
        min={0}
        step={1}
        help="set manually for v0.1; voxel hardpoints inferred later"
      />

      <div className={styles.row}>
        <label className={styles.label}>Compat. Tags</label>
        <div>
          <div className={styles.tagList}>
            {tags.length === 0 ? (
              <span className={styles.empty}>no tags</span>
            ) : (
              tags.map((t) => (
                <span key={t} className={styles.tagChip}>
                  {humanizeEnum(t)}
                  <button
                    type="button"
                    className={styles.tagRemove}
                    onClick={() => toggleTag(t)}
                    title={`remove ${t}`}
                  >
                    ×
                  </button>
                </span>
              ))
            )}
          </div>
          <select
            className={styles.select}
            value=""
            onChange={(e) => {
              const v = e.target.value;
              if (v === "") return;
              // The select is constrained to CompatibilityTag.
              toggleTag(v as CompatibilityTag);
            }}
          >
            <option value="">+ add tag</option>
            {COMPATIBILITY_TAGS.filter((t) => !tags.includes(t)).map((t) => (
              <option key={t} value={t}>
                {humanizeEnum(t)}
              </option>
            ))}
          </select>
        </div>
      </div>
    </section>
  );
}
