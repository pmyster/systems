/**
 * CommsSubform — fields specific to a communications part.
 *
 * Lift source: tools/editor/index.html lines 412-417.
 */

import type { ReactNode } from "react";

import { COMMUNICATIONS_TYPES } from "../../lib/enums";
import type {
  CommunicationsPart,
  CommunicationsType,
} from "../../types/part";

import { NumberField, SelectField } from "./fields";

interface CommsSubformProps {
  readonly part: CommunicationsPart;
  readonly onChange: (next: CommunicationsPart) => void;
}

export function CommsSubform(props: CommsSubformProps): ReactNode {
  const { part, onChange } = props;

  function patch(next: Partial<CommunicationsPart>): void {
    onChange({ ...part, ...next });
  }

  return (
    <>
      <SelectField<CommunicationsType>
        label="Type"
        value={part.communications_type}
        options={COMMUNICATIONS_TYPES}
        onChange={(communications_type) => patch({ communications_type })}
      />
      <NumberField
        label="Range"
        unit="m"
        value={part.communications_range_m}
        onChange={(communications_range_m) => patch({ communications_range_m })}
        min={0}
        step={500}
      />
    </>
  );
}
