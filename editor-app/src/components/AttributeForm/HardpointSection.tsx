/**
 * HardpointSection — shows named typed hardpoint slots on structures.
 * Only renders when unit.chassis.hardpoints is defined and non-empty,
 * or when the chassis class is static_structure / static_wall.
 */
import type { ReactNode } from "react";

import { HARDPOINT_SLOT_TYPES, humanizeEnum } from "../../lib/enums";
import type { HardpointSlot, HardpointSlotType, UnitSchematic } from "../../types/unit";
import styles from "./AttributeForm.module.css";

interface HardpointSectionProps {
  readonly unit: UnitSchematic;
  readonly onUnitChange: (next: UnitSchematic) => void;
}

export type { HardpointSectionProps };

function patchSlot(
  slots: readonly HardpointSlot[],
  index: number,
  patch: Partial<HardpointSlot>,
): HardpointSlot[] {
  return slots.map((s, i) => (i === index ? { ...s, ...patch } : s));
}

export function HardpointSection({ unit, onUnitChange }: HardpointSectionProps): ReactNode {
  const slots = unit.chassis.hardpoints ?? [];
  const cc = unit.chassis.chassis_class;

  if (slots.length === 0 && cc !== "static_structure" && cc !== "static_wall") {
    return null;
  }

  function updateSlots(next: HardpointSlot[]): void {
    onUnitChange({
      ...unit,
      chassis: { ...unit.chassis, hardpoints: next, hardpoint_count: next.length },
    });
  }

  function addSlot(): void {
    updateSlots([...slots, { id: `slot_${slots.length + 1}`, type: "aux" }]);
  }

  function removeSlot(index: number): void {
    updateSlots(slots.filter((_, i) => i !== index));
  }

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionHeader}>
        Hardpoints
        <span className={styles.sectionBadge}>named slots</span>
      </h3>

      {slots.length === 0 && (
        <p style={{ color: "#6b7280", fontSize: 12, margin: "4px 10px" }}>
          No slots defined. Click + Add Slot to begin.
        </p>
      )}

      {slots.map((slot, i) => (
        <div key={i} className={styles.row} style={{ alignItems: "flex-start", gap: 6 }}>
          <label className={styles.label}>#{i + 1}</label>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
            {/* ID */}
            <input
              className={styles.input}
              value={slot.id}
              placeholder="slot-id"
              onChange={(e) => updateSlots(patchSlot(slots, i, { id: e.target.value }))}
            />
            {/* Type */}
            <select
              className={styles.select}
              value={slot.type}
              onChange={(e) =>
                updateSlots(patchSlot(slots, i, { type: e.target.value as HardpointSlotType }))
              }
            >
              {HARDPOINT_SLOT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {humanizeEnum(t)}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className={styles.tagRemove}
            onClick={() => removeSlot(i)}
            title="Remove slot"
            style={{ marginTop: 4 }}
          >
            ×
          </button>
        </div>
      ))}

      <div className={styles.row}>
        <label className={styles.label} />
        <button
          type="button"
          className={styles.archetypeBtn}
          onClick={addSlot}
        >
          + Add Slot
        </button>
      </div>
    </section>
  );
}
