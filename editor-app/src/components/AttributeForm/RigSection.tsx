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
import { useEffect, useState, type ReactNode } from "react";
import * as THREE from "three";

import { RIG_MOTIONS, humanizeEnum } from "../../lib/enums";
import { useMeshAssets } from "../../state/mesh-assets";
import type {
  MuzzleForwardAxis,
  RigAxisConstraint,
  RigEntry,
  RigMotion,
  UnitSchematic,
} from "../../types/unit";
import styles from "./AttributeForm.module.css";

const MUZZLE_FORWARD_OPTIONS: readonly MuzzleForwardAxis[] = [
  "+x",
  "-x",
  "+y",
  "-y",
  "+z",
  "-z",
];

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

/**
 * A degree/number field that lets you type freely — including a leading "-"
 * or a partial decimal — and only commits a parsed number on blur (or Enter).
 * Coercing on every keystroke (the old behaviour) clobbered "-" to 0, so you
 * could never type a negative value. Reverts to the last good value if the
 * final text isn't a finite number.
 */
function DegField({
  value,
  onCommit,
}: {
  readonly value: number;
  readonly onCommit: (n: number) => void;
}): ReactNode {
  const [text, setText] = useState<string>(String(value));
  // Re-sync when the model value changes from outside (invert, unit load, etc.).
  useEffect(() => {
    setText(String(value));
  }, [value]);

  const commit = (): void => {
    const n = Number(text);
    if (Number.isFinite(n)) onCommit(n);
    else setText(String(value));
  };

  return (
    <input
      className={styles.input}
      type="text"
      inputMode="numeric"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
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

  /** Commit a parsed number to an axis field (called by DegField on blur). */
  function setAxisNum(
    index: number,
    axis: "yaw" | "pitch",
    field: "min_deg" | "max_deg" | "rate_dps",
    value: number,
  ): void {
    const entry = rig[index];
    if (!entry) return;
    const current: RigAxisConstraint =
      entry[axis] ?? (axis === "yaw" ? DEFAULT_YAW : DEFAULT_PITCH);
    const nextAxis: RigAxisConstraint = { ...current, [field]: value };
    update(patchEntry(rig, index, { [axis]: nextAxis }));
  }

  /** Toggle an axis on/off: seed from its default when enabled, drop when off. */
  function toggleAxis(index: number, axis: "yaw" | "pitch", enabled: boolean): void {
    const seed = axis === "yaw" ? DEFAULT_YAW : DEFAULT_PITCH;
    update(patchEntry(rig, index, { [axis]: enabled ? { ...seed } : undefined }));
  }

  /** Set an axis's `invert` flag immutably, seeding the axis from its default when absent. */
  function setAxisInvert(index: number, axis: "yaw" | "pitch", invert: boolean): void {
    const entry = rig[index];
    if (!entry) return;
    const current = entry[axis] ?? (axis === "yaw" ? DEFAULT_YAW : DEFAULT_PITCH);
    update(patchEntry(rig, index, { [axis]: { ...current, invert } }));
  }

  /** Set (or clear) a rig's parent_rig immutably. */
  function setParent(index: number, value: string): void {
    update(patchEntry(rig, index, { parent_rig: value === "" ? undefined : value }));
  }

  /**
   * Toggle the muzzle flag on rig N. Enforces the single-muzzle invariant
   * by clearing the flag on every OTHER rig when turning it on. When
   * enabling, seed `muzzle_forward` to "+z" if not already set so the
   * dropdown has a sensible default.
   */
  function setMuzzle(index: number, enabled: boolean): void {
    if (!enabled) {
      // Clearing: drop both fields on this rig only — leave others alone.
      const entry = rig[index];
      if (!entry) return;
      const { muzzle: _m, muzzle_forward: _f, ...rest } = entry;
      void _m;
      void _f;
      update(rig.map((e, i) => (i === index ? rest : e)));
      return;
    }
    // Enabling on index N: turn on N (seed forward if missing), clear on
    // every other rig. This is the constitution-aware loud-over-silent
    // path — we never quietly let two rigs hold the flag at once.
    update(
      rig.map((e, i) => {
        if (i === index) {
          return {
            ...e,
            muzzle: true,
            muzzle_forward: e.muzzle_forward ?? "+z",
          };
        }
        if (e.muzzle === true || e.muzzle_forward !== undefined) {
          const { muzzle: _m, muzzle_forward: _f, ...rest } = e;
          void _m;
          void _f;
          return rest;
        }
        return e;
      }),
    );
  }

  /** Set the muzzle_forward axis on a rig (only meaningful when muzzle=true). */
  function setMuzzleForward(index: number, axis: MuzzleForwardAxis): void {
    update(patchEntry(rig, index, { muzzle_forward: axis }));
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

              {/* Parent — re-attach this part under another rig's node so it
                  rides along (e.g. barrel parented to body). Excludes self. */}
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <label className={styles.label}>Parent</label>
                <select
                  className={styles.select}
                  value={entry.parent_rig ?? ""}
                  onChange={(e) => setParent(i, e.target.value)}
                >
                  <option value="">(none)</option>
                  {rig
                    .filter((other) => other.id !== entry.id)
                    .map((other) => (
                      <option key={other.id} value={other.id}>
                        {other.target_node} ({other.id})
                      </option>
                    ))}
                </select>
              </div>

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

              {/* Muzzle — flag this rig as the projectile spawn + aim point.
                  Toggling on here clears the flag on every other rig (single
                  muzzle invariant). The forward-axis dropdown appears next to
                  it when enabled; it controls which LOCAL axis of this rig's
                  node points out of the barrel. */}
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <label
                  className={styles.label}
                  style={{ display: "flex", alignItems: "center", gap: 4 }}
                  title="When checked, the Fire-Test projectile spawns from this rig's world position and flies along the selected forward axis. Only one rig per unit may be the muzzle."
                >
                  <input
                    type="checkbox"
                    checked={entry.muzzle === true}
                    onChange={(e) => setMuzzle(i, e.target.checked)}
                  />
                  Muzzle
                </label>
                {entry.muzzle === true && (
                  <>
                    <label className={styles.label}>Forward</label>
                    <select
                      className={styles.select}
                      value={entry.muzzle_forward ?? "+z"}
                      onChange={(e) =>
                        setMuzzleForward(i, e.target.value as MuzzleForwardAxis)
                      }
                      title="Local axis of this rig's node that points out of the barrel."
                    >
                      {MUZZLE_FORWARD_OPTIONS.map((a) => (
                        <option key={a} value={a}>
                          {a.toUpperCase()}
                        </option>
                      ))}
                    </select>
                  </>
                )}
              </div>

              {entry.motion === "reactive" && (
                <>
                  {/* Yaw arc — only when enabled. */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <label className={styles.label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <input
                        type="checkbox"
                        checked={entry.yaw !== undefined}
                        onChange={(e) => toggleAxis(i, "yaw", e.target.checked)}
                      />
                      Yaw (min° / max° / rate °/s)
                    </label>
                    {entry.yaw !== undefined && (
                      <div style={{ display: "flex", gap: 4 }}>
                        <DegField
                          value={entry.yaw.min_deg ?? 0}
                          onCommit={(n) => setAxisNum(i, "yaw", "min_deg", n)}
                        />
                        <DegField
                          value={entry.yaw.max_deg ?? 0}
                          onCommit={(n) => setAxisNum(i, "yaw", "max_deg", n)}
                        />
                        <DegField
                          value={entry.yaw.rate_dps ?? 0}
                          onCommit={(n) => setAxisNum(i, "yaw", "rate_dps", n)}
                        />
                        <label
                          className={styles.label}
                          style={{ display: "flex", alignItems: "center", gap: 4 }}
                        >
                          <input
                            type="checkbox"
                            checked={entry.yaw.invert === true}
                            onChange={(e) => setAxisInvert(i, "yaw", e.target.checked)}
                          />
                          Invert
                        </label>
                      </div>
                    )}
                  </div>

                  {/* Pitch arc — only when enabled. */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <label className={styles.label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <input
                        type="checkbox"
                        checked={entry.pitch !== undefined}
                        onChange={(e) => toggleAxis(i, "pitch", e.target.checked)}
                      />
                      Pitch (min° / max° / rate °/s)
                    </label>
                    {entry.pitch !== undefined && (
                      <div style={{ display: "flex", gap: 4 }}>
                        <DegField
                          value={entry.pitch.min_deg ?? 0}
                          onCommit={(n) => setAxisNum(i, "pitch", "min_deg", n)}
                        />
                        <DegField
                          value={entry.pitch.max_deg ?? 0}
                          onCommit={(n) => setAxisNum(i, "pitch", "max_deg", n)}
                        />
                        <DegField
                          value={entry.pitch.rate_dps ?? 0}
                          onCommit={(n) => setAxisNum(i, "pitch", "rate_dps", n)}
                        />
                        <label
                          className={styles.label}
                          style={{ display: "flex", alignItems: "center", gap: 4 }}
                        >
                          <input
                            type="checkbox"
                            checked={entry.pitch.invert === true}
                            onChange={(e) => setAxisInvert(i, "pitch", e.target.checked)}
                          />
                          Invert
                        </label>
                      </div>
                    )}
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
