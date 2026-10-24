import { INSTRUMENTS, type NoteCtx } from '../music/instruments';
import { aliasSound, registerSound, type RecipeOpts, type SoundMeta } from '../registry';
import { bell, droplet, filt, glide, midiHz, noise, noiseHit, osc, perc, ping, pluck, swell, thump, type AC } from '../synth';
import { whoosh } from './elements';

/**
 * UI sounds share the music palette (plucked zither, temple bells, bamboo
 * clicks, taiko) in D major pentatonic, so menus feel part of the world.
 * opts.pitch transposes (the music director uses that to play fanfares in key).
 */

const UI: SoundMeta = { bus: 'ui', priority: 3, maxVoices: 4, cooldown: 0.03 };
const nc = (ac: AC, out: AudioNode, o: RecipeOpts): NoteCtx => ({ ac, out, res: { noise: o.noise, white: o.white, brown: o.brown } });
const hz = (midi: number, o: RecipeOpts) => midiHz(midi) * o.pitch;

function kpluck(ac: AC, out: AudioNode, o: RecipeOpts, t: number, midi: number, vol: number, decay = 1.1, bright = 0.75): void {
  pluck(ac, out, t, hz(midi, o), { decay, bright, vol: vol * o.volume, pick: 0.12 });
}

function softBell(ac: AC, out: AudioNode, o: RecipeOpts, t: number, midi: number, vol: number, decay = 1.2): void {
  // FM temple bell at a UI-appropriate level (the music instrument's velocity curve made these ~20 dB too quiet).
  bell(ac, out, t, hz(midi, o), Math.max(0.6, Math.min(3.2, decay)), 0.5 * vol * o.volume, 3.5, 2.0);
}

/**
 * Real ring-out (s) of recipes whose bells/gongs outlast their musical length,
 * measured offline (debug.audio.verifyAll, -60 dB re peak) plus margin. The
 * engine keeps voices alive for this long, so tails are never cut (no clicks).
 */
const TAIL: Record<string, number> = {
  'ui.confirm': 1.8,
  'ui.open': 1.3,
  'ui.notify': 2.75,
  'ui.notify.info': 2.75,
  'ui.notify.success': 2.4,
  'ui.notify.warning': 2.1,
  'ui.notify.learn': 2.7,
  'ui.notify.quest': 2.3,
  'ui.notify.avatar': 4.5,
  'ui.quest.start': 2.9,
  'ui.quest.complete': 3.4,
  'ui.technique.learned': 3.75,
  'ui.mastery': 5.15,
  'ui.discovery': 3.05,
  'ui.levelup': 3.2,
  'ui.sphere.unlocked': 4.7,
  'ui.save': 2.3,
  'ui.pickup': 1.6,
  'ui.element.water': 2.2,
};

function reg(id: string, dur: number, fn: (ac: AC, out: AudioNode, t: number, o: RecipeOpts) => void, desc: string, extra: SoundMeta = {}): void {
  const total = Math.max(dur + 0.35, TAIL[id] ?? 0);
  registerSound(
    id,
    (ac, out, t, o) => {
      fn(ac, out, t, o);
      return total;
    },
    { ...UI, duration: total, desc, ...extra },
  );
}

reg(
  'ui.hover',
  0.05,
  (ac, out, t, o) => {
    ping(ac, out, t, 2400 * o.pitch, 0.02, 0.05 * o.volume, 'triangle');
    noiseHit(ac, out, o.white, t, 'bandpass', 5000 * o.pitch, 1.5, 0.0008, 0.006, 0.025 * o.volume);
  },
  'pointer enters a button (tiny bamboo tick)',
  { cooldown: 0.05, maxVoices: 2, priority: 1 },
);

reg(
  'ui.click',
  0.08,
  (ac, out, t, o) => {
    ping(ac, out, t, 1050 * o.pitch, 0.045, 0.2 * o.volume, 'triangle');
    ping(ac, out, t, 2100 * o.pitch, 0.02, 0.05 * o.volume);
    noiseHit(ac, out, o.white, t, 'bandpass', 2600 * o.pitch, 1.5, 0.0008, 0.008, 0.1 * o.volume);
  },
  'button press (wood block click)',
);
aliasSound('ui_click', 'ui.click');

reg(
  'ui.confirm',
  0.5,
  (ac, out, t, o) => {
    kpluck(ac, out, o, t, 74, 0.32, 0.9);
    kpluck(ac, out, o, t + 0.07, 81, 0.32, 1.0);
    softBell(ac, out, o, t + 0.07, 93, 0.25, 1.6);
  },
  'confirm / accept (rising D→A pluck)',
);
aliasSound('ui_confirm', 'ui.confirm');

reg(
  'ui.back',
  0.4,
  (ac, out, t, o) => {
    kpluck(ac, out, o, t, 69, 0.26, 0.8, 0.6);
    kpluck(ac, out, o, t + 0.07, 62, 0.26, 0.9, 0.6);
  },
  'back / cancel (falling A→D pluck)',
);
aliasSound('ui_back', 'ui.back');

reg(
  'ui.tab',
  0.12,
  (ac, out, t, o) => {
    const src = noise(ac, o.white, t, 0.1);
    const f = filt(ac, 'bandpass', 3000 * o.pitch, 0.8);
    const g = swell(ac, t, 0.025, 0, 0.05, 0.08 * o.volume);
    src.connect(f).connect(g).connect(out);
    ping(ac, out, t + 0.02, 1600 * o.pitch, 0.02, 0.08 * o.volume, 'triangle');
  },
  'tab switch (paper flick + tick)',
);

reg(
  'ui.open',
  0.6,
  (ac, out, t, o) => {
    whoosh(ac, out, o, t, 500 * o.pitch, 1800 * o.pitch, 1400 * o.pitch, 0.25, 0.07 * o.volume, 0.9);
    kpluck(ac, out, o, t + 0.04, 62, 0.22, 1.0, 0.55);
    softBell(ac, out, o, t + 0.1, 86, 0.12, 1.4);
  },
  'menu / screen opens (scroll unrolls)',
);

reg(
  'ui.close',
  0.45,
  (ac, out, t, o) => {
    whoosh(ac, out, o, t, 1800 * o.pitch, 900 * o.pitch, 500 * o.pitch, 0.22, 0.07 * o.volume, 0.9);
    kpluck(ac, out, o, t + 0.03, 57, 0.18, 0.8, 0.5);
  },
  'menu / screen closes',
);

reg(
  'ui.toggle',
  0.12,
  (ac, out, t, o) => {
    ping(ac, out, t, 1300 * o.pitch, 0.03, 0.12 * o.volume, 'triangle');
    ping(ac, out, t + 0.05, 1700 * o.pitch, 0.03, 0.1 * o.volume, 'triangle');
  },
  'checkbox / toggle (tick-tock)',
);

reg(
  'ui.slider',
  0.04,
  (ac, out, t, o) => ping(ac, out, t, 1500 * o.pitch, 0.02, 0.07 * o.volume, 'triangle'),
  'slider step (pitch follows value)',
  { cooldown: 0.04, maxVoices: 2 },
);

reg(
  'ui.error',
  0.3,
  (ac, out, t, o) => {
    ping(ac, out, t, 220 * o.pitch, 0.07, 0.16 * o.volume, 'triangle');
    ping(ac, out, t + 0.1, 185 * o.pitch, 0.08, 0.14 * o.volume, 'triangle');
    const b = osc(ac, 'square', 110 * o.pitch, t, 0.2);
    const lp = filt(ac, 'lowpass', 600, 0.7);
    const g = perc(ac, t, 0.005, 0.15, 0.035 * o.volume);
    b.connect(lp).connect(g).connect(out);
  },
  'error / not allowed (low double knock)',
);
aliasSound('ui.notify.error', 'ui.error');

reg(
  'ui.notify',
  0.9,
  (ac, out, t, o) => {
    softBell(ac, out, o, t, 79, 0.2, 2.2);
    softBell(ac, out, o, t + 0.09, 86, 0.18, 2.4);
  },
  'generic notification (two soft bells)',
);
aliasSound('notify', 'ui.notify');

reg('ui.notify.info', 0.7, (ac, out, t, o) => softBell(ac, out, o, t, 81, 0.18, 2.2), 'info toast (single soft bell)');

reg(
  'ui.notify.success',
  0.8,
  (ac, out, t, o) => {
    kpluck(ac, out, o, t, 74, 0.24);
    kpluck(ac, out, o, t + 0.06, 78, 0.24);
    kpluck(ac, out, o, t + 0.12, 81, 0.26);
    softBell(ac, out, o, t + 0.12, 86, 0.14, 2.2);
  },
  'success toast (rising pluck triad)',
);

reg(
  'ui.notify.warning',
  0.7,
  (ac, out, t, o) => {
    kpluck(ac, out, o, t, 57, 0.28, 0.6, 0.5);
    kpluck(ac, out, o, t + 0.11, 57, 0.24, 0.6, 0.5);
    softBell(ac, out, o, t + 0.11, 77, 0.12, 2);
  },
  'warning toast (low double pluck + tense bell)',
);

reg(
  'ui.notify.learn',
  0.9,
  (ac, out, t, o) => {
    [74, 76, 81].forEach((m, i) => kpluck(ac, out, o, t + i * 0.06, m, 0.24));
    softBell(ac, out, o, t + 0.18, 86, 0.16, 2.4);
  },
  'learning toast (short flourish)',
);

reg(
  'ui.notify.quest',
  0.8,
  (ac, out, t, o) => {
    softBell(ac, out, o, t, 74, 0.2, 2.2);
    kpluck(ac, out, o, t + 0.12, 81, 0.24);
  },
  'quest toast (bell + pluck)',
);

reg(
  'ui.notify.avatar',
  1.2,
  (ac, out, t, o) => {
    INSTRUMENTS.gong(nc(ac, out, o), t, 92 * o.pitch, 1, 0.55 * o.volume);
    softBell(ac, out, o, t + 0.05, 81, 0.14, 2.4);
  },
  'Avatar-related toast (gong + bell)',
);

reg(
  'ui.quest.start',
  1.2,
  (ac, out, t, o) => {
    softBell(ac, out, o, t, 74, 0.24, 2.4);
    softBell(ac, out, o, t + 0.2, 81, 0.24, 2.6);
    INSTRUMENTS.taiko(nc(ac, out, o), t, 0, 0.5, 0.42 * o.volume);
  },
  'new quest accepted',
);

reg(
  'ui.quest.update',
  0.6,
  (ac, out, t, o) => {
    kpluck(ac, out, o, t, 76, 0.22);
    kpluck(ac, out, o, t + 0.09, 81, 0.22);
  },
  'quest objective updated',
);

reg(
  'ui.quest.complete',
  2.2,
  (ac, out, t, o) => {
    [62, 66, 69, 74].forEach((m, i) => kpluck(ac, out, o, t + i * 0.09, m, 0.3, 1.4));
    const tc = t + 0.4;
    for (const m of [74, 78, 81]) softBell(ac, out, o, tc, m, 0.16, 3);
    INSTRUMENTS.taiko(nc(ac, out, o), t, 0, 0.5, 0.5 * o.volume);
    INSTRUMENTS.taiko(nc(ac, out, o), tc, 0, 0.5, 0.65 * o.volume);
    INSTRUMENTS.chime(nc(ac, out, o), tc + 0.15, hz(98, o), 1, 0.4 * o.volume);
  },
  'quest complete fanfare',
  { priority: 3 },
);

reg(
  'ui.technique.learned',
  2.0,
  (ac, out, t, o) => {
    [62, 64, 66, 69, 71, 74, 76, 78].forEach((m, i) => kpluck(ac, out, o, t + i * 0.06, m, 0.2 + i * 0.015, 0.9));
    const tc = t + 0.5;
    for (const m of [74, 78, 81]) softBell(ac, out, o, tc, m, 0.15, 3);
    INSTRUMENTS.chime(nc(ac, out, o), tc + 0.1, hz(98, o), 1, 0.35 * o.volume);
  },
  'technique learned fanfare (rising run + bell chord)',
);

reg(
  'ui.mastery',
  3.4,
  (ac, out, t, o) => {
    const c = nc(ac, out, o);
    let tt = t;
    for (let i = 0; i < 8; i++) {
      INSTRUMENTS.taiko(c, tt, 0, 0.5, (0.35 + i * 0.07) * o.volume);
      tt += Math.max(0.06, 0.19 - i * 0.018);
    }
    INSTRUMENTS.gong(c, tt, 73 * o.pitch, 3, 0.8 * o.volume);
    for (const m of [62, 69, 74, 78]) softBell(ac, out, o, tt, m + 12, 0.14, 3.2);
    INSTRUMENTS.drone(c, tt, hz(50, o), 1.6, 0.7 * o.volume);
  },
  'element mastered fanfare (taiko roll, gong, bells)',
);

reg(
  'ui.discovery',
  1.8,
  (ac, out, t, o) => {
    [74, 78, 81, 86].forEach((m, i) => softBell(ac, out, o, t + i * 0.11, m, 0.17, 2.6));
    INSTRUMENTS.chime(nc(ac, out, o), t + 0.45, hz(100, o), 1, 0.35 * o.volume);
  },
  'location discovered chime',
);
aliasSound('ui.notify.discovery', 'ui.discovery');

reg(
  'ui.levelup',
  1.6,
  (ac, out, t, o) => {
    [74, 78, 81, 86, 90, 93].forEach((m, i) => INSTRUMENTS.chime(nc(ac, out, o), t + i * 0.06, hz(m, o), 1, 0.4 * o.volume));
    softBell(ac, out, o, t + 0.36, 86, 0.2, 2.6);
  },
  'level up (bright rising chimes)',
);

reg(
  'ui.sphere.unlocked',
  3.8,
  (ac, out, t, o) => {
    const c = nc(ac, out, o);
    for (const m of [50, 57, 62, 66]) INSTRUMENTS.choir(c, t, hz(m, o), 3, 0.85 * o.volume);
    for (let i = 0; i < 8; i++) softBell(ac, out, o, t + 0.4 + i * 0.13, 93 - [0, 2, 5, 7, 9, 12, 14, 17][i], 0.13, 2.6);
    INSTRUMENTS.gong(c, t + 0.2, 73 * o.pitch, 3, 0.7 * o.volume);
  },
  'Elements Sphere unlocked (choir, cascading bells, gong)',
);

reg(
  'ui.save',
  0.6,
  (ac, out, t, o) => {
    whoosh(ac, out, o, t, 1500 * o.pitch, 2600 * o.pitch, 1200 * o.pitch, 0.18, 0.06 * o.volume, 0.8);
    ping(ac, out, t + 0.16, 700 * o.pitch, 0.06, 0.16 * o.volume, 'triangle');
    softBell(ac, out, o, t + 0.18, 86, 0.1, 2);
  },
  'game saved (brush stroke + seal knock)',
);

reg(
  'ui.pickup',
  0.35,
  (ac, out, t, o) => {
    kpluck(ac, out, o, t, 81, 0.22, 0.6);
    INSTRUMENTS.chime(nc(ac, out, o), t + 0.03, hz(105, o), 1, 0.2 * o.volume);
  },
  'item picked up',
);

reg(
  'ui.coins',
  0.45,
  (ac, out, t, o) => {
    for (let i = 0; i < 3; i++) {
      const tt = t + i * 0.07 + Math.random() * 0.02;
      for (const f of [2400, 3130, 4470]) ping(ac, out, tt, f * o.pitch * (0.97 + Math.random() * 0.06), 0.12, 0.05 * o.volume);
    }
  },
  'coins / currency gained (metal clinks)',
);

reg(
  'ui.interact',
  0.3,
  (ac, out, t, o) => kpluck(ac, out, o, t, 76, 0.18, 0.7),
  'interaction prompt used (soft pluck)',
);

reg(
  'ui.page',
  0.3,
  (ac, out, t, o) => {
    const src = noise(ac, o.white, t, 0.28);
    const f = filt(ac, 'bandpass', 1800 * o.pitch, 0.7);
    f.frequency.exponentialRampToValueAtTime(4200 * o.pitch, t + 0.22);
    const g = swell(ac, t, 0.08, 0.04, 0.14, 0.08 * o.volume);
    src.connect(f).connect(g).connect(out);
  },
  'page turn (journal, map, scrolls)',
);

reg(
  'ui.dialogue.open',
  0.45,
  (ac, out, t, o) => {
    whoosh(ac, out, o, t, 700 * o.pitch, 1600 * o.pitch, 1200 * o.pitch, 0.2, 0.05 * o.volume, 0.8);
    kpluck(ac, out, o, t + 0.04, 69, 0.16, 0.8, 0.55);
  },
  'conversation starts',
);

reg(
  'ui.dialogue.next',
  0.12,
  (ac, out, t, o) => {
    ping(ac, out, t, 1250 * o.pitch, 0.03, 0.08 * o.volume, 'triangle');
    noiseHit(ac, out, o.white, t, 'bandpass', 3500 * o.pitch, 1, 0.001, 0.02, 0.03 * o.volume);
  },
  'dialogue advances (soft tick)',
);

reg(
  'ui.dialogue.close',
  0.35,
  (ac, out, t, o) => {
    whoosh(ac, out, o, t, 1500 * o.pitch, 800 * o.pitch, 500 * o.pitch, 0.2, 0.05 * o.volume, 0.8);
  },
  'conversation ends',
);

// Element switch signatures (short, identifiable, on the UI bus).
reg(
  'ui.element.air',
  0.4,
  (ac, out, t, o) => {
    whoosh(ac, out, o, t, 600 * o.pitch, 3000 * o.pitch, 1800 * o.pitch, 0.3, 0.16 * o.volume, 1.2);
    const s = osc(ac, 'sine', hz(79, o), t + 0.05, 0.35);
    glide(s.frequency, t + 0.05, hz(76, o), hz(79, o), 0.08);
    const g = swell(ac, t + 0.05, 0.06, 0.1, 0.18, 0.07 * o.volume);
    s.connect(g).connect(out);
  },
  'switched to Air',
);

reg(
  'ui.element.water',
  0.5,
  (ac, out, t, o) => {
    droplet(ac, out, t, 420 * o.pitch, 0.16 * o.volume, 0.09);
    droplet(ac, out, t + 0.05, 640 * o.pitch, 0.1 * o.volume, 0.07);
    softBell(ac, out, o, t + 0.04, 74, 0.13, 2);
  },
  'switched to Water',
);

reg(
  'ui.element.earth',
  0.45,
  (ac, out, t, o) => {
    thump(ac, out, t, 130 * o.pitch, 70 * o.pitch, 0.12, 0.3 * o.volume);
    ping(ac, out, t, 410 * o.pitch, 0.08, 0.12 * o.volume, 'triangle');
    kpluck(ac, out, o, t + 0.02, 50, 0.24, 1, 0.35);
  },
  'switched to Earth',
);

reg(
  'ui.element.fire',
  0.45,
  (ac, out, t, o) => {
    const f = noiseHit(ac, out, o.noise, t, 'lowpass', 2800 * o.pitch, 0.8, 0.006, 0.22, 0.2 * o.volume);
    f.frequency.exponentialRampToValueAtTime(600 * o.pitch, t + 0.22);
    const s = osc(ac, 'sawtooth', hz(57, o), t, 0.35);
    const lp = filt(ac, 'lowpass', 900, 1.2);
    const g = perc(ac, t, 0.01, 0.3, 0.06 * o.volume);
    s.connect(lp).connect(g).connect(out);
  },
  'switched to Fire',
);
