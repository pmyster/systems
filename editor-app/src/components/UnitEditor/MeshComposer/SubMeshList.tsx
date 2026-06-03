/**
 * SubMeshList — sidebar listing every sub-mesh in the loaded prefab.
 *
 * Pure presentational component. State lives in the parent (MeshComposer).
 *
 * For each sub-mesh shows:
 *   - Name (click → select for gizmo)
 *   - Vert / face count
 *   - Visibility eye toggle
 *
 * Selection highlight uses the same blue used elsewhere in the editor for
 * keyboard-focus rings. Visibility OFF rows render dim so the catch-all
 * bucket (loud-over-silent) is visible — the owner can SEE every node the
 * GLB contained, not just the ones currently displayed.
 */

import type { CSSProperties } from "react";

import type { SubMeshInfo } from "./MeshComposerScene";

interface SubMeshListProps {
  readonly subMeshes: readonly SubMeshInfo[];
  readonly selectedName: string | null;
  readonly onSelect: (name: string) => void;
  readonly onToggleVisibility: (name: string, visible: boolean) => void;
}

const S = {
  root: {
    width: 220,
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    background: "#0f1318",
    borderRight: "1px solid #1f242c",
    overflowY: "auto",
  } satisfies CSSProperties,

  header: {
    padding: "6px 10px",
    fontSize: 10,
    letterSpacing: "0.08em",
    color: "#6b7280",
    textTransform: "uppercase",
    borderBottom: "1px solid #1f242c",
    flexShrink: 0,
  } satisfies CSSProperties,

  empty: {
    padding: 10,
    fontSize: 11,
    color: "#8a93a3",
    fontStyle: "italic",
  } satisfies CSSProperties,

  row: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "5px 8px",
    cursor: "pointer",
    fontSize: 11,
    color: "#d8dde6",
    borderBottom: "1px solid #161a20",
    userSelect: "none" as const,
  } satisfies CSSProperties,

  rowSelected: {
    background: "#1d2b44",
    color: "#f0f3f8",
  } satisfies CSSProperties,

  rowHidden: {
    opacity: 0.5,
  } satisfies CSSProperties,

  name: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  } satisfies CSSProperties,

  counts: {
    fontSize: 9,
    color: "#6b7280",
    fontFamily: "ui-monospace, Menlo, monospace",
    flexShrink: 0,
  } satisfies CSSProperties,

  eye: {
    width: 22,
    height: 18,
    fontSize: 11,
    background: "transparent",
    color: "#8a93a3",
    border: "1px solid #2a313c",
    borderRadius: 3,
    cursor: "pointer",
    flexShrink: 0,
    padding: 0,
    lineHeight: "1",
  } satisfies CSSProperties,
} as const;

export function SubMeshList({
  subMeshes,
  selectedName,
  onSelect,
  onToggleVisibility,
}: SubMeshListProps) {
  return (
    <div style={S.root}>
      <div style={S.header}>Sub-meshes ({subMeshes.length})</div>
      {subMeshes.length === 0 && (
        <div style={S.empty}>
          No mesh loaded — pick a unit with a file-backed mesh_asset to begin.
        </div>
      )}
      {subMeshes.map((sm) => {
        const isSelected = sm.name === selectedName;
        const rowStyle: CSSProperties = {
          ...S.row,
          ...(isSelected ? S.rowSelected : undefined),
          ...(!sm.visible ? S.rowHidden : undefined),
        };
        return (
          <div
            key={sm.uuid}
            style={rowStyle}
            onClick={() => onSelect(sm.name)}
            title={`${sm.name} — ${sm.vertCount} verts, ${sm.faceCount} faces`}
          >
            <button
              type="button"
              style={S.eye}
              onClick={(e) => {
                e.stopPropagation();
                onToggleVisibility(sm.name, !sm.visible);
              }}
              title={sm.visible ? "Hide sub-mesh" : "Show sub-mesh"}
              aria-label={
                sm.visible ? `Hide ${sm.name}` : `Show ${sm.name}`
              }
            >
              {sm.visible ? "◉" : "○"}
            </button>
            <span style={S.name}>{sm.name}</span>
            <span style={S.counts}>
              {sm.vertCount}v / {sm.faceCount}f
            </span>
          </div>
        );
      })}
    </div>
  );
}
