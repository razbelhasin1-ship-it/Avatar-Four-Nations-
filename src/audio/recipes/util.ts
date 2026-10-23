import type { AC } from '../synth';

/**
 * Event scheduler for loop recipes made of discrete events (crackles, bird
 * calls, frog croaks, chimes). Live: a timer schedules events one window ahead
 * of the audio clock (sample-accurate WebAudio times). Offline (verification
 * renders): schedules the whole render length at once.
 */
export interface EventPump {
  stop(): void;
  /** Multiplier applied by callers to event density (0..2). */
  density: number;
}

export function eventPump(ac: AC, fn: (t0: number, t1: number, density: number) => void, window = 1): EventPump {
  const pump: EventPump = { stop() {}, density: 1 };
  const isOffline = typeof OfflineAudioContext !== 'undefined' && ac instanceof OfflineAudioContext;
  if (isOffline) {
    const len = (ac as OfflineAudioContext).length / ac.sampleRate;
    try {
      fn(0.02, len, pump.density);
    } catch (err) {
      console.warn('[Audio] event loop failed', err);
    }
    return pump;
  }
  let horizon = ac.currentTime + 0.05;
  let stopped = false;
  const tick = () => {
    if (stopped) return;
    const now = ac.currentTime;
    if (horizon < now) horizon = now + 0.02;
    const target = now + window;
    if (target <= horizon) return;
    try {
      fn(horizon, target, pump.density);
    } catch (err) {
      console.warn('[Audio] event loop failed', err);
    }
    horizon = target;
  };
  tick();
  const id = setInterval(tick, Math.max(50, window * 400));
  pump.stop = () => {
    stopped = true;
    clearInterval(id);
  };
  return pump;
}

/** Poisson-ish event times in [t0, t1) at `rate` events/second. */
export function eventTimes(t0: number, t1: number, rate: number): number[] {
  const out: number[] = [];
  if (!(rate > 0)) return out;
  let t = t0 + (-Math.log(1 - Math.random()) / rate) * Math.random();
  while (t < t1 && out.length < 400) {
    out.push(t);
    t += -Math.log(1 - Math.random() * 0.999) / rate;
  }
  return out;
}

/** Continuous looping noise source (whole-buffer loop, random start). */
export function loopNoise(ac: AC, buf: AudioBuffer, rate = 1): AudioBufferSourceNode {
  const s = ac.createBufferSource();
  s.buffer = buf;
  s.loop = true;
  s.playbackRate.value = rate;
  s.start(ac.currentTime, Math.random() * buf.duration * 0.9);
  return s;
}

/** Low-frequency oscillator → gain (depth) → target param. */
export function lfo(ac: AC, rate: number, depth: number, target: AudioParam, type: OscillatorType = 'sine'): OscillatorNode {
  const o = ac.createOscillator();
  o.type = type;
  o.frequency.value = rate;
  const g = ac.createGain();
  g.gain.value = depth;
  o.connect(g).connect(target);
  o.start(ac.currentTime);
  return o;
}

/** Stop helper for loop instances: stops all scheduled sources/oscillators at t. */
export function stopAll(nodes: Array<AudioScheduledSourceNode>, t: number): void {
  for (const n of nodes) {
    try {
      n.stop(t);
    } catch {
      /* already stopped */
    }
  }
}
