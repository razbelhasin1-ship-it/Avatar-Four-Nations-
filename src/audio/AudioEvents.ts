import type { GameContext, GameSystem } from '../core/GameContext';
import type { GameEvents } from '../core/events';
import type { NotifyKind, Vec3Like } from '../core/types';
import { installAudioDebug } from './AudioDebug';
import type { LoopHandle } from './AudioEngine';
import type { MusicSystem } from './MusicSystem';
import type { StingerKind } from './music/MusicDirector';
import { stepId } from './recipes/footsteps';

/**
 * Event → sound bindings. Plays the shared library (src/audio/SOUNDS.md) for
 * core game events and replaces the generic ids other systems still play
 * directly (via AudioEngine.suppress, so nothing doubles):
 *
 * - player:footstep → step.<surface>.<walk|run> (replaces footstep*)
 * - player:landed   → step.<surface>.land layered under the generic landing
 * - player:dodged   → dodge.<element> (replaces the generic whoosh)
 * - player:glide    → loop.glide (speed-driven) while gliding
 * - element:switched → ui.element.<element> (replaces the generic whoosh)
 * - hit             → hit.<element> | hit.block | hit.kill, + hit.player on the
 *                     player (replaces CombatSystem's generic hit / block ids)
 * - player:blocked (perfect) → hit.parry; entity:killed → body.fall* (delayed)
 * - technique:failed → fail.nowater (dry fizz) | fail.chi | fail.cooldown | fail.generic
 * - water:drawn     → water.draw[.ice|.snow|.mist] / water.flask
 * - quests, techniques learned, mastery, level up, the Elements Sphere and
 *   discoveries → a musical stinger (MusicSystem) or, if music is inaudible,
 *   the UI fanfare (ui.quest.complete, ui.technique.learned, ui.mastery, ...)
 * - notifications → ui.notify.<kind>; save:written → ui.save; game:paused →
 *   muffles the world; ui:screen → ui.open / ui.close
 * - dialogue: ui.dialogue.open/close + formant babble voice.<type>[.ask|.short]
 *   per line, voice type from the NPC's role/nation.
 * - DOM delegation: hover / click / confirm / back / tab / slider / toggle on
 *   every button and control of the UI (capture phase; replaces ui_click).
 * Avatar State surge/release and the Sphere are voiced by the avatar system
 * itself (avatar.surge, loop.avatar.hum, ...); the music adds its choir bed.
 */

const LEGACY_STEPS = ['footstep', 'footstep_snow', 'footstep_stone', 'footstep_water'] as const;
const LEGACY_CLICKS = ['ui_click', 'ui_confirm', 'ui_back'] as const;
const NOTIFY_IDS: Record<NotifyKind, string> = {
  info: 'ui.notify.info',
  success: 'ui.notify.success',
  warning: 'ui.notify.warning',
  learn: 'ui.notify.learn',
  discovery: 'ui.notify.discovery',
  quest: 'ui.notify.quest',
  error: 'ui.notify.error',
  avatar: 'ui.notify.avatar',
};

/** NPC voice type from role / nation / id (deterministic). */
export function voiceTypeFor(def: { id: string; role?: string; nation?: string; element?: string } | undefined): string {
  if (!def) return 'male';
  let h = 0;
  for (let i = 0; i < def.id.length; i++) h = (h * 31 + def.id.charCodeAt(i)) >>> 0;
  const fem = h % 2 === 1;
  if (def.id.includes('spirit')) return 'spirit';
  switch (def.role) {
    case 'child':
      return 'child';
    case 'monk':
      return 'monk';
    case 'elder':
      return fem ? 'elder_f' : 'elder_m';
    case 'noble':
      return fem ? 'female' : 'noble';
    case 'guard':
    case 'soldier':
      return 'gruff';
    case 'master':
      return def.element === 'air' || def.nation === 'air' ? 'monk' : fem ? 'elder_f' : 'elder_m';
    default:
      return def.nation === 'air' && !fem ? 'monk' : fem ? 'female' : 'male';
  }
}

export class AudioEvents implements GameSystem {
  private ctx!: GameContext;
  private glide: LoopHandle | null = null;
  private glideGen = -1;
  private talking: { npcId: string; voice: string } | null = null;
  private lastFail = -9;
  private lastDraw = -9;
  private readonly lastNotify: Partial<Record<NotifyKind, number>> = {};
  private lastHover: Element | null = null;
  private lastHoverAt = 0;
  private lastSlider = 0;
  /** Counts of bound events (debug/tests). */
  readonly counts: Record<string, number> = {};

  init(ctx: GameContext): void {
    this.ctx = ctx;
    const ev = ctx.events;
    const a = ctx.audio;
    const on = <K extends keyof GameEvents>(name: K, fn: (e: GameEvents[K]) => void): void => {
      ev.on(name, (e: GameEvents[K]) => {
        this.counts[name] = (this.counts[name] ?? 0) + 1;
        try {
          fn(e);
        } catch (err) {
          console.warn(`[Audio] binding ${String(name)} failed`, err);
        }
      });
    };

    // ---- movement ----
    on('player:footstep', (e) => {
      a.suppress(LEGACY_STEPS, { position: e.position, radius: 2 });
      const vol = Math.min(1.1, 0.45 + e.speed * 0.05) * (e.heavy ? 1.3 : 1);
      a.play(stepId(e.surface, e.speed), { position: e.position, volume: vol, pitch: e.heavy ? 0.85 : 1 });
    });
    on('player:landed', (e) => {
      a.play(stepId(e.surface, 0, true), { position: e.position, volume: Math.max(0.35, Math.min(1.2, e.speed / 13)) });
      if (e.speed > 18) a.play('body.fall', { position: e.position, volume: 0.6 });
    });
    on('player:dodged', (e) => {
      a.suppress('whoosh', { position: e.position, radius: 2 });
      a.play(`dodge.${e.element}`, { position: e.position, volume: 0.85 });
    });
    on('player:glide', (e) => this.setGlide(e.active));
    on('element:switched', (e) => {
      a.suppress('whoosh');
      a.play(`ui.element.${e.element}`, { bus: 'ui', volume: 0.75 });
    });

    // ---- combat ----
    on('hit', (e) => {
      a.suppress(['hit', 'rock_impact'], { position: e.position, radius: 0.75 });
      const pos = e.position;
      if (e.blocked) a.play('hit.block', { position: pos, volume: 0.8 });
      else {
        a.play(`hit.${e.element}`, { position: pos, volume: Math.min(1.2, 0.55 + e.damage / 40) });
        if (e.killed) a.play('hit.kill', { position: pos, volume: 0.8 });
      }
      if (e.targetKind === 'player' && !e.blocked) a.play('hit.player', { volume: Math.min(1, 0.5 + e.damage / 50) });
    });
    on('player:blocked', (e) => {
      if (e.perfect) a.play('hit.parry', { position: ctx.player?.position, volume: 0.9 });
    });
    on('entity:killed', (e) => {
      if (e.kind === 'target' || e.kind === 'object') return;
      const water = ctx.world.waterAt(e.position.x, e.position.z);
      const big = e.tags.includes('boss') || e.tags.includes('large') || e.tags.includes('beast');
      const id = water && water.level > e.position.y - 0.3 ? 'body.fall.water' : big ? 'body.fall.heavy' : 'body.fall';
      a.play(id, { position: e.position, delay: 0.45, volume: 0.9 });
    });
    on('player:defeated', () => {
      const p = ctx.player?.position;
      if (p) a.play('body.fall', { position: p, delay: 0.3 });
    });
    on('technique:failed', (e) => {
      // A water attack with empty hands beside a source becomes a gather (it plays the draw sounds itself).
      if (e.reason === 'gather') return;
      const t = ctx.time.real;
      if (t - this.lastFail < 0.3) return;
      this.lastFail = t;
      const id = e.reason === 'water' ? 'fail.nowater' : e.reason === 'chi' ? 'fail.chi' : e.reason === 'cooldown' ? 'fail.cooldown' : 'fail.generic';
      a.play(id, { bus: 'ui', volume: 0.7 });
    });
    on('water:drawn', (e) => {
      const t = ctx.time.real;
      if (t - this.lastDraw < 0.6) return;
      this.lastDraw = t;
      const st = e.sourceType;
      const id = st === 'flask' ? 'water.flask' : st === 'ice' ? 'water.draw.ice' : st === 'snow' ? 'water.draw.snow' : st === 'moisture' || st === 'rain' ? 'water.draw.mist' : 'water.draw';
      a.play(id, { position: e.position, volume: Math.min(1, 0.5 + e.amount / 40) });
    });

    // ---- progression & world (stinger, else UI fanfare) ----
    on('location:discovered', () => this.fanfare('discovery', 'ui.discovery'));
    on('quest:started', () => this.fanfare('questStart', 'ui.quest.start'));
    on('quest:updated', () => a.play('ui.quest.update', { bus: 'ui', volume: 0.6 }));
    on('quest:completed', () => this.fanfare('quest', 'ui.quest.complete'));
    on('technique:learned', (e) => {
      if (e.source === 'start' || e.source === 'debug') return;
      this.fanfare('learn', 'ui.technique.learned');
    });
    on('mastery:achieved', () => this.fanfare('mastery', 'ui.mastery'));
    on('elementsSphere:unlocked', () => this.fanfare('sphere', 'ui.sphere.unlocked'));
    on('level:up', () => this.fanfare('levelup', 'ui.levelup'));
    on('item:acquired', () => a.play('ui.pickup', { bus: 'ui', volume: 0.55 }));
    on('save:written', (e) => a.play('ui.save', { bus: 'ui', volume: e.auto ? 0.35 : 0.7 }));
    on('save:failed', () => a.play('ui.error', { bus: 'ui', volume: 0.7 }));
    on('game:paused', (e) => a.setMuffled(e.paused));
    on('session:ended', () => {
      a.setMuffled(false);
      this.setGlide(false);
    });
    on('ui:screen', (e) => {
      if (ctx.game.mode !== 'play') return;
      a.play(e.screen ? 'ui.open' : 'ui.close', { bus: 'ui', volume: 0.55 });
    });

    // ---- dialogue ----
    on('dialogue:started', (e) => {
      const def = ctx.npcs.getDef(e.npcId);
      this.talking = { npcId: e.npcId, voice: voiceTypeFor(def) };
      a.play('ui.dialogue.open', { bus: 'ui', volume: 0.6 });
    });
    on('dialogue:ended', () => {
      this.talking = null;
      a.play('ui.dialogue.close', { bus: 'ui', volume: 0.5 });
    });
    this.wrapUI();
    this.installDom();
    ctx.audio.addTicker(() => this.tickGlide());
    installAudioDebug(ctx);
  }

  /** Musical stinger when music is audible, otherwise the UI fanfare. */
  private fanfare(kind: StingerKind, uiId: string): void {
    const music = this.ctx.extra.get('audio_music') as MusicSystem | undefined;
    if (music?.stinger(kind)) return;
    this.ctx.audio.play(uiId, { bus: 'ui', volume: 0.8 });
  }

  private setGlide(on: boolean): void {
    if (on && !this.glide && this.ctx.audio.ready) {
      this.glide = this.ctx.audio.loop('loop.glide', { volume: 0.5, bus: 'sfx' });
      this.glideGen = this.ctx.audio.generation;
    } else if (!on && this.glide) {
      this.glide.stop(0.35);
      this.glide = null;
    }
  }

  private tickGlide(): void {
    if (!this.glide) return;
    const p = this.ctx.player;
    if (this.glideGen !== this.ctx.audio.generation || !p || !p.gliding) {
      this.setGlide(false);
      return;
    }
    const v = p.body?.velocity;
    const speed = v ? Math.hypot(v.x, v.y, v.z) : 8;
    this.glide.setParam('speed', Math.min(1, speed / 22));
    this.glide.setVolume(0.35 + Math.min(0.5, speed / 40));
  }

  /** Wrap UIManager.notify / showDialogue (covers both event and direct calls). */
  private wrapUI(): void {
    const ui = this.ctx.ui as unknown as Record<string, unknown>;
    const a = this.ctx.audio;
    const notify = ui.notify as ((text: string, kind?: NotifyKind, ...rest: unknown[]) => void) | undefined;
    if (typeof notify === 'function') {
      ui.notify = (text: string, kind: NotifyKind = 'info', ...rest: unknown[]) => {
        a.suppress('notify', { frames: 2 });
        this.counts['ui.notify'] = (this.counts['ui.notify'] ?? 0) + 1;
        const t = this.ctx.time.real;
        // Rate-limit per kind (toast spam) and let a just-played failure sound speak for error toasts.
        const quiet = t - (this.lastNotify[kind] ?? -9) < 0.35 || (kind === 'error' && t - this.lastFail < 0.3);
        if (!quiet) {
          this.lastNotify[kind] = t;
          // Discovery/quest/learn toasts usually accompany a fanfare: keep them soft.
          const soft = kind === 'discovery' || kind === 'learn' || kind === 'quest';
          a.play(NOTIFY_IDS[kind] ?? 'ui.notify.info', { bus: 'ui', volume: soft ? 0.35 : 0.6 });
        }
        return notify.call(this.ctx.ui, text, kind, ...rest);
      };
    }
    const show = ui.showDialogue as ((v: { speaker: string; text: string }) => void) | undefined;
    if (typeof show === 'function') {
      ui.showDialogue = (v: { speaker: string; text: string }) => {
        this.counts['dialogue:line'] = (this.counts['dialogue:line'] ?? 0) + 1;
        this.speak(v.text ?? '');
        return show.call(this.ctx.ui, v as never);
      };
    }
  }

  /** NPC babble for one dialogue line. */
  private speak(text: string): void {
    const t = this.talking;
    const voice = t?.voice ?? 'male';
    const kind = /\?\s*["”']?\s*$/.test(text) ? '.ask' : text.length < 40 ? '.short' : '';
    const pos: Vec3Like | undefined = t ? this.ctx.npcs.positionOf(t.npcId) ?? undefined : undefined;
    const p = pos ? { x: pos.x, y: pos.y + 1.6, z: pos.z } : undefined;
    this.ctx.audio.play(`voice.${voice}${kind}`, { position: p, volume: 0.9, range: 40 });
  }

  /** Delegated DOM listeners: every button/control in the UI gets hover/click feedback. */
  private installDom(): void {
    if (typeof document === 'undefined') return;
    const a = this.ctx.audio;
    const SEL = 'button, .btn, [role="button"], .tab, .slot, select';
    document.addEventListener(
      'pointerover',
      (ev) => {
        if ((ev as PointerEvent).pointerType && (ev as PointerEvent).pointerType !== 'mouse') return;
        const el = (ev.target as Element | null)?.closest?.(SEL);
        if (!el || el === this.lastHover) return;
        this.lastHover = el;
        if ((el as HTMLButtonElement).disabled) return;
        const t = performance.now();
        if (t - this.lastHoverAt < 45) return;
        this.lastHoverAt = t;
        a.play('ui.hover', { bus: 'ui', volume: 0.45 });
      },
      { capture: true, passive: true },
    );
    document.addEventListener(
      'click',
      (ev) => {
        const el = (ev.target as Element | null)?.closest?.(SEL) as HTMLElement | null;
        if (!el || (el as HTMLButtonElement).disabled || el.tagName === 'SELECT') return;
        this.counts['ui:click'] = (this.counts['ui:click'] ?? 0) + 1;
        a.suppress(LEGACY_CLICKS, { frames: 2, seconds: 0.25 });
        const label = (el.textContent ?? '').trim().toLowerCase();
        const action = el.getAttribute('data-action') ?? '';
        const id = el.classList.contains('tab')
          ? 'ui.tab'
          : el.classList.contains('primary')
            ? 'ui.confirm'
            : el.classList.contains('danger') || /^(back|cancel|close|no|resume|return)\b/.test(label) || /back|close|cancel/.test(action)
              ? 'ui.back'
              : 'ui.click';
        a.play(id, { bus: 'ui', volume: 0.7 });
      },
      { capture: true, passive: true },
    );
    document.addEventListener(
      'input',
      (ev) => {
        const el = ev.target as HTMLInputElement | null;
        if (!el || el.tagName !== 'INPUT' || el.type !== 'range') return;
        const t = performance.now();
        if (t - this.lastSlider < 50) return;
        this.lastSlider = t;
        const min = Number(el.min || 0), max = Number(el.max || 1), v = Number(el.value);
        const k = max > min && Number.isFinite(v) ? (v - min) / (max - min) : 0.5;
        a.play('ui.slider', { bus: 'ui', volume: 0.5, pitch: 0.75 + k * 0.6 });
      },
      { capture: true, passive: true },
    );
    document.addEventListener(
      'change',
      (ev) => {
        const el = ev.target as HTMLInputElement | null;
        if (el?.tagName === 'INPUT' && el.type === 'checkbox') a.play('ui.toggle', { bus: 'ui', volume: 0.6, pitch: el.checked ? 1.08 : 0.92 });
        else if (el?.tagName === 'SELECT') a.play('ui.click', { bus: 'ui', volume: 0.6 });
      },
      { capture: true, passive: true },
    );
  }

  state(): Record<string, unknown> {
    return { counts: { ...this.counts }, gliding: !!this.glide, talking: this.talking };
  }
}
