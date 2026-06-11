/**
 * Material palette UI for the Voxel Sculptor.
 *
 * Behavior lift from tools/voxel-editor/index.html lines 547-571.
 * The prototype's MATERIALS list ships with six entries (armor, hull,
 * accent, glass, engine, hardpoint); the brief speaks of a
 * "faction-bound default palette + a few free colors", which today
 * maps to: team-tinted materials (armor/hull/accent) + fixed-color
 * materials (glass/engine/hardpoint). Faction tinting is applied at
 * render time by buildUnitMesh — the swatch is the raw material color.
 *
 * Active material is component-local state at the VoxelSculptor level
 * and threaded in via props.
 */

import { FACTION_PALETTE_HEX, hexString, MATERIALS } from "../../lib";
import type { Faction, MaterialId } from "../../types";

// ---------------------------------------------------------------------------
// Props.
// ---------------------------------------------------------------------------

export interface PaletteProps {
  readonly active: MaterialId;
  readonly onSelect: (material: MaterialId) => void;
  /**
   * Faction colors are surfaced as a non-interactive preview strip so
   * the user can see what their current faction tint looks like. The
   * raw material swatches are still drawn from MATERIALS.
   */
  readonly faction: Faction;
}

// ---------------------------------------------------------------------------
// Styles (inline; the global pane stylesheet is owned by App.css).
// ---------------------------------------------------------------------------

const styles = {
  wrap: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 8,
  },
  factionStrip: {
    display: "flex",
    gap: 4,
    padding: "4px 0",
  },
  factionChip: {
    width: 24,
    height: 16,
    borderRadius: 3,
    border: "1px solid #2a2a2f",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: 6,
  },
  swatch: {
    aspectRatio: "1 / 1",
    border: "2px solid #3a4150",
    borderRadius: 4,
    cursor: "pointer",
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "center",
    padding: "2px 0 4px",
    fontSize: 10,
    color: "white",
    textShadow: "0 1px 2px rgba(0,0,0,0.8)",
    transition: "transform 0.1s",
    userSelect: "none" as const,
  },
  swatchSelected: {
    borderColor: "#c9a55c",
    boxShadow: "0 0 0 2px rgba(201,165,92,0.3)",
  },
  selectedCard: {
    padding: 8,
    background: "#232831",
    borderRadius: 4,
    border: "1px solid #3a4150",
    fontSize: 12,
  },
  selectedName: {
    fontWeight: 600,
    color: "#c9a55c",
    marginBottom: 4,
  },
  selectedDesc: {
    color: "#8a93a3",
    fontSize: 11,
    lineHeight: 1.4,
  },
  sectionLabel: {
    fontSize: 10,
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
    color: "#8a93a3",
    fontWeight: 600,
  },
};

// ---------------------------------------------------------------------------
// Component.
// ---------------------------------------------------------------------------

export function Palette({ active, onSelect, faction }: PaletteProps) {
  const activeMat = MATERIALS.find((m) => m.id === active) ?? MATERIALS[0];
  const factionHex = FACTION_PALETTE_HEX[faction];

  return (
    <div style={styles.wrap}>
      <div style={styles.selectedCard}>
        <div style={styles.selectedName}>{activeMat.name}</div>
        <div style={styles.selectedDesc}>{activeMat.desc}</div>
      </div>

      <div>
        <div style={styles.sectionLabel}>Faction tint</div>
        <div style={styles.factionStrip} title={`Faction palette: ${faction}`}>
          <div
            style={{ ...styles.factionChip, background: factionHex.primary }}
            title="Primary"
          />
          <div
            style={{ ...styles.factionChip, background: factionHex.secondary }}
            title="Secondary"
          />
          <div
            style={{ ...styles.factionChip, background: factionHex.accent }}
            title="Accent"
          />
        </div>
      </div>

      <div>
        <div style={styles.sectionLabel}>Materials</div>
        <div style={styles.grid}>
          {MATERIALS.map((m, idx) => {
            const isActive = m.id === active;
            const swatchStyle = {
              ...styles.swatch,
              background: hexString(m.color),
              ...(isActive ? styles.swatchSelected : null),
            };
            return (
              <div
                key={m.id}
                role="button"
                tabIndex={0}
                style={swatchStyle}
                title={`${m.name} (key ${idx + 1})`}
                onClick={() => onSelect(m.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") onSelect(m.id);
                }}
              >
                {idx + 1}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
