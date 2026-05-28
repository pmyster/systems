/**
 * React context provider for the unit store.
 *
 * Holds `useReducer(unitReducer, initialUnitState)` and exposes both
 * the state and dispatch via a single hook (`useUnitState`). One hook
 * keeps consumer code short:
 *
 *   const { state, dispatch } = useUnitState();
 *   dispatch({ type: "UpdateMeta", patch: { name: "Wolverine" } });
 *
 * The state object is referentially stable across renders that don't
 * change it (React useReducer semantics) so memoized selectors are
 * cheap. We intentionally do NOT split state and dispatch into two
 * contexts — the editor has one top-level provider, and React-DevTools
 * inspecting a single context is easier than two.
 *
 * Per the parent brief we used React Context + useReducer instead of
 * Zustand because it gave us exactly what we needed with zero new
 * dependencies. See the integration report for the trade-off.
 */

import {
  createContext,
  useContext,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode,
} from "react";

import {
  makeInitialUnitState,
  unitReducer,
  type UnitAction,
  type UnitState,
} from "./unit-store";

interface UnitStateContextValue {
  readonly state: UnitState;
  readonly dispatch: Dispatch<UnitAction>;
}

const UnitStateContext = createContext<UnitStateContextValue | null>(null);

interface UnitStateProviderProps {
  readonly children: ReactNode;
}

export function UnitStateProvider({ children }: UnitStateProviderProps) {
  // Lazy initializer — makeInitialUnitState builds a fresh sessionId
  // per editor instance.
  const [state, dispatch] = useReducer(
    unitReducer,
    undefined,
    makeInitialUnitState,
  );

  // Stable value object so consumers that destructure only `dispatch`
  // aren't re-rendered on unrelated state changes (helped by React's
  // referential equality on dispatch).
  const value = useMemo<UnitStateContextValue>(
    () => ({ state, dispatch }),
    [state],
  );

  return (
    <UnitStateContext.Provider value={value}>
      {children}
    </UnitStateContext.Provider>
  );
}

/**
 * Read the store. Throws if called outside a <UnitStateProvider>.
 */
export function useUnitState(): UnitStateContextValue {
  const ctx = useContext(UnitStateContext);
  if (!ctx) {
    throw new Error("useUnitState must be used inside <UnitStateProvider>");
  }
  return ctx;
}

/**
 * Read just dispatch. Convenience for components that don't render
 * state but need to fire actions (menu, shortcut handlers).
 *
 * Exported for future fine-grained dispatchers — see overnight build log.
 */
export function useUnitDispatch(): Dispatch<UnitAction> {
  return useUnitState().dispatch;
}
