/**
 * AttributeForm — center pane of the Child of Light Editor.
 *
 * Authors a complete unit Schematic (minus the voxel chassis, which
 * comes from VoxelSculptor in the left pane). Controlled component:
 * the parent owns the canonical UnitSchematic and passes it in; every
 * edit calls `onUnitChange` with a new immutable object.
 *
 * Per DESIGN.md Principle 2 (Derived-stat discipline):
 *   - Inputs are physical quantities only (mass, engine_kW,
 *     propellant_energy_MJ, etc.).
 *   - The DerivedStatsPanel sub-section displays computed values
 *     read-only on every render.
 *
 * Per DESIGN.md Principle 4 (Invariance: amend, never alter):
 *   - physics_version is shown but not editable here. A future menu
 *     action explicitly bumps it.
 *
 * Per the brief's behavior contract:
 *   - Immutable spread updates throughout — no in-place mutation.
 *   - Live derived stats: deriveStats(unit) runs on every render.
 *   - Live validation: UnitSchematicSchema.safeParse(unit) runs on
 *     every render; issues are displayed inline.
 *
 * Lift sources (consolidated mapping table in
 * docs/editor-app-tauri-lift-map.md):
 *   - tools/editor/index.html lines 305-308, 314-368, 379-436, 441-462,
 *     467-507, 716-727.
 */

import type { ReactNode } from "react";

import type { UnitSchematic } from "../../types/unit";

import { ChassisSection } from "./ChassisSection";
import { CostsSection } from "./CostsSection";
import { DerivedStatsPanel } from "./DerivedStatsPanel";
import { HardpointSection } from "./HardpointSection";
import { MetaSection } from "./MetaSection";
import { PartsSection } from "./PartsSection";
import { RigSection } from "./RigSection";
import { ValidationPanel } from "./ValidationPanel";
import styles from "./AttributeForm.module.css";

interface AttributeFormProps {
  readonly unit: UnitSchematic;
  readonly onUnitChange: (next: UnitSchematic) => void;
}

/**
 * Top-level AttributeForm. Composition only — every sub-section is its
 * own file. State lives entirely in the parent.
 */
export function AttributeForm(props: AttributeFormProps): ReactNode {
  const { unit, onUnitChange } = props;

  return (
    <div className={styles.form}>
      <MetaSection unit={unit} onUnitChange={onUnitChange} />
      <ChassisSection unit={unit} onUnitChange={onUnitChange} />
      <HardpointSection unit={unit} onUnitChange={onUnitChange} />
      <RigSection unit={unit} onUnitChange={onUnitChange} />
      <PartsSection unit={unit} onUnitChange={onUnitChange} />
      <CostsSection unit={unit} onUnitChange={onUnitChange} />
      <DerivedStatsPanel unit={unit} />
      <ValidationPanel unit={unit} />
    </div>
  );
}
