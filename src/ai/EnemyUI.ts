import * as THREE from 'three';
import type { GameContext } from '../core/GameContext';
import type { Enemy } from './Enemy';

/**
 * Enemy HUD layer (own DOM, mounted inside the HUD element so it hides with it):
 *  - small health bars above enemies that are damaged, locked or fighting;
 *  - name plates (name · level · title) for elites and bosses;
 *  - "?" / "!" awareness markers when an enemy starts investigating / spots you;
 *  - a boss health bar (name, title, phase) at the top of the screen during boss fights;
 *  - off-screen threat arrows for attackers outside the view (behind the camera).
 */

const CSS = `
.enm-layer{position:absolute;inset:0;pointer-events:none;overflow:hidden;font-family:inherit}
.enm-plate{position:absolute;left:0;top:0;transform-origin:50% 100%;display:flex;flex-direction:column;align-items:center;gap:2px;will-change:transform}
.enm-name{font-size:12px;color:#f3e6c8;text-shadow:0 1px 2px #000,0 0 6px #000;white-space:nowrap;letter-spacing:.02em}
.enm-name b{color:#ffcf7a;font-weight:600}
.enm-name i{display:block;text-align:center;font-style:normal;font-size:10px;color:#d8c8a8;opacity:.85}
.enm-bar{position:relative;width:64px;height:6px;background:rgba(10,8,6,.75);border:1px solid rgba(0,0,0,.8);border-radius:3px;overflow:hidden;box-shadow:0 0 4px rgba(0,0,0,.6)}
.enm-plate.elite .enm-bar{width:88px;height:7px;border-color:#7a5a20}
.enm-plate.boss .enm-bar{display:none}
.enm-fill,.enm-ghost{position:absolute;left:0;top:0;bottom:0;width:100%;transform-origin:0 50%}
.enm-ghost{background:#f0d8a0;opacity:.55}
.enm-fill{background:linear-gradient(#e0503a,#a02818)}
.enm-plate.guard .enm-fill{background:linear-gradient(#c8c8d8,#7a7a90)}
.enm-mark{font:700 20px/1 serif;color:#ffd040;text-shadow:0 0 6px #000,0 1px 2px #000;height:20px}
.enm-mark.alert{color:#ff4a30}
.enm-boss{position:absolute;bottom:96px;left:50%;transform:translateX(-50%);width:min(560px,62vw);text-align:center;transition:opacity .4s}
.enm-boss.hidden{opacity:0}
.enm-boss .t{font-size:18px;color:#ffe2b0;text-shadow:0 2px 4px #000;letter-spacing:.06em}
.enm-boss .s{font-size:12px;color:#d8c09a;text-shadow:0 1px 3px #000;margin-bottom:4px}
.enm-boss .bb{position:relative;height:12px;background:rgba(10,6,4,.8);border:1px solid #8a6a2a;border-radius:2px;overflow:hidden;box-shadow:0 0 10px rgba(0,0,0,.7)}
.enm-boss .bb .enm-fill{background:linear-gradient(#ff6a3a,#9a1c10)}
.enm-boss .pips{position:absolute;inset:0}
.enm-boss .pips span{position:absolute;top:0;bottom:0;width:2px;background:rgba(255,230,180,.7)}
.enm-arrow{position:absolute;left:0;top:0;width:0;height:0;border-left:11px solid transparent;border-right:11px solid transparent;border-bottom:20px solid #ff4a30;filter:drop-shadow(0 0 4px rgba(0,0,0,.9));transform-origin:50% 50%}
.enm-arrow.tell{border-bottom-color:#ffd040}
`;

interface Plate {
  el: HTMLElement;
  name: HTMLElement;
  fill: HTMLElement;
  ghost: HTMLElement;
  mark: HTMLElement;
  ghostV: number;
  sig: string;
}

const tmp = new THREE.Vector3();
const camF = new THREE.Vector3();

export class EnemyUI {
  private layer: HTMLElement | null = null;
  private style: HTMLStyleElement | null = null;
  private readonly plates = new Map<number, Plate>();
  private boss: { el: HTMLElement; t: HTMLElement; s: HTMLElement; fill: HTMLElement; ghost: HTMLElement; pips: HTMLElement; id: number; ghostV: number } | null = null;
  private arrows: HTMLElement[] = [];
  /** Currently shown boss id (tests). */
  bossShown = 0;
  platesShown = 0;
  arrowsShown = 0;

  private mount(ctx: GameContext): boolean {
    if (this.layer) return true;
    const hud = ctx.ui.hud?.el;
    if (!hud) return false;
    this.style = document.createElement('style');
    this.style.textContent = CSS;
    document.head.appendChild(this.style);
    this.layer = document.createElement('div');
    this.layer.className = 'enm-layer';
    hud.appendChild(this.layer);
    const el = document.createElement('div');
    el.className = 'enm-boss hidden';
    el.innerHTML = '<div class="t"></div><div class="s"></div><div class="bb"><div class="enm-ghost"></div><div class="enm-fill"></div><div class="pips"></div></div>';
    this.layer.appendChild(el);
    this.boss = { el, t: el.querySelector('.t')!, s: el.querySelector('.s')!, fill: el.querySelector('.bb .enm-fill')!, ghost: el.querySelector('.bb .enm-ghost')!, pips: el.querySelector('.pips')!, id: 0, ghostV: 1 };
    return true;
  }

  private plate(e: Enemy): Plate {
    let p = this.plates.get(e.id);
    if (p) return p;
    const el = document.createElement('div');
    el.className = `enm-plate ${e.rank}`;
    el.innerHTML = '<div class="enm-mark"></div><div class="enm-name"></div><div class="enm-bar"><div class="enm-ghost"></div><div class="enm-fill"></div></div>';
    this.layer!.appendChild(el);
    p = { el, mark: el.querySelector('.enm-mark')!, name: el.querySelector('.enm-name')!, fill: el.querySelector('.enm-bar .enm-fill')!, ghost: el.querySelector('.enm-bar .enm-ghost')!, ghostV: 1, sig: '' };
    this.plates.set(e.id, p);
    return p;
  }

  update(dt: number, ctx: GameContext, enemies: readonly Enemy[]): void {
    if (!this.mount(ctx) || !this.layer) return;
    const player = ctx.player;
    const cam = ctx.camera;
    const now = ctx.time.elapsed;
    const W = window.innerWidth, H = window.innerHeight;
    const seen = new Set<number>();
    let bossE: Enemy | null = null;
    let arrowsUsed = 0;
    this.platesShown = 0;
    cam.getWorldDirection(camF).setY(0).normalize();
    const camRx = -camF.z, camRz = camF.x;
    for (const e of enemies) {
      if (e.isReleased || !player) continue;
      const dist = e.position.distanceTo(player.position);
      const fighting = e.brain.state === 'combat' && !e.defeated;
      if (e.rank === 'boss' && !e.defeated && (fighting || now - e.lastDamagedT < 8) && dist < 80) {
        if (!bossE || dist < bossE.position.distanceTo(player.position)) bossE = e;
      }
      const marker = now - e.alertT < 1.8 && !e.defeated ? (e.brain.state === 'investigate' ? '?' : e.brain.state === 'combat' ? '!' : '') : '';
      const show =
        !e.defeated &&
        dist < 50 &&
        ((e.rank !== 'minion' && dist < 40) || now - e.lastDamagedT < 6 || player.lockTarget === e || (fighting && dist < 26) || marker !== '');
      tmp.copy(e.position).setY(e.position.y + e.height + 0.3);
      tmp.project(cam);
      const onScreen = tmp.z < 1 && tmp.z > -1 && Math.abs(tmp.x) < 1.05 && Math.abs(tmp.y) < 1.05;
      if (show && onScreen) {
        const p = this.plate(e);
        seen.add(e.id);
        this.platesShown++;
        const x = (tmp.x * 0.5 + 0.5) * W, y = (-tmp.y * 0.5 + 0.5) * H;
        const sc = Math.max(0.65, Math.min(1.1, 16 / Math.max(1, dist)));
        p.el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-100%) scale(${sc.toFixed(3)})`;
        p.el.style.display = '';
        const sig = `${e.name}|${e.level}`;
        if (p.sig !== sig) {
          p.sig = sig;
          p.name.innerHTML = e.rank === 'minion' ? '' : e.rank === 'boss' ? `<b>${e.name}</b>` : `${e.name} <b>Lv ${e.level}</b>${e.arch.title ? `<i>${e.arch.title}</i>` : ''}`;
        }
        const f = Math.max(0, e.hpFraction);
        p.ghostV = Math.max(f, p.ghostV - dt * 0.6);
        p.fill.style.transform = `scaleX(${f.toFixed(3)})`;
        p.ghost.style.transform = `scaleX(${p.ghostV.toFixed(3)})`;
        p.el.classList.toggle('guard', e.guarding);
        p.mark.textContent = marker;
        p.mark.classList.toggle('alert', marker === '!');
      }
      // Off-screen threat arrows: fighting enemies outside the view.
      if (fighting && dist < 32 && !onScreen && arrowsUsed < 6) {
        const dx = e.position.x - player.position.x, dz = e.position.z - player.position.z;
        const ang = Math.atan2(dx * camRx + dz * camRz, dx * camF.x + dz * camF.z);
        let a = this.arrows[arrowsUsed];
        if (!a) {
          a = document.createElement('div');
          a.className = 'enm-arrow';
          this.layer.appendChild(a);
          this.arrows.push(a);
        }
        const R = Math.min(W, H) * 0.36;
        const ax = W / 2 + Math.sin(ang) * R, ay = H / 2 - Math.cos(ang) * R;
        a.style.display = '';
        a.style.opacity = String(Math.max(0.35, 1 - dist / 32));
        a.style.transform = `translate(${(ax - 11).toFixed(1)}px,${(ay - 10).toFixed(1)}px) rotate(${ang.toFixed(3)}rad)`;
        a.classList.toggle('tell', !!e.attack && e.attack.phase === 'tell');
        arrowsUsed++;
      }
    }
    for (const [id, p] of this.plates) {
      if (seen.has(id)) continue;
      const alive = enemies.some((x) => x.id === id && !x.isReleased);
      if (!alive) {
        p.el.remove();
        this.plates.delete(id);
      } else p.el.style.display = 'none';
    }
    for (let i = arrowsUsed; i < this.arrows.length; i++) this.arrows[i].style.display = 'none';
    this.arrowsShown = arrowsUsed;
    // Boss bar.
    const b = this.boss!;
    if (bossE) {
      if (b.id !== bossE.id) {
        b.id = bossE.id;
        b.ghostV = 1;
        b.t.textContent = bossE.name;
        b.pips.innerHTML = (bossE.arch.phases ?? []).map((ph) => `<span style="left:${(ph.at * 100).toFixed(1)}%"></span>`).join('');
      }
      const ph = bossE.phaseIndex >= 0 ? bossE.arch.phases?.[bossE.phaseIndex]?.name : null;
      b.s.textContent = `${bossE.arch.title ?? ''} · Lv ${bossE.level}${ph ? ` · ${ph}` : ''}`;
      const f = Math.max(0, bossE.hpFraction);
      b.ghostV = Math.max(f, b.ghostV - dt * 0.35);
      b.fill.style.transform = `scaleX(${f.toFixed(3)})`;
      b.ghost.style.transform = `scaleX(${b.ghostV.toFixed(3)})`;
      b.el.classList.remove('hidden');
      this.bossShown = bossE.id;
    } else {
      b.el.classList.add('hidden');
      this.bossShown = 0;
    }
  }

  clear(): void {
    for (const p of this.plates.values()) p.el.remove();
    this.plates.clear();
    for (const a of this.arrows) a.style.display = 'none';
    if (this.boss) {
      this.boss.el.classList.add('hidden');
      this.boss.id = 0;
    }
    this.bossShown = 0;
  }
}
