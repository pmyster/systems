/**
 * Command interface — the smallest unit of undoable work in the Map Editor.
 *
 * Every authoring action (raise terrain, place an object, change a
 * property) is encoded as a Command that knows how to do AND undo itself.
 * This is the only way state changes happen — UI never mutates the store
 * directly outside of tool/brush settings.
 *
 * Merging:
 *   Commands of the same `kind` triggered close together (e.g. a brush
 *   stroke dragged across the map firing many RaiseTerrainCommand each
 *   frame) can collapse into one via `merge(other)`. If the merge
 *   succeeds, the existing top-of-stack command absorbs the new one and
 *   the new one is discarded — so the user only sees one entry in undo
 *   history per "logical" action.
 *
 * Timestamp is captured at command construction (Date.now() in caller
 * code) so the bus can decide whether two commands are "close enough" to
 * be merge candidates.
 */
export interface Command {
  readonly kind: string;
  readonly timestamp: number;
  do(): void;
  undo(): void;
  /**
   * Merge `other` into self if it's a recent same-kind command. Return
   * true if merged (caller discards `other`); false to push `other` as a
   * new stack entry.
   */
  merge?(other: Command): boolean;
}
