/**
 * DerivedStatsPanel — read-only readout of computed unit stats.
 *
 * Per DESIGN.md Principle 2 (Derived-stat discipline):
 *   - These values are computed by lib/derive-stats.ts from the unit's
 *     physical inputs.
 *   - They are NEVER written back into the Schematic.
 *   - The numbers are illustrative — the engine recomputes them at
 *     load time using the canonical physics formulas.
 *
 * Lift source: tools/editor/index.html lines 617-687. We preserve the
 * grouping (Mobility / Energy / Defense / Weapons) but drop the
 * DOM-string concatenation in favor of React.
 */

import type { ReactNode } from "react";

import { deriveStats } from "../../lib/derive-stats";
import type { DerivedStats, DerivedWeaponBallistics } from "../../types/derived";
import type { UnitSchematic } from "../../types/unit";

import styles from "./AttributeForm.module.css";

interface DerivedStatsPanelProps {
  readonly unit: UnitSchematic;
}

export function DerivedStatsPanel(props: DerivedStatsPanelProps): ReactNode {
  const { unit } = props;
  // Recomputed on every render. deriveStats is pure and cheap.
  const stats = deriveStats(unit);

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionHeader}>
        Derived Stats
        <span className={styles.sectionBadge}>computed — never authored</span>
      </h3>
      <MobilityGroup unit={unit} stats={stats} />
      <EnergyGroup unit={unit} stats={stats} />
      <DefenseGroup unit={unit} stats={stats} />
      <WeaponsGroup stats={stats} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

function formatDuration(s: number): string {
  if (s < 60) return s.toFixed(1) + " s";
  if (s < 3600) return (s / 60).toFixed(1) + " min";
  return (s / 3600).toFixed(1) + " h";
}

interface RowProps {
  readonly label: string;
  readonly value: string;
  readonly tone?: "good" | "warn" | "bad";
}

function StatRow(props: RowProps): ReactNode {
  const { label, value, tone } = props;
  let valueClass = styles.derivedValue;
  if (tone === "good") valueClass = `${valueClass} ${styles.derivedValueGood}`;
  else if (tone === "warn") valueClass = `${valueClass} ${styles.derivedValueWarn}`;
  else if (tone === "bad") valueClass = `${valueClass} ${styles.derivedValueBad}`;
  return (
    <div className={styles.derivedRow}>
      <span className={styles.derivedLabel}>{label}</span>
      <span className={valueClass}>{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mobility — speed, mass, fuel range.
// ---------------------------------------------------------------------------

function MobilityGroup(props: {
  readonly unit: UnitSchematic;
  readonly stats: DerivedStats;
}): ReactNode {
  const { unit, stats } = props;
  const c = unit.chassis;
  return (
    <div className={styles.derivedGroup}>
      <div className={styles.derivedGroupTitle}>Mobility</div>
      {c.chassis_class === "static_structure" ? (
        <StatRow label="Movement" value="stationary" />
      ) : (
        <>
          <StatRow
            label="Top Speed"
            value={`${stats.speed_mps.toFixed(1)} m/s (${stats.speed_kmh.toFixed(0)} km/h)`}
            tone={stats.speed_mps > 30 ? "good" : stats.speed_mps > 10 ? undefined : "warn"}
          />
          <StatRow
            label="Total Mass"
            value={`${(stats.total_mass_kg / 1000).toFixed(1)} t`}
          />
          {stats.fuel_range_km > 0 ? (
            <StatRow
              label="Fuel Range"
              value={`${stats.fuel_range_km.toFixed(1)} km`}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Energy — engine, draw, balance, endurance, solar.
// ---------------------------------------------------------------------------

function EnergyGroup(props: {
  readonly unit: UnitSchematic;
  readonly stats: DerivedStats;
}): ReactNode {
  const { unit, stats } = props;
  const c = unit.chassis;
  const balance = stats.power_balance_kW;
  const tone: "good" | "warn" | "bad" =
    balance < 0 ? "bad" : balance < 20 ? "warn" : "good";

  return (
    <div className={styles.derivedGroup}>
      <div className={styles.derivedGroupTitle}>Energy</div>
      <StatRow label="Engine Output" value={`${c.engine_kW.toFixed(0)} kW`} />
      <StatRow
        label="Parts Draw"
        value={`${stats.total_part_power_kW.toFixed(0)} kW`}
      />
      <StatRow
        label="Power Balance"
        value={`${balance > 0 ? "+" : ""}${balance.toFixed(0)} kW`}
        tone={tone}
      />
      {stats.battery_endurance_s > 0 ? (
        <StatRow
          label="Battery Endurance"
          value={formatDuration(stats.battery_endurance_s)}
        />
      ) : null}
      {stats.solar_full_charge_s > 0 ? (
        <StatRow
          label="Solar Full Charge"
          value={formatDuration(stats.solar_full_charge_s)}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Defense — armor, shields.
// ---------------------------------------------------------------------------

function DefenseGroup(props: {
  readonly unit: UnitSchematic;
  readonly stats: DerivedStats;
}): ReactNode {
  const { unit, stats } = props;
  const material = unit.chassis.armor_material ?? "salvaged_steel";
  return (
    <div className={styles.derivedGroup}>
      <div className={styles.derivedGroupTitle}>Defense</div>
      <StatRow
        label="Effective Armor"
        value={`${stats.effective_armor_mm.toFixed(0)} mm (${material})`}
      />
      {stats.total_shield_MJ > 0 ? (
        <>
          <StatRow
            label="Shield Capacity"
            value={`${stats.total_shield_MJ.toFixed(0)} MJ`}
          />
          <StatRow
            label="Shield Regen"
            value={`${stats.total_shield_regen_MJs.toFixed(1)} MJ/s`}
          />
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Weapons — per-weapon ballistics.
// ---------------------------------------------------------------------------

function WeaponsGroup(props: { readonly stats: DerivedStats }): ReactNode {
  const { stats } = props;
  if (stats.weapons.length === 0) return null;
  return (
    <div className={styles.derivedGroup}>
      <div className={styles.derivedGroupTitle}>
        Weapons ({stats.weapons.length})
      </div>
      {stats.weapons.map((w, i) => (
        <WeaponBlock key={`${w.name}-${i}`} weapon={w} />
      ))}
    </div>
  );
}

function WeaponBlock(props: {
  readonly weapon: DerivedWeaponBallistics;
}): ReactNode {
  const { weapon: w } = props;
  return (
    <div className={styles.weaponBlock}>
      <div>
        <span className={styles.weaponName}>{w.name}</span>
        {w.type ? <span className={styles.weaponType}>({w.type})</span> : null}
      </div>
      {w.muzzle_velocity_mps !== undefined ? (
        <StatRow
          label="Muzzle Velocity"
          value={`${w.muzzle_velocity_mps.toFixed(0)} m/s`}
        />
      ) : null}
      {w.effective_range_m !== undefined ? (
        <StatRow
          label="Effective Range"
          value={`${(w.effective_range_m / 1000).toFixed(2)} km`}
        />
      ) : null}
      {w.impact_energy_kJ !== undefined ? (
        <StatRow
          label="Impact Energy"
          value={`${w.impact_energy_kJ.toFixed(1)} kJ`}
        />
      ) : null}
      {w.sustainable_shots_per_sec !== undefined ? (
        <StatRow
          label="Sustained ROF"
          value={`${w.sustainable_shots_per_sec.toFixed(2)} /s (steady)`}
          tone="good"
        />
      ) : w.shots_to_overheat !== undefined ? (
        <>
          <StatRow
            label="Burst Capacity"
            value={`${w.shots_to_overheat} shots → vent ${formatDuration(w.vent_duration_s ?? 0)}`}
            tone="warn"
          />
          {w.time_between_shots_s !== undefined ? (
            <StatRow
              label="Time / Shot"
              value={`${w.time_between_shots_s.toFixed(2)} s`}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
