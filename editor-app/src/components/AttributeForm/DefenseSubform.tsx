/**
 * DefenseSubform — fields specific to a defense part (shields, armor add).
 *
 * Lift source: tools/editor/index.html lines 400-404.
 */

import type { ReactNode } from "react";

import { PART_ARMOR_MATERIALS } from "../../lib/enums";
import type { DefensePart, PartArmorMaterial } from "../../types/part";

import { NumberField, SelectField } from "./fields";

interface DefenseSubformProps {
  readonly part: DefensePart;
  readonly onChange: (next: DefensePart) => void;
}

export function DefenseSubform(props: DefenseSubformProps): ReactNode {
  const { part, onChange } = props;

  function patch(next: Partial<DefensePart>): void {
    onChange({ ...part, ...next });
  }

  return (
    <>
      <NumberField
        label="Shield Cap."
        unit="MJ"
        value={part.shield_capacity_MJ}
        onChange={(shield_capacity_MJ) => patch({ shield_capacity_MJ })}
        min={0}
        step={10}
      />
      <NumberField
        label="Shield Regen"
        unit="MJ/s"
        value={part.shield_regen_rate_MJs}
        onChange={(shield_regen_rate_MJs) => patch({ shield_regen_rate_MJs })}
        min={0}
        step={0.5}
      />
      <NumberField
        label="Armor Bonus"
        unit="mm"
        value={part.armor_bonus_mm}
        onChange={(armor_bonus_mm) => patch({ armor_bonus_mm })}
        min={0}
        step={5}
      />
      <SelectField<PartArmorMaterial>
        label="Armor Material"
        value={part.armor_material}
        options={PART_ARMOR_MATERIALS}
        onChange={(armor_material) => patch({ armor_material })}
      />
    </>
  );
}
