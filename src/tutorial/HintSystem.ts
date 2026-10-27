import type { GameContext, GameSystem } from '../core/GameContext';
import type { Action } from '../core/Input';
import type { Persistable } from '../core/Save';
import { h } from '../ui/dom';

/**
 * One-time contextual hints during campaigns (Settings → Gameplay → Tutorial
 * hints). Each hint shows at most once per journey (persisted), one at a time.
 * Text uses {action} placeholders rendered as the current key bindings.
 */

interface HintDef {
  id: string;
  text: string;
  /** Wording for touch screens (on-screen buttons instead of keys). */
  touch?: string;
}

const HINTS: Record<string, HintDef> = {
  start: { id: 'start', text: 'Follow the ◆ marker on your compass to your objective. Press {journal} for your journal and {map} for the world map.', touch: 'Follow the ◆ marker on your compass to your objective. Tap MAP for the world map and MENU for your journal.' },
  near_water: { id: 'near_water', text: 'Water nearby! Hold {drawWater} to draw it to you — waterbending needs real water.', touch: 'Water nearby! Hold DRAW to pull it into your hands — waterbending needs real water.' },
  no_water: { id: 'no_water', text: 'No water within reach. Find a river, the sea, a pond or ice — or draw water beforehand and carry it with you.' },
  glide: { id: 'glide', text: 'Hold {jump} while falling to glide on the wind.', touch: 'Hold JUMP while falling to glide on the wind.' },
  new_element: { id: 'new_element', text: 'You can bend a new element! Press {elementNext} or scroll to switch elements.', touch: 'You can bend a new element! Tap the element button on the left to switch.' },
  master: { id: 'master', text: 'Masters (✦) teach techniques you cannot learn anywhere else. Press {interact} to speak with them.', touch: 'Masters (✦) teach techniques you cannot learn anywhere else. Walk up and tap the speech button to talk to them.' },
  combat: { id: 'combat', text: 'Under attack! {dodge} to dodge, {lockOn} to lock on, hold {aim} to charge a heavy technique.', touch: 'Under attack! Tap DODGE to dodge, LOCK to lock on, and hold HEAVY to charge a heavy technique.' },
  learned: { id: 'learned', text: 'New techniques go into slots {ability1}–{ability4}. Rearrange them in the Technique Library ({techniques}).', touch: 'New techniques fill your technique buttons. Rearrange them in MENU → Techniques.' },
  avatar: { id: 'avatar', text: 'In danger? Press {avatarState} to enter the Avatar State.', touch: 'In danger? Tap AVATAR at the top of the screen to enter the Avatar State.' },
  sphere: { id: 'sphere', text: 'The Elements Sphere! Unleash Hurricane, Tsunami, Earthquake and Fire Tornado with {ability1}–{ability4}, and the Avatar Cataclysm with {ability5}.', touch: 'The Elements Sphere! Unleash Hurricane, Tsunami, Earthquake and Fire Tornado with your technique buttons, and the Avatar Cataclysm with the fifth.' },
  defeated: { id: 'defeated', text: 'The Avatar recovers at the last safe place. Nothing is lost.' },
  play_water: { id: 'play_water', text: 'Hold {attack} while looking at water to draw out a floating orb. Look up and down to steer it; let go to drop it.', touch: 'Hold ATTACK while looking at water to draw out a floating orb. Slide your thumb to steer it; let go to drop it.' },
  play_earth: { id: 'play_earth', text: 'Hold {attack} to lift the rock you look at, or to tear a stone out of the ground in front of you. Look around to move it; let go to set it down.', touch: 'Hold ATTACK to lift the rock you look at, or to tear a stone out of the ground in front of you. Slide your thumb to move it; let go to set it down.' },
  play_fire: { id: 'play_fire', text: 'Out of combat, hold {attack} to kindle a small flame in your palm.', touch: 'Out of combat, hold ATTACK to kindle a small flame in your palm.' },
};

export class HintSystem implements GameSystem, Persistable {
  readonly saveKey = 'hints';
  private ctx!: GameContext;
  private seen = new Set<string>();
  private queue: HintDef[] = [];
  private el: HTMLElement | null = null;
  private showTimer = 0;
  private checkTimer = 0;
  /** Seconds something to play with (water, a rock, a free hand) has been in view. */
  private playSeen = 0;

  init(ctx: GameContext): void {
    this.ctx = ctx;
    const ev = ctx.events;
    ev.on('water:unavailable', () => this.trigger('no_water'));
    ev.on('element:unlocked', () => this.trigger('new_element'));
    ev.on('technique:learned', (e) => {
      if (e.source === 'master' || e.source === 'quest') this.trigger('learned');
    });
    ev.on('player:damaged', () => this.trigger('combat'));
    ev.on('player:defeated', () => this.trigger('defeated'));
    ev.on('avatarState:changed', (e) => {
      if (e.active && e.sphere) this.trigger('sphere');
    });
  }

  private get enabled(): boolean {
    return this.ctx.session.kind === 'campaign' && this.ctx.settings.data.gameplay.tutorialHints;
  }

  trigger(id: string): void {
    if (!this.enabled || this.seen.has(id)) return;
    const def = HINTS[id];
    if (!def) return;
    this.seen.add(id);
    this.queue.push(def);
  }

  onSessionStart(ctx: GameContext, isNew: boolean): void {
    if (isNew) setTimeout(() => this.trigger('start'), 6000);
    void ctx;
  }

  onSessionEnd(): void {
    this.el?.remove();
    this.el = null;
    this.queue = [];
  }

  private render(def: HintDef): void {
    this.el?.remove();
    const touch = document.getElementById('ui')?.classList.contains('touch-on') ?? false;
    const text = (touch && def.touch ? def.touch : def.text).replace(/\{(\w+)\}/g, (_m, a: string) => `<span class="kbd">${this.ctx.input.label(a as Action)}</span>`);
    this.el = h('div.hint-toast', { html: `<span class="hint-icon">✦</span> ${text}` });
    this.ctx.ui.layers.overlay.appendChild(this.el);
    this.showTimer = 8;
  }

  update(dt: number): void {
    if (!this.enabled) return;
    if (this.el) {
      this.showTimer -= dt;
      if (this.showTimer <= 0) {
        const el = this.el;
        el.classList.add('out');
        setTimeout(() => el.remove(), 400);
        this.el = null;
      }
    } else if (this.queue.length && !this.ctx.ui.dialogueOpen) {
      this.render(this.queue.shift()!);
    }
    // Periodic situational checks.
    this.checkTimer -= dt;
    if (this.checkTimer > 0) return;
    this.checkTimer = 0.5;
    const p = this.ctx.player;
    if (!p) return;
    if (p.element === 'water' && p.waterReserve < 10 && !this.seen.has('near_water')) {
      const hit = this.ctx.water.findBest(p.position, this.ctx.water.drawRange, { allowLiquid: true });
      if (hit && !hit.frozen) this.trigger('near_water');
    }
    if (p.element === 'air' && p.body && !p.body.grounded && p.body.velocity.y < -8 && !p.gliding) this.trigger('glide');
    // Playful bending: once something to play with has been in view for a moment.
    if (p.element !== 'air' && !this.seen.has('play_' + p.element)) {
      const k = p.play.hintFor();
      this.playSeen = k ? this.playSeen + 0.5 : 0;
      if (k && this.playSeen >= 1.5) this.trigger('play_' + k);
    }
    const inter = this.ctx.interactions.current;
    if (inter && inter.priority === 2) this.trigger('master');
    if (p.health && p.health.hp / p.health.maxHp < 0.35 && !this.ctx.avatar.active && this.ctx.avatar.spirit > 20) this.trigger('avatar');
  }

  serialize(): unknown {
    if (this.ctx?.session.kind !== 'campaign') return undefined;
    return { seen: [...this.seen] };
  }

  deserialize(data: any): void {
    if (data && Array.isArray(data.seen)) for (const s of data.seen) if (typeof s === 'string') this.seen.add(s);
  }

  reset(): void {
    this.seen.clear();
    this.queue = [];
  }
}
