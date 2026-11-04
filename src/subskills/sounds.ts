import { registerLoop, registerSound, type LoopInstance } from '../audio/registry';
import { droplets, filt, gain, grains, noise, noiseAHR, noiseHit, osc, ping, swell, thump } from '../audio/synth';

/**
 * Procedural sounds for the sub-skills (no recorded assets).
 *  - Lava: like the show's sound team, flowing water layered under crackle and rumble; cooling is
 *    a hiss and a crack.
 *  - Spiritual projection: a hush — faint wind and a slow heartbeat; a soft chime on leaving and
 *    returning.
 *  - Bloodbending: a low, taut creak and a quiet watery hum. Nothing wet or crunchy.
 *  - Moral Strain: faint, wordless whispers.
 */

// ---- lava ---------------------------------------------------------------------------------

registerSound(
  'sub.lava.flow',
  (ac, out, t, o) => {
    const p = o.pitch;
    // Water underneath: gurgling band of noise with bubbles.
    noiseAHR(ac, out, o.noise, t, 'bandpass', 520 * p, 1.6, 0.18, 0.9, 0.7, 0.32 * o.volume);
    droplets(ac, out, t + 0.05, 1.4, 9, 140 * p, 420 * p, 0.12 * o.volume);
    // Crackle on top, rumble below.
    grains(ac, out, o.white, t, 1.6, 26, { fLo: 1800, fHi: 5200, q: 3, dur: 0.012, peak: 0.16 * o.volume, type: 'bandpass' });
    noiseAHR(ac, out, o.brown, t, 'lowpass', 140 * p, 0.8, 0.3, 0.9, 0.8, 0.5 * o.volume);
    return 2.1;
  },
  { desc: 'Lava flowing: water gurgle under crackle and rumble', range: 40, maxVoices: 4 },
);

registerSound(
  'sub.lava.melt',
  (ac, out, t, o) => {
    const p = o.pitch;
    thump(ac, out, t, 90 * p, 40 * p, 0.5, 0.45 * o.volume);
    noiseAHR(ac, out, o.brown, t, 'lowpass', 180 * p, 0.7, 0.25, 0.5, 0.7, 0.55 * o.volume);
    droplets(ac, out, t + 0.2, 1.0, 8, 90 * p, 260 * p, 0.14 * o.volume);
    grains(ac, out, o.white, t + 0.15, 1.1, 20, { fLo: 1500, fHi: 4500, q: 3, dur: 0.014, peak: 0.14 * o.volume, type: 'bandpass' });
    return 1.5;
  },
  { desc: 'Earth softening into lava: thud, rumble, bubbling, crackle', range: 45 },
);

registerSound(
  'sub.lava.cool',
  (ac, out, t, o) => {
    const p = o.pitch;
    // Hiss of steam...
    noiseAHR(ac, out, o.white, t, 'highpass', 2800 * p, 0.7, 0.03, 0.25, 0.75, 0.38 * o.volume);
    // ...and the crack of setting rock.
    noiseHit(ac, out, o.white, t + 0.12, 'bandpass', 1600 * p, 2, 0.002, 0.09, 0.5 * o.volume);
    thump(ac, out, t + 0.12, 140 * p, 60 * p, 0.22, 0.32 * o.volume);
    grains(ac, out, o.white, t + 0.2, 0.5, 8, { fLo: 900, fHi: 2600, q: 4, dur: 0.02, peak: 0.12 * o.volume, type: 'bandpass' });
    return 1.1;
  },
  { desc: 'Lava cooling to stone: steam hiss and a crack', range: 40, maxVoices: 4 },
);

registerSound(
  'sub.lava.hiss',
  (ac, out, t, o) => {
    noiseAHR(ac, out, o.white, t, 'highpass', 3200 * o.pitch, 0.8, 0.01, 0.1, 0.4, 0.28 * o.volume);
    grains(ac, out, o.white, t, 0.4, 10, { fLo: 2000, fHi: 6000, q: 3, dur: 0.01, peak: 0.12 * o.volume, type: 'bandpass' });
    return 0.6;
  },
  { desc: 'Molten spatter sizzling', range: 30, maxVoices: 4 },
);

registerSound(
  'sub.lava.disc',
  (ac, out, t, o) => {
    const f = noiseAHR(ac, out, o.noise, t, 'bandpass', 500 * o.pitch, 2.5, 0.05, 0.12, 0.35, 0.4 * o.volume);
    f.frequency.setValueAtTime(400 * o.pitch, t);
    f.frequency.exponentialRampToValueAtTime(1800 * o.pitch, t + 0.4);
    grains(ac, out, o.white, t, 0.5, 12, { fLo: 2500, fHi: 6000, q: 3, dur: 0.01, peak: 0.12 * o.volume, type: 'bandpass' });
    return 0.6;
  },
  { desc: 'Lava disc whirring away with a sizzle', range: 35 },
);

registerSound(
  'sub.lava.rumble',
  (ac, out, t, o) => {
    noiseAHR(ac, out, o.brown, t, 'lowpass', 90 * o.pitch, 0.9, 0.5, 0.8, 0.8, 0.7 * o.volume);
    thump(ac, out, t + 0.3, 60, 30, 0.8, 0.3 * o.volume);
    return 2.2;
  },
  { desc: 'Deep rumble under the ground', range: 80 },
);

registerSound(
  'sub.lava.erupt',
  (ac, out, t, o) => {
    thump(ac, out, t, 110, 28, 1.2, 0.9 * o.volume, 0.1);
    noiseHit(ac, out, o.white, t, 'lowpass', 1800, 0.8, 0.003, 0.5, 0.6 * o.volume);
    noiseAHR(ac, out, o.brown, t, 'lowpass', 160, 0.7, 0.05, 1.2, 1.2, 0.8 * o.volume);
    grains(ac, out, o.white, t + 0.1, 2.2, 50, { fLo: 1200, fHi: 5000, q: 3, dur: 0.016, peak: 0.2 * o.volume, type: 'bandpass' });
    droplets(ac, out, t + 0.4, 2, 14, 70, 220, 0.16 * o.volume);
    return 2.6;
  },
  { desc: 'Eruption: boom, roar, raining crackle', range: 120, maxVoices: 2 },
);

// ---- spiritual projection ---------------------------------------------------------------------

registerSound(
  'sub.spirit.leave',
  (ac, out, t, o) => {
    const env = swell(ac, t, 0.5, 0.3, 0.9, 0.22 * o.volume);
    env.connect(out);
    for (const [f, d] of [[528, 0], [792, 3], [1056, -4]] as const) {
      const s = osc(ac, 'sine', f * o.pitch, t, 1.8, d);
      s.connect(env);
    }
    const w = noiseAHR(ac, out, o.noise, t, 'bandpass', 900 * o.pitch, 1.2, 0.4, 0.3, 0.9, 0.14 * o.volume);
    w.frequency.setValueAtTime(600, t);
    w.frequency.exponentialRampToValueAtTime(2200, t + 1.4);
    return 1.8;
  },
  { desc: 'The spirit leaves the body: soft chord and rising air', bus: 'sfx', range: 25, reverb: 0.4 },
);

registerSound(
  'sub.spirit.return',
  (ac, out, t, o) => {
    const w = noiseAHR(ac, out, o.noise, t, 'bandpass', 1800 * o.pitch, 1.4, 0.05, 0.4, 0.5, 0.18 * o.volume);
    w.frequency.setValueAtTime(2600, t);
    w.frequency.exponentialRampToValueAtTime(500, t + 0.8);
    ping(ac, out, t + 0.7, 1056 * o.pitch, 1.1, 0.14 * o.volume);
    ping(ac, out, t + 0.72, 528 * o.pitch, 1.3, 0.12 * o.volume);
    return 2.1;
  },
  { desc: 'Back along the streak of light into the body', range: 25, reverb: 0.4 },
);

registerSound(
  'sub.spirit.call',
  (ac, out, t, o) => {
    ping(ac, out, t, 660 * o.pitch, 1.4, 0.16 * o.volume);
    ping(ac, out, t + 0.18, 990 * o.pitch, 1.2, 0.12 * o.volume);
    noiseAHR(ac, out, o.noise, t, 'bandpass', 1200, 1.5, 0.2, 0.2, 0.8, 0.06 * o.volume);
    return 1.6;
  },
  { desc: 'Calling out across the distance', bus: 'sfx', reverb: 0.45 },
);

registerLoop(
  'sub.spirit.hush',
  (ac, out, o): LoopInstance => {
    const master = gain(ac, 0);
    master.connect(out);
    const t0 = ac.currentTime;
    master.gain.setTargetAtTime(1, t0, 0.6);
    // Faint wind.
    const wind = noise(ac, o.noise, t0, 3600);
    const wf = filt(ac, 'bandpass', 700, 0.8);
    const wg = gain(ac, 0.05);
    wind.connect(wf).connect(wg).connect(master);
    const lfo = osc(ac, 'sine', 0.13, t0, 3600);
    const lg = gain(ac, 260);
    lfo.connect(lg).connect(wf.frequency);
    // Slow heartbeat: lub-dub every ~1.1 s.
    const beat = gain(ac, 1);
    beat.connect(master);
    let alive = true;
    let next = t0 + 0.4;
    let intensity = 0.5;
    const schedule = () => {
      if (!alive) return;
      while (next < ac.currentTime + 2) {
        thump(ac, beat, next, 62, 38, 0.18, 0.16 * (0.6 + intensity * 0.6));
        thump(ac, beat, next + 0.26, 56, 34, 0.16, 0.1 * (0.6 + intensity * 0.6));
        next += 1.15 - intensity * 0.35;
      }
    };
    schedule();
    const timer = setInterval(schedule, 700);
    return {
      stop(t: number) {
        alive = false;
        clearInterval(timer);
        master.gain.cancelScheduledValues(t);
        master.gain.setTargetAtTime(0, t, 0.25);
        try {
          wind.stop(t + 1.5);
          lfo.stop(t + 1.5);
        } catch {
          /* already stopped */
        }
      },
      setParam(name: string, v: number) {
        if (name === 'intensity') intensity = Math.max(0, Math.min(1, v));
      },
    };
  },
  { desc: 'Projection hush: faint wind and a slow heartbeat', params: ['intensity'] },
);

// ---- bloodbending -----------------------------------------------------------------------------

registerSound(
  'sub.blood.creak',
  (ac, out, t, o) => {
    // Stick-slip friction on a taut line: a narrow band of noise gliding down, gated in pulses.
    const f = filt(ac, 'bandpass', 210 * o.pitch, 9);
    const g = gain(ac, 0);
    const src = noise(ac, o.noise, t, 1.1);
    src.connect(f).connect(g).connect(out);
    f.frequency.setValueAtTime(230 * o.pitch, t);
    f.frequency.exponentialRampToValueAtTime(120 * o.pitch, t + 0.9);
    const peak = 0.9 * o.volume;
    let tt = t;
    for (let i = 0; i < 9; i++) {
      g.gain.setValueAtTime(0, tt);
      g.gain.linearRampToValueAtTime(peak * (0.6 + Math.random() * 0.4), tt + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, tt + 0.08);
      tt += 0.07 + Math.random() * 0.05;
    }
    const low = osc(ac, 'triangle', 55 * o.pitch, t, 1);
    const lg = gain(ac, 0);
    lg.gain.setValueAtTime(0, t);
    lg.gain.linearRampToValueAtTime(0.08 * o.volume, t + 0.2);
    lg.gain.linearRampToValueAtTime(0, t + 1);
    low.connect(lg).connect(out);
    return 1.1;
  },
  { desc: 'A low, taut creak (bloodbending takes hold)', range: 30, maxVoices: 3 },
);

registerLoop(
  'sub.blood.hum',
  (ac, out, o): LoopInstance => {
    const master = gain(ac, 0);
    master.connect(out);
    const t0 = ac.currentTime;
    master.gain.setTargetAtTime(0.06, t0, 0.4);
    const a = osc(ac, 'sine', 98, t0, 3600);
    const b = osc(ac, 'sine', 147.5, t0, 3600);
    const trem = osc(ac, 'sine', 0.7, t0, 3600);
    const tg = gain(ac, 0.35);
    const body = gain(ac, 0.65);
    trem.connect(tg).connect(body.gain);
    a.connect(body);
    b.connect(body);
    body.connect(master);
    // A thin watery shimmer.
    const sh = noise(ac, o.noise, t0, 3600);
    const sf = filt(ac, 'bandpass', 1300, 6);
    const sg = gain(ac, 0.25);
    sh.connect(sf).connect(sg).connect(master);
    return {
      stop(t: number) {
        master.gain.cancelScheduledValues(t);
        master.gain.setTargetAtTime(0, t, 0.2);
        for (const n of [a, b, trem, sh]) {
          try {
            n.stop(t + 1.2);
          } catch {
            /* stopped */
          }
        }
      },
      setParam(name: string, v: number) {
        if (name === 'intensity') master.gain.setTargetAtTime(0.04 + 0.05 * Math.max(0, Math.min(1, v)), ac.currentTime, 0.2);
      },
    };
  },
  { desc: 'Bloodbending hold: quiet watery hum', params: ['intensity'] },
);

registerSound(
  'sub.blood.release',
  (ac, out, t, o) => {
    noiseAHR(ac, out, o.noise, t, 'lowpass', 900 * o.pitch, 0.8, 0.05, 0.1, 0.45, 0.16 * o.volume);
    ping(ac, out, t + 0.05, 330 * o.pitch, 0.6, 0.05 * o.volume);
    return 0.7;
  },
  { desc: 'A hold let go: a soft exhale', range: 25 },
);

// ---- moral strain -----------------------------------------------------------------------------

registerLoop(
  'sub.strain.whisper',
  (ac, out, o): LoopInstance => {
    const master = gain(ac, 0);
    master.connect(out);
    const t0 = ac.currentTime;
    master.gain.setTargetAtTime(1, t0, 1.5);
    // Wordless whispers: breathy noise in a vocal band, gated into syllables.
    const src = noise(ac, o.white, t0, 3600, 0.8);
    const bp = filt(ac, 'bandpass', 1900, 2.2);
    const g = gain(ac, 0);
    src.connect(bp).connect(g).connect(master);
    let alive = true;
    let next = t0 + 0.6;
    const schedule = () => {
      if (!alive) return;
      while (next < ac.currentTime + 2.5) {
        // A phrase of 2-6 syllables, then a pause.
        const n = 2 + Math.floor(Math.random() * 5);
        for (let i = 0; i < n; i++) {
          const peak = 0.035 + Math.random() * 0.03;
          g.gain.setValueAtTime(0, next);
          g.gain.linearRampToValueAtTime(peak, next + 0.04);
          g.gain.linearRampToValueAtTime(0, next + 0.12 + Math.random() * 0.08);
          bp.frequency.setValueAtTime(1500 + Math.random() * 1400, next);
          next += 0.16 + Math.random() * 0.1;
        }
        next += 1.2 + Math.random() * 2.6;
      }
    };
    schedule();
    const timer = setInterval(schedule, 900);
    return {
      stop(t: number) {
        alive = false;
        clearInterval(timer);
        master.gain.cancelScheduledValues(t);
        master.gain.setTargetAtTime(0, t, 0.4);
        try {
          src.stop(t + 2);
        } catch {
          /* stopped */
        }
      },
    };
  },
  { desc: 'Moral Strain: faint wordless whispers' },
);
