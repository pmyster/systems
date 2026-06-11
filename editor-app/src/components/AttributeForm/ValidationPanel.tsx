/**
 * ValidationPanel — runs the Zod schema validator against the current
 * unit on every render and shows the result.
 *
 * Per docs/editor-app-tauri-brief.md, the editor must block Save / Open
 * of invalid content. The validation panel is the live preview of that
 * gate — it shows what would fail right now.
 *
 * Pure component: takes the unit, runs UnitSchematicSchema.safeParse,
 * displays the issues. No internal state.
 */

import type { ReactNode } from "react";

import { UnitSchematicSchema } from "../../lib/zod-schemas";
import type { UnitSchematic } from "../../types/unit";

import styles from "./AttributeForm.module.css";

interface ValidationPanelProps {
  readonly unit: UnitSchematic;
}

export function ValidationPanel(props: ValidationPanelProps): ReactNode {
  const { unit } = props;
  const result = UnitSchematicSchema.safeParse(unit);

  if (result.success) {
    return (
      <section className={styles.section}>
        <h3 className={styles.sectionHeader}>
          Validation
          <span className={styles.sectionBadge}>Zod schema</span>
        </h3>
        <div className={styles.validationOk}>
          schema OK — unit conforms to unit.schema.json
        </div>
      </section>
    );
  }

  // result.error is a ZodError. We render the issues as a path / message
  // table. Issues are stable across renders so React's key strategy can
  // index them.
  const issues = result.error.issues;
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionHeader}>
        Validation
        <span className={styles.sectionBadge}>
          {issues.length} issue{issues.length === 1 ? "" : "s"}
        </span>
      </h3>
      <div className={styles.validationError}>
        unit fails schema — saving is blocked until issues clear
      </div>
      <ul className={styles.validationList}>
        {issues.map((issue, i) => (
          <li key={`${i}-${issue.path.join(".")}`} className={styles.validationItem}>
            <span className={styles.validationPath}>
              {issue.path.length === 0 ? "(root)" : issue.path.join(".")}
            </span>
            <span className={styles.validationMessage}>{issue.message}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
