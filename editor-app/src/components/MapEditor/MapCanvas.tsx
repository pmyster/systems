/**
 * MapCanvas — a thin React wrapper that owns the canvas DOM element and
 * the MapSceneManager that drives it.
 *
 * React's job here is exactly two things:
 *   1. Mount a <canvas> inside an absolutely-positioned container.
 *   2. On mount, hand both refs to a fresh MapSceneManager; on unmount,
 *      call its `dispose()`.
 *
 * Everything else (render loop, camera, store wiring) lives outside
 * React in the scene manager. This keeps the rAF loop and Three.js side
 * effects out of React's render path.
 */

import { useEffect, useRef } from "react";

import { MapSceneManager } from "../../map/scene/MapSceneManager";

export function MapCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const managerRef = useRef<MapSceneManager | null>(null);

  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;
    const mgr = new MapSceneManager(canvasRef.current, containerRef.current);
    managerRef.current = mgr;
    return () => {
      mgr.dispose();
      managerRef.current = null;
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{ position: "absolute", inset: 0, overflow: "hidden" }}
    >
      <canvas ref={canvasRef} style={{ display: "block" }} />
    </div>
  );
}
