import { envGain, noiseSrc, oscSrc, registerLoop, registerSound } from '../../../audio/AudioEngine';

/**
 * Procedural WebAudio recipes for air / fire / earth bending. Each element has
 * its own sonic identity: air = breathy filtered whooshes, fire = roaring
 * low-passed noise with crackle, earth = sub thumps and grinding stone.
 */

// ---------------------------------------------------------------- AIR
registerSound('bend_air_puff', (ac, out, t, o) => {
  const { filter } = noiseSrc(ac, o.noise, t, 0.35, 'bandpass', 700 * o.pitch, 1.1);
  filter.frequency.exponentialRampToValueAtTime(2800 * o.pitch, t + 0.07);
  filter.frequency.exponentialRampToValueAtTime(900 * o.pitch, t + 0.3);
  const g = envGain(ac, t, 0.012, 0.04, 0.24, 0.55 * o.volume);
  filter.connect(g).connect(out);
  const th = oscSrc(ac, t, 0.12, 'sine', 140 * o.pitch);
  th.frequency.exponentialRampToValueAtTime(60, t + 0.1);
  const g2 = envGain(ac, t, 0.003, 0.02, 0.08, 0.25 * o.volume);
  th.connect(g2).connect(out);
  return 0.4;
});

registerSound('bend_air_blast', (ac, out, t, o) => {
  const { filter } = noiseSrc(ac, o.noise, t, 0.8, 'bandpass', 320 * o.pitch, 0.8);
  filter.frequency.exponentialRampToValueAtTime(1600 * o.pitch, t + 0.12);
  filter.frequency.exponentialRampToValueAtTime(380 * o.pitch, t + 0.7);
  const g = envGain(ac, t, 0.02, 0.12, 0.6, 0.9 * o.volume);
  filter.connect(g).connect(out);
  const hiss = noiseSrc(ac, o.noise, t, 0.5, 'highpass', 3200, 0.7);
  const g3 = envGain(ac, t, 0.01, 0.05, 0.4, 0.22 * o.volume);
  hiss.filter.connect(g3).connect(out);
  const th = oscSrc(ac, t, 0.35, 'sine', 80 * o.pitch);
  th.frequency.exponentialRampToValueAtTime(34, t + 0.3);
  const g2 = envGain(ac, t, 0.004, 0.05, 0.26, 0.55 * o.volume);
  th.connect(g2).connect(out);
  return 0.9;
});

registerSound('bend_air_swirl', (ac, out, t, o) => {
  const { filter } = noiseSrc(ac, o.noise, t, 0.75, 'bandpass', 900 * o.pitch, 2.2);
  const lfo = oscSrc(ac, t, 0.75, 'sine', 9);
  const lg = ac.createGain();
  lg.gain.value = 500 * o.pitch;
  lfo.connect(lg).connect(filter.frequency);
  filter.frequency.exponentialRampToValueAtTime(1800 * o.pitch, t + 0.4);
  const g = envGain(ac, t, 0.05, 0.25, 0.4, 0.6 * o.volume);
  filter.connect(g).connect(out);
  return 0.8;
});

registerSound('bend_air_dash', (ac, out, t, o) => {
  const { filter } = noiseSrc(ac, o.noise, t, 0.4, 'bandpass', 400 * o.pitch, 1.4);
  filter.frequency.exponentialRampToValueAtTime(3400 * o.pitch, t + 0.16);
  filter.frequency.exponentialRampToValueAtTime(1200 * o.pitch, t + 0.36);
  const g = envGain(ac, t, 0.015, 0.08, 0.26, 0.7 * o.volume);
  filter.connect(g).connect(out);
  return 0.45;
});

registerSound('bend_air_deflect', (ac, out, t, o) => {
  const { filter } = noiseSrc(ac, o.noise, t, 0.4, 'bandpass', 1400 * o.pitch, 3);
  filter.frequency.exponentialRampToValueAtTime(3800 * o.pitch, t + 0.12);
  const g = envGain(ac, t, 0.005, 0.05, 0.3, 0.6 * o.volume);
  filter.connect(g).connect(out);
  for (const f of [1760, 2640]) {
    const osc = oscSrc(ac, t, 0.5, 'sine', f * o.pitch);
    const gg = envGain(ac, t, 0.003, 0.02, 0.4, 0.12 * o.volume);
    osc.connect(gg).connect(out);
  }
  return 0.6;
});

registerLoop('bend_wind_loop', (ac, out, o) => {
  const src = ac.createBufferSource();
  src.buffer = o.noise;
  src.loop = true;
  const f = ac.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = 800;
  f.Q.value = 1.4;
  const lfo = ac.createOscillator();
  lfo.frequency.value = 5.5;
  const lg = ac.createGain();
  lg.gain.value = 260;
  lfo.connect(lg).connect(f.frequency);
  const g = ac.createGain();
  g.gain.value = 0.7;
  src.connect(f).connect(g).connect(out);
  src.start();
  lfo.start();
  return {
    stop(t: number) {
      src.stop(t);
      lfo.stop(t);
    },
    setPitch(p: number) {
      f.frequency.setTargetAtTime(800 * p, ac.currentTime, 0.05);
      lfo.frequency.setTargetAtTime(5.5 * p, ac.currentTime, 0.05);
    },
  };
});

// ---------------------------------------------------------------- FIRE
function crackle(ac: AudioContext, out: AudioNode, noise: AudioBuffer, t: number, dur: number, n: number, vol: number): void {
  for (let i = 0; i < n; i++) {
    const tt = t + Math.random() * dur;
    const { filter } = noiseSrc(ac, noise, tt, 0.04, 'highpass', 2500 + Math.random() * 3000, 2);
    const g = envGain(ac, tt, 0.001, 0.005, 0.03, vol * (0.5 + Math.random() * 0.5));
    filter.connect(g).connect(out);
  }
}

registerSound('bend_fire_puff', (ac, out, t, o) => {
  const { filter } = noiseSrc(ac, o.noise, t, 0.35, 'lowpass', 3400 * o.pitch, 0.9);
  filter.frequency.exponentialRampToValueAtTime(500, t + 0.28);
  const g = envGain(ac, t, 0.006, 0.05, 0.24, 0.6 * o.volume);
  filter.connect(g).connect(out);
  const th = oscSrc(ac, t, 0.14, 'sine', 150 * o.pitch);
  th.frequency.exponentialRampToValueAtTime(55, t + 0.12);
  const g2 = envGain(ac, t, 0.003, 0.02, 0.1, 0.35 * o.volume);
  th.connect(g2).connect(out);
  crackle(ac, out, o.noise, t + 0.03, 0.2, 3, 0.18 * o.volume);
  return 0.4;
});

registerSound('bend_fire_whoosh', (ac, out, t, o) => {
  const { filter } = noiseSrc(ac, o.noise, t, 0.8, 'lowpass', 2000 * o.pitch, 1.1);
  filter.frequency.exponentialRampToValueAtTime(320, t + 0.7);
  const g = envGain(ac, t, 0.03, 0.15, 0.55, 0.8 * o.volume);
  filter.connect(g).connect(out);
  const th = oscSrc(ac, t, 0.3, 'sine', 95 * o.pitch);
  th.frequency.exponentialRampToValueAtTime(42, t + 0.26);
  const g2 = envGain(ac, t, 0.005, 0.04, 0.22, 0.5 * o.volume);
  th.connect(g2).connect(out);
  crackle(ac, out, o.noise, t + 0.05, 0.5, 6, 0.2 * o.volume);
  return 0.9;
});

registerSound('bend_explosion', (ac, out, t, o) => {
  const th = oscSrc(ac, t, 1.0, 'sine', 62 * o.pitch);
  th.frequency.exponentialRampToValueAtTime(26, t + 0.9);
  const g = envGain(ac, t, 0.004, 0.12, 0.8, 1.0 * o.volume);
  th.connect(g).connect(out);
  const { filter } = noiseSrc(ac, o.noise, t, 1.4, 'lowpass', 1600 * o.pitch, 0.7);
  filter.frequency.exponentialRampToValueAtTime(140, t + 1.2);
  const g2 = envGain(ac, t, 0.003, 0.1, 1.1, 0.95 * o.volume);
  filter.connect(g2).connect(out);
  crackle(ac, out, o.noise, t + 0.1, 0.9, 12, 0.22 * o.volume);
  return 1.5;
});

registerLoop('bend_flame_loop', (ac, out, o) => {
  const src = ac.createBufferSource();
  src.buffer = o.noise;
  src.loop = true;
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1100;
  lp.Q.value = 0.8;
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 2600;
  bp.Q.value = 1.5;
  const lfo = ac.createOscillator();
  lfo.frequency.value = 13;
  const lg = ac.createGain();
  lg.gain.value = 0.25;
  const crackGain = ac.createGain();
  crackGain.gain.value = 0.35;
  lfo.connect(lg).connect(crackGain.gain);
  src.connect(lp).connect(out);
  src.connect(bp).connect(crackGain).connect(out);
  src.start();
  lfo.start();
  return {
    stop(t: number) {
      src.stop(t);
      lfo.stop(t);
    },
    setPitch(p: number) {
      lp.frequency.setTargetAtTime(1100 * p, ac.currentTime, 0.05);
    },
  };
});

registerSound('bend_lightning_charge', (ac, out, t, o) => {
  const osc = oscSrc(ac, t, 0.9, 'sawtooth', 160 * o.pitch);
  osc.frequency.exponentialRampToValueAtTime(900 * o.pitch, t + 0.8);
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1400;
  bp.Q.value = 2;
  const g = envGain(ac, t, 0.25, 0.4, 0.2, 0.18 * o.volume);
  osc.connect(bp).connect(g).connect(out);
  crackle(ac, out, o.noise, t, 0.85, 14, 0.28 * o.volume);
  return 0.95;
});

registerSound('bend_lightning_strike', (ac, out, t, o) => {
  const { filter } = noiseSrc(ac, o.noise, t, 0.08, 'highpass', 1800, 0.6);
  const g = envGain(ac, t, 0.001, 0.02, 0.06, 1.1 * o.volume);
  filter.connect(g).connect(out);
  const buzz = oscSrc(ac, t, 0.3, 'sawtooth', 70 * o.pitch);
  const blp = ac.createBiquadFilter();
  blp.type = 'lowpass';
  blp.frequency.value = 900;
  const gb = envGain(ac, t, 0.002, 0.06, 0.2, 0.35 * o.volume);
  buzz.connect(blp).connect(gb).connect(out);
  const rumble = noiseSrc(ac, o.noise, t + 0.03, 1.4, 'lowpass', 500, 0.6);
  rumble.filter.frequency.exponentialRampToValueAtTime(90, t + 1.3);
  const gr = envGain(ac, t + 0.03, 0.02, 0.2, 1.1, 0.8 * o.volume);
  rumble.filter.connect(gr).connect(out);
  crackle(ac, out, o.noise, t, 0.25, 8, 0.35 * o.volume);
  return 1.5;
});

registerSound('bend_steam', (ac, out, t, o) => {
  const { filter } = noiseSrc(ac, o.noise, t, 0.9, 'highpass', 2600 * o.pitch, 0.5);
  const g = envGain(ac, t, 0.02, 0.15, 0.7, 0.45 * o.volume);
  filter.connect(g).connect(out);
  return 1;
});

// ---------------------------------------------------------------- EARTH
registerSound('bend_earth_rise', (ac, out, t, o) => {
  const { filter } = noiseSrc(ac, o.noise, t, 0.6, 'lowpass', 180 * o.pitch, 1.2);
  filter.frequency.exponentialRampToValueAtTime(900 * o.pitch, t + 0.35);
  const g = envGain(ac, t, 0.03, 0.18, 0.35, 0.85 * o.volume);
  filter.connect(g).connect(out);
  const th = oscSrc(ac, t, 0.4, 'sine', 58 * o.pitch);
  th.frequency.exponentialRampToValueAtTime(36, t + 0.35);
  const g2 = envGain(ac, t, 0.004, 0.08, 0.28, 0.7 * o.volume);
  th.connect(g2).connect(out);
  return 0.7;
});

registerSound('bend_earth_slam', (ac, out, t, o) => {
  const th = oscSrc(ac, t, 0.8, 'sine', 52 * o.pitch);
  th.frequency.exponentialRampToValueAtTime(24, t + 0.7);
  const g = envGain(ac, t, 0.003, 0.1, 0.6, 1.0 * o.volume);
  th.connect(g).connect(out);
  const { filter } = noiseSrc(ac, o.noise, t, 0.9, 'lowpass', 700 * o.pitch, 0.8);
  filter.frequency.exponentialRampToValueAtTime(110, t + 0.8);
  const g2 = envGain(ac, t, 0.002, 0.08, 0.7, 0.85 * o.volume);
  filter.connect(g2).connect(out);
  return 1;
});

registerSound('bend_earth_crumble', (ac, out, t, o) => {
  for (let i = 0; i < 9; i++) {
    const tt = t + i * 0.05 + Math.random() * 0.06;
    const { filter } = noiseSrc(ac, o.noise, tt, 0.12, 'lowpass', (500 + Math.random() * 900) * o.pitch, 1.5);
    const g = envGain(ac, tt, 0.002, 0.02, 0.09, (0.5 - i * 0.04) * o.volume);
    filter.connect(g).connect(out);
  }
  const th = oscSrc(ac, t, 0.3, 'sine', 70 * o.pitch);
  th.frequency.exponentialRampToValueAtTime(38, t + 0.25);
  const g2 = envGain(ac, t, 0.003, 0.04, 0.2, 0.5 * o.volume);
  th.connect(g2).connect(out);
  return 0.8;
});

registerSound('bend_earth_sink', (ac, out, t, o) => {
  const { filter } = noiseSrc(ac, o.noise, t, 0.7, 'lowpass', 600 * o.pitch, 1);
  filter.frequency.exponentialRampToValueAtTime(140, t + 0.6);
  const g = envGain(ac, t, 0.05, 0.2, 0.4, 0.45 * o.volume);
  filter.connect(g).connect(out);
  return 0.75;
});

registerSound('bend_rock_throw', (ac, out, t, o) => {
  const { filter } = noiseSrc(ac, o.noise, t, 0.3, 'bandpass', 300 * o.pitch, 1.2);
  filter.frequency.exponentialRampToValueAtTime(1100 * o.pitch, t + 0.12);
  filter.frequency.exponentialRampToValueAtTime(400 * o.pitch, t + 0.28);
  const g = envGain(ac, t, 0.01, 0.05, 0.2, 0.55 * o.volume);
  filter.connect(g).connect(out);
  return 0.35;
});

registerSound('bend_stone_block', (ac, out, t, o) => {
  const { filter } = noiseSrc(ac, o.noise, t, 0.12, 'bandpass', 1900 * o.pitch, 5);
  const g = envGain(ac, t, 0.001, 0.015, 0.09, 0.8 * o.volume);
  filter.connect(g).connect(out);
  const osc = oscSrc(ac, t, 0.18, 'triangle', 320 * o.pitch);
  osc.frequency.exponentialRampToValueAtTime(180, t + 0.15);
  const g2 = envGain(ac, t, 0.002, 0.02, 0.13, 0.35 * o.volume);
  osc.connect(g2).connect(out);
  return 0.25;
});

registerSound('bend_perfect_block', (ac, out, t, o) => {
  for (const [f, d] of [
    [880, 0.6],
    [1320, 0.45],
    [1760, 0.35],
  ] as const) {
    const osc = oscSrc(ac, t, d, 'sine', f * o.pitch);
    const g = envGain(ac, t, 0.003, 0.03, d, 0.16 * o.volume);
    osc.connect(g).connect(out);
  }
  const { filter } = noiseSrc(ac, o.noise, t, 0.1, 'bandpass', 2400, 4);
  const g2 = envGain(ac, t, 0.001, 0.01, 0.08, 0.7 * o.volume);
  filter.connect(g2).connect(out);
  return 0.7;
});

registerSound('bend_seismic_pulse', (ac, out, t, o) => {
  const th = oscSrc(ac, t, 0.5, 'sine', 48 * o.pitch);
  th.frequency.exponentialRampToValueAtTime(30, t + 0.4);
  const g = envGain(ac, t, 0.004, 0.06, 0.4, 0.7 * o.volume);
  th.connect(g).connect(out);
  const ping = oscSrc(ac, t + 0.05, 1.4, 'sine', 196 * o.pitch);
  const g2 = envGain(ac, t + 0.05, 0.02, 0.1, 1.2, 0.12 * o.volume);
  ping.connect(g2).connect(out);
  return 1.5;
});

registerLoop('bend_rumble_loop', (ac, out, o) => {
  const src = ac.createBufferSource();
  src.buffer = o.noise;
  src.loop = true;
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 220;
  lp.Q.value = 1.2;
  const sub = ac.createOscillator();
  sub.type = 'sine';
  sub.frequency.value = 38;
  const sg = ac.createGain();
  sg.gain.value = 0.5;
  const g = ac.createGain();
  g.gain.value = 1.4;
  src.connect(lp).connect(g).connect(out);
  sub.connect(sg).connect(out);
  src.start();
  sub.start();
  return {
    stop(t: number) {
      src.stop(t);
      sub.stop(t);
    },
    setPitch(p: number) {
      lp.frequency.setTargetAtTime(220 * p, ac.currentTime, 0.05);
      sub.frequency.setTargetAtTime(38 * p, ac.currentTime, 0.05);
    },
  };
});
