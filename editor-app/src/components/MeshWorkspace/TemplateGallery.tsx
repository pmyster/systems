/**
 * TemplateGallery — 3×3 grid of clickable template cards for the Mesh Workspace.
 *
 * Each card shows the template name and a short description.
 * The selected card glows gold; others are dark grey.
 */

import type { CSSProperties } from "react";
import { TEMPLATES } from "../../lib/templates";

// ---------------------------------------------------------------------------
// Props.
// ---------------------------------------------------------------------------

export interface TemplateGalleryProps {
  selectedId: string | null;
  onSelect: (id: string) => void;
}

// ---------------------------------------------------------------------------
// Styles.
// ---------------------------------------------------------------------------

const GOLD = "#c9a55c";
const CARD_BG = "#1a1f2e";
const BORDER_DEFAULT = "#2a2e38";

const styles = {
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: 4,
    padding: "6px 8px",
  } satisfies CSSProperties,

  card: (selected: boolean): CSSProperties => ({
    background: CARD_BG,
    border: `1px solid ${selected ? GOLD : BORDER_DEFAULT}`,
    borderRadius: 4,
    padding: "6px 8px",
    cursor: "pointer",
    minHeight: 80,
    display: "flex",
    flexDirection: "column",
    gap: 4,
    boxShadow: selected ? `0 0 6px ${GOLD}55` : "none",
    transition: "border-color 0.12s, box-shadow 0.12s",
    userSelect: "none",
    outline: "none",
  }),

  name: {
    fontFamily: "system-ui, sans-serif",
    fontWeight: 700,
    fontSize: 11,
    color: "#e8eaf0",
    lineHeight: "1.2",
    letterSpacing: "0.02em",
  } satisfies CSSProperties,

  desc: {
    fontFamily: "system-ui, sans-serif",
    fontSize: 10,
    color: "#9ca3af",
    lineHeight: "1.4",
    overflow: "hidden",
    display: "-webkit-box",
    WebkitLineClamp: 3,
    WebkitBoxOrient: "vertical",
  } satisfies CSSProperties,
} as const;

// ---------------------------------------------------------------------------
// Component.
// ---------------------------------------------------------------------------

export function TemplateGallery({ selectedId, onSelect }: TemplateGalleryProps) {
  return (
    <div style={styles.grid}>
      {TEMPLATES.map((tpl) => {
        const isSelected = tpl.id === selectedId;
        return (
          <div
            key={tpl.id}
            role="button"
            tabIndex={0}
            style={styles.card(isSelected)}
            onClick={() => onSelect(tpl.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(tpl.id);
              }
            }}
            aria-pressed={isSelected}
            title={tpl.description}
          >
            <div style={styles.name}>{tpl.name}</div>
            <div style={styles.desc}>{tpl.description}</div>
          </div>
        );
      })}
    </div>
  );
}
