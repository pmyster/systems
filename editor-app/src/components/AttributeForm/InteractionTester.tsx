/**
 * InteractionTester — live "what happens if X hits this unit" panel.
 *
 * The author picks a projectile from disk, a hit zone (front/side/rear/top),
 * and a range, and the panel renders the InteractionOutcome computed by
 * the pure resolver in src/lib/resolve-interaction.ts. Updates live as
 * zone/range change.
 *
 * Per "loud over silent": the resolution_notes section is always
 * visible (collapsed by default) so unhandled effect combinations or
 * missing electronic systems surface to the author instead of silently
 * resolving as "no effect".
 *
 * Per Principle 2: outcomes are computed every render — never cached
 * back into the unit.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { join } from "@tauri-apps/api/path";

import {
  listProjectiles,
  loadProjectile,
  type ProjectileFileEntry,
} from "../../file-ops/projectile-ops";
import { resolveInteraction } from "../../lib/resolve-interaction";
import { humanizeEnum } from "../../lib/enums";
import type { ProjectileSchematic } from "../../types/projectile";
import type { UnitSchematic } from "../../types/unit";
import type { ArmorZone, InteractionOutcome } from "../../types/vulnerability";

import { ProjectilePicker } from "./ProjectilePicker";
import styles from "./AttributeForm.module.css";

/** Absolute on-disk directory where projectile files live. Mirrors WeaponSubform. */
const PROJECTILES_DIR = "C:\\dev\\Strategy Game\\units\\projectiles";

interface InteractionTesterProps {
  readonly unit: UnitSchematic;
}

const ARMOR_ZONES: readonly ArmorZone[] = ["front", "side", "rear", "top"];

export function InteractionTester(props: InteractionTesterProps): ReactNode {
  const { unit } = props;

  type Mode = "closed" | "picker";
  const [mode, setMode] = useState<Mode>("closed");
  const [projectileEntries, setProjectileEntries] = useState<readonly ProjectileFileEntry[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedEntry, setSelectedEntry] = useState<ProjectileFileEntry | null>(null);
  const [loadedProjectile, setLoadedProjectile] = useState<ProjectileSchematic | null>(null);
  const [hitZone, setHitZone] = useState<ArmorZone>("front");
  const [range_m, setRange_m] = useState<number>(500);
  const [notesOpen, setNotesOpen] = useState<boolean>(false);

  // Load chosen projectile from disk whenever the selection changes.
  useEffect(() => {
    if (!selectedEntry) {
      setLoadedProjectile(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const p = await loadProjectile(selectedEntry.path);
        if (!cancelled) setLoadedProjectile(p);
      } catch (e: unknown) {
        if (!cancelled) {
          setLoadedProjectile(null);
          setLoadError(
            `Failed to load projectile ${selectedEntry.id}: ${
              e instanceof Error ? e.message : String(e)
            }`,
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedEntry]);

  // Pure computation — re-runs on every input change. Per Principle 2,
  // never persisted back into the unit.
  const outcome: InteractionOutcome | null = useMemo(() => {
    if (!loadedProjectile) return null;
    return resolveInteraction(
      loadedProjectile,
      {
        vulnerability: unit.vulnerability,
        thermal_cap_mj: unit.chassis.thermal_capacity_MJ ?? 0,
      },
      hitZone,
      range_m,
    );
  }, [loadedProjectile, unit.vulnerability, unit.chassis.thermal_capacity_MJ, hitZone, range_m]);

  async function openPicker(): Promise<void> {
    setLoadError(null);
    try {
      const dir = PROJECTILES_DIR;
      // (Future: replace with a resolved projectilesDir() helper.)
      void (await join(dir, "")); // exercise the path API so any wiring issue surfaces here, not at click time
      const rows = await listProjectiles(dir);
      setProjectileEntries(rows);
      setMode("picker");
    } catch (e: unknown) {
      setLoadError(
        `Failed to list projectiles: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  if (mode === "picker") {
    return (
      <ProjectilePicker
        projectiles={projectileEntries}
        onSelect={(entry) => {
          setSelectedEntry(entry);
          setMode("closed");
        }}
        onCancel={() => setMode("closed")}
      />
    );
  }

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionHeader}>
        Interaction Tester
        <span className={styles.sectionBadge}>live · derived · physical</span>
      </h3>

      {/* ---------- Projectile picker ---------- */}
      <div className={styles.row}>
        <label className={styles.label}>Projectile</label>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {selectedEntry ? (
            <>
              <span className={styles.partTitle}>{selectedEntry.name}</span>
              <span className={styles.partSubtitle}>{selectedEntry.id}</span>
              {loadedProjectile ? (
                <>
                  <span className={styles.tagChip}>
                    {humanizeEnum(loadedProjectile.delivery_params.kind)}
                  </span>
                  <span className={styles.tagChip}>
                    {humanizeEnum(loadedProjectile.effect_params.kind)}
                  </span>
                </>
              ) : null}
              <button
                type="button"
                className={styles.button}
                onClick={() => {
                  void openPicker();
                }}
              >
                Change…
              </button>
            </>
          ) : (
            <button
              type="button"
              className={`${styles.button} ${styles.buttonPrimary}`}
              onClick={() => {
                void openPicker();
              }}
            >
              Pick Projectile…
            </button>
          )}
        </div>
      </div>

      {loadError ? (
        <div className={styles.validationError} style={{ marginTop: 4 }}>
          {loadError}
        </div>
      ) : null}

      {/* ---------- Hit zone ---------- */}
      <div className={styles.row}>
        <label className={styles.label}>Hit Zone</label>
        <div style={{ display: "flex", gap: 4 }}>
          {ARMOR_ZONES.map((z) => (
            <button
              key={z}
              type="button"
              className={z === hitZone ? `${styles.button} ${styles.buttonPrimary}` : styles.button}
              onClick={() => setHitZone(z)}
            >
              {humanizeEnum(z)}
            </button>
          ))}
        </div>
      </div>

      {/* ---------- Range ---------- */}
      <div className={styles.row}>
        <label className={styles.label}>Range (m)</label>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="range"
            min={0}
            max={5000}
            step={50}
            value={range_m}
            onChange={(e) => setRange_m(Number.parseFloat(e.target.value) || 0)}
            style={{ flex: 1 }}
          />
          <input
            className={styles.input}
            type="number"
            min={0}
            max={5000}
            step={50}
            value={range_m}
            onChange={(e) => {
              const raw = e.target.value;
              const n = raw === "" ? 0 : Number.parseFloat(raw);
              setRange_m(Number.isFinite(n) ? Math.max(0, n) : 0);
            }}
            style={{ width: 90 }}
          />
        </div>
      </div>

      {/* ---------- Outcome display ---------- */}
      {!selectedEntry ? (
        <div className={styles.empty}>
          Pick a projectile to see how this unit responds. The resolver runs
          live as you change zone or range — no save / reload required.
        </div>
      ) : !outcome ? (
        <div className={styles.empty}>Loading projectile…</div>
      ) : (
        <>
          <div
            className={styles.partCard}
            style={{
              marginTop: 6,
              borderColor: outcome.catastrophic ? "#c16060" : "#3a3a42",
            }}
          >
            <div className={styles.partHeader}>
              <span
                className={
                  outcome.catastrophic ? styles.derivedValueBad : styles.derivedValue
                }
                style={{ fontWeight: 600 }}
              >
                {outcome.readable_summary}
              </span>
            </div>

            <div className={styles.derivedGroup}>
              <div className={styles.derivedRow}>
                <span className={styles.derivedLabel}>Penetrated</span>
                <span className={styles.derivedValue}>
                  {outcome.penetrated === null
                    ? "—"
                    : outcome.penetrated
                      ? "YES"
                      : "no"}
                </span>
              </div>
              <div className={styles.derivedRow}>
                <span className={styles.derivedLabel}>Penetration Residual</span>
                <span className={styles.derivedValue}>
                  {outcome.penetration_residual_kj.toFixed(2)} kJ
                </span>
              </div>
              <div className={styles.derivedRow}>
                <span className={styles.derivedLabel}>Crew Effectiveness Loss</span>
                <span className={styles.derivedValue}>
                  {(outcome.crew_effectiveness_loss * 100).toFixed(0)}%
                </span>
              </div>
              <div className={styles.derivedRow}>
                <span className={styles.derivedLabel}>Crew Casualties</span>
                <span
                  className={
                    outcome.crew_casualties > 0
                      ? styles.derivedValueWarn
                      : styles.derivedValue
                  }
                >
                  {outcome.crew_casualties}
                </span>
              </div>
              <div className={styles.derivedRow}>
                <span className={styles.derivedLabel}>Structure Damage</span>
                <span className={styles.derivedValue}>
                  {outcome.structure_damage_mj.toFixed(2)} MJ
                </span>
              </div>
              <div className={styles.derivedRow}>
                <span className={styles.derivedLabel}>Heat Added</span>
                <span className={styles.derivedValue}>
                  {outcome.heat_added_mj.toFixed(2)} MJ
                </span>
              </div>
              <div className={styles.derivedRow}>
                <span className={styles.derivedLabel}>Electronics Disabled</span>
                <span className={styles.derivedValue}>
                  {outcome.electronics_disabled.length === 0
                    ? "none"
                    : outcome.electronics_disabled.join(", ")}
                </span>
              </div>
              <div className={styles.derivedRow}>
                <span className={styles.derivedLabel}>Mobility Impact</span>
                <span className={styles.derivedValue}>
                  {(outcome.mobility_impact * 100).toFixed(0)}%
                </span>
              </div>
              <div className={styles.derivedRow}>
                <span className={styles.derivedLabel}>Catastrophic</span>
                <span
                  className={
                    outcome.catastrophic
                      ? styles.derivedValueBad
                      : styles.derivedValueGood
                  }
                >
                  {outcome.catastrophic ? "YES" : "no"}
                </span>
              </div>
            </div>
          </div>

          {/* ---------- Resolution notes (collapsible) ---------- */}
          <div style={{ marginTop: 6 }}>
            <button
              type="button"
              className={styles.button}
              onClick={() => setNotesOpen((v) => !v)}
            >
              {notesOpen ? "▼" : "▶"} Resolution Notes ({outcome.resolution_notes.length})
            </button>
            {notesOpen ? (
              <pre
                style={{
                  margin: "6px 0 0 0",
                  padding: 8,
                  background: "#1c1c1f",
                  border: "1px solid #2a2a2f",
                  borderRadius: 3,
                  fontSize: 11,
                  fontFamily:
                    "ui-monospace, 'Cascadia Code', Menlo, Consolas, monospace",
                  color: "#b9b9c0",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {outcome.resolution_notes.join("\n")}
              </pre>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}
