import type * as THREE from 'three';
import type { EventBus } from '../core/EventBus';
import type { SettingsManager } from '../core/Settings';
import type { Vec3Like } from '../core/types';

/**
 * Procedural WebAudio engine. No audio files are required: every sound is a
 * "recipe" that builds a short node graph (noise, oscillators, filters,
 * envelopes). Modules register recipes with registerSound().
 *
 * Browser autoplay rules: the AudioContext is created/resumed on the first user
 * gesture (unlock()), which Game wires to pointerdown/keydown.
 */

export type Bus = 'sfx' | 'ui' | 'music' | 'ambient';

export interface PlayOpts {
  position?: Vec3Like;
  volume?: number;
  pitch?: number;
  bus?: Bus;
  /** Override max audible distance (m). */
  range?: number;
}

export interface SoundRecipe {
  /** Build the sound graph into `out`, starting at time `t`. Return duration (s). */
  (ac: AudioContext, out: AudioNode, t: number, opts: { pitch: number; volume: number; noise: AudioBuffer }): number;
}

export interface LoopHandle {
  setVolume(v: number): void;
  setPosition(p: Vec3Like): void;
  setPitch(p: number): void;
  stop(fade?: number): void;
}

export interface LoopRecipe {
  (ac: AudioContext, out: AudioNode, opts: { noise: AudioBuffer }): { stop(t: number): void; setPitch?(p: number): void };
}

const recipes = new Map<string, SoundRecipe>();
const loopRecipes = new Map<string, LoopRecipe>();

export function registerSound(id: string, r: SoundRecipe): void {
  recipes.set(id, r);
}

export function registerLoop(id: string, r: LoopRecipe): void {
  loopRecipes.set(id, r);
}

/** Helper: ADSR-ish gain envelope. */
export function envGain(ac: AudioContext, t: number, attack: number, hold: number, release: number, peak = 1): GainNode {
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + Math.max(0.002, attack));
  g.gain.setValueAtTime(Math.max(0.0002, peak), t + attack + hold);
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
  filter.frequency.setValueAtTime(freq, t);
  filter.Q.value = q;
  src.connect(filter);
  src.start(t, Math.random() * 1.5);
  src.stop(t + dur + 0.05);
  return { src, filter };
}

export function oscSrc(ac: AudioContext, t: number, dur: number, type: OscillatorType, freq: number): OscillatorNode {
  const o = ac.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.start(t);
  o.stop(t + dur + 0.05);
  return o;
}

// ---------------------------------------------------------------------------
// Built-in recipes (expanded by the audio module)
// ---------------------------------------------------------------------------

registerSound('ui_click', (ac, out, t, o) => {
  const osc = oscSrc(ac, t, 0.08, 'triangle', 880 * o.pitch);
  const g = envGain(ac, t, 0.002, 0.01, 0.06, 0.25 * o.volume);
  osc.connect(g).connect(out);
  return 0.1;
});

registerSound('ui_confirm', (ac, out, t, o) => {
  [660, 990].forEach((f, i) => {
    const osc = oscSrc(ac, t + i * 0.06, 0.25, 'sine', f * o.pitch);
    const g = envGain(ac, t + i * 0.06, 0.005, 0.03, 0.2, 0.22 * o.volume);
    osc.connect(g).connect(out);
  });
  return 0.4;
});

registerSound('ui_back', (ac, out, t, o) => {
  const osc = oscSrc(ac, t, 0.15, 'triangle', 520 * o.pitch);
  osc.frequency.exponentialRampToValueAtTime(330 * o.pitch, t + 0.12);
  const g = envGain(ac, t, 0.003, 0.02, 0.1, 0.22 * o.volume);
  osc.connect(g).connect(out);
  return 0.2;
});

registerSound('notify', (ac, out, t, o) => {
  [784, 1046, 1318].forEach((f, i) => {
    const osc = oscSrc(ac, t + i * 0.07, 0.5, 'sine', f * o.pitch);
    const g = envGain(ac, t + i * 0.07, 0.01, 0.05, 0.4, 0.14 * o.volume);
    osc.connect(g).connect(out);
  });
  return 0.8;
});

registerSound('footstep', (ac, out, t, o) => {
  const { filter } = noiseSrc(ac, o.noise, t, 0.12, 'bandpass', 900 * o.pitch, 0.9);
  const g = envGain(ac, t, 0.004, 0.02, 0.08, 0.35 * o.volume);
  filter.connect(g).connect(out);
  return 0.15;
});

registerSound('footstep_snow', (ac, out, t, o) => {
  const { filter } = noiseSrc(ac, o.noise, t, 0.2, 'highpass', 1800 * o.pitch, 0.7);
  const g = envGain(ac, t, 0.01, 0.06, 0.12, 0.3 * o.volume);
  filter.connect(g).connect(out);
  return 0.25;
});

registerSound('footstep_stone', (ac, out, t, o) => {
  const { filter } = noiseSrc(ac, o.noise, t, 0.08, 'bandpass', 2600 * o.pitch, 2);
  const g = envGain(ac, t, 0.002, 0.01, 0.05, 0.3 * o.volume);
  filter.connect(g).connect(out);
  return 0.1;
});

registerSound('footstep_water', (ac, out, t, o) => {
  const { filter } = noiseSrc(ac, o.noise, t, 0.25, 'lowpass', 1400 * o.pitch, 3);
  filter.frequency.exponentialRampToValueAtTime(500, t + 0.2);
  const g = envGain(ac, t, 0.01, 0.04, 0.18, 0.35 * o.volume);
  filter.connect(g).connect(out);
  return 0.3;
});

registerSound('whoosh', (ac, out, t, o) => {
  const { filter } = noiseSrc(ac, o.noise, t, 0.45, 'bandpass', 500 * o.pitch, 1.2);
  filter.frequency.exponentialRampToValueAtTime(2200 * o.pitch, t + 0.18);
  filter.frequency.exponentialRampToValueAtTime(700 * o.pitch, t + 0.4);
  const g = envGain(ac, t, 0.06, 0.08, 0.28, 0.5 * o.volume);
  filter.connect(g).connect(out);
  return 0.5;
});

registerSound('fire_burst', (ac, out, t, o) => {
  const { filter } = noiseSrc(ac, o.noise, t, 0.6, 'lowpass', 2400 * o.pitch, 0.8);
  filter.frequency.exponentialRampToValueAtTime(400, t + 0.5);
  const g = envGain(ac, t, 0.01, 0.1, 0.45, 0.65 * o.volume);
  filter.connect(g).connect(out);
  const thump = oscSrc(ac, t, 0.25, 'sine', 90 * o.pitch);
  thump.frequency.exponentialRampToValueAtTime(45, t + 0.2);
  const g2 = envGain(ac, t, 0.005, 0.03, 0.2, 0.4 * o.volume);
  thump.connect(g2).connect(out);
  return 0.7;
});

registerSound('water_splash', (ac, out, t, o) => {
  const { filter } = noiseSrc(ac, o.noise, t, 0.6, 'bandpass', 1600 * o.pitch, 0.7);
  filter.frequency.exponentialRampToValueAtTime(600, t + 0.5);
  const g = envGain(ac, t, 0.005, 0.08, 0.45, 0.55 * o.volume);
  filter.connect(g).connect(out);
  return 0.7;
});

registerSound('water_whoosh', (ac, out, t, o) => {
  const { filter } = noiseSrc(ac, o.noise, t, 0.5, 'bandpass', 900 * o.pitch, 2.5);
  filter.frequency.exponentialRampToValueAtTime(1800 * o.pitch, t + 0.25);
  const g = envGain(ac, t, 0.04, 0.12, 0.3, 0.45 * o.volume);
  filter.connect(g).connect(out);
  return 0.55;
});

registerSound('rock_impact', (ac, out, t, o) => {
  const thump = oscSrc(ac, t, 0.4, 'sine', 70 * o.pitch);
  thump.frequency.exponentialRampToValueAtTime(35, t + 0.35);
  const g = envGain(ac, t, 0.003, 0.05, 0.3, 0.8 * o.volume);
  thump.connect(g).connect(out);
  const { filter } = noiseSrc(ac, o.noise, t, 0.35, 'lowpass', 900 * o.pitch, 0.7);
  const g2 = envGain(ac, t, 0.002, 0.04, 0.28, 0.5 * o.volume);
  filter.connect(g2).connect(out);
  return 0.5;
});

registerSound('rock_rise', (ac, out, t, o) => {
  const { filter } = noiseSrc(ac, o.noise, t, 0.7, 'lowpass', 300 * o.pitch, 1);
  filter.frequency.exponentialRampToValueAtTime(900 * o.pitch, t + 0.5);
  const g = envGain(ac, t, 0.08, 0.3, 0.3, 0.6 * o.volume);
  filter.connect(g).connect(out);
  return 0.8;
});

registerSound('ice_crack', (ac, out, t, o) => {
  for (let i = 0; i < 4; i++) {
    const tt = t + i * 0.03 + Math.random() * 0.02;
    const { filter } = noiseSrc(ac, o.noise, tt, 0.06, 'highpass', 3000 * o.pitch, 4);
    const g = envGain(ac, tt, 0.001, 0.005, 0.05, 0.35 * o.volume);
    filter.connect(g).connect(out);
  }
  return 0.3;
});

registerSound('hit', (ac, out, t, o) => {
  const osc = oscSrc(ac, t, 0.15, 'square', 180 * o.pitch);
  osc.frequency.exponentialRampToValueAtTime(60, t + 0.12);
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 900;
  const g = envGain(ac, t, 0.002, 0.02, 0.1, 0.35 * o.volume);
  osc.connect(lp).connect(g).connect(out);
  return 0.2;
});

registerSound('jump', (ac, out, t, o) => {
  const { filter } = noiseSrc(ac, o.noise, t, 0.2, 'bandpass', 700 * o.pitch, 1);
  filter.frequency.exponentialRampToValueAtTime(1600, t + 0.15);
  const g = envGain(ac, t, 0.01, 0.03, 0.12, 0.2 * o.volume);
  filter.connect(g).connect(out);
  return 0.25;
});

registerSound('land', (ac, out, t, o) => {
  const thump = oscSrc(ac, t, 0.2, 'sine', 80 * o.pitch);
  thump.frequency.exponentialRampToValueAtTime(40, t + 0.15);
  const g = envGain(ac, t, 0.003, 0.02, 0.15, 0.4 * o.volume);
  thump.connect(g).connect(out);
  return 0.25;
});

registerSound('avatar_surge', (ac, out, t, o) => {
  [110, 165, 220, 330].forEach((f, i) => {
    const osc = oscSrc(ac, t, 2.2, i % 2 ? 'sawtooth' : 'sine', f * o.pitch);
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(200, t);
    lp.frequency.exponentialRampToValueAtTime(3000, t + 0.8);
    const g = envGain(ac, t, 0.4, 0.8, 1.0, 0.12 * o.volume);
    osc.connect(lp).connect(g).connect(out);
  });
  const { filter } = noiseSrc(ac, o.noise, t, 2, 'bandpass', 300, 0.6);
  filter.frequency.exponentialRampToValueAtTime(2500, t + 1.2);
  const g = envGain(ac, t, 0.6, 0.5, 0.9, 0.4 * o.volume);
  filter.connect(g).connect(out);
  return 2.3;
});

registerLoop('wind', (ac, out, o) => {
  const src = ac.createBufferSource();
  src.buffer = o.noise;
  src.loop = true;
  const f = ac.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = 450;
  f.Q.value = 0.6;
  const lfo = ac.createOscillator();
  lfo.frequency.value = 0.13;
  const lfoGain = ac.createGain();
  lfoGain.gain.value = 250;
  lfo.connect(lfoGain).connect(f.frequency);
  src.connect(f).connect(out);
  src.start();
  lfo.start();
  return {
    stop(t: number) {
      src.stop(t);
      lfo.stop(t);
    },
  };
});

registerLoop('fire_crackle', (ac, out, o) => {
  const src = ac.createBufferSource();
  src.buffer = o.noise;
  src.loop = true;
  const f = ac.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 1200;
  src.connect(f).connect(out);
  src.start();
  return { stop: (t: number) => src.stop(t) };
});

registerLoop('water_flow', (ac, out, o) => {
  const src = ac.createBufferSource();
  src.buffer = o.noise;
  src.loop = true;
  const f = ac.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = 900;
  f.Q.value = 0.5;
  src.connect(f).connect(out);
  src.start();
  return { stop: (t: number) => src.stop(t) };
});

// ---------------------------------------------------------------------------

export class AudioEngine {
  ac: AudioContext | null = null;
  private master: GainNode | null = null;
  private buses: Partial<Record<Bus, GainNode>> = {};
  private noise: AudioBuffer | null = null;
  private listenerPos = { x: 0, y: 0, z: 0 };
  private lastPlay = new Map<string, number>();
  private music: MusicPlayer | null = null;
  private pendingTheme: string | null = null;
  unlocked = false;

  constructor(private readonly settings: SettingsManager, events: EventBus) {
    events.on('settings:changed', () => this.applyVolumes());
  }

  /** Must be called from a user gesture. Safe to call repeatedly. */
  unlock(): void {
    try {
      if (!this.ac) {
        const AC = window.AudioContext || (window as any).webkitAudioContext;
        if (!AC) return;
        this.ac = new AC();
        this.master = this.ac.createGain();
        this.master.connect(this.ac.destination);
        const comp = this.ac.createDynamicsCompressor();
        comp.threshold.value = -14;
        comp.ratio.value = 4;
        for (const b of ['sfx', 'ui', 'music', 'ambient'] as Bus[]) {
          const g = this.ac.createGain();
          g.connect(b === 'music' ? this.master : comp);
          this.buses[b] = g;
        }
        comp.connect(this.master);
        this.noise = this.makeNoise(this.ac);
        this.music = new MusicPlayer(this.ac, this.buses.music!);
        this.applyVolumes();
        if (this.pendingTheme) this.music.setTheme(this.pendingTheme);
      }
      if (this.ac.state === 'suspended') void this.ac.resume();
      this.unlocked = true;
    } catch (err) {
      console.warn('[Audio] unavailable', err);
    }
  }

  private makeNoise(ac: AudioContext): AudioBuffer {
    const len = ac.sampleRate * 2;
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      // light pinking
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
    }
    return buf;
  }

  private applyVolumes(): void {
    if (!this.ac || !this.master) return;
    const a = this.settings.data.audio;
    const t = this.ac.currentTime;
    this.master.gain.setTargetAtTime(a.muted ? 0 : a.master, t, 0.05);
    this.buses.sfx?.gain.setTargetAtTime(a.sfx, t, 0.05);
    this.buses.ui?.gain.setTargetAtTime(a.sfx * 0.8, t, 0.05);
    this.buses.music?.gain.setTargetAtTime(a.music * 0.5, t, 0.05);
    this.buses.ambient?.gain.setTargetAtTime(a.ambient, t, 0.05);
  }

  setListener(camera: THREE.Camera): void {
    this.listenerPos.x = camera.position.x;
    this.listenerPos.y = camera.position.y;
    this.listenerPos.z = camera.position.z;
    const ac = this.ac;
    if (!ac) return;
    const l = ac.listener;
    const e = camera.matrixWorld.elements;
    // forward = -Z column, up = Y column
    if (l.positionX) {
      const t = ac.currentTime;
      l.positionX.setTargetAtTime(camera.position.x, t, 0.02);
      l.positionY.setTargetAtTime(camera.position.y, t, 0.02);
      l.positionZ.setTargetAtTime(camera.position.z, t, 0.02);
      l.forwardX.setTargetAtTime(-e[8], t, 0.02);
      l.forwardY.setTargetAtTime(-e[9], t, 0.02);
      l.forwardZ.setTargetAtTime(-e[10], t, 0.02);
      l.upX.setTargetAtTime(e[4], t, 0.02);
      l.upY.setTargetAtTime(e[5], t, 0.02);
      l.upZ.setTargetAtTime(e[6], t, 0.02);
    }
  }

  private spatialOut(bus: Bus, position: Vec3Like | undefined, range: number): AudioNode | null {
    const ac = this.ac!;
    const busNode = this.buses[bus]!;
    if (!position) return busNode;
    const dx = position.x - this.listenerPos.x, dy = position.y - this.listenerPos.y, dz = position.z - this.listenerPos.z;
    if (dx * dx + dy * dy + dz * dz > range * range) return null;
    const p = ac.createPanner();
    p.panningModel = 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = 4;
    p.maxDistance = range;
    p.rolloffFactor = 1.2;
    if (p.positionX) {
      p.positionX.value = position.x;
      p.positionY.value = position.y;
      p.positionZ.value = position.z;
    }
    p.connect(busNode);
    return p;
  }

  /** Play a registered one-shot sound. Unknown ids are ignored. */
  play(id: string, opts: PlayOpts = {}): void {
    if (!this.ac || !this.noise || this.ac.state !== 'running') return;
    const r = recipes.get(id);
    if (!r) return;
    // Anti-spam: same id within 30 ms from the same rough position is dropped.
    const now = this.ac.currentTime;
    const key = id + (opts.position ? Math.round(opts.position.x) + ',' + Math.round(opts.position.z) : '');
    if ((this.lastPlay.get(key) ?? -1) > now - 0.03) return;
    this.lastPlay.set(key, now);
    if (this.lastPlay.size > 512) this.lastPlay.clear();
    const out = this.spatialOut(opts.bus ?? 'sfx', opts.position, opts.range ?? 90);
    if (!out) return;
    try {
      r(this.ac, out, now + 0.005, { pitch: (opts.pitch ?? 1) * (0.96 + Math.random() * 0.08), volume: opts.volume ?? 1, noise: this.noise });
    } catch (err) {
      console.warn(`[Audio] recipe ${id} failed`, err);
    }
  }

  /** Start a looping sound; returns a handle. Returns a no-op handle if audio is locked. */
  loop(id: string, opts: PlayOpts = {}): LoopHandle {
    const noop: LoopHandle = { setVolume() {}, setPosition() {}, setPitch() {}, stop() {} };
    if (!this.ac || !this.noise) return noop;
    const r = loopRecipes.get(id);
    if (!r) return noop;
    const ac = this.ac;
    const gain = ac.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(opts.volume ?? 1, ac.currentTime, 0.2);
    let panner: PannerNode | null = null;
    if (opts.position) {
      panner = ac.createPanner();
      panner.panningModel = 'equalpower';
      panner.refDistance = 5;
      panner.maxDistance = opts.range ?? 120;
      panner.rolloffFactor = 1.1;
      panner.connect(this.buses[opts.bus ?? 'sfx']!);
      gain.connect(panner);
      if (panner.positionX) {
        panner.positionX.value = opts.position.x;
        panner.positionY.value = opts.position.y;
        panner.positionZ.value = opts.position.z;
      }
    } else {
      gain.connect(this.buses[opts.bus ?? 'ambient']!);
    }
    const inst = r(ac, gain, { noise: this.noise });
    let stopped = false;
    return {
      setVolume: (v) => gain.gain.setTargetAtTime(v, ac.currentTime, 0.1),
      setPosition: (p) => {
        if (panner?.positionX) {
          panner.positionX.setTargetAtTime(p.x, ac.currentTime, 0.05);
          panner.positionY.setTargetAtTime(p.y, ac.currentTime, 0.05);
          panner.positionZ.setTargetAtTime(p.z, ac.currentTime, 0.05);
        }
      },
      setPitch: (p) => inst.setPitch?.(p),
      stop: (fade = 0.3) => {
        if (stopped) return;
        stopped = true;
        gain.gain.setTargetAtTime(0, ac.currentTime, fade / 3);
        inst.stop(ac.currentTime + fade + 0.1);
        setTimeout(() => {
          gain.disconnect();
          panner?.disconnect();
        }, (fade + 0.3) * 1000);
      },
    };
  }

  /** Region music theme ('water' | 'earth' | 'fire' | 'air' | 'menu' | 'battle' | ... or null to fade out). */
  setMusicTheme(theme: string | null): void {
    this.pendingTheme = theme;
    this.music?.setTheme(theme);
  }

  update(dt: number): void {
    this.music?.update(dt);
  }
}

/**
 * Small generative music player: pentatonic plucked melodies over a drone,
 * with per-theme scales/tempo/timbre. The audio module may replace it.
 */
export class MusicPlayer {
  private theme: string | null = null;
  private nextNote = 0;
  private drone: { osc: OscillatorNode[]; gain: GainNode } | null = null;
  private step = 0;
  private readonly out: GainNode;

  private static THEMES: Record<string, { root: number; scale: number[]; tempo: number; wave: OscillatorType; density: number }> = {
    menu: { root: 196, scale: [0, 2, 4, 7, 9, 12, 14], tempo: 0.55, wave: 'triangle', density: 0.7 },
    water: { root: 220, scale: [0, 3, 5, 7, 10, 12, 15], tempo: 0.6, wave: 'sine', density: 0.55 },
    earth: { root: 174.6, scale: [0, 2, 5, 7, 9, 12, 14], tempo: 0.5, wave: 'triangle', density: 0.6 },
    fire: { root: 196, scale: [0, 1, 5, 7, 8, 12, 13], tempo: 0.38, wave: 'sawtooth', density: 0.75 },
    air: { root: 261.6, scale: [0, 2, 4, 7, 9, 12, 16], tempo: 0.62, wave: 'sine', density: 0.5 },
    desert: { root: 185, scale: [0, 1, 4, 5, 7, 8, 11], tempo: 0.55, wave: 'triangle', density: 0.5 },
    swamp: { root: 146.8, scale: [0, 3, 5, 6, 7, 10, 12], tempo: 0.7, wave: 'sine', density: 0.4 },
    wild: { root: 196, scale: [0, 2, 4, 7, 9, 12], tempo: 0.65, wave: 'triangle', density: 0.45 },
    spirit: { root: 220, scale: [0, 4, 7, 11, 12, 14, 19], tempo: 0.8, wave: 'sine', density: 0.45 },
    battle: { root: 164.8, scale: [0, 3, 5, 7, 10, 12], tempo: 0.22, wave: 'square', density: 0.85 },
  };

  constructor(private readonly ac: AudioContext, bus: GainNode) {
    this.out = ac.createGain();
    this.out.gain.value = 0.8;
    this.out.connect(bus);
  }

  setTheme(theme: string | null): void {
    if (theme === this.theme) return;
    this.theme = theme;
    if (this.drone) {
      const d = this.drone;
      d.gain.gain.setTargetAtTime(0, this.ac.currentTime, 0.8);
      d.osc.forEach((o) => o.stop(this.ac.currentTime + 3));
      this.drone = null;
    }
    if (!theme) return;
    const th = MusicPlayer.THEMES[theme] ?? MusicPlayer.THEMES.wild;
    const gain = this.ac.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(0.05, this.ac.currentTime, 1.5);
    const lp = this.ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 600;
    lp.connect(gain).connect(this.out);
    const osc = [th.root / 2, th.root * 0.75].map((f) => {
      const o = this.ac.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = Math.random() * 8 - 4;
      o.connect(lp);
      o.start();
      return o;
    });
    this.drone = { osc, gain };
    this.nextNote = this.ac.currentTime + 0.5;
  }

  private pluck(freq: number, t: number, wave: OscillatorType, vol: number): void {
    const o = this.ac.createOscillator();
    o.type = wave;
    o.frequency.value = freq;
    const f = this.ac.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(freq * 6, t);
    f.frequency.exponentialRampToValueAtTime(freq * 1.2, t + 0.6);
    const g = envGain(this.ac, t, 0.004, 0.05, 1.1, vol);
    o.connect(f).connect(g).connect(this.out);
    o.start(t);
    o.stop(t + 1.3);
  }

  update(_dt: number): void {
    if (!this.theme) return;
    const th = MusicPlayer.THEMES[this.theme] ?? MusicPlayer.THEMES.wild;
    const now = this.ac.currentTime;
    while (this.nextNote < now + 0.2) {
      this.step++;
      if (Math.random() < th.density) {
        const deg = th.scale[Math.floor(Math.random() * th.scale.length)];
        const freq = th.root * Math.pow(2, deg / 12) * (this.step % 16 < 8 ? 1 : 2);
        this.pluck(freq, this.nextNote, th.wave, th.wave === 'sawtooth' || th.wave === 'square' ? 0.03 : 0.07);
        if (this.step % 8 === 0) this.pluck(th.root / 2, this.nextNote, 'sine', 0.08);
      }
      this.nextNote += th.tempo * (this.step % 4 === 3 ? 2 : 1);
    }
  }
}
