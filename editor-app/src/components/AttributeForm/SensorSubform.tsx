/**
 * SensorSubform — fields specific to a sensor part.
 *
 * Lift source: tools/editor/index.html lines 392-399.
 */

import type { ReactNode } from "react";

import { SENSOR_MODALITIES } from "../../lib/enums";
import type { SensorModality, SensorPart } from "../../types/part";

import { CheckboxField, NumberField, SelectField } from "./fields";

interface SensorSubformProps {
  readonly part: SensorPart;
  readonly onChange: (next: SensorPart) => void;
}

export function SensorSubform(props: SensorSubformProps): ReactNode {
  const { part, onChange } = props;

  function patch(next: Partial<SensorPart>): void {
    onChange({ ...part, ...next });
  }

  return (
    <>
      <SelectField<SensorModality>
        label="Modality"
        value={part.sensor_modality}
        options={SENSOR_MODALITIES}
        onChange={(sensor_modality) => patch({ sensor_modality })}
      />
      <NumberField
        label="Range"
        unit="m"
        value={part.sensor_range_m}
        onChange={(sensor_range_m) => patch({ sensor_range_m })}
        min={0}
        step={100}
      />
      <NumberField
        label="Sensitivity"
        value={part.sensor_sensitivity}
        onChange={(sensor_sensitivity) => patch({ sensor_sensitivity })}
        min={0}
        step={0.1}
      />
      <CheckboxField
        label="Active"
        value={part.sensor_active ?? false}
        onChange={(sensor_active) => patch({ sensor_active })}
      />
    </>
  );
}
