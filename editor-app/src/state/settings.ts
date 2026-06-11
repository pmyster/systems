/**
 * Editor-wide user settings — persisted to localStorage.
 *
 * Centralised so any subsystem (prefab scanner, future preference panels,
 * autosave cadence, etc.) reads from one place and survives reloads. The
 * store mirrors the on-disk JSON exactly; we persist on every mutation
 * because settings change infrequently and the write is cheap.
 *
 * Defensive notes (per the loud-over-silent rule):
 * - `loadFromStorage` validates each field's type individually so a
 *   corrupted entry can't poison the rest. Anything unparseable falls
 *   back to the default (logged silently here — the user will simply
 *   see defaults on reload).
 * - `persist` is wrapped in try/catch because localStorage can throw
 *   under quota-exceeded or private-browsing modes; we don't want a
 *   setting change to crash the editor.
 */

import { create } from "zustand";

const STORAGE_KEY = "cl_editor_settings_v1";

export interface EditorSettings {
  /** Absolute path to the user prefab folder. Empty = use the dev default. */
  userPrefabFolder: string;
  /** When true, the editor re-scans the prefab folder at app startup. */
  scanOnStartup: boolean;
}

const DEFAULT_SETTINGS: EditorSettings = {
  userPrefabFolder: "",
  scanOnStartup: true,
};

function loadFromStorage(): EditorSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<EditorSettings>;
    return {
      userPrefabFolder:
        typeof parsed.userPrefabFolder === "string"
          ? parsed.userPrefabFolder
          : DEFAULT_SETTINGS.userPrefabFolder,
      scanOnStartup:
        typeof parsed.scanOnStartup === "boolean"
          ? parsed.scanOnStartup
          : DEFAULT_SETTINGS.scanOnStartup,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function persist(s: EditorSettings): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        userPrefabFolder: s.userPrefabFolder,
        scanOnStartup: s.scanOnStartup,
      }),
    );
  } catch {
    /* localStorage may throw under quota-exceeded / private-browsing — silent. */
  }
}

interface SettingsState extends EditorSettings {
  setUserPrefabFolder(p: string): void;
  setScanOnStartup(b: boolean): void;
}

export const useSettings = create<SettingsState>((set) => ({
  ...loadFromStorage(),
  setUserPrefabFolder: (p) =>
    set((s) => {
      const next: SettingsState = { ...s, userPrefabFolder: p };
      persist(next);
      return next;
    }),
  setScanOnStartup: (b) =>
    set((s) => {
      const next: SettingsState = { ...s, scanOnStartup: b };
      persist(next);
      return next;
    }),
}));

/**
 * Non-React accessor for callers outside the component tree (Tauri
 * command wrappers, side-effect modules). Same store, no hooks.
 */
export const settingsStore = useSettings;
