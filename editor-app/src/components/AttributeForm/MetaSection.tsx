/**
 * MetaSection — top-of-form identity fields.
 *
 * Maps to the UnitMeta slice of UnitSchematic (kind, id, name, faction,
 * designer, description, physics_version). All controlled. The
 * physics_version field is read-only here per the brief: bumping it
 * is an explicit user action via a future menu command (per DESIGN.md
 * Principle 4 — Invariance: amend, never alter).
 *
 * Lift source: tools/editor/index.html lines 156-177.
 */

import type { ChangeEvent, ReactNode } from "react";

import { FACTIONS, ROLES, humanizeEnum } from "../../lib/enums";
import type { Faction, UnitRole, UnitSchematic } from "../../types/unit";

import { SelectField, TextAreaField, TextField, ReadonlyField } from "./fields";
import styles from "./AttributeForm.module.css";

interface MetaSectionProps {
  readonly unit: UnitSchematic;
  readonly onUnitChange: (next: UnitSchematic) => void;
}

export function MetaSection(props: MetaSectionProps): ReactNode {
  const { unit, onUnitChange } = props;

  // Field-by-field updaters. Each returns a new UnitSchematic — never
  // mutate `unit` in place. The exhaustive spread preserves chassis /
  // parts / costs untouched.
  const setName = (name: string) => onUnitChange({ ...unit, name });
  const setId = (id: string) => onUnitChange({ ...unit, id });
  const setFaction = (faction: Faction) => onUnitChange({ ...unit, faction });
  const setDesigner = (designer: string) => onUnitChange({ ...unit, designer });
  const setDescription = (description: string) =>
    onUnitChange({ ...unit, description });
  const setRole = (role: UnitRole | undefined) =>
    onUnitChange({ ...unit, role });

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionHeader}>
        Meta
        <span className={styles.sectionBadge}>identity</span>
      </h3>
      <TextField
        label="Name"
        value={unit.name}
        onChange={setName}
        placeholder="Display Name"
      />
      <TextField
        label="ID"
        value={unit.id}
        onChange={setId}
        placeholder="my-unit-id"
        help="lowercase letters, digits, hyphen, underscore; must start with a letter"
      />
      <SelectField<Faction>
        label="Faction"
        value={unit.faction}
        options={FACTIONS}
        onChange={setFaction}
        labelFn={(f) => humanizeEnum(f)}
      />
      <div className={styles.row}>
        <label className={styles.label}>Role</label>
        <select
          className={styles.select}
          value={unit.role ?? ""}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => {
            const v = e.target.value;
            setRole(v === "" ? undefined : (v as UnitRole));
          }}
        >
          <option value="">(unassigned)</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {humanizeEnum(r)}
            </option>
          ))}
        </select>
      </div>
      <TextField
        label="Designer"
        value={unit.designer ?? ""}
        onChange={setDesigner}
        placeholder="Your call-sign"
      />
      <TextAreaField
        label="Description"
        value={unit.description ?? ""}
        onChange={setDescription}
        placeholder="One sentence flavor text"
        rows={2}
      />
      <ReadonlyField
        label="Physics Version"
        value={unit.physics_version}
        help="bumped via menu action — never inline"
      />
    </section>
  );
}
