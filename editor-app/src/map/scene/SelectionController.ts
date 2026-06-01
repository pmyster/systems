/**
 * SelectionController — pointer + keyboard input for "Select" tool.
 *
 * Behavior:
 *   - Left click on a prefab while tool === "select" → select it.
 *   - Left click on empty space → clear selection.
 *   - Delete / Backspace key (when an object is selected and focus is
 *     NOT inside a form input) → emit DeleteObjectCommand and clear
 *     selection.
 *
 * The Delete key listener is bound at WINDOW level (the canvas doesn't
 * accept keyboard focus by default), but we guard against firing while
 * the user is typing into an input/textarea — the same pattern the
 * unit-mode menu bar uses.
 *
 * DeleteObjectCommand accepts either an id (safer — snapshots from the
 * store at construction) or an InstanceObject. We pass the id form so
 * the snapshot can't go stale between construction and `do()`.
 */

import * as THREE from "three";

import { mapCommandBus } from "../commands/CommandBus";
import { DeleteObjectCommand } from "../commands/DeleteObjectCommand";
import { useMapStore } from "../state/mapStore";

import type { GizmoController } from "./GizmoController";
import type { PrefabRenderer } from "./PrefabRenderer";

function isEditingInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

export class SelectionController {
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly prefabRenderer: PrefabRenderer,
    /**
     * Optional — when present, we skip selection raycasts while the
     * cursor is hovering a gizmo handle (controls.axis !== null). Without
     * this guard, clicking a gizmo arrow in select mode runs our raycast
     * too (Three's TransformControls uses stopPropagation, which does not
     * block same-target listeners), and a deselect during a drag would
     * detach the gizmo mid-move.
     */
    private readonly gizmoController?: GizmoController,
  ) {
    canvas.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("keydown", this.onKeyDown);
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const state = useMapStore.getState();
    if (state.tool !== "select") return;
    // Suppress selection raycasts while the user is interacting with the
    // gizmo handles — Three's TransformControls sets controls.axis to a
    // non-null axis name (X / Y / Z / XY / ...) when the pointer is over
    // a handle. Doing a raycast here would risk deselecting mid-drag.
    if (this.gizmoController?.controls.axis) return;

    const rect = this.canvas.getBoundingClientRect();
    this.ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.ndc, this.camera);

    const id = this.prefabRenderer.raycastInstance(this.raycaster);
    if (id) {
      state._setSelection({ kind: "object", id });
    } else {
      state._setSelection({ kind: "none", id: null });
    }
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (isEditingInput(e.target)) return;
    if (e.key !== "Delete" && e.key !== "Backspace") return;

    const state = useMapStore.getState();
    if (state.selection.kind !== "object" || !state.selection.id) return;
    const id = state.selection.id;
    if (!(id in state.objects)) return;
    e.preventDefault();
    mapCommandBus.execute(new DeleteObjectCommand(id));
    state._setSelection({ kind: "none", id: null });
  };

  dispose(): void {
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("keydown", this.onKeyDown);
  }
}
