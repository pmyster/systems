/**
 * ClipRecorder — Phase 1 Week 4
 *
 * Rolling 60-second WebM clip recorder hooked up to the Three.js
 * canvas. The MediaRecorder API streams encoded chunks every
 * `timeslice` ms; we keep the most recent ~60 chunks in a ring buffer.
 * On F10 the user saves the last 60s as a single WebM file.
 *
 * Why VP9 with VP8 fallback?
 *   VP9 is materially better quality at the same bitrate. Most modern
 *   Chromium-derived runtimes (which is what Tauri wraps via webview2 /
 *   wkwebview / webkitgtk) support it, but a stale webview can still
 *   refuse the mimetype. We feature-detect via
 *   `MediaRecorder.isTypeSupported` and fall back transparently with a
 *   visible log line. Loud-over-silent.
 *
 * Why concat blobs at save time, not stream to disk?
 *   - The rolling buffer makes "save the last N seconds" trivial.
 *   - Tauri's bridge gives us a clean Vec<u8> commit point.
 *   - 60s at 8 Mbps ≈ 60 MB — comfortably within an in-memory budget
 *     for a one-shot save.
 */

import { invoke } from "@tauri-apps/api/core";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";

const ROLLING_WINDOW_SEC = 60;
const TIMESLICE_MS = 1000;
const TARGET_FPS = 30;
const VIDEO_BPS = 8_000_000;

/**
 * Preferred mime in order of fidelity. The MediaRecorder must accept
 * the FULL string (including the codecs= parameter) — partial matches
 * don't count.
 */
const MIME_CANDIDATES: readonly string[] = [
  "video/webm; codecs=vp9",
  "video/webm; codecs=vp8",
  "video/webm",
];

function pickSupportedMime(): string | null {
  for (const candidate of MIME_CANDIDATES) {
    // MediaRecorder is a browser global; in Node tests it's undefined
    // — callers should not instantiate ClipRecorder in headless tests.
    if (
      typeof MediaRecorder !== "undefined" &&
      MediaRecorder.isTypeSupported(candidate)
    ) {
      if (candidate.includes("vp9")) {
        // No log — vp9 is the happy path.
      } else if (candidate.includes("vp8")) {
        console.info(
          "[ClipRecorder] VP9 unsupported; falling back to VP8 — clip quality may be lower",
        );
      } else {
        console.info(
          "[ClipRecorder] VP8 also unsupported; using bare video/webm",
        );
      }
      return candidate;
    }
  }
  return null;
}

export class ClipRecorder {
  private readonly canvas: HTMLCanvasElement;
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private actualMime: string | null = null;
  private started = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  /**
   * Begin capturing. Safe to call once per recorder lifecycle; calling
   * it again before `dispose()` is a no-op (warn).
   */
  start(): void {
    if (this.started) {
      console.warn("[ClipRecorder] start() called twice — ignoring");
      return;
    }
    const mime = pickSupportedMime();
    if (mime === null) {
      console.error(
        "[ClipRecorder] No supported WebM mime — clip recording disabled",
      );
      return;
    }
    this.actualMime = mime;
    // captureStream is non-standard on some browsers but ships in every
    // Chromium-derived webview Tauri targets.
    const captureStream = (
      this.canvas as unknown as { captureStream?: (fps: number) => MediaStream }
    ).captureStream;
    if (typeof captureStream !== "function") {
      console.error(
        "[ClipRecorder] canvas.captureStream is not available — clip recording disabled",
      );
      return;
    }
    this.stream = captureStream.call(this.canvas, TARGET_FPS);
    this.recorder = new MediaRecorder(this.stream, {
      mimeType: mime,
      videoBitsPerSecond: VIDEO_BPS,
    });
    this.recorder.ondataavailable = (e: BlobEvent): void => {
      if (e.data && e.data.size > 0) {
        this.chunks.push(e.data);
        // Trim to the rolling window. We use chunk count as the proxy
        // for seconds because timeslice = 1000 ms.
        const max = ROLLING_WINDOW_SEC;
        if (this.chunks.length > max) {
          this.chunks.splice(0, this.chunks.length - max);
        }
      }
    };
    this.recorder.onerror = (ev: Event): void => {
      console.error("[ClipRecorder] MediaRecorder error", ev);
    };
    this.recorder.start(TIMESLICE_MS);
    this.started = true;
  }

  /** Number of seconds currently in the rolling buffer. */
  bufferedSec(): number {
    return this.chunks.length;
  }

  /**
   * Concatenate the rolling buffer and prompt the user for a save path.
   * Returns the path written, or null if the user cancels.
   */
  async saveLast60s(suggestedFileName = "clip.webm"): Promise<string | null> {
    if (!this.actualMime || this.chunks.length === 0) {
      console.warn(
        "[ClipRecorder] saveLast60s() called but no chunks buffered — ignoring",
      );
      return null;
    }
    const blob = new Blob(this.chunks, { type: this.actualMime });
    const buf = await blob.arrayBuffer();
    const bytes = Array.from(new Uint8Array(buf));
    const picked = await saveDialog({
      title: "Save Last 60s Clip",
      defaultPath: suggestedFileName,
      filters: [{ name: "WebM Video", extensions: ["webm"] }],
    });
    if (picked === null || picked === undefined) return null;
    const path: string = typeof picked === "string" ? picked : String(picked);
    const written = await invoke<string>("save_video_clip", { path, bytes });
    return written;
  }

  /** Tear down the MediaRecorder + stream tracks. */
  dispose(): void {
    if (this.recorder && this.recorder.state !== "inactive") {
      try {
        this.recorder.stop();
      } catch (e) {
        console.warn("[ClipRecorder] recorder.stop() threw", e);
      }
    }
    if (this.stream) {
      for (const t of this.stream.getTracks()) t.stop();
    }
    this.recorder = null;
    this.stream = null;
    this.chunks.length = 0;
    this.started = false;
  }
}
