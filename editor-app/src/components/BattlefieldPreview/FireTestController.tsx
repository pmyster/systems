/**
 * FireTestController — overlay UI bar for the Fire-Test feature.
 *
 * Renders a floating, dark, glassy bar pinned to the bottom-centre of
 * the BattlefieldPreview pane. The bar lets the author:
 *
 *   - Pick a projectile (opens the existing ProjectilePicker modal)
 *   - Pick a hit zone (front / side / rear / top)
 *   - Slide the range (50m → 3000m)
 *   - Pick time-dilation (1x / 10x / 100x / 1000x)
 *   - Hit Fire ▶ to launch
 *   - Hit Replay ↻ to repeat with the same inputs
 *
 * The controller is a pure presentational component — it only knows how
 * to gather inputs and shout `onFire(request)` at its parent. The parent
 * (`BattlefieldPreview`) loads the projectile, runs the resolver, and
 * drives the FireTestScene.
 *
 * Per the brief: when no projectile is selected, controls are greyed
 * out and a hint reads "Select a projectile to begin →".
 */

import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { join } from "@tauri-apps/api/path";

import {
  listProjectiles,
  loadProjectile,
  type ProjectileFileEntry,
} from "../../file-ops/projectile-ops";
import type { FireTestRequest } from "../../lib/fire-test/types";
import { humanizeEnum } from "../../lib/enums";
import type { MeshHardpoint, ProjectileSchematic } from "../../types";
import type { ArmorZone } from "../../types/vulnerability";

import { ProjectilePicker } from "../AttributeForm/ProjectilePicker";

const PROJECTILES_DIR = "C:\\dev\\Strategy Game\\units\\projectiles";

const ARMOR_ZONES: readonly ArmorZone[] = ["front", "side", "rear", "top"];

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

const chipStyle: CSSProperties = {
  display: "inline-block",
  padding: "1px 6px",
  background: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(255,255,255,0.18)",
  borderRadius: 10,
  fontSize: 10,
  color: "#cfd6dc",
  marginLeft: 4,
};

const sliderStyle: CSSProperties = {
  width: 140,
  verticalAlign: "middle",
};

const modalOverlayStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  background: "rgba(0,0,0,0.55)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 20,
};

const modalCardStyle: CSSProperties = {
  width: "min(560px, 92%)",
  maxHeight: "80%",
  overflow: "auto",
  background: "#1f1f23",
  border: "1px solid #2a2a2f",
  borderRadius: 6,
  padding: 12,
  boxShadow: "0 12px 28px rgba(0,0,0,0.55)",
};

// ---------------------------------------------------------------------------
// Component.
// ---------------------------------------------------------------------------

export interface FireTestControllerProps {
  readonly onFire: (request: FireTestRequest) => Promise<void>;
  readonly busy: boolean;
  /**
   * Called any time the user changes the projectile or range so the
   * preview can update the target marker live (before Fire is pressed).
   */
  readonly onAimChange?: (
    projectile: ProjectileSchematic | null,
    range_m: number,
  ) => void;
  /**
   * The unit's hardpoints — drives the per-hardpoint checkbox row. The
   * controller is responsible for tracking which ids are checked
   * (per-session state, NOT persisted) and broadcasting changes via
   * `onSelectedHardpointsChange`. A hardpoint with `parent_rig_id ===
   * null` is shown with a disabled checkbox + tooltip — it cannot fire
   * without a parent rig because the runtime has no spawn frame for it.
   *
   * Passed as a readonly array so we can render checkbox UI in the same
   * order the form shows them, top to bottom.
   */
  readonly hardpoints: readonly MeshHardpoint[];
  /**
   * Called whenever the user toggles a checkbox or hits All / None.
   * Receives the FULL current selection set (not a delta) so the parent
   * can push it straight into shared state — easier to reason about
   * than reconciling deltas.
   */
  readonly onSelectedHardpointsChange: (ids: ReadonlySet<string>) => void;
}

export function FireTestController(props: FireTestControllerProps): ReactNode {
  const { onFire, busy, onAimChange, hardpoints, onSelectedHardpointsChange } =
    props;

  const [pickerOpen, setPickerOpen] = useState(false);
  const [entries, setEntries] = useState<readonly ProjectileFileEntry[]>([]);
  const [pickError, setPickError] = useState<string | null>(null);

  const [selected, setSelected] = useState<ProjectileFileEntry | null>(null);
  const [projectile, setProjectile] = useState<ProjectileSchematic | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [hitZone, setHitZone] = useState<ArmorZone>("front");
  const [range_m, setRangeM] = useState<number>(500);
  const [dilation, setDilation] = useState<number>(100);

  // -------------------------------------------------------------------------
  // Hardpoint selection — per-session, NOT persisted to the unit JSON.
  //
  // Default: every PARENTED hardpoint is checked on a fresh load / unit
  // swap / hardpoint list change. Unparented hardpoints (parent_rig_id ===
  // null) cannot fire — they have no rig frame to spawn from — so the
  // checkbox is disabled and they default to unchecked.
  //
  // The set is rebuilt whenever the hardpoint id set or parent_rig_id
  // mapping changes shape. We don't rebuild on every render (or every
  // arbitrary unit edit) — only when an id appears/disappears or a
  // hardpoint switches between parented and unparented — so user
  // toggles in the middle of a session survive form edits.
  // -------------------------------------------------------------------------
  const [selectedHpIds, setSelectedHpIds] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );

  // Build a stable key from the hardpoints' (id, parented?) so the
  // defaulting effect only fires when the SHAPE changes, not on every
  // pos/rot tweak. Sorted to ignore reordering — order doesn't affect
  // which hardpoints exist or which are parented.
  const hpShapeKey = useMemo(() => {
    const rows = hardpoints.map(
      (h) => `${h.id}:${h.parent_rig_id !== null && h.parent_rig_id !== "" ? "1" : "0"}`,
    );
    rows.sort();
    return rows.join("|");
  }, [hardpoints]);

  // Re-default the selection when the hardpoint shape changes. "All
  // parented HPs selected" is the default per the brief; we also drop any
  // selected id that no longer exists so a deleted hardpoint doesn't
  // linger as a phantom selection.
  useEffect(() => {
    const next = new Set<string>();
    for (const h of hardpoints) {
      const parented = h.parent_rig_id !== null && h.parent_rig_id !== "";
      if (parented) next.add(h.id);
    }
    setSelectedHpIds(next);
    // Intentionally depend on hpShapeKey, not the full hardpoints array —
    // see comment above. Including `hardpoints` would reset the selection
    // on every form keystroke.
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

  function selectAllParented(): void {
    const next = new Set<string>();
    for (const h of hardpoints) {
      if (h.parent_rig_id !== null && h.parent_rig_id !== "") {
        next.add(h.id);
      }
    }
    setSelectedHpIds(next);
  }

  function selectNone(): void {
    setSelectedHpIds(new Set<string>());
  }

  // Load the projectile body when the selected entry changes.
  useEffect(() => {
    if (!selected) {
      setProjectile(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const p = await loadProjectile(selected.path);
        if (!cancelled) {
          setProjectile(p);
          setLoadError(null);
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setProjectile(null);
          setLoadError(
            `Failed to load projectile ${selected.id}: ${
              e instanceof Error ? e.message : String(e)
            }`,
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected]);

  // Live aim broadcast.
  useEffect(() => {
    if (onAimChange) onAimChange(projectile, range_m);
  }, [projectile, range_m, onAimChange]);

  async function openPicker(): Promise<void> {
    setPickError(null);
    try {
      void (await join(PROJECTILES_DIR, ""));
      const rows = await listProjectiles(PROJECTILES_DIR);
      setEntries(rows);
      setPickerOpen(true);
    } catch (e: unknown) {
      setPickError(
        `Failed to list projectiles: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  function buildRequest(): FireTestRequest | null {
    if (!projectile) return null;
    return {
      projectile,
      hitZone,
      range_m,
      time_dilation: dilation,
    };
  }

  async function handleFire(): Promise<void> {
    const req = buildRequest();
    if (!req) return;
    await onFire(req);
  }

  // Fire is disabled when busy, when no projectile is picked, OR when no
  // hardpoints are selected to fire from. The "no hardpoints selected"
  // condition is new: a multi-hardpoint unit with everything unchecked
  // would have no shots to fire, so we surface that as a disabled button
  // rather than silently producing zero beams.
  const fireDisabled = busy || !projectile || selectedHpIds.size === 0;
  const controlsDisabled = busy;

  return (
    <>
      {pickerOpen ? (
        <div style={modalOverlayStyle}>
          <div style={modalCardStyle}>
            <ProjectilePicker
              projectiles={entries}
              onSelect={(entry) => {
                setSelected(entry);
                setPickerOpen(false);
              }}
              onCancel={() => setPickerOpen(false)}
            />
          </div>
        </div>
      ) : null}

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
              const parented =
                h.parent_rig_id !== null && h.parent_rig_id !== "";
              const checked = selectedHpIds.has(h.id);
              const label = (
                <label
                  key={h.id}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    cursor: parented && !controlsDisabled ? "pointer" : "not-allowed",
                    opacity: parented ? 1 : 0.45,
                    color: checked ? "#00ffff" : "#e6e6e6",
                  }}
                  title={
                    parented
                      ? `Fire from ${h.id}`
                      : "Needs a parent rig to fire"
                  }
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!parented || controlsDisabled}
                    onChange={() => toggleHp(h.id)}
                    style={{
                      cursor:
                        parented && !controlsDisabled ? "pointer" : "not-allowed",
                    }}
                  />
                  {h.id}
                </label>
              );
              return label;
            })}
            <span style={{ color: "#6b7280" }}>|</span>
            <button
              type="button"
              style={controlsDisabled ? { ...buttonStyle, ...disabledStyle } : buttonStyle}
              disabled={controlsDisabled}
              onClick={selectAllParented}
              title="Check every hardpoint that has a parent rig"
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

        {/* -------- Projectile picker button -------- */}
        <button
          type="button"
          style={controlsDisabled ? { ...buttonStyle, ...disabledStyle } : buttonStyle}
          disabled={controlsDisabled}
          onClick={() => {
            void openPicker();
          }}
        >
          {projectile
            ? `${projectile.name} ▾`
            : selected
              ? `${selected.name} ▾`
              : "Projectile ▾"}
        </button>

        {projectile ? (
          <>
            <span style={chipStyle}>
              {humanizeEnum(projectile.delivery_params.kind)}
            </span>
            <span style={chipStyle}>
              {humanizeEnum(projectile.effect_params.kind)}
            </span>
          </>
        ) : (
          <span style={{ color: "#9aa3ad", marginLeft: 4 }}>
            Select a projectile to begin →
          </span>
        )}

        {/* -------- Zone segmented control -------- */}
        <div style={{ display: "flex", gap: 2, marginLeft: 8 }}>
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

        {(pickError ?? loadError) ? (
          <div
            style={{
              flexBasis: "100%",
              color: "#f08080",
              padding: "4px 0 0 0",
              fontSize: 11,
            }}
          >
            {pickError ?? loadError}
          </div>
        ) : null}
      </div>
    </>
  );
}
