/**
 * WeaponSubform — fields specific to a weapon part.
 *
 * Per DESIGN.md Principle 2: the editor accepts propellant_energy_MJ,
 * projectile_mass_kg, barrel_thermal_capacity_MJ, per_shot_heat_MJ,
 * cooling_rate_MJs, drag_coefficient — *never* raw muzzle velocity,
 * effective range, or rate of fire. Those derive from the inputs above
 * in src/lib/derive-stats.ts.
 *
 * Slice-1 projectile authoring: the weapon part references a standalone
 * Projectile Schematic via `projectile_id`. The drawer at the bottom
 * lets the author create, link, or edit that file inline. The projectile
 * file itself owns delivery + effect + cluster physics.
 *
 * Lift source: tools/editor/index.html lines 381-391.
 */

import { useEffect, useState, type ReactNode } from "react";
import type { CSSProperties } from "react";
import { join } from "@tauri-apps/api/path";

import { WEAPON_TYPES } from "../../lib/enums";
import { deriveProjectileStats } from "../../lib/derive-projectile";
import type { WeaponPart, WeaponType } from "../../types/part";
import type { ProjectileSchematic } from "../../types/projectile";
import {
  listProjectiles,
  loadProjectile,
  saveProjectile,
  type ProjectileFileEntry,
} from "../../file-ops/projectile-ops";

import { NumberField, SelectField } from "./fields";
import {
  ProjectileDrawer,
  makeProjectile,
} from "./ProjectileDrawer";
import { ProjectilePicker } from "./ProjectilePicker";
import styles from "./AttributeForm.module.css";

/** Absolute on-disk directory where projectile files live (next to unit files, git-committable). */
const PROJECTILES_DIR = "C:\\dev\\Strategy Game\\units\\projectiles";

async function projectilesDir(): Promise<string> {
  return PROJECTILES_DIR;
}

async function projectilePath(id: string): Promise<string> {
  return await join(PROJECTILES_DIR, `${id}.proj.json`);
}

interface WeaponSubformProps {
  readonly part: WeaponPart;
  readonly onChange: (next: WeaponPart) => void;
}

export function WeaponSubform(props: WeaponSubformProps): ReactNode {
  const { part, onChange } = props;

  function patch(next: Partial<WeaponPart>): void {
    onChange({ ...part, ...next });
  }

  // elevation_range_deg is a tuple [min, max]; edit each end independently.
  const elevation = part.elevation_range_deg ?? [-10, 30];

  // -------------------------------------------------------------------------
  // Projectile drawer state — local to this weapon card.
  //
  //   mode === "closed"  — no drawer; show summary or empty
  //   mode === "drawer-new"   — drawer open with a fresh projectile
  //   mode === "drawer-edit"  — drawer open with a loaded projectile
  //   mode === "picker"  — picker open to link an existing file
  //
  // Linked-projectile metadata lives in `linked` so the summary row
  // can show the projectile's name + derived KE without re-reading the
  // file on every render. We refresh `linked` on save and on initial
  // load whenever projectile_id changes.
  // -------------------------------------------------------------------------

  type Mode = "closed" | "drawer-new" | "drawer-edit" | "picker";
  const [mode, setMode] = useState<Mode>("closed");
  const [drawerData, setDrawerData] = useState<ProjectileSchematic | null>(null);
  const [drawerIsExisting, setDrawerIsExisting] = useState(false);
  const [linked, setLinked] = useState<ProjectileSchematic | null>(null);
  const [existing, setExisting] = useState<readonly ProjectileFileEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Resolve linked projectile metadata for the summary row whenever
  // the weapon's projectile_id changes.
  useEffect(() => {
    let cancelled = false;
    const id = part.projectile_id;
    if (!id) {
      setLinked(null);
      return;
    }
    (async () => {
      try {
        const p = await projectilePath(id);
        const loaded = await loadProjectile(p);
        if (!cancelled) setLinked(loaded);
      } catch (e: unknown) {
        // Loud, not silent. If the file was deleted out from under
        // us, surface that — don't silently render an empty summary.
        if (!cancelled) {
          setLinked(null);
          setError(
            `Failed to read projectile ${id}: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [part.projectile_id]);

  // Refresh the existing-projectiles list whenever we're about to
  // show a picker (or whenever the drawer opens, since cluster
  // picking reuses the same list).
  async function refreshExisting(): Promise<readonly ProjectileFileEntry[]> {
    try {
      const dir = await projectilesDir();
      const rows = await listProjectiles(dir);
      setExisting(rows);
      return rows;
    } catch (e: unknown) {
      setError(
        `Failed to list projectiles: ${e instanceof Error ? e.message : String(e)}`,
      );
      return [];
    }
  }

  async function openNew(): Promise<void> {
    await refreshExisting();
    // Pick a non-colliding default id.
    const baseId = (part.id || "weapon") + "_projectile";
    let id = baseId;
    let n = 1;
    const existingIds = new Set(existing.map((p) => p.id));
    while (existingIds.has(id)) {
      n += 1;
      id = `${baseId}_${n}`;
    }
    setDrawerData(makeProjectile(id));
    setDrawerIsExisting(false);
    setMode("drawer-new");
  }

  async function openPicker(): Promise<void> {
    await refreshExisting();
    setMode("picker");
  }

  async function openEdit(): Promise<void> {
    const id = part.projectile_id;
    if (!id) return;
    setError(null);
    try {
      await refreshExisting();
      const p = await projectilePath(id);
      const loaded = await loadProjectile(p);
      setDrawerData(loaded);
      setDrawerIsExisting(true);
      setMode("drawer-edit");
    } catch (e: unknown) {
      setError(
        `Failed to load projectile ${id}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  async function handleSave(next: ProjectileSchematic): Promise<void> {
    setError(null);
    try {
      const targetPath = await projectilePath(next.id);
      // Resolver lets hasCycle walk cross-file references. We look up
      // each projectile via its on-disk file.
      const resolver = async (
        id: string,
      ): Promise<ProjectileSchematic | null> => {
        try {
          const path = await projectilePath(id);
          return await loadProjectile(path);
        } catch {
          // Missing file — treat as a leaf (no further descent).
          return null;
        }
      };
      await saveProjectile(next, targetPath, resolver);
      // Bind the weapon to this projectile id (always — both new and edit).
      patch({ projectile_id: next.id });
      setLinked(next);
      setMode("closed");
      setDrawerData(null);
    } catch (e: unknown) {
      setError(
        `Save failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  function unlinkProjectile(): void {
    patch({ projectile_id: null });
    setLinked(null);
  }

  // Derived-KE summary for the linked projectile row.
  const linkedKE = linked
    ? deriveProjectileStats(linked).kinetic_energy_kj
    : 0;

  // FIRING PATTERN collapse state — collapsed by default to keep the card
  // compact for weapons that don't author timing. Opens with a click on
  // the section header. Local-only UI state; not persisted to the unit.
  const [firingOpen, setFiringOpen] = useState(false);
  const firingHeaderStyle: CSSProperties = {
    margin: "8px 0 4px 0",
    padding: "4px 6px",
    fontSize: 11,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: "#b9b9c0",
    background: "rgba(255,255,255,0.04)",
    border: "1px solid #2a2a2f",
    borderRadius: 3,
    cursor: "pointer",
    userSelect: "none",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  };

  return (
    <>
      <SelectField<WeaponType>
        label="Type"
        value={part.weapon_type}
        options={WEAPON_TYPES}
        onChange={(weapon_type) => patch({ weapon_type })}
      />
      <NumberField
        label="Propellant"
        unit="MJ"
        value={part.propellant_energy_MJ}
        onChange={(propellant_energy_MJ) => patch({ propellant_energy_MJ })}
        min={0}
        step={0.1}
      />
      <NumberField
        label="Projectile"
        unit="kg"
        value={part.projectile_mass_kg}
        onChange={(projectile_mass_kg) => patch({ projectile_mass_kg })}
        min={0}
        step={0.05}
      />
      <NumberField
        label="Barrel Therm. Cap"
        unit="MJ"
        value={part.barrel_thermal_capacity_MJ}
        onChange={(barrel_thermal_capacity_MJ) =>
          patch({ barrel_thermal_capacity_MJ })
        }
        min={0}
        step={5}
      />
      <NumberField
        label="Heat / Shot"
        unit="MJ"
        value={part.per_shot_heat_MJ}
        onChange={(per_shot_heat_MJ) => patch({ per_shot_heat_MJ })}
        min={0}
        step={0.5}
      />
      <NumberField
        label="Cooling"
        unit="MJ/s"
        value={part.cooling_rate_MJs}
        onChange={(cooling_rate_MJs) => patch({ cooling_rate_MJs })}
        min={0}
        step={0.5}
      />
      <NumberField
        label="Drag"
        value={part.drag_coefficient}
        onChange={(drag_coefficient) => patch({ drag_coefficient })}
        min={0}
        step={0.05}
      />
      <NumberField
        label="Elevation Min"
        unit="deg"
        value={elevation[0]}
        onChange={(minDeg) =>
          patch({ elevation_range_deg: [minDeg, elevation[1]] })
        }
        step={1}
      />
      <NumberField
        label="Elevation Max"
        unit="deg"
        value={elevation[1]}
        onChange={(maxDeg) =>
          patch({ elevation_range_deg: [elevation[0], maxDeg] })
        }
        step={1}
      />

      {/* -----------------------------------------------------------------
          FIRING PATTERN — timing model the fire-test sequencer obeys.
          All fields optional with zero-default semantics; omitting every
          one reproduces legacy single-shot fire. Collapsible by default
          to keep the weapon card compact.
          ----------------------------------------------------------------- */}
      <div
        style={firingHeaderStyle}
        onClick={() => setFiringOpen((v) => !v)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setFiringOpen((v) => !v);
          }
        }}
        title="Charge → burst → cooldown timing the fire-test sequencer obeys."
      >
        <span>FIRING PATTERN</span>
        <span style={{ color: "#6f6f78", fontSize: 10 }}>
          {firingOpen ? "▾" : "▸"}
        </span>
      </div>
      {firingOpen ? (
        <>
          <NumberField
            label="Charge"
            unit="ms"
            value={part.charge_time_ms}
            onChange={(charge_time_ms) => patch({ charge_time_ms })}
            min={0}
            step={10}
            title="Delay before first shot leaves the barrel."
          />
          <NumberField
            label="Fire Rate"
            unit="ms"
            value={part.fire_rate_ms}
            onChange={(fire_rate_ms) => patch({ fire_rate_ms })}
            min={0}
            step={10}
            title="Time between shots in sustained fire."
          />
          <NumberField
            label="Burst Count"
            value={part.burst_count}
            onChange={(burst_count) => {
              // Coerce to a positive integer ≥ 1 — the schema requires
              // an int min 1 when set. NumberField hands us a float;
              // round + clamp here so the form never holds an
              // intermediate invalid value the user can't see.
              const n = Math.max(1, Math.floor(burst_count));
              patch({ burst_count: n });
            }}
            min={1}
            step={1}
            title="Shots per Fire trigger (1 = single, 3 = triple-burst)."
          />
          <NumberField
            label="Burst Delay"
            unit="ms"
            value={part.burst_delay_ms}
            onChange={(burst_delay_ms) => patch({ burst_delay_ms })}
            min={0}
            step={10}
            title="Time between shots within a burst."
          />
          <NumberField
            label="Cooldown"
            unit="ms"
            value={part.cooldown_ms}
            onChange={(cooldown_ms) => patch({ cooldown_ms })}
            min={0}
            step={50}
            title="Lockout after burst completes."
          />
        </>
      ) : null}

      {/* -----------------------------------------------------------------
          Projectile section. Shows summary + edit/unlink when linked,
          New/Link buttons when not. The drawer / picker mount inline.
          ----------------------------------------------------------------- */}
      <div className={styles.weaponBlock}>
        <div className={styles.derivedGroupTitle}>Projectile</div>

        {error ? (
          <div className={styles.validationMessage}>{error}</div>
        ) : null}

        {part.projectile_id ? (
          <div className={styles.partCard}>
            <div className={styles.partHeader}>
              <div>
                <span className={styles.partTitle}>
                  {linked ? linked.name : part.projectile_id}
                </span>
                <span className={styles.partSubtitle}>
                  {part.projectile_id}
                </span>
              </div>
              <div>
                <button
                  type="button"
                  className={styles.button}
                  onClick={() => {
                    void openEdit();
                  }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className={styles.buttonDanger}
                  onClick={unlinkProjectile}
                >
                  Unlink
                </button>
              </div>
            </div>
            {linked ? (
              <>
                <div className={styles.partSubtitle}>
                  delivery: {linked.delivery_params.kind} · effect:{" "}
                  {linked.effect_params.kind}
                </div>
                <div className={styles.derivedRow}>
                  <span className={styles.derivedLabel}>KE</span>
                  <span className={styles.derivedValue}>
                    {linkedKE.toLocaleString(undefined, {
                      maximumFractionDigits: 2,
                    })}{" "}
                    kJ
                  </span>
                </div>
              </>
            ) : null}
          </div>
        ) : (
          <div className={styles.addPart}>
            <button
              type="button"
              className={`${styles.button} ${styles.buttonPrimary}`}
              onClick={() => {
                void openNew();
              }}
            >
              + New Projectile
            </button>
            <button
              type="button"
              className={styles.button}
              onClick={() => {
                void openPicker();
              }}
            >
              Link Existing…
            </button>
          </div>
        )}

        {(mode === "drawer-new" || mode === "drawer-edit") && drawerData ? (
          <ProjectileDrawer
            projectile={drawerData}
            isExistingFile={drawerIsExisting}
            existingProjectiles={existing}
            onSave={(next) => {
              void handleSave(next);
            }}
            onCancel={() => {
              setMode("closed");
              setDrawerData(null);
            }}
          />
        ) : null}

        {mode === "picker" ? (
          <ProjectilePicker
            projectiles={existing}
            onSelect={(entry) => {
              patch({ projectile_id: entry.id });
              setMode("closed");
            }}
            onCancel={() => setMode("closed")}
          />
        ) : null}
      </div>
    </>
  );
}
