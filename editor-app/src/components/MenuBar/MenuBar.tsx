/**
 * MenuBar — the editor's top-of-window action surface.
 *
 * Renders inside the existing `.app-header` slot. Tauri's native
 * window menu API is platform-quirky (Windows-only on v2 at the
 * time of writing) so we use a portable React menu component instead.
 * Keyboard shortcuts are bound by the parent App via useKeyboardShortcuts.
 *
 * Buttons drive these workflows:
 *   - New           : reset to a blank unit (with unsaved-changes guard)
 *   - Open (Ctrl+O) : Tauri open-file dialog → LoadUnit
 *   - Save (Ctrl+S) : Tauri write to known path, or Save As
 *   - Save As (Ctrl+Shift+S) : always prompt for path
 *   - Bump physics_version : explicit Principle 4 action
 *
 * Status text shows file path and dirty marker; validation errors
 * (from save / open) display inline.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";

import { useUnitState } from "../../state";
import { selectIsDirty, selectWindowTitle } from "../../state/selectors";
import {
  OpenParseError,
  OpenValidationError,
  SaveValidationError,
  openUnit,
  saveUnit,
  saveUnitAs,
} from "../../file-ops";

interface MenuBarProps {
  /** Optional notice surfaced by parent components (e.g. save failures). */
  readonly notice?: string | null;
  /** Setter so menu actions can push their own status messages. */
  readonly setNotice?: (n: string | null) => void;
}

const buttonStyle: React.CSSProperties = {
  background: "transparent",
  border: "1px solid transparent",
  color: "#d8dde6",
  padding: "2px 10px",
  font: "inherit",
  cursor: "pointer",
  borderRadius: 3,
};

const buttonHoverStyle: React.CSSProperties = {
  background: "#23232a",
  borderColor: "#3a3a44",
};

const menuRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  marginLeft: "auto",
};

const noticeStyle: React.CSSProperties = {
  marginLeft: 12,
  color: "#e08850",
  fontSize: 12,
  fontStyle: "italic",
  maxWidth: 480,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const dirtyDotStyle: React.CSSProperties = {
  display: "inline-block",
  width: 8,
  height: 8,
  borderRadius: "50%",
  background: "#c9a55c",
  marginLeft: 8,
};

interface MenuButtonProps {
  readonly label: string;
  readonly hint?: string;
  readonly onClick: () => void;
}

function MenuButton({ label, hint, onClick }: MenuButtonProps): ReactNode {
  const [hover, setHover] = useState<boolean>(false);
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={hover ? { ...buttonStyle, ...buttonHoverStyle } : buttonStyle}
    >
      {label}
    </button>
  );
}

/**
 * Top header. Renders title + menu buttons + status notice.
 *
 * Keyboard shortcuts are bound in this component because they need
 * access to the same action handlers. Wiring them at the menu level
 * keeps state-mutation logic in one place.
 */
export function MenuBar({ notice, setNotice }: MenuBarProps): ReactNode {
  const { state, dispatch } = useUnitState();
  const isDirty = selectIsDirty(state);
  const title = selectWindowTitle(state);

  const announce = useCallback(
    (msg: string | null) => {
      if (setNotice) setNotice(msg);
    },
    [setNotice],
  );

  // ----- New ---------------------------------------------------------------

  const handleNew = useCallback(() => {
    if (isDirty) {
      const ok = window.confirm(
        "Discard unsaved changes and start a new unit?",
      );
      if (!ok) return;
    }
    dispatch({ type: "NewUnit" });
    announce(null);
  }, [isDirty, dispatch, announce]);

  // ----- Open --------------------------------------------------------------

  const handleOpen = useCallback(async () => {
    if (isDirty) {
      const ok = window.confirm(
        "Discard unsaved changes and open another unit?",
      );
      if (!ok) return;
    }
    try {
      const opened = await openUnit();
      if (!opened) {
        announce(null);
        return;
      }
      dispatch({
        type: "LoadUnit",
        unit: opened.unit,
        voxels: opened.voxels,
        path: opened.path,
      });
      announce(null);
    } catch (err) {
      if (err instanceof OpenValidationError) {
        announce(
          `Open failed — validation errors (${err.issues.length}). First: ${err.issues[0]?.path.join(".") ?? "?"}: ${err.issues[0]?.message ?? ""}`,
        );
      } else if (err instanceof OpenParseError) {
        announce(`Open failed — ${err.message}`);
      } else {
        announce(`Open failed — ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }, [isDirty, dispatch, announce]);

  // ----- Save / Save As ----------------------------------------------------

  const handleSave = useCallback(async () => {
    try {
      const path = await saveUnit(state.unit, state.file.path);
      if (!path) {
        announce(null);
        return;
      }
      dispatch({ type: "MarkSaved", path });
      announce(`Saved to ${path}`);
    } catch (err) {
      if (err instanceof SaveValidationError) {
        announce(
          `Save blocked — validation errors (${err.issues.length}). First: ${err.issues[0]?.path.join(".") ?? "?"}: ${err.issues[0]?.message ?? ""}`,
        );
      } else {
        announce(`Save failed — ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }, [state.unit, state.file.path, dispatch, announce]);

  const handleSaveAs = useCallback(async () => {
    try {
      const path = await saveUnitAs(state.unit);
      if (!path) {
        announce(null);
        return;
      }
      dispatch({ type: "MarkSaved", path });
      announce(`Saved to ${path}`);
    } catch (err) {
      if (err instanceof SaveValidationError) {
        announce(
          `Save blocked — validation errors (${err.issues.length}). First: ${err.issues[0]?.path.join(".") ?? "?"}: ${err.issues[0]?.message ?? ""}`,
        );
      } else {
        announce(`Save failed — ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }, [state.unit, dispatch, announce]);

  // ----- Bump physics_version ---------------------------------------------

  const handleBump = useCallback(() => {
    const ok = window.confirm(
      `Bump physics_version from "${state.unit.physics_version}"? ` +
        `Per DESIGN.md Principle 4 this is a permanent contract change.`,
    );
    if (!ok) return;
    dispatch({ type: "BumpPhysicsVersion" });
    announce(null);
  }, [state.unit.physics_version, dispatch, announce]);

  // ----- Keyboard shortcuts ------------------------------------------------

  useEffect(() => {
    const onKey = (ev: KeyboardEvent): void => {
      // Skip shortcuts while typing into an input/textarea.
      const target = ev.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          target.isContentEditable
        ) {
          return;
        }
      }
      // Use Ctrl on Windows/Linux, Meta on macOS — Tauri targets desktop.
      const mod = ev.ctrlKey || ev.metaKey;
      if (!mod) return;
      const key = ev.key.toLowerCase();
      if (key === "o") {
        ev.preventDefault();
        void handleOpen();
      } else if (key === "s") {
        ev.preventDefault();
        if (ev.shiftKey) {
          void handleSaveAs();
        } else {
          void handleSave();
        }
      } else if (key === "n" && !ev.shiftKey) {
        ev.preventDefault();
        handleNew();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [handleNew, handleOpen, handleSave, handleSaveAs]);

  // ----- Render ------------------------------------------------------------

  return (
    <>
      <span className="app-title">{title}</span>
      {isDirty ? (
        <span style={dirtyDotStyle} title="Unsaved changes" aria-hidden />
      ) : null}
      {notice ? <span style={noticeStyle}>{notice}</span> : null}
      <div style={menuRowStyle}>
        <MenuButton label="New" hint="Ctrl+N" onClick={handleNew} />
        <MenuButton label="Open…" hint="Ctrl+O" onClick={() => void handleOpen()} />
        <MenuButton label="Save" hint="Ctrl+S" onClick={() => void handleSave()} />
        <MenuButton
          label="Save As…"
          hint="Ctrl+Shift+S"
          onClick={() => void handleSaveAs()}
        />
        <MenuButton
          label="Bump physics_version"
          hint="Principle 4 — explicit"
          onClick={handleBump}
        />
      </div>
    </>
  );
}
