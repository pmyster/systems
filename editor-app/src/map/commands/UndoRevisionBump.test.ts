/**
 * Regression guard for the silent-undo case.
 *
 * History (Day 3 → Day 4): the user reported "even if I Ctrl+Z I still
 * see deformities" — meaning either undo wasn't running at all, or it
 * was running without bumping the terrain revision / accumulating dirty
 * pixels. Either failure mode is visually identical to "no undo": the
 * heightmap might be restored in memory, but the scene manager never
 * gets the signal to re-upload to the GPU.
 *
 * This test pins the contract that every successful CommandBus.undo()
 * for a terrain edit:
 *   1. Bumps terrain.revision (so the scene-manager subscriber fires).
 *   2. Leaves a non-empty dirty set for that subscriber to drain.
 *
 * If either invariant regresses, undo will look broken in the viewport
 * even though the in-memory data is correct.
 */

import { describe, it, expect, beforeEach } from "vitest";

import { useMapStore, _resetMapStore, _drainDirty } from "../state/mapStore";
import { CommandBus } from "./CommandBus";
import { RaiseTerrainCommand } from "./RaiseTerrainCommand";

describe("Undo path bumps terrain revision and leaves dirty pixels", () => {
  beforeEach(() => {
    _resetMapStore();
    _drainDirty();
  });

  it("revision bumps once on execute, once on undo; dirty set non-empty after undo", () => {
    const bus = new CommandBus();
    const startRevision = useMapStore.getState().terrain.revision;

    // Track every revision the store has emitted across the test so we
    // can prove the undo really did push a new value rather than reusing
    // the post-execute one.
    const seenRevisions: number[] = [startRevision];
    const unsub = useMapStore.subscribe((s) => {
      const last = seenRevisions[seenRevisions.length - 1];
      if (s.terrain.revision !== last) {
        seenRevisions.push(s.terrain.revision);
      }
    });

    try {
      bus.execute(
        new RaiseTerrainCommand({
          worldX: 64,
          worldZ: 64,
          radiusM: 4,
          strength: 0.5,
          timestamp: 1000,
        }),
      );

      const afterExecuteRevision = useMapStore.getState().terrain.revision;
      expect(afterExecuteRevision).toBe(startRevision + 1);

      // Drain whatever the execute path left so we can isolate the undo
      // contribution to the dirty accumulator below.
      const executeDrain = _drainDirty();
      expect(executeDrain).not.toBeNull();
      expect(executeDrain!.size).toBeGreaterThan(0);

      const didUndo = bus.undo();
      expect(didUndo).toBe(true);

      const afterUndoRevision = useMapStore.getState().terrain.revision;
      expect(afterUndoRevision).toBe(startRevision + 2);

      // Critical invariant: the undo must accumulate dirty pixels so the
      // scene manager's subscriber knows what to re-upload. If this set
      // is empty, the viewport will not reflect the undo.
      const undoDrain = _drainDirty();
      expect(undoDrain).not.toBeNull();
      expect(undoDrain!.size).toBeGreaterThan(0);

      // Sequence sanity: at minimum we saw the initial value, the
      // post-execute value, and the post-undo value as DISTINCT bumps.
      expect(seenRevisions.length).toBeGreaterThanOrEqual(3);
      expect(seenRevisions[0]).toBe(startRevision);
      expect(seenRevisions).toContain(startRevision + 1);
      expect(seenRevisions).toContain(startRevision + 2);
    } finally {
      unsub();
    }
  });
});
