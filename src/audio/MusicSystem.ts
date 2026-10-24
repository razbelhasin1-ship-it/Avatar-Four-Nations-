import type { GameContext, GameSystem } from '../core/GameContext';
import type { StingerKind } from './music/MusicDirector';

/**
 * Music director module: decides WHAT the generative MusicDirector
 * (src/audio/music) plays from the game state.
 *
 * - Theme: 'menu' on the main menu, 'spirit' in the tutorial, otherwise the
 *   theme of the region the player stands in (water / earth / fire / air /
 *   desert / swamp / wild / spirit), re-evaluated every second so walking
 *   across a border crossfades (MusicDirector crossfades over ~3 s). Edge-
 *   triggered, so an explicit setMusicTheme(null) (quit screen) is respected.
 * - Combat layer: hits between the player and enemies/creatures and damage
 *   taken pulse the intensity; enemies in 'combat' state targeting the player
 *   nearby hold it up (bosses push it to full). It decays ~7 s after combat.
 * - Stingers (in the current key, ducking the bed) for discoveries, quests,
 *   learned techniques, mastery, level up, the Elements Sphere and defeat via
 *   `stinger()`, which reports false when music is inaudible so the event
 *   bindings can fall back to the UI fanfare instead (never both).
 * - Dialogue ducks the music; the Avatar State adds a choir bed.
 * Debug: window.__game.debug.audio.music.
 */
export class MusicSystem implements GameSystem {
  private ctx!: GameContext;
  private acc = 0;
  private engagedAcc = 0;
  private lastDesired: string | null | undefined = undefined;
  /** Debug override: force a theme regardless of region (null = automatic). */
  forced: string | null = null;
  engaged = 0;
  boss = false;
  readonly stats = { themeChanges: 0, stingers: 0, fallbacks: 0, pulses: 0, lastTheme: null as string | null };

  init(ctx: GameContext): void {
    this.ctx = ctx;
    const ev = ctx.events;
    const music = () => ctx.audio.music;
    ctx.audio.addTicker((dt) => this.tick(dt));
    ev.on('region:entered', () => {
      this.acc = 1;
    });
    ev.on('hit', (e) => {
      const vsHostile = e.playerIsAttacker && (e.targetKind === 'enemy' || e.targetKind === 'creature');
      if (!vsHostile && e.targetKind !== 'player') return;
      if (this.isSparring()) return;
      music().pulseCombat(e.targetKind === 'player' ? 0.22 : e.killed ? 0.08 : 0.14);
      this.stats.pulses++;
    });
    ev.on('player:damaged', () => {
      if (!this.isSparring()) music().pulseCombat(0.08);
    });
    ev.on('player:defeated', () => {
      music().setCombat(0);
      this.stinger('defeat');
    });
    ev.on('avatarState:changed', (e) => music().setAvatar(e.active));
    ev.on('dialogue:started', () => music().setDucked(0.45));
    ev.on('dialogue:ended', () => music().setDucked(1));
    ev.on('session:ended', () => {
      music().setCombat(0);
      music().setAvatar(false);
      music().setDucked(1);
    });
  }

  private isSparring(): boolean {
    const enc = this.ctx.extra.get('encounters') as { enemies?: Array<{ sparring?: boolean; alive?: boolean }> } | undefined;
    const list = enc?.enemies;
    if (!list?.length) return false;
    let any = false;
    for (const e of list) {
      if (!e.alive) continue;
      if (!e.sparring) return false;
      any = true;
    }
    return any;
  }

  /** Theme the game state asks for (undefined = leave as is, e.g. while loading). */
  desiredTheme(): string | null | undefined {
    if (this.forced !== null) return this.forced;
    const g = this.ctx.game;
    if (g.mode === 'menu') return 'menu';
    if (g.mode !== 'play' || !this.ctx.session.active) return undefined;
    if (this.ctx.session.kind === 'tutorial') return 'spirit';
    const p = this.ctx.player?.position;
    if (!p) return undefined;
    const r = this.ctx.world.regionAt(p.x, p.z) ?? this.ctx.world.currentRegion;
    return r?.theme ?? 'wild';
  }

  /** Play a stinger if music is audible; false = caller should use a UI sound instead. */
  stinger(kind: StingerKind): boolean {
    const a = this.ctx.audio;
    if (!a.ready || a.busLevel('music') < 0.12) {
      this.stats.fallbacks++;
      return false;
    }
    const ok = a.music.stinger(kind);
    if (ok) this.stats.stingers++;
    else this.stats.fallbacks++;
    return ok;
  }

  private tick(dt: number): void {
    this.acc += dt;
    this.engagedAcc += dt;
    if (this.engagedAcc >= 0.5) {
      this.engagedAcc = 0;
      this.updateEngagement();
    }
    if (this.acc < 1) return;
    this.acc = 0;
    const want = this.desiredTheme();
    if (want === undefined || want === this.lastDesired) return;
    this.lastDesired = want;
    if (want !== this.ctx.audio.music.theme) {
      this.ctx.audio.setMusicTheme(want);
      this.stats.themeChanges++;
    }
    this.stats.lastTheme = want;
  }

  /** Enemies fighting the player keep the combat layer up (bosses: full intensity). */
  private updateEngagement(): void {
    const ctx = this.ctx;
    this.engaged = 0;
    this.boss = false;
    if (ctx.game.mode !== 'play' || !ctx.session.active || !ctx.player) return;
    const enc = ctx.extra.get('encounters') as { enemies?: Array<Record<string, any>> } | undefined;
    const list = enc?.enemies;
    if (!list?.length) return;
    const p = ctx.player.position;
    for (const e of list) {
      if (!e?.alive || e.sparring) continue;
      const brain = e.brain;
      if (brain?.state !== 'combat' || brain?.target?.kind !== 'player') continue;
      const pos = e.position;
      if (pos && Math.hypot(pos.x - p.x, pos.z - p.z) > 50) continue;
      this.engaged++;
      if (e.arch?.rank === 'boss') this.boss = true;
    }
    if (this.engaged > 0) {
      const m = ctx.audio.music;
      const level = this.boss ? 1 : Math.min(0.85, 0.4 + 0.12 * this.engaged);
      if (m.intensity < level || m.state().combatTarget < level) m.setCombat(Math.max(level, m.state().combatTarget));
    }
  }

  state(): Record<string, unknown> {
    return { ...this.ctx.audio.music.state(), desired: this.desiredTheme() ?? null, forced: this.forced, engaged: this.engaged, boss: this.boss, stats: { ...this.stats } };
  }
}
