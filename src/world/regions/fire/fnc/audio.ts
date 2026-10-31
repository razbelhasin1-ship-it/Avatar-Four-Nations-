import { envGain, noiseSrc, oscSrc, registerSound } from '../../../../audio/registry';

/**
 * Fire Nation capital sound recipes (procedural WebAudio): a warship's horn at the sea gate, war
 * drums and marching feet at rallies and parades, the foundries' hammers, the volcano's rumble.
 * Crowd murmur, gulls, vendor calls and fire crackle reuse the shared library.
 */

/** Steam horn: two detuned saws through a vocal band, swelling and fading (3.6 s). */
registerSound(
  'fnc_horn',
  (ac, out, t, o) => {
    const dur = 3.6;
    const g = envGain(ac, t, 0.35, 2.4, 0.85, 0.42 * o.volume);
    const f = ac.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 340;
    f.Q.value = 1.4;
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    for (const [hz, det] of [[92, 0], [92, 7], [138, -4]] as const) {
      const osc = oscSrc(ac, t, dur, 'sawtooth', hz * o.pitch);
      osc.detune.value = det;
      osc.frequency.setValueAtTime(hz * 0.94 * o.pitch, t);
      osc.frequency.linearRampToValueAtTime(hz * o.pitch, t + 0.3);
      osc.connect(f);
    }
    f.connect(lp).connect(g).connect(out);
    const send = ac.createGain();
    send.gain.value = 0.5;
    g.connect(send).connect(o.reverb);
    return dur;
  },
  { duration: 3.7, range: 900, maxVoices: 2, cooldown: 1, reverb: 0.4, desc: 'warship steam horn (Fire Nation harbour)' },
);

/** War drum: deep membrane thump with a skin slap. */
registerSound(
  'fnc_drum',
  (ac, out, t, o) => {
    const body = oscSrc(ac, t, 0.6, 'sine', 70 * o.pitch);
    body.frequency.exponentialRampToValueAtTime(42 * o.pitch, t + 0.45);
    const g = envGain(ac, t, 0.003, 0.05, 0.5, 0.8 * o.volume);
    body.connect(g).connect(out);
    const { filter } = noiseSrc(ac, o.noise, t, 0.12, 'bandpass', 900 * o.pitch, 1.1);
    const g2 = envGain(ac, t, 0.001, 0.015, 0.08, 0.28 * o.volume);
    filter.connect(g2).connect(out);
    return 0.65;
  },
  { duration: 0.7, range: 260, maxVoices: 6, cooldown: 0.05, reverb: 0.35, desc: 'Fire Nation war drum hit' },
);

/** Marching feet: a muffled crunch of many boots landing together. */
registerSound(
  'fnc_march',
  (ac, out, t, o) => {
    const { filter } = noiseSrc(ac, o.brown, t, 0.18, 'lowpass', 520 * o.pitch, 0.7);
    const g = envGain(ac, t, 0.004, 0.03, 0.12, 0.55 * o.volume);
    filter.connect(g).connect(out);
    const { filter: f2 } = noiseSrc(ac, o.noise, t + 0.01, 0.1, 'bandpass', 1800 * o.pitch, 0.9);
    const g2 = envGain(ac, t + 0.01, 0.002, 0.02, 0.06, 0.12 * o.volume);
    f2.connect(g2).connect(out);
    return 0.22;
  },
  { duration: 0.25, range: 70, maxVoices: 4, cooldown: 0.08, desc: 'a squad of boots landing in step' },
);

/** Foundry hammer on hot iron: inharmonic metallic partials with a fast decay. */
registerSound(
  'fnc_clang',
  (ac, out, t, o) => {
    const g = envGain(ac, t, 0.001, 0.01, 0.9, 0.3 * o.volume);
    for (const [hz, a] of [[523, 1], [1290, 0.6], [2075, 0.4], [3110, 0.25]] as const) {
      const osc = oscSrc(ac, t, 1.0, 'sine', hz * o.pitch * (0.97 + o.seed * 0.06));
      const og = ac.createGain();
      og.gain.value = a;
      osc.connect(og).connect(g);
    }
    g.connect(out);
    const { filter } = noiseSrc(ac, o.noise, t, 0.05, 'highpass', 2500, 0.7);
    const g2 = envGain(ac, t, 0.001, 0.008, 0.04, 0.25 * o.volume);
    filter.connect(g2).connect(out);
    return 1.0;
  },
  { duration: 1.05, range: 120, maxVoices: 4, cooldown: 0.15, reverb: 0.3, desc: 'foundry hammer on iron' },
);

/** The volcano: a long, low rumble rolling under the city. */
registerSound(
  'fnc_rumble',
  (ac, out, t, o) => {
    const dur = 4.5;
    const { filter } = noiseSrc(ac, o.brown, t, dur, 'lowpass', 90 * o.pitch, 0.9);
    filter.frequency.setValueAtTime(60 * o.pitch, t);
    filter.frequency.linearRampToValueAtTime(130 * o.pitch, t + 1.4);
    filter.frequency.exponentialRampToValueAtTime(50 * o.pitch, t + dur);
    const g = envGain(ac, t, 1.1, 1.4, 2.0, 0.7 * o.volume);
    filter.connect(g).connect(out);
    return dur;
  },
  { duration: 4.6, bus: 'ambient', maxVoices: 1, cooldown: 5, desc: 'volcanic rumble under the Fire Nation capital' },
);
