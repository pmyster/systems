/**
 * MeshComposerScene — Three.js canvas with orbit + TransformControls.
 *
 * Renders the prefab's THREE.Group (handed in as `mesh` prop), enumerates
 * its sub-meshes for the parent's sidebar, and attaches TransformControls
 * to whichever sub-mesh is selected. Mirrors the pattern used in
 * `components/MeshWorkspace/MeshViewer.tsx` (vanilla useEffect-mounted
 * scene + orbit handlers) rather than introducing R3F — the editor is
 * vanilla Three.js throughout and consistency wins.
 *
 * Loud-over-silent (CLAUDE.md rule #1):
 *   - If TransformControls can't mount (no WebGL, no canvas) the parent's
 *     `onGizmoUnavailable` callback fires so the UI can fall back to a
 *     numeric input form. The scene itself still renders.
 *   - Every sub-mesh found in the tree is reported to the parent, even
 *     ones with empty `.name` (rendered as `<unnamed_N>`). That's the
 *     catch-all bucket — the owner can SEE every node the GLB contained.
 *
 * Adaptive over specific (CLAUDE.md rule #2):
 *   The enumeration walks `mesh.traverse((o) => o.isMesh)` and accepts
 *   any Mesh node. A future Hunyuan export that uses Groups for sub-parts
 *   doesn't need special-casing here; future code can extend the gather
 *   predicate without touching call sites.
 */

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";

import {
  applyOrbit,
  clampDistance,
  clampElevation,
  createOrbitState,
  panOrbit,
} from "../../MeshWorkspace/controls";
import { createMeshScene, type MeshScene } from "../../MeshWorkspace/scene";

// ---------------------------------------------------------------------------
// Types surfaced to the parent.
// ---------------------------------------------------------------------------

export interface SubMeshInfo {
  /** Stable identifier (Three.js Object3D.uuid) — survives renames. */
  readonly uuid: string;
  /** Display name. `<unnamed_N>` when the source node had no name. */
  readonly name: string;
  /** Current visibility — synced from `node.visible`. */
  readonly visible: boolean;
  readonly vertCount: number;
  readonly faceCount: number;
}

export type GizmoMode = "translate" | "rotate" | "scale";

/**
 * Live transform of the currently-selected sub-mesh. Emitted whenever the
 * gizmo updates the node — the parent uses this to build the sidecar entry
 * on save.
 */
export interface SubMeshTransform {
  readonly name: string;
  readonly position: readonly [number, number, number];
  readonly rotation_quat: readonly [number, number, number, number];
  readonly scale: readonly [number, number, number];
}

export interface MeshComposerSceneProps {
  /** The loaded prefab root. null = empty viewport with an overlay prompt. */
  readonly mesh: THREE.Group | null;
  /** Currently-selected sub-mesh NAME, or null for "nothing selected". */
  readonly selectedName: string | null;
  /** Gizmo transform mode. */
  readonly gizmoMode: GizmoMode;
  /** Map of sub-mesh-name → visibility flag (owner-controlled). */
  readonly visibility: ReadonlyMap<string, boolean>;
  /** Fires when the scene finishes enumerating the prefab's sub-meshes. */
  readonly onSubMeshesChanged: (subs: readonly SubMeshInfo[]) => void;
  /** Fires when the user clicks a sub-mesh in the viewport. */
  readonly onPickSubMesh: (name: string) => void;
  /** Fires whenever a gizmo drag mutates the selected sub-mesh. */
  readonly onTransformChanged: (xform: SubMeshTransform) => void;
  /**
   * Fires once on mount if TransformControls couldn't be created — the
   * parent should reveal the numeric fallback form.
   */
  readonly onGizmoUnavailable?: () => void;
}

// ---------------------------------------------------------------------------
// Styles.
// ---------------------------------------------------------------------------

const styles = {
  container: {
    position: "relative" as const,
    width: "100%",
    height: "100%",
    minHeight: 0,
    minWidth: 0,
    overflow: "hidden",
    background: "#0a0d12",
  },
  emptyOverlay: {
    position: "absolute" as const,
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    pointerEvents: "none" as const,
    color: "rgba(255,255,255,0.35)",
    fontSize: 14,
    fontFamily: "system-ui, sans-serif",
    textAlign: "center" as const,
    padding: "0 24px",
  },
} as const;

// ---------------------------------------------------------------------------
// Component.
// ---------------------------------------------------------------------------

export function MeshComposerScene({
  mesh,
  selectedName,
  gizmoMode,
  visibility,
  onSubMeshesChanged,
  onPickSubMesh,
  onTransformChanged,
  onGizmoUnavailable,
}: MeshComposerSceneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<MeshScene | null>(null);
  const orbitRef = useRef(createOrbitState());
  const prevMeshRef = useRef<THREE.Group | null>(null);
  const transformControlsRef = useRef<TransformControls | null>(null);
  const gizmoDraggingRef = useRef<boolean>(false);
  // Map sub-mesh NAME → THREE.Mesh node for selection lookups.
  const meshByNameRef = useRef<Map<string, THREE.Mesh>>(new Map());
  // Outline / wireframe overlay for the selected sub-mesh.
  const outlineRef = useRef<THREE.LineSegments | null>(null);
  // Stable refs for the callbacks so the long-lived event handlers don't
  // need to be re-attached every render. Same pattern as MeshViewer.
  const onTransformRef = useRef(onTransformChanged);
  useEffect(() => {
    onTransformRef.current = onTransformChanged;
  }, [onTransformChanged]);
  const onPickRef = useRef(onPickSubMesh);
  useEffect(() => {
    onPickRef.current = onPickSubMesh;
  }, [onPickSubMesh]);
  const selectedNameRef = useRef<string | null>(selectedName);
  useEffect(() => {
    selectedNameRef.current = selectedName;
  }, [selectedName]);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);

  // ----- Mount: build scene + TransformControls ----------------------------

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const sceneBundle = createMeshScene();
    sceneRef.current = sceneBundle;
    container.appendChild(sceneBundle.renderer.domElement);
    setCanvas(sceneBundle.renderer.domElement);
    applyOrbit(sceneBundle.camera, orbitRef.current);

    // Build TransformControls. Wrap in try/catch — defensive: if the
    // underlying gizmo construction fails (very old WebGL drivers, headless
    // jsdom in tests), surface to the parent so it can fall back to a
    // numeric form. Same loud-over-silent rule as the rest of the file.
    try {
      const controls = new TransformControls(
        sceneBundle.camera,
        sceneBundle.renderer.domElement,
      );
      controls.setSize(0.8);
      controls.space = "local";
      controls.addEventListener("mouseDown", () => {
        gizmoDraggingRef.current = true;
      });
      controls.addEventListener("mouseUp", () => {
        gizmoDraggingRef.current = false;
      });
      controls.addEventListener("dragging-changed", (e) => {
        gizmoDraggingRef.current = Boolean(e.value);
      });
      controls.addEventListener("objectChange", () => {
        const obj = controls.object as THREE.Object3D | null;
        const name = selectedNameRef.current;
        if (!obj || !name) return;
        const p = obj.position;
        const q = obj.quaternion;
        const s = obj.scale;
        onTransformRef.current({
          name,
          position: [p.x, p.y, p.z],
          rotation_quat: [q.x, q.y, q.z, q.w],
          scale: [s.x, s.y, s.z],
        });
        syncOutlineToSelection(); // outline tracks the dragged mesh
      });
      sceneBundle.scene.add(controls.getHelper());
      transformControlsRef.current = controls;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(
        "[MeshComposerScene] TransformControls unavailable; numeric fallback form will be shown.",
        e,
      );
      onGizmoUnavailable?.();
    }

    return () => {
      const c = transformControlsRef.current;
      if (c) {
        c.detach();
        const helper = c.getHelper();
        if (helper.parent) helper.parent.remove(helper);
        helper.dispose();
        c.dispose();
      }
      transformControlsRef.current = null;

      // Tear the outline down.
      const o = outlineRef.current;
      if (o) {
        if (o.parent) o.parent.remove(o);
        o.geometry.dispose();
        const mat = o.material as THREE.Material | THREE.Material[];
        if (Array.isArray(mat)) for (const m of mat) m.dispose();
        else mat.dispose();
      }
      outlineRef.current = null;

      if (sceneBundle.renderer.domElement.parentNode === container) {
        container.removeChild(sceneBundle.renderer.domElement);
      }
      sceneBundle.dispose();
      sceneRef.current = null;
      prevMeshRef.current = null;
      meshByNameRef.current.clear();
      setCanvas(null);
    };
    // onGizmoUnavailable is intentionally NOT a dep — we mount once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ----- Sync mesh prop → meshGroup + enumerate sub-meshes -----------------

  useEffect(() => {
    const sceneBundle = sceneRef.current;
    if (!sceneBundle) return;

    // Remove previous mesh from the group (DO NOT dispose — we don't own
    // the geometry; the prefab bank or MeshWorkspace owns it).
    if (prevMeshRef.current) {
      sceneBundle.meshGroup.remove(prevMeshRef.current);
      prevMeshRef.current = null;
    }
    meshByNameRef.current.clear();

    if (mesh) {
      sceneBundle.meshGroup.add(mesh);
      prevMeshRef.current = mesh;

      // Enumerate sub-meshes. Use traversal order so the first hit (the
      // chassis hull, by Hunyuan's export convention) lands at index 0.
      const subs: SubMeshInfo[] = [];
      let unnamedCounter = 0;
      mesh.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        const name = node.name && node.name.length > 0
          ? node.name
          : `<unnamed_${unnamedCounter++}>`;
        // If the GLB had duplicate names, prefer the FIRST occurrence —
        // matches composerOverrides' rule so the editor and runtime stay
        // in sync. Subsequent dupes get suffixed so the sidebar still
        // shows them (catch-all bucket).
        const finalName = meshByNameRef.current.has(name)
          ? `${name}#${meshByNameRef.current.size}`
          : name;
        meshByNameRef.current.set(finalName, node);
        // If the original node.name was empty/different, set the picked
        // name so subsequent select-by-name calls find it (and the runtime
        // override key matches).
        if (node.name !== finalName) {
          node.name = finalName;
        }
        const geom = node.geometry;
        const pos = geom.getAttribute("position");
        const vertCount = pos ? pos.count : 0;
        const index = geom.getIndex();
        const faceCount = index ? index.count / 3 : vertCount / 3;
        subs.push({
          uuid: node.uuid,
          name: finalName,
          visible: node.visible,
          vertCount,
          faceCount: Math.floor(faceCount),
        });
      });
      onSubMeshesChanged(subs);
    } else {
      onSubMeshesChanged([]);
    }
  }, [mesh, onSubMeshesChanged]);

  // ----- Sync visibility map -----------------------------------------------

  useEffect(() => {
    for (const [name, mesh] of meshByNameRef.current) {
      const want = visibility.get(name);
      // Default to visible if the map doesn't list this sub-mesh — the
      // adaptive default (rule #2): new sub-meshes added by re-loading a
      // GLB just show up, no edits needed elsewhere.
      mesh.visible = want === undefined ? true : want;
    }
  }, [visibility, mesh]);

  // ----- Attach gizmo + outline to selection -------------------------------

  useEffect(() => {
    const controls = transformControlsRef.current;
    const target =
      selectedName !== null ? meshByNameRef.current.get(selectedName) : null;

    // Outline: rebuild whenever the selected sub-mesh changes.
    rebuildOutline(target ?? null);

    if (!controls) return;
    if (!target) {
      controls.detach();
      return;
    }
    controls.setMode(gizmoMode);
    controls.attach(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedName, gizmoMode, mesh]);

  /**
   * Build (or rebuild) the wireframe outline around `target`. Removes the
   * previous outline first so we never leak GPU memory.
   */
  function rebuildOutline(target: THREE.Mesh | null): void {
    const sceneBundle = sceneRef.current;
    if (!sceneBundle) return;

    const prev = outlineRef.current;
    if (prev) {
      if (prev.parent) prev.parent.remove(prev);
      prev.geometry.dispose();
      const mat = prev.material as THREE.Material | THREE.Material[];
      if (Array.isArray(mat)) for (const m of mat) m.dispose();
      else mat.dispose();
    }
    outlineRef.current = null;

    if (!target) return;
    const edges = new THREE.EdgesGeometry(target.geometry, 30);
    const lineMat = new THREE.LineBasicMaterial({
      color: 0xffcc44,
      depthTest: false,
      transparent: true,
      opacity: 0.85,
    });
    const lines = new THREE.LineSegments(edges, lineMat);
    lines.renderOrder = 999;
    // Mount as a child of the target so it follows position/quaternion/scale
    // automatically.
    target.add(lines);
    outlineRef.current = lines;
  }

  /**
   * Re-sync the outline mid-drag. The outline is parented to the mesh so it
   * tracks transform changes automatically — but if a future polish pass
   * wants to overlay on a fixed-world position, this is the hook.
   */
  function syncOutlineToSelection(): void {
    // Currently a no-op: the outline is parented to the mesh so it tracks
    // naturally. Reserved for future selection-feedback effects (pulse,
    // halo, etc.) that the gizmo's `objectChange` event should trigger.
  }

  // ----- Render loop -------------------------------------------------------

  useEffect(() => {
    const sceneBundle = sceneRef.current;
    if (!sceneBundle) return undefined;
    let rafId = 0;
    let stopped = false;
    const frame = (): void => {
      if (stopped) return;
      if (document.visibilityState !== "hidden") {
        sceneBundle.renderer.render(sceneBundle.scene, sceneBundle.camera);
      }
      rafId = requestAnimationFrame(frame);
    };
    rafId = requestAnimationFrame(frame);
    return () => {
      stopped = true;
      cancelAnimationFrame(rafId);
    };
  }, [canvas]);

  // ----- Resize ------------------------------------------------------------

  useEffect(() => {
    const container = containerRef.current;
    const sceneBundle = sceneRef.current;
    if (!container || !sceneBundle) return undefined;
    const apply = (w: number, h: number): void => {
      if (w <= 0 || h <= 0) return;
      sceneBundle.camera.aspect = w / h;
      sceneBundle.camera.updateProjectionMatrix();
      sceneBundle.renderer.setSize(w, h);
    };
    apply(container.clientWidth, container.clientHeight);
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const cr = entry.contentRect;
        apply(cr.width, cr.height);
      }
    });
    ro.observe(container);
    return () => {
      ro.disconnect();
    };
  }, [canvas]);

  // ----- Pointer + wheel orbit + click-to-select ---------------------------

  useEffect(() => {
    if (!canvas) return undefined;

    interface DragStart {
      x: number;
      y: number;
      button: number;
      az: number;
      el: number;
      tx: number;
      ty: number;
      tz: number;
    }
    let mouseStart: DragStart | null = null;
    let isDragging = false;
    const raycaster = new THREE.Raycaster();

    const onContextMenu = (e: MouseEvent): void => {
      e.preventDefault();
    };

    const onPointerDown = (e: PointerEvent): void => {
      if (gizmoDraggingRef.current) return;
      const orbit = orbitRef.current;
      isDragging = false;
      mouseStart = {
        x: e.clientX,
        y: e.clientY,
        button: e.button,
        az: orbit.azimuth,
        el: orbit.elevation,
        tx: orbit.camTarget.x,
        ty: orbit.camTarget.y,
        tz: orbit.camTarget.z,
      };
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    };

    const onPointerMove = (e: PointerEvent): void => {
      const sceneBundle = sceneRef.current;
      if (!sceneBundle || !mouseStart) return;
      if (gizmoDraggingRef.current) return;
      const dx = e.clientX - mouseStart.x;
      const dy = e.clientY - mouseStart.y;
      if (!isDragging && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
        isDragging = true;
      }
      if (isDragging) {
        const orbit = orbitRef.current;
        if (mouseStart.button === 2) {
          // Right-drag = orbit. Editor-wide convention matching Play view
          // (commit e9d93db) + BattlefieldPreview + MeshViewer.
          orbit.azimuth = mouseStart.az - dx * 0.008;
          orbit.elevation = clampElevation(mouseStart.el + dy * 0.008);
          applyOrbit(sceneBundle.camera, orbit);
        } else if (mouseStart.button === 1) {
          // Middle-drag = pan.
          const speed = orbit.distance * 0.0025;
          orbit.camTarget.set(mouseStart.tx, mouseStart.ty, mouseStart.tz);
          panOrbit(orbit, -dx * speed, dy * speed);
          applyOrbit(sceneBundle.camera, orbit);
        }
      }
    };

    const onPointerUp = (e: PointerEvent): void => {
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      // If we did NOT drag and the gizmo wasn't grabbing pointer events,
      // treat this as a click-to-select on whichever sub-mesh sits under
      // the cursor. The Three.js raycaster filters to Mesh-instance hits.
      if (
        !isDragging &&
        !gizmoDraggingRef.current &&
        mouseStart &&
        e.button === 0
      ) {
        const sceneBundle = sceneRef.current;
        if (sceneBundle) {
          const rect = canvas.getBoundingClientRect();
          const ndc = new THREE.Vector2(
            ((e.clientX - rect.left) / rect.width) * 2 - 1,
            -((e.clientY - rect.top) / rect.height) * 2 + 1,
          );
          raycaster.setFromCamera(ndc, sceneBundle.camera);
          // Only hit meshes inside the prefab — not the ground/grid.
          const targets = Array.from(meshByNameRef.current.values()).filter(
            (m) => m.visible,
          );
          const hits = raycaster.intersectObjects(targets, false);
          if (hits.length > 0) {
            const picked = hits[0].object as THREE.Mesh;
            // Find the name we stored for this mesh.
            for (const [name, node] of meshByNameRef.current) {
              if (node === picked) {
                onPickRef.current(name);
                break;
              }
            }
          }
        }
      }
      mouseStart = null;
      isDragging = false;
    };

    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const sceneBundle = sceneRef.current;
      if (!sceneBundle) return;
      const orbit = orbitRef.current;
      orbit.distance = clampDistance(orbit.distance * (1 + e.deltaY * 0.0015));
      applyOrbit(sceneBundle.camera, orbit);
    };

    canvas.addEventListener("contextmenu", onContextMenu);
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      canvas.removeEventListener("contextmenu", onContextMenu);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [canvas]);

  return (
    <div style={styles.container} ref={containerRef}>
      {mesh === null && (
        <div style={styles.emptyOverlay}>
          Load a unit with a file-backed mesh_asset to begin composing.
        </div>
      )}
    </div>
  );
}
