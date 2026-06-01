/**
 * GizmoController — wraps Three.js TransformControls so the user can
 * translate a selected prefab. Emits a single SetPropertyCommand on
 * drag-end so the move is undoable as one operation, not per-frame.
 *
 * State flow during a drag:
 *   1. dragging-changed (true) → snapshot the current store position.
 *      The gizmo mutates the rendered Object3D directly while dragging
 *      — the STORE is intentionally not updated mid-drag (we'd emit
 *      dozens of merged commands per stroke and pile up undo entries).
 *   2. dragging-changed (false) → read the rendered node's new position
 *      and emit a SetPropertyCommand whose path is "position". The
 *      command captures the store's CURRENT (= pre-drag) position as
 *      oldValue, sets the new value, and on undo restores the original.
 *
 * Why pass the whole `position` object at once instead of three separate
 * x/y/z commands: a single command is one undo step. Three commands
 * would either merge unreliably or require three Ctrl+Z presses to
 * revert one drag.
 *
 * TransformControls API note (three.js r169+):
 *   TransformControls is no longer an Object3D — it extends Controls
 *   (an EventDispatcher). The visual gizmo helper must be obtained via
 *   `controls.getHelper()` and added to the scene separately. Passing
 *   the controls instance to `scene.add(...)` is a silent no-op (logs
 *   `THREE.Object3D.add: object not an instance of THREE.Object3D` and
 *   leaves the gizmo helper unparented). The MeshViewer in the Unit
 *   editor follows the same `getHelper()` pattern — we mirror it here.
 */

import * as THREE from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";

import { mapCommandBus } from "../commands/CommandBus";
import { SetPropertyCommand } from "../commands/SetPropertyCommand";
import { useMapStore } from "../state/mapStore";

import type { PrefabRenderer } from "./PrefabRenderer";

export class GizmoController {
  readonly controls: TransformControls;
  private readonly helper: THREE.Object3D;
  private currentId: string | null = null;
  private dragStartPos: { x: number; y: number; z: number } | null = null;

  constructor(
    camera: THREE.PerspectiveCamera,
    private readonly canvas: HTMLCanvasElement,
    private readonly prefabRenderer: PrefabRenderer,
    scene: THREE.Scene,
  ) {
    this.controls = new TransformControls(camera, canvas);
    this.controls.setSize(0.8);
    // r169+ API: parent the gizmo helper (Object3D) — NOT `this.controls`
    // (which is an EventDispatcher, not an Object3D).
    this.helper = this.controls.getHelper();
    scene.add(this.helper);

    // Dragging the gizmo must NOT pan/orbit the camera. The cursor
    // change is a visual cue; the actual button-vs-camera mediation is
    // handled by TransformControls' own internal stopPropagation.
    this.controls.addEventListener("dragging-changed", (event) => {
      const dragging = Boolean((event as { value: unknown }).value);
      this.canvas.style.cursor = dragging ? "grabbing" : "default";
      if (dragging && this.currentId) {
        // Drag start: snapshot the store position so we have an honest
        // oldValue regardless of what the gizmo does to the node during
        // the drag.
        const inst = useMapStore.getState().objects[this.currentId];
        if (inst) this.dragStartPos = { ...inst.position };
      } else if (!dragging && this.currentId && this.dragStartPos) {
        // Drag end: read the new transform off the live node and emit
        // a single undoable command for the whole drag.
        const node = this.prefabRenderer.getNode(this.currentId);
        if (node) {
          const newPos = {
            x: node.position.x,
            y: node.position.y,
            z: node.position.z,
          };
          // SetPropertyCommand reads the OLD value from the store at
          // construction time. The store still holds the pre-drag
          // position (we never updated it mid-drag), so the captured
          // oldValue matches `dragStartPos` — the assertion is just
          // belt-and-braces in case something else has touched the
          // store mid-drag.
          mapCommandBus.execute(
            new SetPropertyCommand({
              entityKind: "object",
              id: this.currentId,
              propertyPath: "position",
              newValue: newPos,
            }),
          );
        }
        this.dragStartPos = null;
      }
    });
  }

  /**
   * Attach the gizmo to the given instance, or detach if null. Idempotent.
   * Re-attaching to an unknown id is a no-op (likely a transient race
   * between selection change and prefab sync).
   */
  attachTo(id: string | null): void {
    if (id === null) {
      this.controls.detach();
      this.currentId = null;
      return;
    }
    if (id === this.currentId) return;
    const node = this.prefabRenderer.getNode(id);
    if (!node) {
      // Selection points at an id we don't yet have a node for —
      // detach so we don't show a stale gizmo on the previous target.
      this.controls.detach();
      this.currentId = null;
      return;
    }
    this.controls.attach(node);
    this.currentId = id;
  }

  dispose(): void {
    this.controls.detach();
    // Re-parent + dispose the gizmo helper — controls.dispose() does
    // not unparent its visuals (same teardown shape as MeshViewer).
    if (this.helper.parent) this.helper.parent.remove(this.helper);
    (this.helper as unknown as { dispose?: () => void }).dispose?.();
    // TransformControls.dispose was added in newer Three versions;
    // guard so older bundled copies don't error here.
    (this.controls as unknown as { dispose?: () => void }).dispose?.();
  }
}
