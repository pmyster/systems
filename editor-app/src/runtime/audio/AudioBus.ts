/**
 * AudioBus — Phase 1 Week 4
 *
 * Placeholder audio bus. The point of this slice is to establish the
 * WIRING and CALL-SITES — Week 5+ can swap synthesised cues for real
 * sample assets without touching anywhere outside this file.
 *
 * Synthesis approach: we use raw Web Audio (oscillator + envelope +
 * brief noise) to make distinct, recognisable cues without shipping
 * any .mp3/.wav assets. Each cue is a one-shot function that builds
 * its node graph, schedules an envelope, and starts.
 *
 * 2D vs 3D:
 *   - 2D cues (selection confirm, UI blips) play at master gain.
 *   - World cues (weapon fire, impact, death) attach to a
 *     PositionalAudio node anchored at the supplied world position,
 *     so the AudioListener on the camera attenuates them naturally.
 *
 * Loud-over-silent: an unknown cue id triggers a one-shot warn
 * (Set-deduped) so the developer sees the missing wire WITHOUT the
 * console drowning every frame.
 */

import * as THREE from "three";

export const AudioCue = {
  WeaponFireShort: "weapon_fire_short",
  WeaponFireBeam: "weapon_fire_beam",
  ImpactKinetic: "impact_kinetic",
  ImpactExplosive: "impact_explosive",
  UnitDeath: "unit_death",
  SelectConfirm: "select_confirm",
} as const;
export type AudioCueId = (typeof AudioCue)[keyof typeof AudioCue];

interface CueRecipe {
  /** Master gain at peak (0..1). */
  readonly peak: number;
  /** Total duration in seconds. */
  readonly durSec: number;
  /** Builder runs at play time; receives a destination AudioNode. */
  readonly build: (ctx: AudioContext, dest: AudioNode) => void;
}

function makeEnvelope(
  ctx: AudioContext,
  attackSec: number,
  releaseSec: number,
  peak: number,
): GainNode {
  const g = ctx.createGain();
  const now = ctx.currentTime;
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(peak, now + attackSec);
  g.gain.linearRampToValueAtTime(0, now + attackSec + releaseSec);
  return g;
}

/**
 * Cue recipes — small, deliberate, distinct. None of these are pretty;
 * the goal is "the wiring works" and "you can tell apart a fire from a
 * death". Real assets land later.
 */
const CUE_RECIPES: Record<AudioCueId, CueRecipe> = {
  [AudioCue.WeaponFireShort]: {
    peak: 0.5,
    durSec: 0.05,
    build: (ctx, dest) => {
      const osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.value = 80;
      const env = makeEnvelope(ctx, 0.002, 0.05, 0.5);
      osc.connect(env).connect(dest);
      osc.start();
      osc.stop(ctx.currentTime + 0.06);
    },
  },
  [AudioCue.WeaponFireBeam]: {
    peak: 0.4,
    durSec: 0.2,
    build: (ctx, dest) => {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = 220;
      const env = makeEnvelope(ctx, 0.005, 0.2, 0.4);
      osc.connect(env).connect(dest);
      osc.start();
      osc.stop(ctx.currentTime + 0.21);
    },
  },
  [AudioCue.ImpactKinetic]: {
    peak: 0.55,
    durSec: 0.1,
    build: (ctx, dest) => {
      // 60 Hz click + brief noise burst.
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = 60;
      const clickEnv = makeEnvelope(ctx, 0.001, 0.04, 0.45);
      osc.connect(clickEnv).connect(dest);
      osc.start();
      osc.stop(ctx.currentTime + 0.05);
      // Noise burst — 100 ms of brown-ish noise via a short buffer.
      const sr = ctx.sampleRate;
      const buf = ctx.createBuffer(1, sr * 0.1, sr);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.3;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const nEnv = makeEnvelope(ctx, 0.001, 0.1, 0.35);
      src.connect(nEnv).connect(dest);
      src.start();
    },
  },
  [AudioCue.ImpactExplosive]: {
    peak: 0.6,
    durSec: 0.4,
    build: (ctx, dest) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      const now = ctx.currentTime;
      osc.frequency.setValueAtTime(40, now);
      osc.frequency.exponentialRampToValueAtTime(20, now + 0.4);
      const env = makeEnvelope(ctx, 0.005, 0.4, 0.6);
      osc.connect(env).connect(dest);
      osc.start();
      osc.stop(now + 0.41);
    },
  },
  [AudioCue.UnitDeath]: {
    peak: 0.5,
    durSec: 0.6,
    build: (ctx, dest) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      const now = ctx.currentTime;
      osc.frequency.setValueAtTime(400, now);
      osc.frequency.exponentialRampToValueAtTime(100, now + 0.6);
      const env = makeEnvelope(ctx, 0.01, 0.6, 0.5);
      osc.connect(env).connect(dest);
      osc.start();
      osc.stop(now + 0.61);
    },
  },
  [AudioCue.SelectConfirm]: {
    peak: 0.35,
    durSec: 0.06,
    build: (ctx, dest) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = 880;
      const env = makeEnvelope(ctx, 0.002, 0.06, 0.35);
      osc.connect(env).connect(dest);
      osc.start();
      osc.stop(ctx.currentTime + 0.07);
    },
  },
};

/**
 * Singleton — one bus per runtime view. We don't enforce singleton-ness
 * in code, but GameRuntime should construct one and dispose on unmount.
 */
export class AudioBus {
  private readonly listener: THREE.AudioListener;
  private readonly masterGain: GainNode;
  private readonly unknownCueWarned = new Set<string>();
  private readonly ctx: AudioContext;

  constructor(listener: THREE.AudioListener) {
    this.listener = listener;
    // THREE.AudioListener wraps an AudioContext internally — we reuse
    // that one so positional audio and 2D audio share a single context.
    this.ctx = listener.context;
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.7;
    this.masterGain.connect(this.ctx.destination);
  }

  /**
   * Resume the AudioContext if it's been suspended (browser autoplay
   * policies: contexts created before a user gesture start as
   * "suspended"). Call this from a user-input handler.
   */
  async resume(): Promise<void> {
    if (this.ctx.state === "suspended") {
      await this.ctx.resume();
    }
  }

  /**
   * Play a cue. If `worldPos` is supplied the cue is placed
   * positionally; otherwise it routes through the 2D master bus.
   *
   * `volume` is a per-call multiplier — useful for distance falloff
   * the caller may want to apply itself (e.g., a death event might be
   * scaled down by 30% to make weapon fires feel punchier).
   */
  play(cue: AudioCueId, worldPos?: THREE.Vector3, volume = 1.0): void {
    const recipe = CUE_RECIPES[cue];
    if (!recipe) {
      // Loud-over-silent (dedup so a missed wire doesn't spam the log).
      if (!this.unknownCueWarned.has(cue)) {
        this.unknownCueWarned.add(cue);
        console.warn("[AudioBus] unknown cue '%s' — first occurrence only", cue);
      }
      return;
    }
    const callGain = this.ctx.createGain();
    callGain.gain.value = Math.max(0, Math.min(1, volume));
    if (worldPos !== undefined) {
      // Positional path. THREE.PositionalAudio expects a buffer source
      // — but our builders schedule their own oscillators. We
      // approximate "positional" by computing a distance attenuation
      // and applying it as a gain multiplier. Full positional path
      // arrives when real sample assets land in Week 5.
      const lp = this.listener.position;
      const dx = worldPos.x - lp.x;
      const dy = worldPos.y - lp.y;
      const dz = worldPos.z - lp.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const refDist = 10;
      const rolloff = 1;
      // OpenAL inverse distance model:
      const atten = refDist / (refDist + rolloff * Math.max(0, dist - refDist));
      callGain.gain.value *= atten;
    }
    callGain.connect(this.masterGain);
    recipe.build(this.ctx, callGain);
  }

  dispose(): void {
    try {
      this.masterGain.disconnect();
    } catch (e) {
      // Disconnect can throw if already disconnected; non-fatal.
      void e;
    }
  }
}
