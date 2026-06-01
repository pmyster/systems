/**
 * App-mode toggle: switches the editor shell between the existing Unit
 * editor and the new Map editor.
 *
 * Uses Zustand (introduced in Week 1 of the Map editor build — see
 * `docs/adr/0002-map-project-directory-format.md` for the rationale on
 * keeping two state patterns in one repo). The Unit editor's existing
 * Context+useReducer store is untouched.
 *
 * Default mode is "unit" so existing users land on the editor they
 * already know on first launch after the update.
 */

import { create } from "zustand";

export type AppMode = "unit" | "map";

interface AppModeState {
  mode: AppMode;
  setMode: (m: AppMode) => void;
}

export const useAppMode = create<AppModeState>((set) => ({
  mode: "unit",
  setMode: (m) => set({ mode: m }),
}));
