/**
 * UtilitySubform — fields specific to a utility part.
 *
 * Lift source: tools/editor/index.html lines 405-411.
 */

import type { ReactNode } from "react";

import { UTILITY_FUNCTIONS } from "../../lib/enums";
import type { UtilityFunction, UtilityPart } from "../../types/part";

import { NumberField, SelectField } from "./fields";

interface UtilitySubformProps {
  readonly part: UtilityPart;
  readonly onChange: (next: UtilityPart) => void;
}

export function UtilitySubform(props: UtilitySubformProps): ReactNode {
  const { part, onChange } = props;

  function patch(next: Partial<UtilityPart>): void {
    onChange({ ...part, ...next });
  }

  return (
    <>
      <SelectField<UtilityFunction>
        label="Function"
        value={part.utility_function}
        options={UTILITY_FUNCTIONS}
        onChange={(utility_function) => patch({ utility_function })}
      />
      <NumberField
        label="Radius"
        unit="m"
        value={part.utility_effect_radius_m}
        onChange={(utility_effect_radius_m) =>
          patch({ utility_effect_radius_m })
        }
        min={0}
        step={1}
      />
      <NumberField
        label="Rate"
        value={part.utility_effect_rate}
        onChange={(utility_effect_rate) => patch({ utility_effect_rate })}
        min={0}
        step={0.1}
      />
    </>
  );
}
