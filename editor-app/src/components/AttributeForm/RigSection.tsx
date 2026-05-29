/**
 * RigSection — defines a unit's moving parts ("rig").
 *
 * Each rig entry binds a named mesh node to a motion tier:
 *   - passive: decorative, no targeting logic.
 *   - reactive: turret-style — tracks targets within yaw/pitch arcs.
 *   - active: independently animated.
 *
 * Node names are read live from the shared mesh (useMeshAssets). When no
 * mesh with named parts is present we still render any existing rig rows
 * so authored data is never silently hidden.
 *
 * Mirrors HardpointSection's structure and reuses the same CSS classes
 * from AttributeForm.module.css.
 */
import type { ReactNode } from "react";
import * as THREE from "three";

import { RIG_MOTIONS, humanizeEnum } from "../../lib/enums";
import { useMeshAssets } from "../../state/mesh-assets";
import type { RigAxisConstraint, RigEntry, RigMotion, UnitSchematic } from "../../types/unit";
import styles from "./AttributeForm.module.css";

interface RigSectionProps {
  readonly unit: UnitSchematic;
  readonly onUnitChange: (next: UnitSchematic) => void;
}

export type { RigSectionProps };

/** Traverse a mesh group for named meshes that can be rigged as moving parts. */
function meshNodeNames(group: THREE.Group | null): string[] {
  if (!group) return [];
  const names = new Set<string>();
  group.traverse((n) => {
    // Offer named meshes/groups as rig targets. Skip the unnamed root.
    if (n.name && (n as THREE.Mesh).isMesh) names.add(n.name);
  });
  return [...names];
}

/** Patch a single rig entry immutably by index. */
function patchEntry(
  rig: readonly RigEntry[],
  index: number,
  patch: Partial<RigEntry>,
): RigEntry[] {
  return rig.map((e, i) => (i === index ? { ...e, ...patch } : e));
}

/** Coerce a number input, falling back to the previous value when non-finite. */
function coerce(raw: string, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

const DEFAULT_YAW: RigAxisConstraint = { min_deg: -90, max_deg: 90, rate_dps: 45 };
const DEFAULT_PITCH: RigAxisConstraint = { min_deg: 0, max_deg: 20, rate_dps: 20 };

export function RigSection({ unit, onUnitChange }: RigSectionProps): ReactNode {
  const { meshSource } = useMeshAssets();
  const rig = unit.rig ?? [];
  const nodeNames = meshNodeNames(meshSource);

  function update(next: RigEntry[]): void {
    onUnitChange({ ...unit, rig: next });
  }

  function addRig(): void {
    update([
      ...rig,
      {
        id: `rig_${rig.length + 1}`,
        target_node: nodeNames[0] ?? "",
        motion: "reactive",
        // Yaw-only by default = a clean turret traverse. Add pitch explicitly
        // for a barrel/elevation part (the pitch fields seed from DEFAULT_PITCH).
        yaw: { ...DEFAULT_YAW },
      },
    ]);
  }

  function removeRig(index: number): void {
    update(rig.filter((_, i) => i !== index));
  }

  function patchAxis(
    index: number,
    axis: "yaw" | "pitch",
    field: keyof RigAxisConstraint,
    raw: string,
  ): void {
    const entry = rig[index];
    if (!entry) return;
    const current: RigAxisConstraint =
      entry[axis] ?? (axis === "yaw" ? DEFAULT_YAW : DEFAULT_PITCH);
    const fallback = current[field] ?? 0;
    const nextAxis: RigAxisConstraint = { ...current, [field]: coerce(raw, fallback) };
    update(patchEntry(rig, index, { [axis]: nextAxis }));
  }

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionHeader}>
        Rig
        <span className={styles.sectionBadge}>moving parts</span>
      </h3>

      {nodeNames.length === 0 && (
        <p style={{ color: "#6b7280", fontSize: 12, margin: "4px 10px" }}>
          Pick a template or import a mesh with named parts to rig moving pieces.
        </p>
      )}

      {rig.map((entry, i) => {
        // Preserve a value not present in the mesh so it is never lost.
        const options = nodeNames.includes(entry.target_node)
          ? nodeNames
          : [entry.target_node, ...nodeNames].filter((n) => n.length > 0);

        return (
          <div key={i} className={styles.row} style={{ alignItems: "flex-start", gap: 6 }}>
            <label className={styles.label}>#{i + 1}</label>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
              {/* Target node */}
              <select
                className={styles.select}
                value={entry.target_node}
                onChange={(e) =>
                  update(patchEntry(rig, i, { target_node: e.target.value }))
                }
              >
                {options.length === 0 && <option value="">(no named nodes)</option>}
                {options.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>

              {/* Motion */}
              <select
                className={styles.select}
                value={entry.motion}
                onChange={(e) =>
                  update(patchEntry(rig, i, { motion: e.target.value as RigMotion }))
                }
              >
                {RIG_MOTIONS.map((m) => (
                  <option key={m} value={m}>
                    {humanizeEnum(m)}
                  </option>
                ))}
              </select>

              {entry.motion === "reactive" && (
                <>
                  {/* Yaw arc */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <label className={styles.label}>Yaw (min° / max° / rate °/s)</label>
                    <div style={{ display: "flex", gap: 4 }}>
                      <input
                        className={styles.input}
                        type="number"
                        value={entry.yaw?.min_deg ?? 0}
                        onChange={(e) => patchAxis(i, "yaw", "min_deg", e.target.value)}
                      />
                      <input
                        className={styles.input}
                        type="number"
                        value={entry.yaw?.max_deg ?? 0}
                        onChange={(e) => patchAxis(i, "yaw", "max_deg", e.target.value)}
                      />
                      <input
                        className={styles.input}
                        type="number"
                        value={entry.yaw?.rate_dps ?? 0}
                        onChange={(e) => patchAxis(i, "yaw", "rate_dps", e.target.value)}
                      />
                    </div>
                  </div>

                  {/* Pitch arc */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <label className={styles.label}>Pitch (min° / max° / rate °/s)</label>
                    <div style={{ display: "flex", gap: 4 }}>
                      <input
                        className={styles.input}
                        type="number"
                        value={entry.pitch?.min_deg ?? 0}
                        onChange={(e) => patchAxis(i, "pitch", "min_deg", e.target.value)}
                      />
                      <input
                        className={styles.input}
                        type="number"
                        value={entry.pitch?.max_deg ?? 0}
                        onChange={(e) => patchAxis(i, "pitch", "max_deg", e.target.value)}
                      />
                      <input
                        className={styles.input}
                        type="number"
                        value={entry.pitch?.rate_dps ?? 0}
                        onChange={(e) => patchAxis(i, "pitch", "rate_dps", e.target.value)}
                      />
                    </div>
                  </div>
                </>
              )}
            </div>
            <button
              type="button"
              className={styles.tagRemove}
              onClick={() => removeRig(i)}
              title="Remove rig"
              style={{ marginTop: 4 }}
            >
              ×
            </button>
          </div>
        );
      })}

      <div className={styles.row}>
        <label className={styles.label} />
        <button type="button" className={styles.archetypeBtn} onClick={addRig}>
          + Add Rig
        </button>
      </div>
    </section>
  );
}
