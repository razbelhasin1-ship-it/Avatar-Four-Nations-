import type * as THREE from 'three';
import type { EventBus } from '../core/EventBus';
import type { SettingsManager } from '../core/Settings';
import type { Vec3Like } from '../core/types';
import { createReverb, makeResources, type AudioResources, type Reverb, type ReverbParams } from './dsp';
import { MusicDirector } from './music/MusicDirector';
import { getLoopRecipe, getSoundRecipe, soundMeta, soundTrim, type Bus } from './registry';
import './recipes';
import './trims';

// Public recipe API (unchanged import path for every module).
export * from './registry';
export { MusicDirector } from './music/MusicDirector';

/**
 * Procedural WebAudio engine. No audio files are required: every sound is a
 * "recipe" that builds a short node graph (noise, oscillators, filters,
 * envelopes, Karplus–Strong plucks, FM...). Modules register recipes with
 * registerSound()/registerLoop(); the shared library lives in src/audio/recipes
 * and is documented in src/audio/SOUNDS.md.
 *
 * Graph:
 *   voice → [air-absorption LP] → [panner] → bus(sfx|ambient) → duck → muffle ┐
 *   voice → bus(ui) → duck ────────────────────────────────────────────────────┼→ glue comp → master → limiter → out
 *   voice → send → sendFader(bus) → FDN reverb ─────────────────→ muffle ──────┘
 *   MusicDirector → bus(music) → duck ──────────────────────────────────────────→ master
 *
 * Voice management: global voice cap with priority stealing (click-free 40 ms
 * fade), per-id concurrency caps, per-id/per-spot cooldowns, distance culling,
 * NaN-safe options, and `suppress()` so event bindings can replace legacy direct
 * plays without doubling them.
 *
 * Browser autoplay rules: the AudioContext is created/resumed on the first user
 * gesture (unlock()), which Game wires to pointerdown/keydown (the engine also
 * listens for touchend/click). Everything is a safe no-op while locked.
 */

export interface PlayOpts {
  position?: Vec3Like;
  volume?: number;
  pitch?: number;
  bus?: Bus;
  /** Override max audible distance (m). */
  range?: number;
  /** Start delay (s). */
  delay?: number;
}

export interface LoopHandle {
  setVolume(v: number): void;
  setPosition(p: Vec3Like): void;
  setPitch(p: number): void;
  /** Named loop parameter (see SOUNDS.md for each loop's params). No-op if unsupported. */
  setParam(name: string, v: number): void;
  stop(fade?: number): void;
}

export interface SoundHandle {
  readonly id: string;
  /** Fade the voice out early (click-free). */
  stop(fade?: number): void;
}

export interface SuppressOpts {
  /** Valid for this many engine frames (default 1 = the rest of the current frame). */
  frames?: number;
  /** Valid for this many real seconds instead (async callers). */
  seconds?: number;
  /** Only suppress plays within `radius` metres of this point. */
  position?: Vec3Like;
  radius?: number;
}

export interface PlayLogEntry {
  id: string;
  t: number;
  bus: Bus;
  vol: number;
  x?: number;
  z?: number;
}

interface Voice {
  id: string;
  start: number;
  end: number;
  prio: number;
  gain: GainNode;
  send: GainNode;
  nodes: AudioNode[];
  stolen: boolean;
}

interface LoopRecord {
  id: string;
  gain: GainNode;
  stopped: boolean;
  generation: number;
}

interface Suppression {
  ids: Set<string>;
  untilFrame: number;
  untilMs: number;
  pos?: Vec3Like;
  r2: number;
}

const BUSES: readonly Bus[] = ['sfx', 'ui', 'music', 'ambient'];
const NOOP_LOOP: LoopHandle = { setVolume() {}, setPosition() {}, setPitch() {}, setParam() {}, stop() {} };
const fin = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const finite3 = (p: Vec3Like | undefined): p is Vec3Like => !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class AudioEngine {
  ac: AudioContext | null = null;
  unlocked = false;
  /** Generative music (exists before unlock so themes/intensity can be set any time). */
  readonly music = new MusicDirector();
  /** Listener (camera) position and forward, updated every frame. */
  readonly listenerPos = { x: 0, y: 0, z: 0 };
  readonly listenerFwd = { x: 0, y: 0, z: -1 };
  /** Max simultaneous one-shot voices (scaled down on the low graphics preset). */
  maxVoices = 40;
  /** Increments whenever a new AudioContext is built (old loop handles are dead). */
  generation = 0;
  /** Recently played one-shots (debug / tests). */
  readonly log: PlayLogEntry[] = [];
  readonly stats = { played: 0, dropped: 0, stolen: 0, suppressed: 0, culled: 0, errors: 0, unknown: new Set<string>() };
  private master: GainNode | null = null;
  private muffle: BiquadFilterNode | null = null;
  private buses: Partial<Record<Bus, GainNode>> = {};
  private ducks: Partial<Record<Bus, GainNode>> = {};
  private sendFaders: Partial<Record<Bus, GainNode>> = {};
  private envReverb: Reverb | null = null;
  private res: AudioResources | null = null;
  private lastPlay = new Map<string, number>();
  private voices: Voice[] = [];
  private loops = new Set<LoopRecord>();
  private suppressions: Suppression[] = [];
  private tickers: Array<(dt: number) => void> = [];
  private frameNo = 0;
  private muffled = false;
  private hiddenSuspend = false;

  constructor(private readonly settings: SettingsManager, events: EventBus) {
    events.on('settings:changed', () => this.applyVolumes());
    if (typeof window !== 'undefined') {
      const u = () => this.unlock();
      window.addEventListener('touchend', u, { capture: true, passive: true });
      window.addEventListener('click', u, { capture: true, passive: true });
    }
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => this.onVisibility());
  }

  /** True when sounds can actually be heard/scheduled. */
  get ready(): boolean {
    return !!this.ac && this.ac.state === 'running' && !!this.res;
  }

  /** Must be called from a user gesture. Safe to call repeatedly. */
  unlock(): void {
    try {
      if (!this.ac) {
        const AC: typeof AudioContext | undefined = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (!AC) return;
        this.build(new AC({ latencyHint: 'interactive' }));
      }
      const st = this.ac!.state as string;
      if (st === 'suspended' || st === 'interrupted') void this.ac!.resume().catch(() => {});
      this.unlocked = true;
    } catch (err) {
      console.warn('[Audio] unavailable', err);
    }
  }

  private build(ac: AudioContext): void {
    this.ac = ac;
    this.generation++;
    this.res = makeResources(ac);
    const limiter = ac.createDynamicsCompressor();
    limiter.threshold.value = -1.5;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.15;
    limiter.connect(ac.destination);
    const master = ac.createGain();
    master.gain.value = 0;
    master.connect(limiter);
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 10;
    comp.ratio.value = 3;
    comp.attack.value = 0.006;
    comp.release.value = 0.22;
    comp.connect(master);
    const muffle = ac.createBiquadFilter();
    muffle.type = 'lowpass';
    muffle.frequency.value = 20000;
    muffle.Q.value = 0.5;
    muffle.connect(comp);
    for (const b of BUSES) {
      const bus = ac.createGain();
      bus.gain.value = 0;
      const duck = ac.createGain();
      duck.gain.value = 1;
      bus.connect(duck);
      if (b === 'music') duck.connect(master);
      else if (b === 'ui') duck.connect(comp);
      else duck.connect(muffle);
      this.buses[b] = bus;
      this.ducks[b] = duck;
      const sf = ac.createGain();
      sf.gain.value = 0;
      this.sendFaders[b] = sf;
    }
    const rev = createReverb(ac, { decay: 1.3, damping: 5200, mix: 0.4 });
    this.sendFaders.sfx!.connect(rev.input);
    this.sendFaders.ui!.connect(rev.input);
    this.sendFaders.ambient!.connect(rev.input);
    rev.output.connect(muffle);
    this.envReverb = rev;
    this.master = master;
    this.muffle = muffle;
    this.music.attach(ac, this.buses.music!);
    this.sendFaders.music!.connect(this.music.reverbInput ?? this.buses.music!);
    this.applyVolumes();
    ac.onstatechange = () => {
      // iOS may interrupt the context (calls, other apps): the next gesture resumes it.
      if (this.ac === ac && (ac.state as string) === 'interrupted') this.unlocked = false;
    };
  }

  private onVisibility(): void {
    const ac = this.ac;
    if (!ac) return;
    if (document.hidden) {
      if (ac.state === 'running') {
        this.hiddenSuspend = true;
        void ac.suspend().catch(() => {});
      }
    } else if (this.hiddenSuspend) {
      this.hiddenSuspend = false;
      void ac.resume().catch(() => {});
    }
  }

  private applyVolumes(): void {
    if (!this.ac || !this.master) return;
    const a = this.settings.data.audio;
    const t = this.ac.currentTime;
    const v = (x: unknown) => Math.max(0, Math.min(1.5, fin(x, 0)));
    this.master.gain.setTargetAtTime(a.muted ? 0 : v(a.master), t, 0.05);
    const levels: Record<Bus, number> = { sfx: v(a.sfx), ui: v(a.sfx) * 0.8, music: v(a.music) * 0.6, ambient: v(a.ambient) };
    for (const b of BUSES) {
      this.buses[b]?.gain.setTargetAtTime(levels[b], t, 0.05);
      this.sendFaders[b]?.gain.setTargetAtTime(levels[b], t, 0.05);
    }
    // Fewer voices on the low preset (weak CPUs).
    this.maxVoices = this.settings.data.graphics.preset === 'low' ? 28 : 40;
  }

  /** Current effective level of a bus (0 when muted / locked). */
  busLevel(bus: Bus): number {
    const a = this.settings.data.audio;
    if (a.muted) return 0;
    const base = bus === 'ui' ? a.sfx * 0.8 : bus === 'music' ? a.music * 0.6 : bus === 'sfx' ? a.sfx : a.ambient;
    return Math.max(0, base * a.master);
  }

  setListener(camera: THREE.Camera): void {
    const p = camera.position;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) return;
    this.listenerPos.x = p.x;
    this.listenerPos.y = p.y;
    this.listenerPos.z = p.z;
    const e = camera.matrixWorld.elements;
    // forward = -Z column, up = Y column
    if (Number.isFinite(e[8]) && Number.isFinite(e[10])) {
      this.listenerFwd.x = -e[8];
      this.listenerFwd.y = -e[9];
      this.listenerFwd.z = -e[10];
    }
    const ac = this.ac;
    if (!ac) return;
    const l = ac.listener;
    if (l.positionX && Number.isFinite(e[4])) {
      const t = ac.currentTime;
      l.positionX.setTargetAtTime(p.x, t, 0.02);
      l.positionY.setTargetAtTime(p.y, t, 0.02);
      l.positionZ.setTargetAtTime(p.z, t, 0.02);
      l.forwardX.setTargetAtTime(-e[8], t, 0.02);
      l.forwardY.setTargetAtTime(-e[9], t, 0.02);
      l.forwardZ.setTargetAtTime(-e[10], t, 0.02);
      l.upX.setTargetAtTime(e[4], t, 0.02);
      l.upY.setTargetAtTime(e[5], t, 0.02);
      l.upZ.setTargetAtTime(e[6], t, 0.02);
    }
  }

  private distTo(p: Vec3Like): number {
    const dx = p.x - this.listenerPos.x, dy = p.y - this.listenerPos.y, dz = p.z - this.listenerPos.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  private makePanner(ac: AudioContext, p: Vec3Like, range: number, ref: number, rolloff: number): PannerNode {
    const pn = ac.createPanner();
    pn.panningModel = 'equalpower';
    pn.distanceModel = 'inverse';
    pn.refDistance = ref;
    pn.maxDistance = Math.max(ref + 1, range);
    pn.rolloffFactor = rolloff;
    if (pn.positionX) {
      pn.positionX.value = p.x;
      pn.positionY.value = p.y;
      pn.positionZ.value = p.z;
    } else (pn as any).setPosition?.(p.x, p.y, p.z);
    return pn;
  }

  // ---------------------------------------------------------------------------
  // Suppression (event bindings replacing legacy direct plays)
  // ---------------------------------------------------------------------------

  /**
   * Drop plays of `ids` for a short window. Used when an event binding plays a
   * richer replacement for a sound another module also plays directly (e.g.
   * per-surface footsteps replacing the generic 'footstep').
   */
  suppress(ids: string | readonly string[], o: SuppressOpts = {}): void {
    const list = typeof ids === 'string' ? [ids] : ids;
    const r = o.radius ?? 2.5;
    this.suppressions.push({
      ids: new Set(list),
      untilFrame: o.seconds !== undefined ? Infinity : this.frameNo + Math.max(1, o.frames ?? 1),
      untilMs: o.seconds !== undefined ? nowMs() + o.seconds * 1000 : Infinity,
      pos: finite3(o.position) ? { x: o.position.x, y: o.position.y, z: o.position.z } : undefined,
      r2: r * r,
    });
    if (this.suppressions.length > 64) this.suppressions.shift();
  }

  private isSuppressed(id: string, pos: Vec3Like | undefined): boolean {
    if (!this.suppressions.length) return false;
    const ms = nowMs();
    for (const s of this.suppressions) {
      if (s.untilFrame <= this.frameNo || s.untilMs <= ms) continue;
      if (!s.ids.has(id)) continue;
      if (s.pos && pos) {
        const dx = s.pos.x - pos.x, dy = s.pos.y - pos.y, dz = s.pos.z - pos.z;
        if (dx * dx + dy * dy + dz * dz > s.r2) continue;
      }
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // One-shots
  // ---------------------------------------------------------------------------

  /** Play a registered one-shot sound. Unknown ids are ignored. Returns a handle or null if not played. */
  play(id: string, opts: PlayOpts = {}): SoundHandle | null {
    const ac = this.ac;
    const res = this.res;
    if (!ac || !res || ac.state !== 'running') return null;
    const r = getSoundRecipe(id);
    if (!r) {
      this.stats.unknown.add(id);
      return null;
    }
    const meta = soundMeta(id);
    const volume = Math.max(0, Math.min(4, fin(opts.volume, 1)));
    if (volume < 0.002) return null;
    const pos = finite3(opts.position) ? opts.position : undefined;
    if (this.isSuppressed(id, pos)) {
      this.stats.suppressed++;
      return null;
    }
    const now = ac.currentTime;
    // Anti-spam: same id from the same rough spot within the cooldown is dropped.
    const key = pos ? `${id}@${Math.round(pos.x)},${Math.round(pos.z)}` : id;
    const cooldown = meta.cooldown ?? 0.03;
    if ((this.lastPlay.get(key) ?? -1e9) > now - cooldown) {
      this.stats.dropped++;
      return null;
    }
    const range = Math.max(1, fin(opts.range, meta.range ?? 90));
    const dist = pos ? this.distTo(pos) : 0;
    if (pos && dist > range) {
      this.stats.culled++;
      return null;
    }
    this.lastPlay.set(key, now);
    if (this.lastPlay.size > 512) this.lastPlay.clear();
    const bus: Bus = opts.bus ?? meta.bus ?? 'sfx';
    const prio = meta.priority ?? (bus === 'ui' ? 2 : 1);
    // Voice limiting.
    this.pruneVoices(now);
    const perId = meta.maxVoices ?? 6;
    let same = 0;
    let oldestSame: Voice | null = null;
    for (const v of this.voices) {
      if (v.stolen || v.id !== id) continue;
      same++;
      if (!oldestSame || v.start < oldestSame.start) oldestSame = v;
    }
    if (same >= perId && oldestSame) this.fadeVoice(oldestSame, now);
    let live = 0;
    for (const v of this.voices) if (!v.stolen) live++;
    if (live >= this.maxVoices) {
      let victim: Voice | null = null;
      for (const v of this.voices) {
        if (v.stolen) continue;
        if (!victim || v.prio < victim.prio || (v.prio === victim.prio && v.start < victim.start)) victim = v;
      }
      if (!victim || victim.prio > prio) {
        this.stats.dropped++;
        return null;
      }
      this.fadeVoice(victim, now);
    }
    // Build the voice chain.
    const busNode = this.buses[bus]!;
    const vg = ac.createGain();
    vg.gain.value = soundTrim(id);
    const nodes: AudioNode[] = [vg];
    let head: AudioNode = vg;
    if (pos) {
      if (dist > 22) {
        // Air absorption: distant sounds lose their highs.
        const lp = ac.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = Math.max(1400, 20000 * Math.exp(-(dist - 22) / 55));
        lp.Q.value = 0.5;
        vg.connect(lp);
        head = lp;
        nodes.push(lp);
      }
      const pn = this.makePanner(ac, pos, range, 4, 1.2);
      head.connect(pn);
      pn.connect(busNode);
      nodes.push(pn);
    } else head.connect(busNode);
    const sendNode = ac.createGain();
    // Reverb falls off more slowly than the direct sound (distant = wetter).
    sendNode.gain.value = pos ? Math.max(0.2, Math.min(1, Math.sqrt(4 / Math.max(4, dist)) * 1.4)) : 1;
    sendNode.connect(this.sendFaders[bus]!);
    nodes.push(sendNode);
    const auto = meta.reverb ?? (bus === 'ui' || bus === 'music' ? 0 : 0.12);
    if (auto > 0) {
      const ag = ac.createGain();
      ag.gain.value = auto;
      vg.connect(ag).connect(sendNode);
      nodes.push(ag);
    }
    const t = now + 0.005 + Math.max(0, Math.min(5, fin(opts.delay, 0)));
    const pitch = Math.max(0.05, Math.min(8, fin(opts.pitch, 1))) * (0.96 + Math.random() * 0.08);
    let dur = 0.5;
    try {
      dur = fin(r(ac, vg, t, { pitch, volume, noise: res.noise, white: res.white, brown: res.brown, reverb: sendNode, seed: Math.random() }), 0.5);
    } catch (err) {
      this.stats.errors++;
      console.warn(`[Audio] recipe ${id} failed`, err);
      for (const n of nodes) n.disconnect();
      return null;
    }
    // Keep the voice alive for the longer of the returned and declared durations (no cut-off tails).
    const life = Math.max(0.05, dur, fin(meta.duration, 0));
    const voice: Voice = { id, start: t, end: t + life + 0.3, prio, gain: vg, send: sendNode, nodes, stolen: false };
    this.voices.push(voice);
    this.stats.played++;
    this.log.push({ id, t: now, bus, vol: volume, x: pos?.x, z: pos?.z });
    if (this.log.length > 200) this.log.splice(0, this.log.length - 200);
    return { id, stop: (fade = 0.08) => this.fadeVoice(voice, ac.currentTime, fade) };
  }

  private fadeVoice(v: Voice, now: number, fade = 0.04): void {
    if (v.stolen) return;
    v.stolen = true;
    this.stats.stolen++;
    for (const g of [v.gain.gain, v.send.gain]) {
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(0, now + Math.max(0.01, fade));
    }
    v.end = Math.min(v.end, now + fade + 0.06);
  }

  private pruneVoices(now: number): void {
    if (!this.voices.length) return;
    let w = 0;
    for (const v of this.voices) {
      if (v.end < now) {
        for (const n of v.nodes) {
          try {
            n.disconnect();
          } catch {
            /* already disconnected */
          }
        }
      } else this.voices[w++] = v;
    }
    this.voices.length = w;
  }

  // ---------------------------------------------------------------------------
  // Loops
  // ---------------------------------------------------------------------------

  /** Start a looping sound; returns a handle. Returns a no-op handle if audio is locked. */
  loop(id: string, opts: PlayOpts = {}): LoopHandle {
    const ac = this.ac;
    const res = this.res;
    if (!ac || !res) return NOOP_LOOP;
    const r = getLoopRecipe(id);
    if (!r) {
      this.stats.unknown.add('loop:' + id);
      return NOOP_LOOP;
    }
    const pos = finite3(opts.position) ? opts.position : undefined;
    const bus: Bus = opts.bus ?? (pos ? 'sfx' : 'ambient');
    const trim = soundTrim(id);
    const gainNode = ac.createGain();
    gainNode.gain.value = 0;
    gainNode.gain.setTargetAtTime(Math.max(0, Math.min(4, fin(opts.volume, 1))) * trim, ac.currentTime, 0.2);
    let panner: PannerNode | null = null;
    if (pos) {
      panner = this.makePanner(ac, pos, Math.max(2, fin(opts.range, 120)), 5, 1.1);
      gainNode.connect(panner);
      panner.connect(this.buses[bus]!);
    } else gainNode.connect(this.buses[bus]!);
    const sendNode = ac.createGain();
    sendNode.gain.value = pos ? 0.6 : 0.35;
    sendNode.connect(this.sendFaders[bus]!);
    if (pos) {
      const ag = ac.createGain();
      ag.gain.value = 0.1;
      gainNode.connect(ag).connect(sendNode);
    }
    let inst: ReturnType<typeof r>;
    try {
      inst = r(ac, gainNode, { noise: res.noise, white: res.white, brown: res.brown, reverb: sendNode });
    } catch (err) {
      this.stats.errors++;
      console.warn(`[Audio] loop ${id} failed`, err);
      gainNode.disconnect();
      panner?.disconnect();
      sendNode.disconnect();
      return NOOP_LOOP;
    }
    const rec: LoopRecord = { id, gain: gainNode, stopped: false, generation: this.generation };
    this.loops.add(rec);
    const live = () => !rec.stopped && this.ac === ac;
    return {
      setVolume: (v) => {
        if (live()) gainNode.gain.setTargetAtTime(Math.max(0, Math.min(4, fin(v, 0))) * trim, ac.currentTime, 0.1);
      },
      setPosition: (p) => {
        if (!live() || !panner?.positionX || !finite3(p)) return;
        panner.positionX.setTargetAtTime(p.x, ac.currentTime, 0.05);
        panner.positionY.setTargetAtTime(p.y, ac.currentTime, 0.05);
        panner.positionZ.setTargetAtTime(p.z, ac.currentTime, 0.05);
      },
      setPitch: (p) => {
        if (!live()) return;
        try {
          inst.setPitch?.(Math.max(0.05, Math.min(8, fin(p, 1))));
        } catch {
          /* ignore */
        }
      },
      setParam: (name, v) => {
        if (!live() || !Number.isFinite(v)) return;
        try {
          inst.setParam?.(name, v);
        } catch {
          /* ignore */
        }
      },
      stop: (fade = 0.3) => {
        if (rec.stopped) return;
        rec.stopped = true;
        this.loops.delete(rec);
        const f = Math.max(0.02, fin(fade, 0.3));
        gainNode.gain.cancelScheduledValues(ac.currentTime);
        gainNode.gain.setTargetAtTime(0, ac.currentTime, f / 3);
        try {
          inst.stop(ac.currentTime + f + 0.1);
        } catch {
          /* sources already stopped */
        }
        setTimeout(() => {
          gainNode.disconnect();
          panner?.disconnect();
          sendNode.disconnect();
        }, (f + 0.4) * 1000);
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Mix controls
  // ---------------------------------------------------------------------------

  /** Temporarily lower a bus (dialogue, stingers). amount = target gain 0..1. */
  duck(bus: Bus, amount: number, attack = 0.15, hold = 0.5, release = 0.8): void {
    const ac = this.ac;
    const d = this.ducks[bus];
    if (!ac || !d) return;
    const now = ac.currentTime;
    const g = d.gain;
    const a = Math.max(0, Math.min(1, fin(amount, 1)));
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(a, now + Math.max(0.01, attack));
    g.setValueAtTime(a, now + Math.max(0.01, attack) + Math.max(0, hold));
    g.linearRampToValueAtTime(1, now + Math.max(0.01, attack) + Math.max(0, hold) + Math.max(0.01, release));
  }

  /** Muffle the world (pause menu): low-pass sfx + ambience; UI and music stay clear. */
  setMuffled(on: boolean): void {
    this.muffled = on;
    const ac = this.ac;
    if (!ac || !this.muffle) return;
    this.muffle.frequency.setTargetAtTime(on ? 650 : 20000, ac.currentTime, on ? 0.08 : 0.15);
  }

  /** Environment reverb (set by the ambience director from the surroundings). */
  setEnvironment(p: Partial<ReverbParams>): void {
    this.envReverb?.set(p);
  }

  get environment(): ReverbParams | null {
    return this.envReverb ? { ...this.envReverb.params } : null;
  }

  /** Register a per-frame callback (runs in every game mode, also before unlock). Returns a remover. */
  addTicker(fn: (dt: number) => void): () => void {
    this.tickers.push(fn);
    return () => {
      const i = this.tickers.indexOf(fn);
      if (i >= 0) this.tickers.splice(i, 1);
    };
  }

  /** Region music theme ('water' | 'earth' | 'fire' | 'air' | 'menu' | 'battle' | ... or null to fade out). */
  setMusicTheme(theme: string | null): void {
    this.music.setTheme(theme);
  }

  update(dt: number): void {
    this.frameNo++;
    const step = Math.max(0, Math.min(0.25, fin(dt, 0)));
    if (this.ac) this.pruneVoices(this.ac.currentTime);
    try {
      this.music.update(step);
    } catch (err) {
      this.stats.errors++;
      console.warn('[Audio] music update failed', err);
    }
    for (let i = 0; i < this.tickers.length; i++) {
      try {
        this.tickers[i](step);
      } catch (err) {
        this.stats.errors++;
        console.warn('[Audio] ticker failed', err);
      }
    }
    if (this.suppressions.length) {
      const ms = nowMs();
      this.suppressions = this.suppressions.filter((s) => s.untilFrame > this.frameNo && s.untilMs > ms);
    }
  }

  /** Snapshot for debug/tests. */
  debugState(): Record<string, unknown> {
    const ac = this.ac;
    const voiceIds: Record<string, number> = {};
    for (const v of this.voices) if (!v.stolen) voiceIds[v.id] = (voiceIds[v.id] ?? 0) + 1;
    const buses: Record<string, number> = {};
    for (const b of BUSES) buses[b] = this.buses[b]?.gain.value ?? 0;
    return {
      ready: this.ready,
      state: ac?.state ?? 'locked',
      unlocked: this.unlocked,
      generation: this.generation,
      sampleRate: ac?.sampleRate ?? 0,
      time: ac?.currentTime ?? 0,
      voices: this.voices.filter((v) => !v.stolen).length,
      maxVoices: this.maxVoices,
      voiceIds,
      loops: [...this.loops].map((l) => l.id),
      buses,
      master: this.master?.gain.value ?? 0,
      settings: { ...this.settings.data.audio },
      muffled: this.muffled,
      environment: this.environment,
      stats: { ...this.stats, unknown: [...this.stats.unknown] },
    };
  }
}
