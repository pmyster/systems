/**
 * PartsSection - list editor for unit parts.
 *
 * Maintains the discriminated-union invariant: each part renders the
 * subform matching its `category`. Switching the category swaps the
 * subform and re-seeds the category-specific fields with defaults
 * (matching the prototype's addPart behavior).
 *
 * Lift sources:
 *  - tools/editor/index.html lines 314-356 (per-category defaults)
 *  - tools/editor/index.html lines 358-368 (remove / update)
 *  - tools/editor/index.html lines 370-436 (render parts list)
 */

import { useState, type ReactNode } from "react";

import { PART_CATEGORIES, humanizeEnum } from "../../lib/enums";
import type {
  CommunicationsPart,
  DefensePart,
  MobilityAuxPart,
  PartCategory,
  PartSchematic,
  SensorPart,
  UtilityPart,
  WeaponPart,
} from "../../types/part";
import {
  isCommunications,
  isDefense,
  isMobilityAux,
  isSensor,
  isUtility,
  isWeapon,
} from "../../types/part";
import type { UnitSchematic } from "../../types/unit";

import { CommsSubform } from "./CommsSubform";
import { DefenseSubform } from "./DefenseSubform";
import { MobilitySubform } from "./MobilitySubform";
import { NumberField, SelectField, TextField } from "./fields";
import { SensorSubform } from "./SensorSubform";
import { UtilitySubform } from "./UtilitySubform";
import { WeaponSubform } from "./WeaponSubform";
import styles from "./AttributeForm.module.css";

// ----------------------------------------------------------------------
// Defaults - per-category seed values. Lifted verbatim from
// tools/editor/index.html lines 314-356.
// ----------------------------------------------------------------------

function makeWeaponPart(id: string): WeaponPart {
  return {
    id,
    category: "weapon",
    name: "New weapon",
    mass_kg: 100,
    power_draw_kW: 5,
    weapon_type: "kinetic",
    propellant_energy_MJ: 1.0,
    projectile_mass_kg: 0.5,
    barrel_thermal_capacity_MJ: 50,
    per_shot_heat_MJ: 3,
    cooling_rate_MJs: 2,
    drag_coefficient: 0.3,
    elevation_range_deg: [-10, 30],
  };
}

function makeSensorPart(id: string): SensorPart {
  return {
    id,
    category: "sensor",
    name: "New sensor",
    mass_kg: 100,
    power_draw_kW: 5,
    sensor_modality: "radar",
    sensor_range_m: 1500,
    sensor_sensitivity: 1.0,
    sensor_active: true,
  };
}

function makeDefensePart(id: string): DefensePart {
  return {
    id,
    category: "defense",
    name: "New defense",
    mass_kg: 100,
    power_draw_kW: 5,
    shield_capacity_MJ: 200,
    shield_regen_rate_MJs: 4,
    armor_bonus_mm: 20,
  };
}

function makeUtilityPart(id: string): UtilityPart {
  return {
    id,
    category: "utility",
    name: "New utility",
    mass_kg: 100,
    power_draw_kW: 5,
    utility_function: "constructor",
    utility_effect_radius_m: 8,
    utility_effect_rate: 1.0,
  };
}

function makeMobilityAuxPart(id: string): MobilityAuxPart {
  return {
    id,
    category: "mobility_aux",
    name: "New mobility aux",
    mass_kg: 100,
    power_draw_kW: 5,
    mobility_bonus_speed: 1.1,
    mobility_bonus_turn_rate: 1.1,
  };
}

function makeCommsPart(id: string): CommunicationsPart {
  return {
    id,
    category: "communications",
    name: "New communications",
    mass_kg: 100,
    power_draw_kW: 5,
    communications_type: "radio",
    communications_range_m: 5000,
  };
}

function makePart(category: PartCategory, id: string): PartSchematic {
  switch (category) {
    case "weapon":
      return makeWeaponPart(id);
    case "sensor":
      return makeSensorPart(id);
    case "defense":
      return makeDefensePart(id);
    case "utility":
      return makeUtilityPart(id);
    case "mobility_aux":
      return makeMobilityAuxPart(id);
    case "communications":
      return makeCommsPart(id);
  }
}

// ----------------------------------------------------------------------
// PartsSection - the visible component.
// ----------------------------------------------------------------------

interface PartsSectionProps {
  readonly unit: UnitSchematic;
  readonly onUnitChange: (next: UnitSchematic) => void;
}

export function PartsSection(props: PartsSectionProps): ReactNode {
  const { unit, onUnitChange } = props;
  const parts: readonly PartSchematic[] = unit.parts ?? [];

  function setParts(next: readonly PartSchematic[]): void {
    onUnitChange({ ...unit, parts: next });
  }

  function addPart(category: PartCategory): void {
    let n = parts.length + 1;
    let id = `part_${n}`;
    const existing = new Set(parts.map((p) => p.id));
    while (existing.has(id)) {
      n += 1;
      id = `part_${n}`;
    }
    setParts([...parts, makePart(category, id)]);
  }

  function removePart(idx: number): void {
    const next = parts.slice();
    next.splice(idx, 1);
    setParts(next);
  }

  function updatePart(idx: number, replacement: PartSchematic): void {
    const next = parts.slice();
    next[idx] = replacement;
    setParts(next);
  }

  // Change a part's category - re-seed with the new category's defaults
  // but preserve id / name / mass / power so the user doesn't lose their
  // header edits. We can't spread a discriminated union and reassign to
  // the same union - TypeScript widens the discriminator. Switch on the
  // seeded value's category so each branch keeps a narrow type.
  function changeCategory(idx: number, nextCategory: PartCategory): void {
    const existing = parts[idx];
    if (!existing) return;
    if (existing.category === nextCategory) return;
    const seeded = makePart(nextCategory, existing.id);
    const carry = {
      name: existing.name,
      mass_kg: existing.mass_kg,
      ...(existing.power_draw_kW !== undefined
        ? { power_draw_kW: existing.power_draw_kW }
        : {}),
    };
    let merged: PartSchematic;
    switch (seeded.category) {
      case "weapon":
        merged = { ...seeded, ...carry };
        break;
      case "sensor":
        merged = { ...seeded, ...carry };
        break;
      case "defense":
        merged = { ...seeded, ...carry };
        break;
      case "mobility_aux":
        merged = { ...seeded, ...carry };
        break;
      case "utility":
        merged = { ...seeded, ...carry };
        break;
      case "communications":
        merged = { ...seeded, ...carry };
        break;
    }
    updatePart(idx, merged);
  }

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionHeader}>
        Parts
        <span className={styles.sectionBadge}>{parts.length} item(s)</span>
      </h3>

      {parts.length === 0 ? (
        <div className={styles.empty}>No parts. Add one below.</div>
      ) : (
        parts.map((part, idx) => (
          <PartCard
            key={`${part.id}-${idx}`}
            part={part}
            idx={idx}
            onChange={(next) => updatePart(idx, next)}
            onChangeCategory={(cat) => changeCategory(idx, cat)}
            onRemove={() => removePart(idx)}
          />
        ))
      )}

      <AddPartRow onAdd={addPart} />
    </section>
  );
}

// ----------------------------------------------------------------------
// Per-part card - common fields + category-specific subform dispatch.
// ----------------------------------------------------------------------

interface PartCardProps {
  readonly part: PartSchematic;
  readonly idx: number;
  readonly onChange: (next: PartSchematic) => void;
  readonly onChangeCategory: (next: PartCategory) => void;
  readonly onRemove: () => void;
}

function PartCard(props: PartCardProps): ReactNode {
  const { part, idx, onChange, onChangeCategory, onRemove } = props;

  // Common-field patcher. We can't spread directly across the union
  // without TypeScript widening the discriminator; switch on category
  // and rebuild.
  function patchCommon(next: {
    id?: string;
    name?: string;
    mass_kg?: number;
    power_draw_kW?: number;
  }): void {
    if (isWeapon(part)) onChange({ ...part, ...next });
    else if (isSensor(part)) onChange({ ...part, ...next });
    else if (isDefense(part)) onChange({ ...part, ...next });
    else if (isMobilityAux(part)) onChange({ ...part, ...next });
    else if (isUtility(part)) onChange({ ...part, ...next });
    else if (isCommunications(part)) onChange({ ...part, ...next });
  }

  return (
    <div className={styles.partCard}>
      <div className={styles.partHeader}>
        <div>
          <span className={styles.partTitle}>
            {humanizeEnum(part.category)}
          </span>
          <span className={styles.partSubtitle}>#{idx + 1}</span>
        </div>
        <button
          type="button"
          className={styles.buttonDanger}
          onClick={onRemove}
          title="remove part"
        >
          remove
        </button>
      </div>

      <SelectField<PartCategory>
        label="Category"
        value={part.category}
        options={PART_CATEGORIES}
        onChange={onChangeCategory}
        help="changes the subform; common fields are preserved"
      />

      <TextField
        label="ID"
        value={part.id}
        onChange={(id) => patchCommon({ id })}
      />
      <TextField
        label="Name"
        value={part.name}
        onChange={(name) => patchCommon({ name })}
      />
      <NumberField
        label="Mass"
        unit="kg"
        value={part.mass_kg}
        onChange={(mass_kg) => patchCommon({ mass_kg })}
        min={0}
        step={10}
      />
      <NumberField
        label="Power Draw"
        unit="kW"
        value={part.power_draw_kW}
        onChange={(power_draw_kW) => patchCommon({ power_draw_kW })}
        min={0}
        step={1}
      />

      {/* Category-specific subform. Narrowing dispatch keeps each
          subform strictly typed against its branch - no `any`. */}
      {isWeapon(part) ? (
        <WeaponSubform part={part} onChange={(p) => onChange(p)} />
      ) : null}
      {isSensor(part) ? (
        <SensorSubform part={part} onChange={(p) => onChange(p)} />
      ) : null}
      {isDefense(part) ? (
        <DefenseSubform part={part} onChange={(p) => onChange(p)} />
      ) : null}
      {isMobilityAux(part) ? (
        <MobilitySubform part={part} onChange={(p) => onChange(p)} />
      ) : null}
      {isUtility(part) ? (
        <UtilitySubform part={part} onChange={(p) => onChange(p)} />
      ) : null}
      {isCommunications(part) ? (
        <CommsSubform part={part} onChange={(p) => onChange(p)} />
      ) : null}
    </div>
  );
}

// ----------------------------------------------------------------------
// Add-part control. A select + a button matching the prototype.
// ----------------------------------------------------------------------

interface AddPartRowProps {
  readonly onAdd: (category: PartCategory) => void;
}

function AddPartRow(props: AddPartRowProps): ReactNode {
  const { onAdd } = props;
  // Pending category is local UI state. The add button commits it to
  // the canonical unit; until then it never touches the source of
  // truth.
  const [pending, setPending] = useState<PartCategory>("weapon");

  return (
    <div className={styles.addPart}>
      <select
        className={styles.select}
        value={pending}
        onChange={(e) => setPending(e.target.value as PartCategory)}
      >
        {PART_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {humanizeEnum(c)}
          </option>
        ))}
      </select>
      <button
        type="button"
        className={`${styles.button} ${styles.buttonPrimary}`}
        onClick={() => onAdd(pending)}
      >
        + Add Part
      </button>
    </div>
  );
}
