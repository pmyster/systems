/**
 * ProjectilePicker — modal listing all projectiles found under
 * units/projectiles/. Used by:
 *
 *   - WeaponSubform → "Link Existing…" to bind a weapon to a
 *     pre-existing projectile file.
 *   - ProjectileDrawer → cluster modifier's child picker. Pass
 *     `excludeIds` so a projectile can't reference itself (trivial
 *     cycle pre-check; the deep cycle check happens at save time in
 *     projectile-ops.hasCycle).
 *
 * The picker shows id/name/delivery+effect badges so authors don't
 * need to load the full file to recognize a row. The badges come
 * from… nothing yet, because `ProjectileFileEntry` only carries
 * id+name. Slice 2 may widen the Rust command to include the two
 * discriminator strings; for now we render id+name only and note
 * the gap in a comment.
 */

import { useState, type ReactNode } from "react";

import type { ProjectileFileEntry } from "../../file-ops/projectile-ops";
import { humanizeEnum } from "../../lib/enums";

import styles from "./AttributeForm.module.css";

export interface ProjectilePickerProps {
  readonly projectiles: readonly ProjectileFileEntry[];
  readonly excludeIds?: readonly string[];
  readonly onSelect: (entry: ProjectileFileEntry) => void;
  readonly onCancel: () => void;
}

export function ProjectilePicker(props: ProjectilePickerProps): ReactNode {
  const { projectiles, excludeIds, onSelect, onCancel } = props;
  const excluded = new Set(excludeIds ?? []);
  const visible = projectiles.filter((p) => !excluded.has(p.id));
  const [filter, setFilter] = useState("");
  const filtered = filter.trim()
    ? visible.filter(
        (p) =>
          p.id.toLowerCase().includes(filter.toLowerCase()) ||
          p.name.toLowerCase().includes(filter.toLowerCase()),
      )
    : visible;

  return (
    <div className={styles.section}>
      <h3 className={styles.sectionHeader}>
        Projectile Picker
        <span className={styles.sectionBadge}>
          {filtered.length} of {visible.length}
        </span>
      </h3>

      <input
        className={styles.input}
        type="text"
        placeholder="Filter by id or name…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />

      {filtered.length === 0 ? (
        <div className={styles.empty}>
          {visible.length === 0
            ? "No projectiles in units/projectiles/. Create one from a weapon part."
            : "No projectiles match the filter."}
        </div>
      ) : (
        <div className={styles.tagList} style={{ flexDirection: "column" }}>
          {filtered.map((p) => (
            <div key={p.path} className={styles.partCard}>
              <div className={styles.partHeader}>
                <div>
                  <span className={styles.partTitle}>
                    {humanizeEnum(p.name)}
                  </span>
                  <span className={styles.partSubtitle}>{p.id}</span>
                </div>
                <button
                  type="button"
                  className={`${styles.button} ${styles.buttonPrimary}`}
                  onClick={() => onSelect(p)}
                >
                  Select
                </button>
              </div>
              <div className={styles.help}>{p.path}</div>
            </div>
          ))}
        </div>
      )}

      <div className={styles.addPart}>
        <button type="button" className={styles.button} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
