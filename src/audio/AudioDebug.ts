import type { GameContext } from '../core/GameContext';
import type { AmbienceContext, AmbienceDirector } from './AmbienceDirector';
import { ambienceTargets, sampleContext, sampleWater, spotRates } from './AmbienceDirector';
import type { AudioEvents } from './AudioEvents';
import type { LoopHandle, PlayOpts } from './AudioEngine';
import { renderLoop, renderSound, verifyAll } from './AudioVerify';
import { createReverb, type ReverbParams } from './dsp';
import type { MusicSystem } from './MusicSystem';
import type { StingerKind } from './music/MusicDirector';
import { hasSound, listLoops, listSounds, loopMeta, soundMeta } from './registry';

/**
 * window.__game.debug.audio — inspection and offline verification helpers
 * (used by tests/e2e/audio.e2e.mjs). Installed once window.__game exists.
 */
export function installAudioDebug(ctx: GameContext): void {
  if (typeof window === 'undefined') return;
  const tryInstall = (): boolean => {
    const g = (window as any).__game;
    if (!g) return false;
    g.debug = g.debug ?? {};
    const amb = () => ctx.extra.get('audio_ambience') as AmbienceDirector | undefined;
    const mus = () => ctx.extra.get('audio_music') as MusicSystem | undefined;
    const evs = () => ctx.extra.get('audio_events') as AudioEvents | undefined;
    const handles: LoopHandle[] = [];
    g.debug.audio = {
      state: () => ({ engine: ctx.audio.debugState(), ambience: amb()?.state() ?? null, music: mus()?.state() ?? null, events: evs()?.state() ?? null }),
      unlock: () => {
        ctx.audio.unlock();
        return ctx.audio.debugState();
      },
      ready: () => ctx.audio.ready,
      /** Peak per 2 s window of an impulse through the reverb (runaway-feedback regression check). */
      reverbTail: async (p: Partial<ReverbParams>, size = 1, seconds = 16, sampleRate = 44100): Promise<number[]> => {
        const oac = new OfflineAudioContext(1, Math.ceil(sampleRate * seconds), sampleRate);
        const rev = createReverb(oac, p, size);
        const src = oac.createBufferSource();
        const b = oac.createBuffer(1, 64, sampleRate);
        b.getChannelData(0)[0] = 1;
        src.buffer = b;
        src.connect(rev.input);
        rev.output.connect(oac.destination);
        src.start(0.01);
        const d = (await oac.startRendering()).getChannelData(0);
        const out: number[] = [];
        for (let s = 0; s + 2 <= seconds; s += 2) {
          let m = 0;
          for (let i = s * sampleRate; i < (s + 2) * sampleRate; i++) {
            const v = Math.abs(d[i]);
            if (!(v <= m)) m = v; // NaN propagates
          }
          out.push(m);
        }
        return out;
      },
      list: () => ({ sounds: listSounds(), loops: listLoops() }),
      has: (id: string) => hasSound(id),
      hasLoop: (id: string) => listLoops().includes(id),
      meta: (id: string) => ({ ...soundMeta(id), loop: loopMeta(id) }),
      play: (id: string, o?: PlayOpts) => !!ctx.audio.play(id, o),
      loop: (id: string, o?: PlayOpts) => handles.push(ctx.audio.loop(id, o)) - 1,
      stopLoop: (i: number) => handles[i]?.stop(0.2),
      log: (n = 60) => ctx.audio.log.slice(-n),
      clearLog: () => {
        ctx.audio.log.length = 0;
      },
      render: (id: string, o?: Parameters<typeof renderSound>[1]) => renderSound(id, o),
      renderLoop: (id: string, o?: Parameters<typeof renderLoop>[1]) => renderLoop(id, o),
      /** Offline-render every sound and loop; returns failures + compact per-id numbers. */
      verifyAll: async (o?: Parameters<typeof verifyAll>[0]) => {
        const s = await verifyAll(o);
        const r3 = (v: number) => Math.round(v * 1000) / 1000;
        return {
          sounds: s.sounds,
          loops: s.loops,
          failed: s.failed,
          ms: Math.round(s.ms),
          stats: Object.fromEntries(s.reports.map((r) => [r.id, { peak: r3(r.peak), rms: r3(r.rms), eff: r3(r.effective), dec: r3(r.declared) }])),
          loopStats: Object.fromEntries(s.loopReports.map((r) => [r.id, { peak: r3(r.peak), rms: r3(r.rms), tail: r3(r.tailPeak) }])),
        };
      },
      ambience: {
        state: () => amb()?.state() ?? null,
        /** Force context fields, e.g. { hour: 23 } or { weather: 'rain', rain: 1 }. null clears. */
        override: (o: Partial<AmbienceContext> | null) => {
          const d = amb();
          if (d) d.override = o;
          return !!d;
        },
        snap: () => amb()?.snap(),
        /** Targets for a hypothetical place (no teleport): sample the world at x,z. */
        targetsAt: (x: number, z: number, o: { y?: number; hour?: number; weather?: string; rain?: number; snow?: number; sand?: number; ash?: number; blizzard?: number } = {}) => {
          const y = o.y ?? Math.max(0, ctx.world.heightAt(x, z)) + 1.7;
          const reg = ctx.world.regionAt(x, z);
          const c = sampleContext(x, y, z, {
            hour: o.hour ?? 12,
            region: reg ? { id: reg.id, theme: reg.theme } : null,
            weather: { type: o.weather ?? 'clear', rain: o.rain ?? 0, snow: o.snow ?? 0, blizzard: o.blizzard ?? 0, sand: o.sand ?? 0, ash: o.ash ?? 0, wind: 0.3 },
            heavy: sampleWater(x, z),
          });
          const t = ambienceTargets(c);
          const out: Record<string, number> = {};
          for (const [k, v] of Object.entries(t)) if (v > 0.01) out[k] = Math.round(v * 100) / 100;
          const spots = spotRates(c).filter((s) => s.rate > 0.001).map((s) => s.id);
          return { region: c.region, biome: c.biome, seaDist: c.seaDist, riverDist: Math.round(c.riverDist), settlement: +c.settlement.toFixed(2), temple: +c.temple.toFixed(2), targets: out, spots };
        },
      },
      music: {
        state: () => mus()?.state() ?? ctx.audio.music.state(),
        /** Force a theme (null = automatic by region / menu). */
        force: (id: string | null) => {
          const m = mus();
          if (m) m.forced = id;
          return !!m;
        },
        stinger: (kind: StingerKind) => mus()?.stinger(kind) ?? ctx.audio.music.stinger(kind),
        pulse: (amount = 0.3) => ctx.audio.music.pulseCombat(amount),
        setCombat: (level: number) => ctx.audio.music.setCombat(level),
      },
      events: () => evs()?.state() ?? null,
    };
    return true;
  };
  if (tryInstall()) return;
  const iv = setInterval(() => {
    if (tryInstall()) clearInterval(iv);
  }, 30);
  setTimeout(() => clearInterval(iv), 20000);
}
