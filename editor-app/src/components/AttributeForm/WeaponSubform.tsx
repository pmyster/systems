/**
 * WeaponSubform — fields specific to a weapon part.
 *
 * Per DESIGN.md Principle 2: the editor accepts propellant_energy_MJ,
 * projectile_mass_kg, barrel_thermal_capacity_MJ, per_shot_heat_MJ,
 * cooling_rate_MJs, drag_coefficient — *never* raw muzzle velocity,
 * effective range, or rate of fire. Those derive from the inputs above
 * in src/lib/derive-stats.ts.
 *
 * Lift source: tools/editor/index.html lines 381-391.
 */

import type { ReactNode } from "react";

import { WEAPON_TYPES } from "../../lib/enums";
import type { WeaponPart, WeaponType } from "../../types/part";

import { NumberField, SelectField } from "./fields";

interface WeaponSubformProps {
  readonly part: WeaponPart;
  readonly onChange: (next: WeaponPart) => void;
}

export function WeaponSubform(props: WeaponSubformProps): ReactNode {
  const { part, onChange } = props;

  function patch(next: Partial<WeaponPart>): void {
    onChange({ ...part, ...next });
  }

  // elevation_range_deg is a tuple [min, max]; edit each end independently.
  const elevation = part.elevation_range_deg ?? [-10, 30];

  return (
    <>
      <SelectField<WeaponType>
        label="Type"
        value={part.weapon_type}
        options={WEAPON_TYPES}
        onChange={(weapon_type) => patch({ weapon_type })}
      />
      <NumberField
        label="Propellant"
        unit="MJ"
        value={part.propellant_energy_MJ}
        onChange={(propellant_energy_MJ) => patch({ propellant_energy_MJ })}
        min={0}
        step={0.1}
      />
      <NumberField
        label="Projectile"
        unit="kg"
        value={part.projectile_mass_kg}
        onChange={(projectile_mass_kg) => patch({ projectile_mass_kg })}
        min={0}
        step={0.05}
      />
      <NumberField
        label="Barrel Therm. Cap"
        unit="MJ"
        value={part.barrel_thermal_capacity_MJ}
        onChange={(barrel_thermal_capacity_MJ) =>
          patch({ barrel_thermal_capacity_MJ })
        }
        min={0}
        step={5}
      />
      <NumberField
        label="Heat / Shot"
        unit="MJ"
        value={part.per_shot_heat_MJ}
        onChange={(per_shot_heat_MJ) => patch({ per_shot_heat_MJ })}
        min={0}
        step={0.5}
      />
      <NumberField
        label="Cooling"
        unit="MJ/s"
        value={part.cooling_rate_MJs}
        onChange={(cooling_rate_MJs) => patch({ cooling_rate_MJs })}
        min={0}
        step={0.5}
      />
      <NumberField
        label="Drag"
        value={part.drag_coefficient}
        onChange={(drag_coefficient) => patch({ drag_coefficient })}
        min={0}
        step={0.05}
      />
      <NumberField
        label="Elevation Min"
        unit="deg"
        value={elevation[0]}
        onChange={(minDeg) =>
          patch({ elevation_range_deg: [minDeg, elevation[1]] })
        }
        step={1}
      />
      <NumberField
        label="Elevation Max"
        unit="deg"
        value={elevation[1]}
        onChange={(maxDeg) =>
          patch({ elevation_range_deg: [elevation[0], maxDeg] })
        }
        step={1}
      />
    </>
  );
}
