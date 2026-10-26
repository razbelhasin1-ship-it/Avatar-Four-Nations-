import { createReverb, makeResources, type AudioResources, type Reverb } from '../dsp';
import { INSTRUMENTS, type InstrumentId, type NoteCtx } from './instruments';
import { composePiece, degreeMidi, midiToHz, rngFrom, type MNote, type Piece, type Rng } from './theory';
import { themeFor, THEMES, type AccompPart, type PercMap, type ThemeDef } from './themes';
import { TrackPlayer } from './TrackPlayer';
import menuTrackUrl from './tracks/menu-theme.mp3?url';

/**
 * Generative music director (replaces the old MusicPlayer).
 *
 * A Performance plays one theme: it composes a piece (period-form sections A B
 * A' with cadences and dynamics, see theory.ts), schedules it on a 16th-note
 * grid with a look-ahead scheduler (sample-accurate WebAudio timing, no
 * catch-up bursts after stalls), layers accompaniment / bass / drone /
 * percussion / sparkles, then rests (a quiet moment) before composing the next
 * piece. Theme changes crossfade two performances. A combat layer (drums +
 * low-string ostinato in the current key) rises with combat intensity and
 * decays after combat. Stingers (discovery, quest, learning, mastery...) are
 * played in the current key on the beat grid while the bed ducks.
 *
 * Themes listed in TRACKS play a recorded track instead (the main menu theme), with
 * the generative theme of the same id as the fallback if the file cannot play.
 */

export type StingerKind = 'discovery' | 'questStart' | 'quest' | 'learn' | 'mastery' | 'levelup' | 'sphere' | 'defeat';

const LOOKAHEAD = 0.4;
const COMBAT_HOLD = 7;

/**
 * Recorded tracks by theme id: the file and its linear gain on the music bus. The menu
 * theme is mastered loud (-10 LUFS): -6 dB keeps its climaxes above the generative
 * themes without blasting, and its quiet intro still audible.
 */
const TRACKS: Record<string, { url: string; gain: number }> = {
  menu: { url: menuTrackUrl, gain: 0.5 },
};

class Performance {
  readonly out: GainNode;
  readonly bed: GainNode;
  readonly combat: GainNode;
  readonly stepDur: number;
  readonly beatDur: number;
  readonly stepsPerBar: number;
  nextTime: number;
  mode: 'play' | 'rest' | 'stopped' = 'play';
  pieces = 0;
  bar = 0;
  step = 0;
  sectionName = '';
  private piece!: Piece;
  private readonly rng: Rng;
  private restUntil = 0;
  private sectionIndex = -1;
  private sectionStart = 0;
  private stepNotes: MNote[][] = [];
  private prevLead = 0;
  private prevCounter = 0;
  private droneUntil = 0;

  constructor(
    readonly theme: ThemeDef,
    private readonly ac: BaseAudioContext,
    dest: AudioNode,
    hall: AudioNode,
    private readonly res: AudioResources,
    start: number,
    fadeIn: number,
    seed: number,
  ) {
    this.rng = rngFrom(seed);
    this.out = ac.createGain();
    this.out.gain.setValueAtTime(0, ac.currentTime);
    this.out.gain.linearRampToValueAtTime(theme.level, start + Math.max(0.05, fadeIn));
    this.out.connect(dest);
    const send = ac.createGain();
    send.gain.value = theme.reverb;
    this.out.connect(send).connect(hall);
    this.bed = ac.createGain();
    this.bed.connect(this.out);
    this.combat = ac.createGain();
    this.combat.gain.value = 0;
    this.combat.connect(this.out);
    this.beatDur = 60 / theme.bpm;
    this.stepDur = this.beatDur / 4;
    this.stepsPerBar = theme.beatsPerBar * 4;
    this.nextTime = start;
    this.startPiece(start);
  }

  private startPiece(t: number): void {
    const th = this.theme;
    this.piece = composePiece(this.rng, { scale: th.scale, beatsPerBar: th.beatsPerBar, style: th.style, form: th.form, harmony: th.harmony, signature: th.signature });
    this.mode = 'play';
    this.bar = 0;
    this.step = 0;
    this.sectionIndex = -1;
    this.pieces++;
    void t;
  }

  private nc(out: AudioNode, prev = 0): NoteCtx {
    return { ac: this.ac, out, res: this.res, prev };
  }

  private play(inst: InstrumentId, out: AudioNode, t: number, midi: number, dur: number, vel: number, prev = 0, orn?: MNote['orn']): number {
    const f = midiToHz(midi);
    try {
      INSTRUMENTS[inst](this.nc(out, prev), t, f, dur, Math.max(0, Math.min(1, vel)), orn);
    } catch (err) {
      console.warn('[Music] note failed', inst, err);
    }
    return f;
  }

  /** Nearest MIDI note in the theme's scale to `midi`. */
  private snap(midi: number): number {
    const th = this.theme;
    let best = midi;
    let bestD = Infinity;
    for (let d = -2; d <= 2; d++) {
      const m = midi + d;
      const pc = (((m - th.root) % 12) + 12) % 12;
      if (th.scale.includes(pc) && Math.abs(d) < bestD) {
        bestD = Math.abs(d);
        best = m;
      }
    }
    return best;
  }

  private chordTones(base: number, h: number): number[] {
    const r = base + h;
    return [r, r + 7, r + 12, this.snap(r + 16), this.snap(r + 14)];
  }

  private enterSection(i: number, t: number): void {
    const th = this.theme;
    this.sectionIndex = i;
    const sec = this.piece.sections[i];
    this.sectionName = sec.name;
    this.sectionStart = this.bar;
    const steps = sec.bars * this.stepsPerBar;
    this.stepNotes = Array.from({ length: steps }, () => [] as MNote[]);
    for (const n of sec.notes) {
      const k = Math.round(n.at * 4);
      if (k >= 0 && k < steps) this.stepNotes[k].push(n);
    }
    // Drone / bed for the section.
    if (th.drone) {
      const len = sec.bars * this.stepsPerBar * this.stepDur;
      for (const iv of th.drone.intervals) this.play(th.drone.inst, this.bed, t, th.root - 24 + iv, len + 1.5, th.drone.vel * (0.7 + 0.4 * sec.dyn));
      this.droneUntil = t + len;
    }
    if (sec.name.startsWith('B') && th.perc?.map.g) this.play('gong', this.bed, t, th.root - 24, 4, 0.45);
  }

  /** Schedule everything that starts on the current step at time t. */
  doStep(t: number, intensity: number, now: number): void {
    const th = this.theme;
    const sp = this.stepsPerBar;
    if (this.mode === 'rest') {
      if (t >= this.restUntil && this.step === 0) this.startPiece(t);
      else {
        if (th.drone?.rest && t >= this.droneUntil - 0.5) {
          const len = sp * this.stepDur * 4;
          for (const iv of th.drone.intervals) this.play(th.drone.inst, this.bed, t, th.root - 24 + iv, len + 1.5, th.drone.vel * 0.45);
          this.droneUntil = t + len;
        }
        this.combatStep(t, intensity, 0);
        return;
      }
    }
    if (this.mode !== 'play') return;
    const secIdx = this.piece.barSection[this.bar] ?? 0;
    if (secIdx !== this.sectionIndex) this.enterSection(secIdx, t);
    const sec = this.piece.sections[secIdx];
    const barInSec = this.bar - this.sectionStart;
    const stepInSec = barInSec * sp + this.step;
    const h = sec.harmony[barInSec % sec.harmony.length] ?? 0;
    const lift = 1 + 0.25 * intensity;
    // Lead (+ canon counter-melody in B sections).
    for (const n of this.stepNotes[stepInSec] ?? []) {
      const midi = degreeMidi(th.root + 12 * th.lead.oct, th.scale, n.deg);
      const hum = this.rng() * 0.012;
      const dur = n.dur * this.beatDur * 0.96;
      this.prevLead = this.play(th.lead.inst, this.bed, t + hum, midi, dur, n.vel * th.lead.vel * lift, this.prevLead, n.orn);
      if (th.counter && sec.name.startsWith('B') && n.dur >= 1 && this.rng() < 0.8) {
        const cm = degreeMidi(th.root + 12 * th.counter.oct, th.scale, n.deg - 2);
        this.prevCounter = this.play(th.counter.inst, this.bed, t + this.beatDur + hum, cm, dur * 0.9, n.vel * th.counter.vel, this.prevCounter);
      }
    }
    if (th.accomp) this.accomp(th.accomp, t, h, sec.dyn * lift);
    if (th.bass) this.accomp(th.bass, t, h, sec.dyn * lift);
    // Percussion.
    if (th.perc && sec.dyn >= (th.perc.minDyn ?? 0)) this.perc(th.perc.pattern, th.perc.map, this.bed, t, sec.dyn * lift);
    // Sparkles on beats.
    if (th.sparkle && this.step % 4 === 0 && this.rng() < th.sparkle.prob) {
      const deg = Math.floor(this.rng() * th.scale.length * 1.5);
      this.play(th.sparkle.inst, this.bed, t + this.rng() * 0.05, degreeMidi(th.root + 12 * th.sparkle.oct, th.scale, deg), 1.5, th.sparkle.vel);
    }
    this.combatStep(t, intensity, h);
    void now;
  }

  private perc(pattern: string, map: PercMap, out: AudioNode, t: number, dyn: number): void {
    if (!pattern.length) return;
    const ch = pattern[this.step % pattern.length];
    const hit = map[ch];
    if (!hit) return;
    this.play(hit[0], out, t, this.theme.root - 24, 0.5, hit[1] * Math.min(1, dyn + 0.2));
  }

  private accomp(p: AccompPart, t: number, h: number, dyn: number): void {
    const th = this.theme;
    const base = th.root + 12 * p.oct;
    const ct = this.chordTones(base, h);
    const s = this.step;
    const sp = this.stepsPerBar;
    const vel = p.vel * Math.min(1.1, 0.6 + 0.5 * dyn);
    switch (p.pattern) {
      case 'arp8':
        if (s % 2 === 0) {
          const seq = [0, 1, 2, 1, 3, 2, 1, 2];
          this.play(p.inst, this.bed, t, ct[seq[(s / 2) % seq.length]], this.stepDur * 3, vel * (s === 0 ? 1.1 : 0.85));
        }
        break;
      case 'arp16': {
        const seq = [0, 1, 2, 1, 0, 1, 3, 1];
        this.play(p.inst, this.bed, t, ct[seq[s % seq.length]], this.stepDur * 1.6, vel * (s % 4 === 0 ? 1 : 0.7));
        break;
      }
      case 'sparse':
        if ((s === 0 || (sp === 16 && s === 8)) && this.rng() < 0.65) this.play(p.inst, this.bed, t, ct[Math.floor(this.rng() * 4)], this.beatDur * 2, vel);
        break;
      case 'chord2':
        if (s === 0 && (this.bar - this.sectionStart) % 2 === 0) {
          const len = this.stepDur * sp * 2;
          for (const m of [ct[0], ct[1], ct[4]]) this.play(p.inst, this.bed, t, m, len, vel * 0.8);
        }
        break;
      case 'strum':
        if (s === 0 || s === 6) for (let i = 0; i < 3; i++) this.play(p.inst, this.bed, t + i * 0.028, ct[i], this.beatDur * 0.9, vel * (1 - i * 0.15));
        break;
      case 'pulse8':
        if (s % 2 === 0) this.play(p.inst, this.bed, t, ct[0], this.stepDur * 1.6, vel * (s === 0 ? 1 : 0.65));
        break;
      case 'root1':
        if (s === 0) this.play(p.inst, this.bed, t, ct[0], this.stepDur * sp * 0.95, vel);
        break;
      case 'root2':
        if (s === 0 || s === sp / 2) this.play(p.inst, this.bed, t, s === 0 ? ct[0] : ct[1] - 12, this.stepDur * sp * 0.48, vel);
        break;
    }
  }

  private combatStep(t: number, intensity: number, h: number): void {
    if (intensity < 0.04) return;
    const th = this.theme;
    this.perc(th.combat.pattern, th.combat.map, this.combat, t, 0.5 + 0.5 * intensity);
    if (intensity > 0.22 && this.step % 2 === 0) {
      const seq = [0, 0, 7, 0, 0, 0, 7, 12];
      const m = th.root - 12 + h + seq[(this.step / 2) % seq.length];
      this.play(th.combat.ostinato, this.combat, t, m, this.stepDur * 1.5, 0.55 + 0.4 * intensity);
    }
  }

  advance(): void {
    this.nextTime += this.stepDur;
    this.step++;
    if (this.step >= this.stepsPerBar) {
      this.step = 0;
      this.bar++;
      if (this.mode === 'play' && this.bar >= this.piece.totalBars) {
        // Quiet moment before the next piece.
        this.mode = 'rest';
        const [a, b] = this.theme.rest;
        this.restUntil = this.nextTime + a + this.rng() * (b - a);
        this.bar = 0;
      }
    }
  }

  /** Skip the remaining rest (combat started). */
  wake(): void {
    if (this.mode === 'rest') this.restUntil = 0;
  }

  get restRemaining(): number {
    return this.mode === 'rest' ? Math.max(0, this.restUntil - this.nextTime) : 0;
  }

  stop(now: number, fade: number): void {
    this.mode = 'stopped';
    const g = this.out.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + Math.max(0.05, fade));
  }

  dispose(): void {
    try {
      this.out.disconnect();
    } catch {
      /* ignore */
    }
  }
}

export interface MusicState {
  theme: string | null;
  playing: string | null;
  mode: string;
  section: string;
  bar: number;
  pieces: number;
  intensity: number;
  combatTarget: number;
  fading: number;
  attached: boolean;
  avatar: boolean;
  ducked: number;
  lastStinger: string | null;
  restRemaining: number;
  /** Recorded track (main menu) when one is playing instead of a generative theme. */
  track: ReturnType<TrackPlayer['state']> | null;
}

export class MusicDirector {
  private ac: BaseAudioContext | null = null;
  private master: GainNode | null = null;
  private duckGain: GainNode | null = null;
  private stingerOut: GainNode | null = null;
  private avatarGain: GainNode | null = null;
  private hall: Reverb | null = null;
  private res: AudioResources | null = null;
  /** Send into the music hall reverb (engine routes bus='music' sends here). */
  reverbInput: AudioNode | null = null;
  private current: Performance | null = null;
  private fading: Array<{ p: Performance; until: number }> = [];
  private requested: string | null = null;
  private seed = 1 + Math.floor(Math.random() * 1e6);
  /** Smoothed combat intensity 0..1. */
  intensity = 0;
  private target = 0;
  private clock = 0;
  private lastCombat = -1e9;
  private avatarOn = false;
  private avatarUntil = 0;
  private ducked = 1;
  private lastStinger: string | null = null;
  private tracks = new Map<string, TrackPlayer>();
  /** The recorded track currently playing (or fading in), if any. */
  private track: TrackPlayer | null = null;

  get theme(): string | null {
    return this.requested;
  }

  /** Player for a theme's recorded track (null: generative, or the track cannot play here). */
  private trackFor(id: string | null): TrackPlayer | null {
    const def = id ? TRACKS[id] : undefined;
    if (!id || !def || !TrackPlayer.supported(this.ac)) return null;
    let t = this.tracks.get(id);
    if (!t) {
      t = new TrackPlayer(id, def.url, def.gain, () => {
        // The file failed: play the generative theme instead if it is still wanted.
        if (this.track === t) this.track = null;
        if (this.requested === id && this.ac) this.switchTo(id, 1.5);
      });
      this.tracks.set(id, t);
    }
    return t.failed ? null : t;
  }

  attach(ac: BaseAudioContext, bus: AudioNode): void {
    // A rebuilt context (engine watchdog): the old performance's nodes died with the old one.
    this.current = null;
    this.fading = [];
    this.ac = ac;
    this.res = makeResources(ac);
    this.master = ac.createGain();
    this.master.gain.value = 0.95;
    this.duckGain = ac.createGain();
    this.duckGain.gain.value = 1;
    this.master.connect(this.duckGain).connect(bus);
    this.hall = createReverb(ac, { decay: 2.6, damping: 4200, mix: 0.55 }, 1.35);
    this.hall.output.connect(this.master);
    this.reverbInput = this.hall.input;
    this.stingerOut = ac.createGain();
    this.stingerOut.gain.value = 0.9;
    this.stingerOut.connect(this.master);
    const ss = ac.createGain();
    ss.gain.value = 0.45;
    this.stingerOut.connect(ss).connect(this.hall.input);
    this.avatarGain = ac.createGain();
    this.avatarGain.gain.value = 0;
    this.avatarGain.connect(this.master);
    if (this.requested) this.switchTo(this.requested, 0.5);
  }

  setTheme(id: string | null): void {
    if (id === this.requested) return;
    this.requested = id;
    // Start downloading a recorded track early (before the first tap unlocks audio).
    this.trackFor(id)?.prefetch();
    if (this.ac) this.switchTo(id, 2.5);
  }

  private switchTo(id: string | null, fadeIn: number): void {
    const ac = this.ac;
    if (!ac || !this.master || !this.hall || !this.res) return;
    const now = ac.currentTime;
    let start = now + 0.08;
    if (this.current) {
      // Crossfade: the old performance stops scheduling and fades while the new one rises.
      const cur = this.current;
      start = Math.max(start, Math.min(cur.nextTime, now + 0.6));
      cur.stop(now, 3.2);
      this.fading.push({ p: cur, until: now + 9 });
      this.current = null;
    }
    const track = this.trackFor(id);
    if (this.track && this.track !== track) this.track.stop(3.2);
    this.track = track;
    if (track) {
      track.play(ac as AudioContext, this.master, fadeIn);
      return;
    }
    if (!id) return;
    const th = themeFor(id);
    this.seed = (this.seed * 1103515245 + 12345) >>> 0;
    this.current = new Performance(th, ac, this.master, this.hall.input, this.res, start, fadeIn, this.seed);
    if (this.intensity > 0.3) this.current.wake();
  }

  /** Raise combat intensity (hits, damage). */
  pulseCombat(amount = 0.3): void {
    if (!Number.isFinite(amount)) return;
    this.target = Math.max(0, Math.min(1, this.target + amount));
    this.lastCombat = this.clock;
    if (this.target > 0.35) this.current?.wake();
  }

  /** Force a combat level (0..1). */
  setCombat(level: number): void {
    if (!Number.isFinite(level)) return;
    this.target = Math.max(0, Math.min(1, level));
    this.lastCombat = this.clock;
  }

  /** Long-lived duck (dialogue): 1 = normal. */
  setDucked(level: number): void {
    this.ducked = Math.max(0.1, Math.min(1, Number.isFinite(level) ? level : 1));
    if (this.ac && this.duckGain) this.duckGain.gain.setTargetAtTime(this.ducked, this.ac.currentTime, 0.4);
  }

  /** Avatar State: choir bed in the current key while active. */
  setAvatar(on: boolean): void {
    this.avatarOn = on;
    const ac = this.ac;
    if (!ac || !this.avatarGain) return;
    this.avatarGain.gain.setTargetAtTime(on ? 1 : 0, ac.currentTime, on ? 0.6 : 1.2);
    if (on) this.avatarUntil = 0;
  }

  private avatarBed(now: number): void {
    if (!this.avatarOn || !this.ac || !this.avatarGain || !this.res) return;
    if (now < this.avatarUntil - 1.5) return;
    const th = this.current?.theme ?? THEMES.spirit;
    const len = 12;
    const nc: NoteCtx = { ac: this.ac, out: this.avatarGain, res: this.res };
    for (const iv of [0, 7, 12, 16]) {
      const m = th.root - 12 + (iv === 16 ? this.snapScale(th, iv) : iv);
      INSTRUMENTS.choir(nc, Math.max(now, this.avatarUntil - 1.5), midiToHz(m), len, 0.7);
    }
    this.avatarUntil = Math.max(now, this.avatarUntil - 1.5) + len;
  }

  private snapScale(th: ThemeDef, semis: number): number {
    for (let d = 0; d <= 2; d++) {
      if (th.scale.includes((semis - d + 12) % 12)) return semis - d;
      if (th.scale.includes((semis + d) % 12)) return semis + d;
    }
    return semis;
  }

  /**
   * Play a stinger in the current key on the beat grid; the bed ducks under it.
   * Returns false when music cannot play (locked / no context) so callers can
   * fall back to a UI sound.
   */
  stinger(kind: StingerKind): boolean {
    const ac = this.ac;
    if (!ac || (ac as AudioContext).state !== 'running' || !this.stingerOut || !this.res) return false;
    const th = this.current?.theme ?? THEMES.menu;
    const now = ac.currentTime;
    let t0 = now + 0.05;
    const cur = this.current;
    if (cur && cur.mode !== 'stopped') {
      const g = cur.stepDur * 2;
      const back = Math.floor((cur.nextTime - t0) / g);
      t0 = cur.nextTime - back * g;
      if (t0 < now + 0.03) t0 += g;
    }
    const dur = this.scheduleStinger(kind, th, t0);
    if (cur) {
      const b = cur.bed.gain;
      b.cancelScheduledValues(now);
      b.setValueAtTime(b.value, now);
      b.linearRampToValueAtTime(0.3, t0 + 0.05);
      b.setValueAtTime(0.3, t0 + dur * 0.75);
      b.linearRampToValueAtTime(1, t0 + dur + 1.5);
    }
    this.lastStinger = kind;
    return true;
  }

  private scheduleStinger(kind: StingerKind, th: ThemeDef, t0: number): number {
    const ac = this.ac!;
    const out = this.stingerOut!;
    const nc: NoteCtx = { ac, out, res: this.res! };
    const n = th.scale.length;
    const deg = (d: number, oct = 0) => midiToHz(degreeMidi(th.root + 12 * oct, th.scale, d));
    const lead = INSTRUMENTS[th.lead.inst];
    const bellI = INSTRUMENTS.bell;
    const pl = INSTRUMENTS.guzheng;
    switch (kind) {
      case 'discovery': {
        [0, 2, 4, n].forEach((d, i) => bellI(nc, t0 + i * 0.12, deg(d, 1), 1.2, 0.75 - i * 0.05));
        INSTRUMENTS.chime(nc, t0 + 0.5, deg(n + 2, 1), 1.5, 0.5);
        INSTRUMENTS.pad(nc, t0, deg(0, 0), 1.8, 0.6);
        return 2.4;
      }
      case 'questStart': {
        bellI(nc, t0, deg(0, 1), 1, 0.7);
        bellI(nc, t0 + 0.22, deg(Math.min(4, n - 1), 1), 1.2, 0.7);
        INSTRUMENTS.taiko(nc, t0, 0, 0.5, 0.45);
        return 1.6;
      }
      case 'quest': {
        const run = [2 % n, 3 % n, 4 % n, n];
        run.forEach((d, i) => lead(nc, t0 + i * 0.17, deg(d, 1), i === run.length - 1 ? 1.3 : 0.18, 0.85));
        for (const d of [0, 2, 4]) bellI(nc, t0 + 0.51, deg(d, 1), 1.6, 0.55);
        INSTRUMENTS.taiko(nc, t0, 0, 0.5, 0.7);
        INSTRUMENTS.taiko(nc, t0 + 0.51, 0, 0.5, 0.9);
        INSTRUMENTS.pad(nc, t0 + 0.51, deg(0, -1), 2, 0.7);
        return 2.6;
      }
      case 'learn': {
        for (let i = 0; i <= 7; i++) pl(nc, t0 + i * 0.065, deg(i, 0), 0.4, 0.55 + i * 0.04);
        for (const d of [0, 2, 4]) bellI(nc, t0 + 0.55, deg(d, 1), 1.6, 0.5);
        INSTRUMENTS.chime(nc, t0 + 0.6, deg(n * 2, 1), 1.5, 0.45);
        return 2.3;
      }
      case 'mastery': {
        let t = t0;
        for (let i = 0; i < 9; i++) {
          INSTRUMENTS.taiko(nc, t, 0, 0.5, 0.45 + i * 0.06);
          t += Math.max(0.06, 0.2 - i * 0.018);
        }
        INSTRUMENTS.gong(nc, t, midiToHz(th.root - 24), 4, 0.9);
        const sig = th.signature ?? [0, 1, 2, 4];
        sig.forEach((d, i) => lead(nc, t + i * 0.32, deg(d, 1), i === sig.length - 1 ? 1.6 : 0.3, 0.9));
        for (const d of [0, 2, 4]) INSTRUMENTS.choir(nc, t, deg(d, 0), 2.8, 0.8);
        return t - t0 + 3.2;
      }
      case 'levelup': {
        for (let i = 0; i <= 10; i += 2) INSTRUMENTS.chime(nc, t0 + i * 0.03, deg(i, 1), 1, 0.55);
        bellI(nc, t0 + 0.32, deg(n, 1), 1.4, 0.6);
        return 1.9;
      }
      case 'sphere': {
        for (const iv of [0, 7, 12]) INSTRUMENTS.choir(nc, t0, midiToHz(th.root - 12 + iv), 3.6, 0.9);
        for (let i = 0; i < 8; i++) bellI(nc, t0 + 0.4 + i * 0.14, deg(n * 2 - i, 1), 1.4, 0.55);
        INSTRUMENTS.gong(nc, t0 + 0.2, midiToHz(th.root - 24), 4, 0.8);
        return 5;
      }
      case 'defeat': {
        [4, 3, 2, 1, 0].forEach((d, i) => lead(nc, t0 + i * 0.42, deg(d % n, 0), 0.5, 0.6));
        INSTRUMENTS.drone(nc, t0, deg(0, -2), 3, 0.6);
        return 3.2;
      }
    }
    return 1;
  }

  update(dt: number): void {
    this.clock += dt;
    // Combat intensity: hold after the last combat event, then decay.
    if (this.clock - this.lastCombat > COMBAT_HOLD) this.target = Math.max(0, this.target - dt * 0.12);
    const tau = this.target > this.intensity ? 0.7 : 2.8;
    this.intensity += (this.target - this.intensity) * (1 - Math.exp(-dt / tau));
    if (this.intensity < 0.003 && this.target === 0) this.intensity = 0;
    const ac = this.ac;
    if (!ac || (ac as AudioContext).state !== 'running') return;
    const now = ac.currentTime;
    const cur = this.current;
    if (cur) {
      cur.combat.gain.setTargetAtTime(Math.min(1, this.intensity * 1.1), now, 0.25);
      if (cur.nextTime < now - 0.25) {
        // Fell behind (tab hidden / long frame): resync without a burst of late notes.
        const steps = Math.ceil((now + 0.05 - cur.nextTime) / cur.stepDur);
        for (let i = 0; i < steps && i < 4096; i++) cur.advance();
      }
      let guard = 0;
      while (cur.nextTime < now + LOOKAHEAD && guard++ < 64) {
        cur.doStep(cur.nextTime, this.intensity, now);
        cur.advance();
      }
    }
    this.avatarBed(now);
    for (const t of this.tracks.values()) t.update();
    if (this.fading.length) {
      this.fading = this.fading.filter((f) => {
        if (now < f.until) return true;
        f.p.dispose();
        return false;
      });
    }
  }

  /** A theme's recorded track (null if the theme has none or it was never used). */
  trackState(id: string): ReturnType<TrackPlayer['state']> | null {
    return this.tracks.get(id)?.state() ?? null;
  }

  state(): MusicState {
    const c = this.current;
    const tr = this.track;
    return {
      theme: this.requested,
      playing: tr ? tr.id : c?.theme.id ?? null,
      mode: tr ? 'track' : c?.mode ?? 'off',
      track: tr?.state() ?? null,
      section: c?.sectionName ?? '',
      bar: c?.bar ?? 0,
      pieces: c?.pieces ?? 0,
      intensity: +this.intensity.toFixed(3),
      combatTarget: +this.target.toFixed(3),
      fading: this.fading.length,
      attached: !!this.ac,
      avatar: this.avatarOn,
      ducked: this.ducked,
      lastStinger: this.lastStinger,
      restRemaining: c ? +c.restRemaining.toFixed(2) : 0,
    };
  }
}
