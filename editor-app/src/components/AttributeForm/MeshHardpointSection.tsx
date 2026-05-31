/**
 * MeshHardpointSection — author hardpoints (artist-placed weapon sockets).
 *
 * A hardpoint is a transform: local position + local quaternion, optionally
 * parented to one of the unit's rigs (via `parent_rig_id`) or to the unit
 * root (when `parent_rig_id === null`). In the Battlefield Preview the
 * runtime parents the hardpoint to its rig node, so a turret's hardpoint
 * automatically inherits yaw/pitch animation through the scene graph — no
 * extra math required.
 *
 * Authoring flow:
 *   - "+ Add Hardpoint" appends a fresh socket at origin with identity
 *     rotation.
 *   - Clicking any row of an existing hardpoint SELECTS it; the row
 *     highlights and the 3D gizmo in the Mesh Workspace attaches.
 *   - The Position fields edit `local_position` directly (3-decimal place
 *     numeric inputs).
 *   - The Rotation fields show Euler degrees (pitch/yaw/roll, XYZ order)
 *     for human-readable authoring. On commit we convert Euler → quaternion
 *     and write the quaternion to the store. Reads decompose the stored
 *     quaternion back to Euler so the form stays consistent across reloads.
 *
 * EULER ORDER DECISION (XYZ): chosen because Three.js's THREE.Euler default
 * is "XYZ" — round-tripping through `setFromQuaternion(q, "XYZ")` and back
 * via `setFromEuler(e)` matches the convention every other Three.js helper
 * uses (TransformControls, OrbitControls, GLTF importer). Picking anything
 * else would surprise authors familiar with the engine. Pitch = X, Yaw = Y,
 * Roll = Z under this order — labelled in the UI for clarity.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import * as THREE from "three";

import { useMeshAssets } from "../../state/mesh-assets";
import { isWeapon } from "../../types/part";
import type { MeshHardpoint, UnitSchematic } from "../../types/unit";

import styles from "./AttributeForm.module.css";

interface MeshHardpointSectionProps {
  readonly unit: UnitSchematic;
  readonly onUnitChange: (next: UnitSchematic) => void;
}

export type { MeshHardpointSectionProps };

// ---------------------------------------------------------------------------
// Numeric input that commits on blur / Enter. Reused for position + euler.
// Same pattern as RigSection's DegField — coercing on every keystroke would
// destroy a leading "-" or partial decimal as the user types.
// ---------------------------------------------------------------------------

interface NumFieldProps {
  readonly value: number;
  readonly onCommit: (n: number) => void;
  readonly step?: number;
  readonly placeholder?: string;
  readonly title?: string;
}

function NumField({ value, onCommit, step: _step, placeholder, title }: NumFieldProps): ReactNode {
  // 3 decimal places is enough for the cm-scale authoring this UI targets;
  // we still preserve the user's literal typing as a string until commit.
  const formatted = useMemo(() => {
    if (!Number.isFinite(value)) return "0";
    return Number(value.toFixed(3)).toString();
  }, [value]);
  const [text, setText] = useState<string>(formatted);
  useEffect(() => {
    setText(formatted);
  }, [formatted]);

  const commit = (): void => {
    const n = Number(text);
    if (Number.isFinite(n)) onCommit(n);
    else setText(formatted);
  };

  return (
    <input
      className={styles.input}
      type="text"
      inputMode="decimal"
      value={text}
      placeholder={placeholder}
      title={title}
      style={{ width: 64 }}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Quaternion <-> Euler-degree helpers. We always go through THREE.Euler in
// the default "XYZ" order — see file header.
// ---------------------------------------------------------------------------

interface EulerDeg {
  readonly pitch: number; // x
  readonly yaw: number; // y
  readonly roll: number; // z
}

const scratchQuat = new THREE.Quaternion();
const scratchEuler = new THREE.Euler();

function quatToEulerDeg(q: readonly [number, number, number, number]): EulerDeg {
  scratchQuat.set(q[0], q[1], q[2], q[3]);
  scratchEuler.setFromQuaternion(scratchQuat, "XYZ");
  return {
    pitch: THREE.MathUtils.radToDeg(scratchEuler.x),
    yaw: THREE.MathUtils.radToDeg(scratchEuler.y),
    roll: THREE.MathUtils.radToDeg(scratchEuler.z),
  };
}

function eulerDegToQuat(e: EulerDeg): readonly [number, number, number, number] {
  scratchEuler.set(
    THREE.MathUtils.degToRad(e.pitch),
    THREE.MathUtils.degToRad(e.yaw),
    THREE.MathUtils.degToRad(e.roll),
    "XYZ",
  );
  scratchQuat.setFromEuler(scratchEuler);
  return [scratchQuat.x, scratchQuat.y, scratchQuat.z, scratchQuat.w];
}

// ---------------------------------------------------------------------------
// Component.
// ---------------------------------------------------------------------------

export function MeshHardpointSection({
  unit,
  onUnitChange,
}: MeshHardpointSectionProps): ReactNode {
  const { selectedHardpointId, setSelectedHardpointId } = useMeshAssets();
  const hardpoints = unit.hardpoints ?? [];
  const rigs = unit.rig ?? [];
  // Weapon parts available to assign to a hardpoint. Computed once per
  // render — small lists in practice; the form rebuilds on every keystroke
  // already, so no useMemo is justified. isWeapon narrows the union to
  // WeaponPart so .id / .name are typed.
  const weapons = (unit.parts ?? []).filter(isWeapon);
  const weaponIds = new Set(weapons.map((w) => w.id));

  function update(next: readonly MeshHardpoint[]): void {
    onUnitChange({ ...unit, hardpoints: next });
  }

  function patchById(id: string, patch: Partial<MeshHardpoint>): void {
    update(hardpoints.map((h) => (h.id === id ? { ...h, ...patch } : h)));
  }

  function addHardpoint(): void {
    // Match the reducer's "hp_<n>" scheme so id collisions don't happen if
    // the user authors via this UI then loads + saves + reopens.
    let maxN = 0;
    for (const h of hardpoints) {
      const m = /^hp_(\d+)$/.exec(h.id);
      if (m && m[1]) {
        const n = Number(m[1]);
        if (Number.isFinite(n) && n > maxN) maxN = n;
      }
    }
    const newId = `hp_${maxN + 1}`;
    update([
      ...hardpoints,
      {
        id: newId,
        parent_rig_id: null,
        local_position: [0, 0, 0],
        local_quaternion: [0, 0, 0, 1],
      },
    ]);
    setSelectedHardpointId(newId);
  }

  function removeHardpoint(id: string): void {
    update(hardpoints.filter((h) => h.id !== id));
    if (selectedHardpointId === id) setSelectedHardpointId(null);
  }

  function setPosComponent(id: string, axis: 0 | 1 | 2, value: number): void {
    const h = hardpoints.find((x) => x.id === id);
    if (!h) return;
    const p: [number, number, number] = [
      h.local_position[0],
      h.local_position[1],
      h.local_position[2],
    ];
    p[axis] = value;
    patchById(id, { local_position: p });
  }

  function setEulerComponent(
    id: string,
    axis: "pitch" | "yaw" | "roll",
    value: number,
  ): void {
    const h = hardpoints.find((x) => x.id === id);
    if (!h) return;
    const cur = quatToEulerDeg(h.local_quaternion);
    const next: EulerDeg = { ...cur, [axis]: value };
    patchById(id, { local_quaternion: eulerDegToQuat(next) });
  }

  function setIdField(id: string, nextId: string): void {
    const cleaned = nextId.trim();
    if (cleaned === "" || cleaned === id) return;
    // Loud-over-silent: refuse a duplicate id rather than letting two
    // hardpoints share an id and silently confusing the runtime lookup.
    if (hardpoints.some((h) => h.id === cleaned)) {
      // eslint-disable-next-line no-console
      console.warn(
        `[MeshHardpoints] cannot rename "${id}" → "${cleaned}": id already in use.`,
      );
      return;
    }
    patchById(id, { id: cleaned });
    if (selectedHardpointId === id) setSelectedHardpointId(cleaned);
  }

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionHeader}>
        Mesh Hardpoints
        <span className={styles.sectionBadge}>weapon sockets</span>
      </h3>

      {hardpoints.length === 0 && (
        <p style={{ color: "#6b7280", fontSize: 12, margin: "4px 10px" }}>
          No hardpoints yet — click "Add Hardpoint" to drop one at the unit
          origin, then drag it in the Mesh Workspace.
        </p>
      )}

      {hardpoints.map((h, i) => {
        const isSelected = selectedHardpointId === h.id;
        const euler = quatToEulerDeg(h.local_quaternion);
        return (
          <div
            key={h.id}
            className={styles.row}
            style={{
              alignItems: "flex-start",
              gap: 6,
              cursor: "pointer",
              background: isSelected ? "rgba(201,165,92,0.12)" : "transparent",
              border: isSelected
                ? "1px solid rgba(201,165,92,0.5)"
                : "1px solid transparent",
              borderRadius: 3,
              padding: 4,
            }}
            onClick={() => setSelectedHardpointId(h.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setSelectedHardpointId(h.id);
              }
            }}
          >
            <label className={styles.label}>#{i + 1}</label>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
              {/* ID + unparented warning */}
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <label className={styles.label}>ID</label>
                <input
                  className={styles.input}
                  defaultValue={h.id}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => setIdField(h.id, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                />
                {(h.parent_rig_id === null || h.parent_rig_id === "") && (
                  <span
                    title="Hardpoint has no parent rig — it cannot fire. Pick a rig from the Parent dropdown below."
                    style={{
                      display: "inline-block",
                      padding: "1px 6px",
                      borderRadius: 10,
                      fontSize: 10,
                      color: "#f08080",
                      background: "rgba(240, 80, 80, 0.10)",
                      border: "1px solid rgba(240, 80, 80, 0.45)",
                    }}
                  >
                    ⚠ no parent — cannot fire
                  </span>
                )}
              </div>

              {/* Parent rig */}
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <label className={styles.label}>Parent</label>
                <select
                  className={styles.select}
                  value={h.parent_rig_id ?? ""}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) =>
                    patchById(h.id, {
                      parent_rig_id: e.target.value === "" ? null : e.target.value,
                    })
                  }
                  title="Rig whose node this hardpoint follows. '(unit root)' = no rig follow."
                >
                  <option value="">(unit root)</option>
                  {rigs.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.target_node} ({r.id})
                    </option>
                  ))}
                </select>
              </div>

              {/* Position */}
              <div
                style={{ display: "flex", alignItems: "center", gap: 4 }}
                onClick={(e) => e.stopPropagation()}
              >
                <label className={styles.label}>Pos (m)</label>
                <NumField
                  value={h.local_position[0]}
                  onCommit={(n) => setPosComponent(h.id, 0, n)}
                  title="X — meters from parent origin"
                />
                <NumField
                  value={h.local_position[1]}
                  onCommit={(n) => setPosComponent(h.id, 1, n)}
                  title="Y — meters from parent origin"
                />
                <NumField
                  value={h.local_position[2]}
                  onCommit={(n) => setPosComponent(h.id, 2, n)}
                  title="Z — meters from parent origin"
                />
              </div>

              {/* Rotation (Euler degrees, XYZ order) */}
              <div
                style={{ display: "flex", alignItems: "center", gap: 4 }}
                onClick={(e) => e.stopPropagation()}
                title="Pitch / Yaw / Roll in degrees (THREE.Euler XYZ order)."
              >
                <label className={styles.label}>Rot</label>
                <NumField
                  value={euler.pitch}
                  onCommit={(n) => setEulerComponent(h.id, "pitch", n)}
                  title="Pitch (rotation around X), degrees"
                />
                <NumField
                  value={euler.yaw}
                  onCommit={(n) => setEulerComponent(h.id, "yaw", n)}
                  title="Yaw (rotation around Y), degrees"
                />
                <NumField
                  value={euler.roll}
                  onCommit={(n) => setEulerComponent(h.id, "roll", n)}
                  title="Roll (rotation around Z), degrees"
                />
              </div>

              {/* Weapon assignment — drives the projectile that this
                  hardpoint fires AND the timing model (charge / burst /
                  cooldown) the fire-test sequencer obeys. <None> clears
                  the assignment; a stale reference (weapon deleted) is
                  surfaced as a red chip — loud-over-silent, same pattern
                  as the no-parent chip on the ID row.
                  ---------------------------------------------------- */}
              <div
                style={{ display: "flex", alignItems: "center", gap: 4 }}
                onClick={(e) => e.stopPropagation()}
              >
                <label className={styles.label}>Weapon</label>
                <select
                  className={styles.select}
                  value={h.weapon_part_id ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    // Empty string maps back to `undefined` so the
                    // serialized JSON omits the field entirely — matches
                    // the "unset" convention used elsewhere (parent_rig_id
                    // null path). React doesn't have native `delete` on a
                    // patch object, so we apply the partial here.
                    if (v === "") {
                      // Strip weapon_part_id from the hardpoint by
                      // rebuilding it without that field. patchById
                      // applies the patch via spread, which CANNOT delete
                      // a key — so we do the omit inline.
                      update(
                        hardpoints.map((x) =>
                          x.id === h.id
                            ? {
                                id: x.id,
                                parent_rig_id: x.parent_rig_id,
                                local_position: x.local_position,
                                local_quaternion: x.local_quaternion,
                              }
                            : x,
                        ),
                      );
                    } else {
                      patchById(h.id, { weapon_part_id: v });
                    }
                  }}
                  title="Weapon (Part) this hardpoint fires. <None> = unarmed."
                >
                  <option value="">&lt;None&gt;</option>
                  {weapons.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name || w.id}
                    </option>
                  ))}
                </select>
                {h.weapon_part_id !== undefined &&
                !weaponIds.has(h.weapon_part_id) ? (
                  <span
                    title="The referenced weapon part no longer exists on this unit. Pick another weapon or set to <None>."
                    style={{
                      display: "inline-block",
                      padding: "1px 6px",
                      borderRadius: 10,
                      fontSize: 10,
                      color: "#f08080",
                      background: "rgba(240, 80, 80, 0.10)",
                      border: "1px solid rgba(240, 80, 80, 0.45)",
                    }}
                  >
                    ⚠ weapon '{h.weapon_part_id}' missing
                  </span>
                ) : null}
              </div>
            </div>
            <button
              type="button"
              className={styles.tagRemove}
              onClick={(e) => {
                e.stopPropagation();
                removeHardpoint(h.id);
              }}
              title="Remove hardpoint"
              style={{ marginTop: 4 }}
            >
              ×
            </button>
          </div>
        );
      })}

      <div className={styles.row}>
        <label className={styles.label} />
        <button
          type="button"
          className={styles.button}
          onClick={addHardpoint}
        >
          + Add Hardpoint
        </button>
      </div>
    </section>
  );
}
