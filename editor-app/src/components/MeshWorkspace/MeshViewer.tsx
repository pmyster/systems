/**
 * MeshViewer — Three.js mesh viewer for the Mesh Workspace left pane.
 *
 * Renders an imported THREE.Group (GLB/GLTF mesh) inside a WebGL
 * canvas. Supports orbit camera via pointer events:
 *   - Left-drag  → orbit (azimuth + elevation)
 *   - Middle-drag → pan camera target
 *   - Wheel       → dolly distance
 *
 * When `mesh` is null an overlay prompt is shown.
 * All GPU resources are disposed on unmount.
 */

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

import {
  applyOrbit,
  clampDistance,
  clampElevation,
  createOrbitState,
  panOrbit,
} from "./controls";
import { createMeshScene, type MeshScene } from "./scene";

// ---------------------------------------------------------------------------
// Props.
// ---------------------------------------------------------------------------

export interface MeshViewerProps {
  /** The current mesh to display. null = empty scene with prompt overlay. */
  mesh: THREE.Group | null;
}

// ---------------------------------------------------------------------------
// Inline styles.
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
    letterSpacing: "0.02em",
    textAlign: "center" as const,
    padding: "0 24px",
  },
} as const;

// ---------------------------------------------------------------------------
// Component.
// ---------------------------------------------------------------------------

export function MeshViewer({ mesh }: MeshViewerProps) {
  // The div the renderer canvas is mounted inside.
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Three.js scene bundle (created on mount, disposed on unmount).
  const sceneRef = useRef<MeshScene | null>(null);
  // Orbit camera state — mutable, never triggers re-renders.
  const orbitRef = useRef(createOrbitState());
  // Ref tracking the most-recently-added mesh so we can remove it.
  const prevMeshRef = useRef<THREE.Group | null>(null);
  // Canvas state drives the render-loop and resize-observer effects.
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);

  // ----- Mount: build scene, attach canvas ---------------------------------

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const sceneBundle = createMeshScene();
    sceneRef.current = sceneBundle;
    container.appendChild(sceneBundle.renderer.domElement);
    setCanvas(sceneBundle.renderer.domElement);
    applyOrbit(sceneBundle.camera, orbitRef.current);

    return () => {
      if (sceneBundle.renderer.domElement.parentNode === container) {
        container.removeChild(sceneBundle.renderer.domElement);
      }
      sceneBundle.dispose();
      sceneRef.current = null;
      prevMeshRef.current = null;
      setCanvas(null);
    };
  }, []);

  // ----- Sync mesh prop → meshGroup ----------------------------------------

  useEffect(() => {
    const sceneBundle = sceneRef.current;
    if (!sceneBundle) return;

    // Remove previous mesh.
    if (prevMeshRef.current) {
      sceneBundle.meshGroup.remove(prevMeshRef.current);
      prevMeshRef.current = null;
    }

    // Add new mesh.
    if (mesh) {
      sceneBundle.meshGroup.add(mesh);
      prevMeshRef.current = mesh;
    }
  }, [mesh]);

  // ----- Render loop (rAF, paused while hidden) ----------------------------

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

    const onVisibility = (): void => {
      if (document.visibilityState !== "hidden") {
        sceneBundle.renderer.render(sceneBundle.scene, sceneBundle.camera);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stopped = true;
      cancelAnimationFrame(rafId);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [canvas]);

  // ----- ResizeObserver on the container -----------------------------------

  useEffect(() => {
    const container = containerRef.current;
    const sceneBundle = sceneRef.current;
    if (!container || !sceneBundle) return undefined;

    const apply = (w: number, h: number): void => {
      if (w <= 0 || h <= 0) return;
      sceneBundle.camera.aspect = w / h;
      sceneBundle.camera.updateProjectionMatrix();
      sceneBundle.renderer.setSize(w, h, false);
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

  // ----- Pointer + wheel orbit controls ------------------------------------

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

    const onContextMenu = (e: MouseEvent): void => {
      e.preventDefault();
    };

    const onPointerDown = (e: PointerEvent): void => {
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
        // setPointerCapture can throw if the pointer isn't active; ignore.
      }
    };

    const onPointerMove = (e: PointerEvent): void => {
      const sceneBundle = sceneRef.current;
      if (!sceneBundle || !mouseStart) return;
      const dx = e.clientX - mouseStart.x;
      const dy = e.clientY - mouseStart.y;
      if (!isDragging && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
        isDragging = true;
      }
      if (isDragging) {
        const orbit = orbitRef.current;
        if (mouseStart.button === 0) {
          // Left-drag = orbit
          orbit.azimuth = mouseStart.az - dx * 0.008;
          orbit.elevation = clampElevation(mouseStart.el + dy * 0.008);
          applyOrbit(sceneBundle.camera, orbit);
        } else if (mouseStart.button === 1) {
          // Middle-drag = pan
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

  // ----- Render ------------------------------------------------------------

  return (
    <div style={styles.container} ref={containerRef}>
      {mesh === null && (
        <div style={styles.emptyOverlay}>
          No mesh loaded — pick a template or import a file
        </div>
      )}
    </div>
  );
}
