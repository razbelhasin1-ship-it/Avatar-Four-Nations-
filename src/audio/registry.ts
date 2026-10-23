/**
 * Sound recipe registry + the original helper functions. Kept separate from
 * AudioEngine.ts so recipe libraries can register at import time without a
 * circular import (AudioEngine.ts re-exports everything here, so existing
 * `import { registerSound } from '.../audio/AudioEngine'` keeps working).
 */

export type Bus = 'sfx' | 'ui' | 'music' | 'ambient';

/** Shared resources handed to every one-shot recipe. */
export interface RecipeOpts {
  pitch: number;
  volume: number;
  /** Pink-ish noise, 2 s, use with loop = true (the original shared buffer). */
  noise: AudioBuffer;
  /** White noise, 2 s. */
  white: AudioBuffer;
  /** Brown (red) noise, 2 s — rumbles, surf, distant roars. */
  brown: AudioBuffer;
  /**
   * Send into the environment reverb (feedback-delay network). Already scaled by
   * distance for positional sounds; connect a (gain-scaled) copy of any signal.
   */
  reverb: AudioNode;
  /** Random variation value 0..1, fixed for this play. */
  seed: number;
}

export interface SoundRecipe {
  /** Build the sound graph into `out`, starting at time `t`. Return duration (s). */
  (ac: AudioContext, out: AudioNode, t: number, opts: RecipeOpts): number;
}

export interface SoundMeta {
  /** Declared maximum duration (s), verified offline by debug.audio.verifyAll(). Defaults to the recipe's return value. */
  duration?: number;
  /** Default bus when PlayOpts.bus is omitted (default 'sfx'). */
  bus?: Bus;
  /** Max concurrent voices of this id (the oldest is faded out). Default 6. */
  maxVoices?: number;
  /** Minimum seconds between two plays of this id at the same spot. Default 0.03. */
  cooldown?: number;
  /** 0 = ambient detail … 3 = UI/critical. Lower priorities are stolen first. Default 1 (2 for ui). */
  priority?: number;
  /** Automatic reverb send 0..1 (default 0.12 for sfx/ambient, 0 for ui). */
  reverb?: number;
  /** Default audible range (m) for positional plays. */
  range?: number;
  /** One-line description (documentation/debug). */
  desc?: string;
}

export interface LoopRecipeOpts {
  noise: AudioBuffer;
  white: AudioBuffer;
  brown: AudioBuffer;
  reverb: AudioNode;
}

export interface LoopInstance {
  stop(t: number): void;
  setPitch?(p: number): void;
  /** Optional named parameters (e.g. 'intensity', 'density', 'speed'), 0..1 unless documented. */
  setParam?(name: string, v: number): void;
}

export interface LoopRecipe {
  (ac: AudioContext, out: AudioNode, opts: LoopRecipeOpts): LoopInstance;
}

export interface LoopMeta {
  desc?: string;
  /** Parameters understood by setParam. */
  params?: string[];
}

const recipes = new Map<string, SoundRecipe>();
const metas = new Map<string, SoundMeta>();
const loopRecipes = new Map<string, LoopRecipe>();
const loopMetas = new Map<string, LoopMeta>();

export function registerSound(id: string, r: SoundRecipe, meta?: SoundMeta): void {
  recipes.set(id, r);
  if (meta) metas.set(id, meta);
}

export function registerLoop(id: string, r: LoopRecipe, meta?: LoopMeta): void {
  loopRecipes.set(id, r);
  if (meta) loopMetas.set(id, meta);
}

/** Register `alias` as another name for an already registered sound. */
export function aliasSound(alias: string, target: string, meta?: SoundMeta): void {
  const r = recipes.get(target);
  if (!r) throw new Error(`[Audio] alias ${alias}: unknown sound ${target}`);
  recipes.set(alias, r);
  const m = meta ?? metas.get(target);
  if (m) metas.set(alias, m);
}

export function getSoundRecipe(id: string): SoundRecipe | undefined {
  return recipes.get(id);
}

export function getLoopRecipe(id: string): LoopRecipe | undefined {
  return loopRecipes.get(id);
}

export function soundMeta(id: string): SoundMeta {
  return metas.get(id) ?? EMPTY_META;
}

export function loopMeta(id: string): LoopMeta {
  return loopMetas.get(id) ?? {};
}

export function hasSound(id: string): boolean {
  return recipes.has(id);
}

export function listSounds(): string[] {
  return [...recipes.keys()].sort();
}

export function listLoops(): string[] {
  return [...loopRecipes.keys()].sort();
}

const EMPTY_META: SoundMeta = {};

// ---------------------------------------------------------------------------
// Original helpers (public API — other modules build recipes with these).
// ---------------------------------------------------------------------------

/** Helper: ADSR-ish gain envelope. */
export function envGain(ac: AudioContext, t: number, attack: number, hold: number, release: number, peak = 1): GainNode {
  const g = ac.createGain();
  const p = Math.max(0.0002, Number.isFinite(peak) ? peak : 0.0002);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(p, t + Math.max(0.002, attack));
  g.gain.setValueAtTime(p, t + attack + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
  return g;
}

/** Helper: noise source from the shared buffer with a filter. */
export function noiseSrc(ac: AudioContext, noise: AudioBuffer, t: number, dur: number, type: BiquadFilterType, freq: number, q = 1): { src: AudioBufferSourceNode; filter: BiquadFilterNode } {
  const src = ac.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  src.loopStart = Math.random() * 1.5;
  const filter = ac.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(Number.isFinite(freq) ? freq : 1000, t);
  filter.Q.value = q;
  src.connect(filter);
  src.start(t, Math.random() * 1.5);
  src.stop(t + dur + 0.05);
  return { src, filter };
}

export function oscSrc(ac: AudioContext, t: number, dur: number, type: OscillatorType, freq: number): OscillatorNode {
  const o = ac.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(Number.isFinite(freq) ? freq : 440, t);
  o.start(t);
  o.stop(t + dur + 0.05);
  return o;
}
