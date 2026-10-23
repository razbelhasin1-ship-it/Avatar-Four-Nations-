import { envGain, noiseSrc, oscSrc, registerLoop, registerSound } from '../../audio/AudioEngine';

/**
 * Procedural WebAudio recipes for waterbending. Every sound is synthesised
 * (filtered noise + oscillators); nothing is loaded from files.
 */

/** Small helper: a burst of bubbly sine "blips" (rising pitch). */
function bubbles(ac: AudioContext, out: AudioNode, t: number, n: number, span: number, base: number, vol: number, pitch: number): void {
  for (let i = 0; i < n; i++) {
    const tt = t + Math.random() * span;
    const f0 = base * (0.7 + Math.random() * 0.8) * pitch;
    const o = oscSrc(ac, tt, 0.07, 'sine', f0);
    o.frequency.exponentialRampToValueAtTime(f0 * 2.2, tt + 0.05);
    const g = envGain(ac, tt, 0.004, 0.01, 0.05, vol * (0.5 + Math.random() * 0.5));
    o.connect(g).connect(out);
  }
}

// Water rising out of a source toward the hands.
registerSound('water_gather', (ac, out, t, o) => {
  const { filter } = noiseSrc(ac, o.noise, t, 0.55, 'bandpass', 380 * o.pitch, 1.4);
  filter.frequency.exponentialRampToValueAtTime(1500 * o.pitch, t + 0.42);
  const g = envGain(ac, t, 0.12, 0.18, 0.22, 0.42 * o.volume);
  filter.connect(g).connect(out);
  bubbles(ac, out, t + 0.04, 6, 0.4, 520, 0.12 * o.volume, o.pitch);
  return 0.6;
});

// Lash: a swish building into a wet crack.
registerSound('water_whip', (ac, out, t, o) => {
  const sw = noiseSrc(ac, o.noise, t, 0.22, 'bandpass', 700 * o.pitch, 1.6);
  sw.filter.frequency.exponentialRampToValueAtTime(2600 * o.pitch, t + 0.14);
  const g1 = envGain(ac, t, 0.05, 0.05, 0.08, 0.35 * o.volume);
  sw.filter.connect(g1).connect(out);
  const tc = t + 0.13;
  const cr = noiseSrc(ac, o.noise, tc, 0.12, 'highpass', 2400 * o.pitch, 0.9);
  const g2 = envGain(ac, tc, 0.002, 0.012, 0.09, 0.5 * o.volume);
  cr.filter.connect(g2).connect(out);
  const sp = noiseSrc(ac, o.noise, tc, 0.3, 'bandpass', 1300 * o.pitch, 0.8);
  sp.filter.frequency.exponentialRampToValueAtTime(500, tc + 0.25);
  const g3 = envGain(ac, tc, 0.01, 0.04, 0.22, 0.3 * o.volume);
  sp.filter.connect(g3).connect(out);
  return 0.5;
});

// Heavy water impact: low thump + wide splash.
registerSound('water_impact', (ac, out, t, o) => {
  const th = oscSrc(ac, t, 0.3, 'sine', 110 * o.pitch);
  th.frequency.exponentialRampToValueAtTime(48, t + 0.25);
  const g = envGain(ac, t, 0.003, 0.04, 0.25, 0.65 * o.volume);
  th.connect(g).connect(out);
  const { filter } = noiseSrc(ac, o.noise, t, 0.9, 'lowpass', 3200 * o.pitch, 0.7);
  filter.frequency.exponentialRampToValueAtTime(420, t + 0.8);
  const g2 = envGain(ac, t, 0.004, 0.1, 0.7, 0.6 * o.volume);
  filter.connect(g2).connect(out);
  bubbles(ac, out, t + 0.12, 7, 0.5, 380, 0.08 * o.volume, o.pitch);
  return 1;
});

// Launching a mass of water forward.
registerSound('water_launch', (ac, out, t, o) => {
  const { filter } = noiseSrc(ac, o.noise, t, 0.5, 'bandpass', 420 * o.pitch, 1.1);
  filter.frequency.exponentialRampToValueAtTime(1900 * o.pitch, t + 0.16);
  filter.frequency.exponentialRampToValueAtTime(600 * o.pitch, t + 0.45);
  const g = envGain(ac, t, 0.02, 0.1, 0.34, 0.62 * o.volume);
  filter.connect(g).connect(out);
  const th = oscSrc(ac, t, 0.25, 'sine', 140 * o.pitch);
  th.frequency.exponentialRampToValueAtTime(70, t + 0.2);
  const g2 = envGain(ac, t, 0.004, 0.05, 0.16, 0.35 * o.volume);
  th.connect(g2).connect(out);
  return 0.55;
});

// Ice forming: crystalline pings and crackle.
registerSound('ice_form', (ac, out, t, o) => {
  const freqs = [2093, 2637, 3136, 3951, 2349];
  freqs.forEach((f, i) => {
    const tt = t + i * 0.035 + Math.random() * 0.02;
    const osc = oscSrc(ac, tt, 0.35, 'sine', f * o.pitch);
    const g = envGain(ac, tt, 0.002, 0.01, 0.28, 0.08 * o.volume);
    osc.connect(g).connect(out);
  });
  for (let i = 0; i < 6; i++) {
    const tt = t + Math.random() * 0.3;
    const { filter } = noiseSrc(ac, o.noise, tt, 0.05, 'highpass', 3500 * o.pitch, 3);
    const g = envGain(ac, tt, 0.001, 0.004, 0.04, 0.3 * o.volume);
    filter.connect(g).connect(out);
  }
  const low = noiseSrc(ac, o.noise, t, 0.45, 'lowpass', 500 * o.pitch, 1);
  const g3 = envGain(ac, t, 0.01, 0.15, 0.25, 0.3 * o.volume);
  low.filter.connect(g3).connect(out);
  return 0.6;
});

// Ice shattering.
registerSound('ice_shatter', (ac, out, t, o) => {
  for (let i = 0; i < 9; i++) {
    const tt = t + Math.random() * 0.12;
    const { filter } = noiseSrc(ac, o.noise, tt, 0.07, 'highpass', (2500 + Math.random() * 3000) * o.pitch, 5);
    const g = envGain(ac, tt, 0.001, 0.006, 0.06, 0.32 * o.volume);
    filter.connect(g).connect(out);
  }
  const ping = oscSrc(ac, t, 0.3, 'triangle', 3300 * o.pitch);
  const g2 = envGain(ac, t, 0.001, 0.01, 0.22, 0.07 * o.volume);
  ping.connect(g2).connect(out);
  const thud = oscSrc(ac, t, 0.2, 'sine', 160 * o.pitch);
  thud.frequency.exponentialRampToValueAtTime(70, t + 0.15);
  const g3 = envGain(ac, t, 0.002, 0.02, 0.15, 0.3 * o.volume);
  thud.connect(g3).connect(out);
  return 0.4;
});

// Shield wrapping around the bender.
registerSound('water_shield', (ac, out, t, o) => {
  for (const [f0, f1, d] of [[300, 1400, 0], [600, 2200, 0.05]] as Array<[number, number, number]>) {
    const { filter } = noiseSrc(ac, o.noise, t + d, 0.7, 'bandpass', f0 * o.pitch, 2.2);
    filter.frequency.exponentialRampToValueAtTime(f1 * o.pitch, t + d + 0.3);
    filter.frequency.exponentialRampToValueAtTime(f0 * 1.5 * o.pitch, t + d + 0.65);
    const g = envGain(ac, t + d, 0.08, 0.25, 0.3, 0.32 * o.volume);
    filter.connect(g).connect(out);
  }
  bubbles(ac, out, t + 0.1, 5, 0.5, 700, 0.07 * o.volume, o.pitch);
  return 0.8;
});

// Healing shimmer.
registerSound('water_heal', (ac, out, t, o) => {
  [880, 1320, 1760, 2217].forEach((f, i) => {
    const tt = t + i * 0.09;
    const osc = oscSrc(ac, tt, 1.3, 'sine', f * o.pitch);
    const g = envGain(ac, tt, 0.15, 0.4, 0.7, 0.07 * o.volume);
    osc.connect(g).connect(out);
  });
  const { filter } = noiseSrc(ac, o.noise, t, 1.2, 'bandpass', 3000 * o.pitch, 2);
  const g = envGain(ac, t, 0.3, 0.4, 0.5, 0.08 * o.volume);
  filter.connect(g).connect(out);
  return 1.4;
});

// Steam when water meets fire.
registerSound('steam_hiss', (ac, out, t, o) => {
  const { filter } = noiseSrc(ac, o.noise, t, 0.9, 'highpass', 2800 * o.pitch, 0.6);
  filter.frequency.exponentialRampToValueAtTime(5200 * o.pitch, t + 0.7);
  const g = envGain(ac, t, 0.01, 0.15, 0.65, 0.42 * o.volume);
  filter.connect(g).connect(out);
  return 1;
});

// Moisture pulled from plants / air.
registerSound('water_moisture', (ac, out, t, o) => {
  const { filter } = noiseSrc(ac, o.noise, t, 1.4, 'bandpass', 2200 * o.pitch, 1.2);
  filter.frequency.exponentialRampToValueAtTime(700 * o.pitch, t + 1.2);
  const g = envGain(ac, t, 0.6, 0.3, 0.4, 0.28 * o.volume);
  filter.connect(g).connect(out);
  bubbles(ac, out, t + 0.6, 8, 0.8, 900, 0.06 * o.volume, o.pitch);
  return 1.5;
});

// No water: a dry puff.
registerSound('water_fizzle', (ac, out, t, o) => {
  const { filter } = noiseSrc(ac, o.noise, t, 0.25, 'lowpass', 900 * o.pitch, 0.6);
  filter.frequency.exponentialRampToValueAtTime(250, t + 0.2);
  const g = envGain(ac, t, 0.01, 0.03, 0.18, 0.25 * o.volume);
  filter.connect(g).connect(out);
  return 0.3;
});

// Water column erupting (spout).
registerSound('water_spout', (ac, out, t, o) => {
  const { filter } = noiseSrc(ac, o.noise, t, 1.1, 'lowpass', 300 * o.pitch, 0.8);
  filter.frequency.exponentialRampToValueAtTime(1800 * o.pitch, t + 0.5);
  filter.frequency.exponentialRampToValueAtTime(700 * o.pitch, t + 1.0);
  const g = envGain(ac, t, 0.05, 0.4, 0.6, 0.7 * o.volume);
  filter.connect(g).connect(out);
  const th = oscSrc(ac, t, 0.5, 'sine', 70 * o.pitch);
  const g2 = envGain(ac, t, 0.02, 0.15, 0.3, 0.4 * o.volume);
  th.connect(g2).connect(out);
  return 1.2;
});

// Loops ----------------------------------------------------------------------

registerLoop('water_jet', (ac, out, o) => {
  const src = ac.createBufferSource();
  src.buffer = o.noise;
  src.loop = true;
  const hp = ac.createBiquadFilter();
  hp.type = 'bandpass';
  hp.frequency.value = 2400;
  hp.Q.value = 0.7;
  const lfo = ac.createOscillator();
  lfo.frequency.value = 9;
  const lg = ac.createGain();
  lg.gain.value = 500;
  lfo.connect(lg).connect(hp.frequency);
  const low = ac.createBiquadFilter();
  low.type = 'lowpass';
  low.frequency.value = 260;
  const lowG = ac.createGain();
  lowG.gain.value = 1.4;
  src.connect(hp).connect(out);
  src.connect(low).connect(lowG).connect(out);
  src.start();
  lfo.start();
  return {
    stop(t: number) {
      src.stop(t);
      lfo.stop(t);
    },
    setPitch(p: number) {
      hp.frequency.setTargetAtTime(2400 * p, ac.currentTime, 0.05);
    },
  };
});

registerLoop('water_draw', (ac, out, o) => {
  const src = ac.createBufferSource();
  src.buffer = o.noise;
  src.loop = true;
  const f = ac.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = 1100;
  f.Q.value = 1.6;
  const lfo = ac.createOscillator();
  lfo.frequency.value = 3.3;
  const lg = ac.createGain();
  lg.gain.value = 350;
  lfo.connect(lg).connect(f.frequency);
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

registerLoop('water_swirl', (ac, out, o) => {
  const src = ac.createBufferSource();
  src.buffer = o.noise;
  src.loop = true;
  const f = ac.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = 800;
  f.Q.value = 2;
  const lfo = ac.createOscillator();
  lfo.frequency.value = 1.6;
  const lg = ac.createGain();
  lg.gain.value = 500;
  lfo.connect(lg).connect(f.frequency);
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
