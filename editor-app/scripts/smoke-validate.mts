/**
 * Smoke validation — replicates the editor's "click archetype → save" path
 * and runs the REAL Zod save-validation against every archetype.
 *
 * Mirrors:
 *   - ChassisSection archetype onClick: { ...unit, role, chassis:{...c,...a.chassis} }
 *   - save.ts: UnitSchematicSchema.safeParse(unit) before any write
 *
 * Run: npx tsx scripts/smoke-validate.mts
 */
import { ARCHETYPES } from "../src/lib/archetypes";
import { UnitSchematicSchema } from "../src/lib/zod-schemas";
import type { UnitSchematic } from "../src/types/unit";

// Inline copy of blankUnit() from state/unit-store.ts (avoids importing the
// store, which pulls in Tauri-only modules that don't load under Node).
function blankUnit(): UnitSchematic {
  return {
    kind: "unit",
    id: "new_unit",
    physics_version: "1.0",
    name: "New Unit",
    faction: "reclaimer",
    chassis: {
      chassis_class: "ground_tracked",
      mass_kg: 1000,
      engine_kW: 100,
      drivetrain_efficiency: 0.8,
    },
  };
}

let pass = 0;
let fail = 0;

for (const a of ARCHETYPES) {
  const base = blankUnit();
  // Exactly what the archetype button dispatches:
  const unit: UnitSchematic = {
    ...base,
    id: a.id,
    name: a.label,
    role: a.role,
    chassis: { ...base.chassis, ...a.chassis },
  };

  const result = UnitSchematicSchema.safeParse(unit);
  if (result.success) {
    pass++;
    console.log(`  ok   ${a.label.padEnd(14)} role=${a.role}  class=${unit.chassis.chassis_class}`);
  } else {
    fail++;
    console.log(`  FAIL ${a.label.padEnd(14)} ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
}

console.log(`\n${pass}/${ARCHETYPES.length} archetypes pass save-validation; ${fail} failed.`);
process.exit(fail === 0 ? 0 : 1);
