/**
 * MobilitySubform — fields specific to a mobility-aux part.
 *
 * These multipliers apply to derived speed and turn rate. They're
 * physical inputs because the engine treats them as gear-ratio
 * coefficients on the underlying drivetrain — not as authored speeds.
 *
 * Lift source: tools/editor/index.html lines 418-421.
 */

import type { ReactNode } from "react";

import type { MobilityAuxPart } from "../../types/part";

import { NumberField } from "./fields";

interface MobilitySubformProps {
  readonly part: MobilityAuxPart;
  readonly onChange: (next: MobilityAuxPart) => void;
}

export function MobilitySubform(props: MobilitySubformProps): ReactNode {
  const { part, onChange } = props;

  function patch(next: Partial<MobilityAuxPart>): void {
    onChange({ ...part, ...next });
  }

  return (
    <>
      <NumberField
        label="Speed Multiplier"
        value={part.mobility_bonus_speed}
        onChange={(mobility_bonus_speed) => patch({ mobility_bonus_speed })}
        min={0}
        step={0.05}
        help="1.0 is neutral; multiplies derived top speed"
      />
      <NumberField
        label="Turn Multiplier"
        value={part.mobility_bonus_turn_rate}
        onChange={(mobility_bonus_turn_rate) =>
          patch({ mobility_bonus_turn_rate })
        }
        min={0}
        step={0.05}
        help="1.0 is neutral; multiplies derived turn rate"
      />
    </>
  );
}
