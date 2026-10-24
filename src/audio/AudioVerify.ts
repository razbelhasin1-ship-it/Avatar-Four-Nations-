import { analyse, createReverb, makeResources, type SignalStats } from './dsp';
import { getLoopRecipe, getSoundRecipe, listLoops, listSounds, loopMeta, soundMeta, soundTrim } from './registry';

/**
 * Offline verification ("listening without ears"): renders recipes through an
 * OfflineAudioContext and measures the result. Used by
 * window.__game.debug.audio.verifyAll() and tests/e2e/audio.e2e.mjs.
 *
 * Checks per one-shot: finite samples (no NaN), audible (peak/RMS), no clipping
 * at volume 1, starts click-free, decays within its declared duration, and the
 * reverb send stays finite. Loops: finite, audible, steady (no long dropouts),
 * and silent shortly after stop().
 */

export interface RenderReport extends SignalStats {
  id: string;
  /** Declared duration (meta.duration or the recipe's return value). */
  declared: number;
  /** Value returned by the recipe. */
  returned: number;
  /** Seconds rendered. */
  rendered: number;
  /** Reverb-send signal stats (must be finite). */
  sendPeak: number;
  sendNan: number;
  ok: boolean;
  problems: string[];
  ms: number;
}

export interface LoopReport extends SignalStats {
  id: string;
  params: string[];
  /** RMS per 0.5 s window while running (steadiness). */
  windows: number[];
  /** Peak after stop() + fade. */
  tailPeak: number;
  ok: boolean;
  problems: string[];
  ms: number;
}

const SR = 44100;
const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function ctor(): typeof OfflineAudioContext | null {
  const w = typeof window !== 'undefined' ? (window as any) : (globalThis as any);
  return w.OfflineAudioContext || w.webkitOfflineAudioContext || null;
}

export function offlineAvailable(): boolean {
  return !!ctor();
}

/** Render one registered one-shot and analyse it. */
export async function renderSound(id: string, o: { pitch?: number; volume?: number; seed?: number; sampleRate?: number } = {}): Promise<RenderReport> {
  const t0 = nowMs();
  const problems: string[] = [];
  const r = getSoundRecipe(id);
  const meta = soundMeta(id);
  const OAC = ctor();
  const blank = (msg: string): RenderReport => ({
    id, declared: 0, returned: 0, rendered: 0, sendPeak: 0, sendNan: 0, ok: false, problems: [msg], ms: 0,
    peak: 0, rms: 0, nan: 0, clipped: 0, dc: 0, effective: 0, first: 0, last: 0, maxStep: 0,
  });
  if (!r) return blank('unknown id');
  if (!OAC) return blank('OfflineAudioContext unavailable');
  const sr = o.sampleRate ?? SR;
  // Render generously past the declared length to catch sounds that ring on.
  const declaredGuess = meta.duration ?? 4;
  const len = Math.min(14, declaredGuess + 1.5);
  const oac = new OAC(2, Math.ceil(sr * len), sr);
  const res = makeResources(oac);
  const merger = oac.createChannelMerger(2);
  merger.connect(oac.destination);
  // Same per-voice gain staging as AudioEngine.play (trims.ts).
  const out = oac.createGain();
  out.gain.value = soundTrim(id);
  out.channelCount = 1;
  out.channelCountMode = 'explicit';
  out.connect(merger, 0, 0);
  const send = oac.createGain();
  send.channelCount = 1;
  send.channelCountMode = 'explicit';
  send.connect(merger, 0, 1);
  let returned = 0;
  try {
    returned = r(oac as unknown as AudioContext, out, 0.01, {
      pitch: o.pitch ?? 1,
      volume: o.volume ?? 1,
      noise: res.noise,
      white: res.white,
      brown: res.brown,
      reverb: send,
      seed: o.seed ?? 0.5,
    });
  } catch (err) {
    return { ...blank('recipe threw: ' + String((err as Error)?.message ?? err)), ms: nowMs() - t0 };
  }
  let buf: AudioBuffer;
  try {
    buf = await oac.startRendering();
  } catch (err) {
    return { ...blank('render failed: ' + String(err)), ms: nowMs() - t0 };
  }
  const dry = buf.getChannelData(0);
  const wet = buf.getChannelData(1);
  const s = analyse([dry], sr);
  const w = analyse([wet], sr);
  const declared = meta.duration ?? (Number.isFinite(returned) ? returned : 0);
  if (!Number.isFinite(returned) || returned <= 0) problems.push(`recipe returned ${returned}`);
  if (s.nan > 0) problems.push(`${s.nan} non-finite samples`);
  if (w.nan > 0) problems.push(`${w.nan} non-finite reverb-send samples`);
  if (s.peak < 0.002 || s.rms < 0.0002) problems.push(`silent (peak ${s.peak.toFixed(4)}, rms ${s.rms.toFixed(5)})`);
  if (s.clipped > 0 || s.peak > 1) problems.push(`clips (peak ${s.peak.toFixed(3)}, ${s.clipped} samples > 1)`);
  if (s.first > 0.02) problems.push(`click at start (${s.first.toFixed(3)})`);
  // 'effective' = last sample above -60 dB re peak; allow a small tolerance.
  if (s.effective > declared + 0.15) problems.push(`rings past declared duration (${s.effective.toFixed(2)} s > ${declared.toFixed(2)} s)`);
  if (s.last > 0.01) problems.push(`not decayed at render end (${s.last.toFixed(3)})`);
  if (Math.abs(s.dc) > 0.05) problems.push(`DC offset ${s.dc.toFixed(3)}`);
  return {
    ...s,
    id,
    declared,
    returned,
    rendered: len,
    sendPeak: w.peak,
    sendNan: w.nan,
    ok: problems.length === 0,
    problems,
    ms: nowMs() - t0,
  };
}

/** Render a loop for `seconds` (params set to `level`), stop it, and analyse. */
export async function renderLoop(id: string, o: { seconds?: number; level?: number; params?: Record<string, number>; sampleRate?: number } = {}): Promise<LoopReport> {
  const t0 = nowMs();
  const r = getLoopRecipe(id);
  const meta = loopMeta(id);
  const params = meta.params ?? [];
  const OAC = ctor();
  const blank = (msg: string): LoopReport => ({
    id, params, windows: [], tailPeak: 0, ok: false, problems: [msg], ms: 0,
    peak: 0, rms: 0, nan: 0, clipped: 0, dc: 0, effective: 0, first: 0, last: 0, maxStep: 0,
  });
  if (!r) return blank('unknown loop');
  if (!OAC) return blank('OfflineAudioContext unavailable');
  const sr = o.sampleRate ?? SR;
  const run = o.seconds ?? 4;
  const tail = 1.6;
  const oac = new OAC(1, Math.ceil(sr * (run + tail)), sr);
  const res = makeResources(oac);
  // Like AudioEngine.loop: a per-loop gain (trim) that fades on stop().
  const out = oac.createGain();
  out.gain.value = soundTrim(id);
  out.gain.setTargetAtTime(0, run, 0.1);
  out.connect(oac.destination);
  // The engine routes loop sends into the FDN reverb: include it so feedback stability is covered.
  const send = oac.createGain();
  const rev = createReverb(oac, { decay: 1.3, damping: 5200, mix: 0.4 });
  send.connect(rev.input);
  const revOut = oac.createGain();
  revOut.gain.value = 0;
  rev.output.connect(revOut).connect(oac.destination);
  const problems: string[] = [];
  try {
    const inst = r(oac as unknown as AudioContext, out, { noise: res.noise, white: res.white, brown: res.brown, reverb: send });
    for (const p of params) inst.setParam?.(p, o.params?.[p] ?? o.level ?? 1);
    inst.stop(run + 0.4);
  } catch (err) {
    return { ...blank('loop threw: ' + String((err as Error)?.message ?? err)), ms: nowMs() - t0 };
  }
  let buf: AudioBuffer;
  try {
    buf = await oac.startRendering();
  } catch (err) {
    return { ...blank('render failed: ' + String(err)), ms: nowMs() - t0 };
  }
  const d = buf.getChannelData(0);
  const body = d.subarray(Math.floor(sr * 0.6), Math.floor(sr * run));
  const s = analyse([body], sr);
  const windows: number[] = [];
  const win = Math.floor(sr * 0.5);
  for (let i = Math.floor(sr * 0.6); i + win <= Math.floor(sr * run); i += win) {
    let sum = 0;
    for (let k = i; k < i + win; k++) {
      const v = d[k];
      if (Number.isFinite(v)) sum += v * v;
    }
    windows.push(+Math.sqrt(sum / win).toFixed(5));
  }
  let tailPeak = 0;
  for (let i = Math.floor(sr * (run + 0.9)); i < d.length; i++) tailPeak = Math.max(tailPeak, Math.abs(d[i]) || 0);
  let nan = 0;
  for (let i = 0; i < d.length; i++) if (!Number.isFinite(d[i])) nan++;
  if (nan > 0) problems.push(`${nan} non-finite samples`);
  if (s.peak < 0.002 || s.rms < 0.0003) problems.push(`silent (peak ${s.peak.toFixed(4)}, rms ${s.rms.toFixed(5)})`);
  if (s.peak > 1) problems.push(`clips (peak ${s.peak.toFixed(3)})`);
  const maxW = windows.length ? Math.max(...windows) : 0;
  const minW = windows.length ? Math.min(...windows) : 0;
  if (maxW > 0 && minW < maxW * 0.02) problems.push(`drops out (window rms ${minW} vs ${maxW})`);
  if (tailPeak > 0.02) problems.push(`still sounding after stop (${tailPeak.toFixed(3)})`);
  return { ...s, nan, id, params, windows, tailPeak, ok: problems.length === 0, problems, ms: nowMs() - t0 };
}

export interface VerifySummary {
  sounds: number;
  loops: number;
  failed: Array<{ id: string; problems: string[] }>;
  reports: RenderReport[];
  loopReports: LoopReport[];
  ms: number;
}

/** Verify every registered sound (and loop). `filter` limits ids by prefix/substring. */
export async function verifyAll(o: { filter?: string; loops?: boolean; sounds?: boolean } = {}): Promise<VerifySummary> {
  const t0 = nowMs();
  const match = (id: string) => !o.filter || id.includes(o.filter);
  const reports: RenderReport[] = [];
  const loopReports: LoopReport[] = [];
  if (o.sounds !== false) for (const id of listSounds()) if (match(id)) reports.push(await renderSound(id));
  if (o.loops !== false) for (const id of listLoops()) if (match(id)) loopReports.push(await renderLoop(id));
  const failed = [...reports, ...loopReports].filter((r) => !r.ok).map((r) => ({ id: r.id, problems: r.problems }));
  return { sounds: reports.length, loops: loopReports.length, failed, reports, loopReports, ms: nowMs() - t0 };
}
