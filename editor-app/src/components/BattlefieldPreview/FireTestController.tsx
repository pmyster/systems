/**
 * FireTestController — overlay UI bar for the Fire-Test feature.
 *
 * Renders a floating, dark, glassy bar pinned to the bottom-centre of
 * the BattlefieldPreview pane. The bar lets the author:
 *
 *   - Check which armed hardpoints are firing this volley
 *   - See a "Fires: hp_1 (Main Cannon), …" status line (one row per
 *     checked HP) — replaces the legacy global Projectile dropdown
 *   - Pick a hit zone (front / side / rear / top)
 *   - Slide the range (50m → 3000m)
 *   - Pick time-dilation (1x / 10x / 100x / 1000x)
 *   - Hit Fire ▶ to launch
 *   - Hit Replay ↻ to repeat with the same inputs
 *
 * The controller is a pure presentational component — it gathers bar
 * inputs and shouts `onFire(bar request)` at its parent. The parent
 * (`BattlefieldPreview`) resolves each checked HP to its weapon,
 * LOADS the weapon's projectile file, runs the resolver, and drives
 * the FireTestScene through a per-HP timing sequencer.
 *
 * A hardpoint is "firable" iff it has a parent rig (spawn frame) AND
 * a `weapon_part_id` that resolves to a `parts[]` entry with
 * `category === "weapon"`. Unparented OR unarmed hardpoints get
 * disabled checkboxes with explanatory tooltips — loud-over-silent.
 */

import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import { humanizeEnum } from "../../lib/enums";
import { isWeapon } from "../../types/part";
import type { MeshHardpoint, UnitSchematic } from "../../types";
import type { ArmorZone } from "../../types/vulnerability";

const ARMOR_ZONES: readonly ArmorZone[] = ["front", "side", "rear", "top"];

/**
 * Bar-level state sent on Fire. Per-HP projectile resolution lives in
 * BattlefieldPreview.handleFire — each armed hardpoint loads ITS OWN
 * weapon's projectile and obeys its OWN timing model.
 */
export interface FireTestBarRequest {
  readonly hitZone: ArmorZone;
  readonly range_m: number;
  readonly time_dilation: number;
}

const DILATION_OPTIONS: readonly { value: number; label: string }[] = [
  { value: 1, label: "1x (real)" },
  { value: 10, label: "10x" },
  { value: 100, label: "100x" },
  { value: 1000, label: "1000x" },
];

// ---------------------------------------------------------------------------
// Inline styles — bar lives outside the regular form module.
// ---------------------------------------------------------------------------

const barStyle: CSSProperties = {
  position: "absolute",
  bottom: 16,
  left: "50%",
  transform: "translateX(-50%)",
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "8px 12px",
  background: "rgba(10, 15, 20, 0.85)",
  border: "1px solid rgba(255, 255, 255, 0.12)",
  borderRadius: 6,
  color: "#e6e6e6",
  font: "12px/1.35 -apple-system, Segoe UI, sans-serif",
  letterSpacing: "0.02em",
  boxShadow: "0 6px 20px rgba(0,0,0,0.4)",
  zIndex: 5,
  maxWidth: "calc(100% - 24px)",
  flexWrap: "wrap",
};

const buttonStyle: CSSProperties = {
  padding: "4px 10px",
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.18)",
  borderRadius: 4,
  color: "#e6e6e6",
  font: "inherit",
  cursor: "pointer",
};

const primaryButtonStyle: CSSProperties = {
  ...buttonStyle,
  background: "rgba(80, 140, 230, 0.25)",
  borderColor: "rgba(140, 180, 230, 0.55)",
};

const fireButtonStyle: CSSProperties = {
  ...buttonStyle,
  background: "rgba(230, 80, 60, 0.30)",
  borderColor: "rgba(240, 130, 110, 0.7)",
  fontWeight: 600,
};

const disabledStyle: CSSProperties = {
  opacity: 0.45,
  cursor: "not-allowed",
};

const segmentedActiveStyle: CSSProperties = {
  ...buttonStyle,
  background: "rgba(80, 140, 230, 0.35)",
  borderColor: "rgba(140, 180, 230, 0.7)",
  color: "#ffffff",
};

const sliderStyle: CSSProperties = {
  width: 140,
  verticalAlign: "middle",
};


// ---------------------------------------------------------------------------
// Component.
// ---------------------------------------------------------------------------

export interface FireTestControllerProps {
  readonly onFire: (request: FireTestBarRequest) => Promise<void>;
  readonly busy: boolean;
  /**
   * Called any time hitZone or range_m changes so the preview can update
   * the target marker live (before Fire is pressed). The active hit-zone
   * is reflected on the world target sprite via this callback.
   */
  readonly onAimChange?: (hitZone: ArmorZone, range_m: number) => void;
  /**
   * The unit's hardpoints — drives the per-hardpoint checkbox row. The
   * controller tracks which ids are checked (per-session, NOT persisted)
   * and broadcasts via `onSelectedHardpointsChange`. A hardpoint with no
   * `parent_rig_id` (unparented) OR a missing/invalid `weapon_part_id`
   * (unarmed) is shown with a disabled checkbox + tooltip — it cannot
   * fire without both a parent rig (spawn frame) and a weapon
   * (projectile + timing). Passed as a readonly array so the checkbox
   * row matches the form's top-to-bottom order.
   */
  readonly hardpoints: readonly MeshHardpoint[];
  /**
   * The unit — used to resolve per-HP `weapon_part_id` references to
   * weapon parts (for the "Fires:" status line and the "armed" check).
   * Passing the whole unit instead of a prefiltered weapon list keeps
   * the controller a thin presentation layer.
   */
  readonly unit: UnitSchematic;
  /**
   * Called whenever the user toggles a checkbox or hits All / None.
   * Receives the FULL current selection set (not a delta) so the parent
   * can push it straight into shared state.
   */
  readonly onSelectedHardpointsChange: (ids: ReadonlySet<string>) => void;
}

export function FireTestController(props: FireTestControllerProps): ReactNode {
  const {
    onFire,
    busy,
    onAimChange,
    hardpoints,
    unit,
    onSelectedHardpointsChange,
  } = props;

  const [hitZone, setHitZone] = useState<ArmorZone>("front");
  const [range_m, setRangeM] = useState<number>(500);
  const [dilation, setDilation] = useState<number>(100);

  // Resolve weapon parts on the unit, keyed by id, for the "armed" check
  // and the Fires status line. The map is derived per render — small
  // lists, no memo justified. A hardpoint is "armed" iff its
  // weapon_part_id is set AND that id resolves to a part with
  // category === "weapon" (a non-weapon match counts as unarmed —
  // loud-over-silent over "any part will do").
  const weaponById = useMemo(() => {
    const m = new Map<string, { id: string; name: string }>();
    for (const p of unit.parts ?? []) {
      if (isWeapon(p)) m.set(p.id, { id: p.id, name: p.name || p.id });
    }
    return m;
  }, [unit.parts]);

  function isArmed(h: MeshHardpoint): boolean {
    if (h.weapon_part_id === undefined) return false;
    return weaponById.has(h.weapon_part_id);
  }

  function isParented(h: MeshHardpoint): boolean {
    return h.parent_rig_id !== null && h.parent_rig_id !== "";
  }

  function isFirable(h: MeshHardpoint): boolean {
    return isParented(h) && isArmed(h);
  }

  // -------------------------------------------------------------------------
  // Hardpoint selection — per-session, NOT persisted to the unit JSON.
  //
  // Default: every FIRABLE hardpoint (parented AND armed) is checked on a
  // fresh load / unit swap / shape change. Unparented OR unarmed HPs
  // cannot fire — checkboxes are disabled with explanatory tooltips and
  // default to unchecked.
  //
  // The set is rebuilt only when the SHAPE changes — id set, parented?,
  // armed? — not on every form keystroke.
  // -------------------------------------------------------------------------
  const [selectedHpIds, setSelectedHpIds] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );

  // Stable key combining (id, parented?, armed?). When ANY of these
  // change shape (HP added/removed, parent rig assigned, weapon
  // assigned/cleared) we re-default the selection. Sorted to ignore
  // reordering — order has no effect on which HPs exist.
  const hpShapeKey = useMemo(() => {
    const rows = hardpoints.map((h) => {
      const p = isParented(h) ? "1" : "0";
      const a = isArmed(h) ? "1" : "0";
      return `${h.id}:${p}${a}`;
    });
    rows.sort();
    return rows.join("|");
    // weaponById is part of the shape — re-default when weapons change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hardpoints, weaponById]);

  // Re-default the selection when the hardpoint shape changes. "All
  // firable HPs selected" is the default per the brief; drop any
  // selected id that no longer exists OR is no longer firable.
  useEffect(() => {
    const next = new Set<string>();
    for (const h of hardpoints) {
      if (isFirable(h)) next.add(h.id);
    }
    setSelectedHpIds(next);
    // Intentionally depend on hpShapeKey, not the full hardpoints array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hpShapeKey]);

  // Broadcast the current selection to the parent on every change so
  // the BattlefieldPreview can push it into the shared mesh-assets
  // context (which the MeshViewer reads for cyan highlight + the slot
  // reads for arrow colour).
  useEffect(() => {
    onSelectedHardpointsChange(selectedHpIds);
  }, [selectedHpIds, onSelectedHardpointsChange]);

  function toggleHp(id: string): void {
    setSelectedHpIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllFirable(): void {
    const next = new Set<string>();
    for (const h of hardpoints) {
      if (isFirable(h)) next.add(h.id);
    }
    setSelectedHpIds(next);
  }

  function selectNone(): void {
    setSelectedHpIds(new Set<string>());
  }

  // Live aim broadcast — hitZone + range together drive the world target
  // marker AND the hit-zone label sprite.
  useEffect(() => {
    if (onAimChange) onAimChange(hitZone, range_m);
  }, [hitZone, range_m, onAimChange]);

  async function handleFire(): Promise<void> {
    await onFire({ hitZone, range_m, time_dilation: dilation });
  }

  // Per-HP weapon resolution for the "Fires:" status line. Each currently
  // CHECKED hp gets a row whether or not it's armed — an unarmed checked
  // HP shouldn't be checkable in the first place (the checkbox is
  // disabled), but if a race produces one we surface "— no weapon —" in
  // muted text instead of dropping it silently.
  const firesSummary: { readonly hpId: string; readonly weaponName: string | null }[] = [];
  for (const h of hardpoints) {
    if (!selectedHpIds.has(h.id)) continue;
    const wid = h.weapon_part_id;
    const w = wid !== undefined ? weaponById.get(wid) ?? null : null;
    firesSummary.push({ hpId: h.id, weaponName: w !== null ? w.name : null });
  }

  // Fire is disabled when busy OR no checked HP exists OR no checked HP
  // is firable (every checked one is missing a weapon — effectively no
  // projectile to fire). The "no projectile" condition is preserved as
  // an OR — equivalent to "no armed selected HP".
  const anyCheckedFirable = (() => {
    for (const h of hardpoints) {
      if (selectedHpIds.has(h.id) && isFirable(h)) return true;
    }
    return false;
  })();
  const fireDisabled = busy || selectedHpIds.size === 0 || !anyCheckedFirable;
  const controlsDisabled = busy;

  return (
    <>
      <div style={barStyle}>
        {/* -------- Hardpoint checkbox row -------- */}
        {/*
          One checkbox per hardpoint, labeled with the hardpoint id. The
          row hides entirely when the unit declares no hardpoints — the
          existing rig + bbox fallback paths in BattlefieldPreview's
          computeAim still work in that case (single-shot legacy mode),
          so a hidden row is the truthful UI signal that there is no
          per-hardpoint choice to make.

          A hardpoint with no parent_rig_id gets a disabled checkbox plus
          a tooltip explaining why — same loud-over-silent principle as
          the inspector-side chip in MeshHardpointSection.
        */}
        {hardpoints.length > 0 ? (
          <div
            style={{
              flexBasis: "100%",
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
              borderBottom: "1px dashed rgba(255,255,255,0.12)",
              paddingBottom: 6,
              marginBottom: 2,
            }}
          >
            <span style={{ color: "#9aa3ad" }}>Hardpoints:</span>
            {hardpoints.map((h) => {
              const parented = isParented(h);
              const armed = isArmed(h);
              const firable = parented && armed;
              const checked = selectedHpIds.has(h.id);
              // Distinct tooltip per failure mode so the author knows
              // WHICH gate is closed. Compose for the multi-failure
              // case (no parent AND no weapon).
              const reasons: string[] = [];
              if (!parented) reasons.push("Needs a parent rig to fire");
              if (!armed) reasons.push("No weapon assigned");
              const title = firable ? `Fire from ${h.id}` : reasons.join(" · ");
              return (
                <label
                  key={h.id}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    cursor: firable && !controlsDisabled ? "pointer" : "not-allowed",
                    opacity: firable ? 1 : 0.45,
                    color: checked ? "#00ffff" : "#e6e6e6",
                  }}
                  title={title}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!firable || controlsDisabled}
                    onChange={() => toggleHp(h.id)}
                    style={{
                      cursor:
                        firable && !controlsDisabled ? "pointer" : "not-allowed",
                    }}
                  />
                  {h.id}
                </label>
              );
            })}
            <span style={{ color: "#6b7280" }}>|</span>
            <button
              type="button"
              style={controlsDisabled ? { ...buttonStyle, ...disabledStyle } : buttonStyle}
              disabled={controlsDisabled}
              onClick={selectAllFirable}
              title="Check every hardpoint that is parented AND armed"
            >
              All
            </button>
            <button
              type="button"
              style={controlsDisabled ? { ...buttonStyle, ...disabledStyle } : buttonStyle}
              disabled={controlsDisabled}
              onClick={selectNone}
              title="Uncheck every hardpoint"
            >
              None
            </button>
          </div>
        ) : null}

        {/* -------- "Fires" status line -------- */}
        {/*
          One status line per checked HP. The global projectile dropdown
          is gone — each armed hardpoint fires ITS OWN weapon's
          projectile and obeys its OWN timing model. An unarmed checked
          HP (only possible via a transient race) is muted with
          "— no weapon —". When nothing is checked, the line reads as
          a hint to pick one.
        */}
        <span style={{ color: "#9aa3ad" }}>Fires:</span>
        {firesSummary.length === 0 ? (
          <span style={{ color: "#9aa3ad", marginLeft: 4 }}>
            (pick a hardpoint above)
          </span>
        ) : (
          <span
            style={{
              color: "#e6e6e6",
              maxWidth: 380,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={firesSummary
              .map((r) =>
                r.weaponName !== null
                  ? `${r.hpId} (${r.weaponName})`
                  : `${r.hpId} (no weapon)`,
              )
              .join(", ")}
          >
            {firesSummary.map((r, i) => (
              <span key={r.hpId}>
                {r.weaponName !== null ? (
                  <span>
                    {r.hpId} ({r.weaponName})
                  </span>
                ) : (
                  <span style={{ color: "#9aa3ad" }}>
                    {r.hpId} (— no weapon —)
                  </span>
                )}
                {i < firesSummary.length - 1 ? ", " : ""}
              </span>
            ))}
          </span>
        )}

        {/* -------- Hit Zone segmented control -------- */}
        {/*
          Labeled "Hit Zone:" so the row's purpose reads at a glance
          (previously the buttons were unlabeled). The active zone is
          rendered in `segmentedActiveStyle` — distinct background +
          brighter text — so the current selection is unambiguous even
          across re-mounts.
        */}
        <span style={{ color: "#9aa3ad", marginLeft: 8 }}>Hit Zone:</span>
        <div style={{ display: "flex", gap: 2 }}>
          {ARMOR_ZONES.map((z) => (
            <button
              key={z}
              type="button"
              style={
                z === hitZone
                  ? segmentedActiveStyle
                  : controlsDisabled
                    ? { ...buttonStyle, ...disabledStyle }
                    : buttonStyle
              }
              disabled={controlsDisabled}
              onClick={() => setHitZone(z)}
              title={`Aim at the ${humanizeEnum(z)} zone`}
            >
              {humanizeEnum(z)}
            </button>
          ))}
        </div>

        {/* -------- Range slider -------- */}
        <label style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 8 }}>
          <span style={{ color: "#9aa3ad" }}>Range:</span>
          <input
            type="range"
            min={50}
            max={3000}
            step={10}
            value={range_m}
            disabled={controlsDisabled}
            onChange={(e) => setRangeM(Number.parseFloat(e.target.value) || 0)}
            style={sliderStyle}
          />
          <span
            style={{
              minWidth: 56,
              textAlign: "right",
              fontVariantNumeric: "tabular-nums",
              color: "#e6e6e6",
            }}
          >
            {range_m} m
          </span>
        </label>

        {/* -------- Speed dropdown -------- */}
        <label style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 8 }}>
          <span style={{ color: "#9aa3ad" }}>Speed:</span>
          <select
            value={dilation}
            disabled={controlsDisabled}
            onChange={(e) => setDilation(Number.parseFloat(e.target.value) || 1)}
            style={{
              ...buttonStyle,
              ...(controlsDisabled ? disabledStyle : {}),
              padding: "3px 6px",
            }}
          >
            {DILATION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        {/* -------- Fire + Replay -------- */}
        <button
          type="button"
          style={fireDisabled ? { ...fireButtonStyle, ...disabledStyle } : fireButtonStyle}
          disabled={fireDisabled}
          onClick={() => {
            void handleFire();
          }}
        >
          ▶ Fire
        </button>
        <button
          type="button"
          style={fireDisabled ? { ...primaryButtonStyle, ...disabledStyle } : primaryButtonStyle}
          disabled={fireDisabled}
          onClick={() => {
            void handleFire();
          }}
          title="Replay with the same inputs"
        >
          ↻ Replay
        </button>

      </div>
    </>
  );
}
