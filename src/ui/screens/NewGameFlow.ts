import * as THREE from 'three';
import {
  BODY_OPTIONS,
  cloneAppearance,
  DEFAULT_APPEARANCE,
  EYE_COLORS,
  FACIAL_HAIR,
  FRAME_OPTIONS,
  HAIR_COLORS,
  HAIRSTYLES,
  SCARS,
  SKIN_TONES,
  TATTOO_COLORS,
  TATTOO_STYLES,
  type Appearance,
  type BodyType,
  type EyeShape,
  type OutfitSlots,
  withBodyType,
} from '../../character/Appearance';
import { FACE_PRESET_NAMES } from '../../character/CharShape';
import { Humanoid } from '../../character/Humanoid';
import { creatorPresets, isSuggestedName, NATION_NAMES, NATION_PALETTES, NAME_MAX, normalizeName, randomLook, suggestName, validateName, withPreset } from '../../character/looks';
import { createModel } from '../../companions/models';
import { defaultAnim, type AnimInput, type CreatureModel } from '../../companions/models/CreatureModel';
import type { GameContext } from '../../core/GameContext';
import { Random } from '../../core/Random';
import { SAVE_SLOTS } from '../../core/Save';
import { ELEMENT_INFO, ELEMENTS, type Element } from '../../core/types';
import { COSMETICS, type CosmeticDef, type CosmeticSlot } from '../../data/cosmetics';
import { SPECIES } from '../../data/creatures';
import { MASTERS } from '../../data/masters';
import { QUESTS } from '../../data/quests';
import { STARTS, regionById } from '../../world/WorldLayout';
import { clear, h } from '../dom';
import { ELEMENT_COLORS, emblem } from '../icons';
import type { Screen, UIManager } from '../UIManager';
import { gamepadNav, getVista } from './MainMenu';

/** Homeland companion shown beside the Avatar on the journey preview (studio scale keeps big creatures in frame). */
const COMPANION: Record<Element, { species: string; scale: number; x: number; z: number; yaw: number }> = {
  air: { species: 'sky_bison', scale: 0.5, x: 2.1, z: -2.2, yaw: -0.7 },
  water: { species: 'polar_bear_dog', scale: 0.75, x: 1.7, z: -1.4, yaw: -0.8 },
  earth: { species: 'badgermole', scale: 0.8, x: 1.7, z: -1.3, yaw: -0.8 },
  fire: { species: 'dragon', scale: 0.15, x: 1.8, z: -2.1, yaw: -0.35 },
};

/** The master who teaches in the start city, and the opening quest (data-driven). */
function startInfo(e: Element): { region: string; master: string | null; quest: { title: string; summary: string } | null } {
  const s = STARTS[e];
  const m = MASTERS.find((x) => x.element === e && x.region === s.regionId && !x.hidden);
  const q = QUESTS.find((x) => x.autoStart?.startingElement === e);
  return { region: regionById(s.regionId)?.name ?? '', master: m ? `${m.name}, ${m.title}` : null, quest: q ? { title: q.title, summary: q.summary ?? '' } : null };
}

const CARD_BG: Record<Element, string> = {
  air: 'linear-gradient(160deg, #f7e2b0 0%, #e8b04a 35%, #6a8fb8 100%)',
  water: 'linear-gradient(160deg, #e6f4ff 0%, #6aa6d6 40%, #1e3a66 100%)',
  earth: 'linear-gradient(160deg, #d8e8b0 0%, #6a9a4a 40%, #2f4f25 100%)',
  fire: 'linear-gradient(160deg, #ffd8a0 0%, #d0362a 45%, #2a1010 100%)',
};

/** Studio backdrop gradient (top, bottom), pedestal colour and accent ring colour per element. */
const STUDIO: Record<Element, { top: string; bottom: string; pedestal: string; ring: string }> = {
  air: { top: '#f6e2b4', bottom: '#6d86ab', pedestal: '#e6d6ae', ring: '#f2b640' },
  water: { top: '#d8eefa', bottom: '#24446e', pedestal: '#e2eef6', ring: '#5fb2f0' },
  earth: { top: '#d4e2ac', bottom: '#38482a', pedestal: '#8f7f5c', ring: '#7fbf4a' },
  fire: { top: '#f4bc8a', bottom: '#3a1414', pedestal: '#5a2a20', ring: '#ff6a2a' },
};

const STARTER_ITEMS: Record<Element, Array<{ name: string; detail: string }>> = {
  water: [
    { name: 'Water Tribe attire', detail: 'Warm parka and fur boots of the tribes.' },
    { name: 'Water Skin', detail: 'Carry a little bendable water anywhere.' },
    { name: '3 × Healing Herbs, 5 × Sea Prunes', detail: 'Supplies for the road (and for polar bear dogs).' },
  ],
  earth: [
    { name: 'Earth Kingdom attire', detail: 'Sturdy clothes from the Lower Ring.' },
    { name: 'Jade Pendant', detail: 'A simple green stone for luck.' },
    { name: '3 × Healing Herbs, 5 × Cabbages', detail: 'Supplies — and badgermoles love cabbage.' },
  ],
  fire: [
    { name: 'Fire Nation attire', detail: 'Proper clothes for the capital.' },
    { name: 'Leather Bracers', detail: 'Protection for quick strikes.' },
    { name: '3 × Healing Herbs, 5 × Fire Flakes', detail: 'Spicy supplies. Some creatures adore them.' },
  ],
  air: [
    { name: 'Air Nomad attire', detail: 'Light garments for running along the wind.' },
    { name: 'Glider Staff', detail: 'A gift from the temple elders.' },
    { name: '3 × Healing Herbs, 5 × Moon Peaches', detail: 'Sky bison cannot resist moon peaches.' },
  ],
};

const HOMELAND_CREATURES: Record<Element, string> = {
  water: 'Polar bear dogs roam the northern ice. Win their trust with patience and stewed sea prunes.',
  earth: 'Badgermoles tunnel beneath the Earth Kingdom; ostrich horses graze its farmland.',
  fire: 'Rare dragons are said to sleep near the ancient Sun Warrior ruins. Only the worthy approach.',
  air: 'Sky bison drift above the temple meadows. A gentle hand and moon peaches go a long way.',
};

/** Signature motion played by the "Strike a pose" button. */
const SHOWCASE: Record<Element, string> = { air: 'spin_360', water: 'circle_arms', earth: 'stomp', fire: 'strike_r' };

const BROW_NAMES = ['Natural', 'Arched', 'Angled', 'Bold', 'Fine', 'Soft'];
const EYE_SHAPES: Array<{ id: EyeShape; name: string }> = [
  { id: 'round', name: 'Round' },
  { id: 'almond', name: 'Almond' },
  { id: 'narrow', name: 'Narrow' },
  { id: 'wide', name: 'Wide' },
];
const NATION_ORDER: Array<Element | 'any'> = ['air', 'water', 'earth', 'fire', 'any'];
const SLOT_LABELS: Array<[keyof OutfitSlots, CosmeticSlot, string]> = [
  ['top', 'top', 'TOP / ROBE'],
  ['bottom', 'bottom', 'TROUSERS & SKIRTS'],
  ['footwear', 'footwear', 'FOOTWEAR'],
  ['outer', 'outer', 'OUTER LAYER'],
  ['gloves', 'gloves', 'GLOVES & WRAPS'],
  ['belt', 'belt', 'BELT / SASH'],
  ['headwear', 'headwear', 'HEADWEAR'],
  ['necklace', 'necklace', 'NECKLACE'],
  ['accessory', 'accessory', 'CARRIED'],
];
const EMPTY_IDS = new Set(['none', 'none_gloves', 'none_belt', 'none_head', 'none_neck', 'none_acc']);
/** Tabs and the camera view each one prefers. */
const TABS: Array<{ id: string; label: string; view: 'body' | 'face' }> = [
  { id: 'body', label: 'Body', view: 'body' },
  { id: 'face', label: 'Face', view: 'face' },
  { id: 'hair', label: 'Hair', view: 'face' },
  { id: 'marks', label: 'Markings', view: 'body' },
  { id: 'attire', label: 'Attire', view: 'body' },
  { id: 'colors', label: 'Colours', view: 'body' },
];

const CSS = `
.ngf-root { position: absolute; inset: 0; pointer-events: none; }
.ngf-stage { position: absolute; inset: 0; pointer-events: auto; touch-action: none; cursor: grab; }
.ngf-stage.dragging { cursor: grabbing; }
.ngf-left, .ngf-right { position: absolute; top: 16px; bottom: 16px; display: flex; flex-direction: column; min-height: 0; padding: 14px; pointer-events: auto; box-sizing: border-box; }
.ngf-left { left: 16px; width: min(390px, 36vw); }
.ngf-right { right: 16px; width: min(290px, 25vw); }
.ngf-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.ngf-head h2 { margin: 0; font-size: 20px; flex: 1; }
.ngf-name { display: flex; gap: 6px; }
.ngf-name input { flex: 1; min-width: 0; }
.ngf-name button { flex: 0 0 auto; padding: 0 10px; }
.ngf-error { color: #ffab8f; font-size: 13px; min-height: 16px; margin-top: 2px; }
.ngf-error.ok { color: var(--muted); }
.ngf-tabs { display: flex; gap: 4px; overflow-x: auto; flex-wrap: nowrap; scrollbar-width: none; flex: 0 0 auto; }
.ngf-tabs::-webkit-scrollbar { display: none; }
.ngf-tabs .tab { flex: 0 0 auto; }
.ngf-scroll { flex: 1; min-height: 0; overflow-y: auto; padding-right: 6px; margin-top: 10px; overscroll-behavior: contain; }
.ngf-group { font-family: var(--font-title); font-size: 11px; letter-spacing: 0.12em; color: var(--muted); margin: 8px 0 4px; text-transform: uppercase; }
.ngf-presets { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 6px; }
.ngf-preset { text-align: left; padding: 7px 9px; border-radius: 8px; border: 1px solid var(--line); background: rgba(0, 0, 0, 0.3); color: var(--text); cursor: pointer; font: inherit; }
.ngf-preset b { display: block; font-size: 14px; font-weight: normal; }
.ngf-preset span { display: block; font-size: 12px; color: var(--muted); line-height: 1.25; margin-top: 2px; }
.ngf-preset.active { border-color: var(--gold-2); background: rgba(214, 178, 94, 0.2); }
.ngf-dots { display: flex; gap: 3px; margin-top: 5px; }
.ngf-dots i { width: 13px; height: 13px; border-radius: 50%; display: inline-block; border: 1px solid rgba(255, 255, 255, 0.25); }
.ngf-palettes { display: flex; flex-wrap: wrap; gap: 6px; }
.ngf-pal { display: flex; gap: 2px; padding: 4px; border-radius: 8px; border: 1px solid var(--line); background: rgba(0, 0, 0, 0.3); cursor: pointer; }
.ngf-pal i { width: 16px; height: 22px; border-radius: 3px; display: inline-block; }
.ngf-pal.active { border-color: var(--gold-2); }
.ngf-custom { width: 30px; height: 26px; padding: 0; border: 1px solid var(--line); border-radius: 6px; background: none; cursor: pointer; }
.ngf-viewbar { position: absolute; bottom: 18px; display: flex; gap: 6px; pointer-events: auto; transform: translateX(-50%); }
.ngf-viewbar .chip { backdrop-filter: blur(4px); white-space: nowrap; }
body.ngf-studio .main-menu { visibility: hidden; }
.ngf-hint { position: absolute; bottom: 56px; transform: translateX(-50%); color: var(--muted); font-size: 13px; text-shadow: 0 1px 4px #000; pointer-events: none; white-space: nowrap; }
.ngf-actions { display: flex; gap: 8px; align-items: center; }
.ngf-actions .grow { flex: 1; }
.ngf-mobile { display: none; }
.ngf-sum { font-size: 14px; line-height: 1.4; }
.ngf-sec { margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(214, 178, 94, 0.18); }
.ngf-sec-title { font-family: var(--font-title); font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--gold); margin-bottom: 6px; }
.ngf-sec p { margin: 4px 0 0; }
.ngf-who-name { font-family: var(--font-title); font-size: 22px; color: var(--gold-2); }
.ngf-items { display: flex; flex-direction: column; gap: 6px; }
.ngf-item { display: flex; gap: 8px; font-size: 14px; line-height: 1.3; }
.ngf-item i { color: var(--gold); font-style: normal; font-size: 9px; margin-top: 5px; }
.ngf-item .muted { font-size: 13px; }
.ngf-slots { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
.ngf-slot { text-align: left; padding: 7px 9px; border-radius: 8px; border: 1px solid var(--line); background: rgba(0, 0, 0, 0.3); color: var(--text); cursor: pointer; font: inherit; min-width: 0; }
.ngf-slot b { display: block; font-family: var(--font-title); font-size: 12px; font-weight: 600; letter-spacing: 0.06em; }
.ngf-slot span { display: block; font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ngf-slot.active { border-color: var(--gold-2); background: rgba(214, 178, 94, 0.2); }
.ngf-slot.used.active { border-color: #e0806a; background: rgba(224, 80, 58, 0.16); }
.ngf-slot-note { font-size: 13px; margin-top: 6px; }
.ngf-slot-note.warn { color: #ffb59f; }
@media (max-width: 860px), (max-aspect-ratio: 4/5) {
  .ngf-left { left: 0; right: 0; bottom: 0; top: auto; width: auto; height: 57%; border-radius: 14px 14px 0 0; padding: 10px 12px 12px; }
  .ngf-right { display: none; }
  .ngf-head h2 { font-size: 17px; }
  .ngf-viewbar { top: 10px; bottom: auto; }
  .ngf-viewbar .chip { padding: 4px 9px; font-size: 13px; }
  .ngf-hint { display: none; }
  .ngf-mobile { display: flex; padding-top: 8px; }
  .ngf-presets { grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); }
  .ngf-left.ngf-preview-sheet { height: 50%; }
}
/* Landscape phones: the sheet becomes a left-hand panel so the Avatar keeps the right side. */
@media (max-height: 500px) and (min-aspect-ratio: 4/3) {
  .ngf-left, .ngf-left.ngf-preview-sheet { left: 0; right: auto; top: 0; bottom: 0; height: auto; width: min(420px, 52vw); border-radius: 0 14px 14px 0; padding: max(8px, env(safe-area-inset-top)) 10px max(8px, env(safe-area-inset-bottom)) max(10px, env(safe-area-inset-left)); }
  .ngf-viewbar { top: 8px; bottom: auto; }
  .ngf-head h2 { font-size: 15px; }
  .ngf-scroll { margin-top: 6px; }
}
`;

type Step = 'element' | 'creator' | 'preview';
type View = 'body' | 'face';

interface Studio {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  humanoid: Humanoid;
  bgMat: THREE.ShaderMaterial;
  pedestalMat: THREE.MeshStandardMaterial;
  ringMat: THREE.MeshBasicMaterial;
  disposables: Array<{ dispose(): void }>;
}

export class NewGameFlow implements Screen {
  readonly id = 'newGame';
  readonly el: HTMLElement;
  modal = true;
  private ctx!: GameContext;
  private step: Step = 'element';
  private element: Element = 'water';
  private name = '';
  private app: Appearance = cloneAppearance(DEFAULT_APPEARANCE.water);
  private studio: Studio | null = null;
  private yaw = 0.35;
  private zoom = 0;
  private zoomTarget = 0;
  private view: View = 'body';
  private autoSpin = true;
  private dragging = false;
  private lastX = 0;
  private tab = 'body';
  private leftPanel: HTMLElement | null = null;
  private rightPanel: HTMLElement | null = null;
  private viewBar: HTMLElement | null = null;
  private hint: HTMLElement | null = null;
  private rebuildTimer = 0;
  private dirty = false;
  private nameError: HTMLElement | null = null;
  private nameInput: HTMLInputElement | null = null;
  private continueBtns: HTMLButtonElement[] = [];
  private subscribed = false;
  /** Save slot the new journey will be written to. */
  private slot: string = SAVE_SLOTS[0];
  private companion: { model: CreatureModel; anim: AnimInput; element: Element } | null = null;

  constructor(private readonly ui: UIManager) {
    this.el = h('div.layer.interactive');
  }

  onOpen(ctx: GameContext): void {
    this.ctx = ctx;
    this.step = 'element';
    if (!document.getElementById('ngf-style')) document.head.append(h('style#ngf-style', CSS));
    if (!this.subscribed) {
      this.subscribed = true;
      // New vistas arrive as the menu tour visits each city.
      ctx.events.on('menu:tour', (e) => {
        if (e.phase === 'cut') this.onTour();
      });
    }
    this.render();
    this.installDebug();
  }

  onClose(): void {
    this.disposeStudio();
  }

  private render(): void {
    clear(this.el);
    this.leftPanel = this.rightPanel = this.viewBar = this.hint = null;
    if (this.step === 'element') this.renderElementSelect();
    else if (this.step === 'creator') this.renderCreator();
    else this.renderPreview();
  }

  // ---------------------------------------------------------------------------
  // Step 1: element choice
  // ---------------------------------------------------------------------------

  private renderElementSelect(): void {
    this.disposeStudio();
    const order: Element[] = ['earth', 'air', 'fire', 'water'];
    const where: Record<Element, string> = {
      earth: 'Begin your journey in Ba Sing Se',
      air: 'Begin your journey at an Air Temple',
      fire: 'Begin your journey in the Fire Nation Capital',
      water: 'Begin your journey in the Northern Water Tribe',
    };
    const desc: Record<Element, string> = {
      earth: 'Start in the Earth Kingdom’s great walled city. Grounding, defence, precision and powerful impacts.',
      air: 'Start at a mountain temple above the clouds. Agility, evasion, air currents and aerial movement.',
      fire: 'Start among the capital’s grand architecture and royal palace. Aggressive combinations and controlled bursts.',
      water: 'Start in a polar city of ice and canals. Flowing attacks, redirection, water whips and ice.',
    };
    const cards = order.map((e, i) => {
      const c = ELEMENT_COLORS[e];
      const info = startInfo(e);
      const art = h('div.card-art', { 'data-art': e }, emblem(e));
      this.paintArt(art, e);
      const card = h(
        'div.element-card',
        {
          tabindex: 0,
          role: 'button',
          'aria-label': `${ELEMENT_INFO[e].name}: ${where[e]}`,
          'data-element': e,
          style: { animationDelay: `${i * 0.06}s` },
          onclick: () => this.chooseElement(e),
          onkeydown: (ev: KeyboardEvent) => {
            if (ev.key === 'Enter' || ev.key === ' ') {
              ev.preventDefault();
              this.chooseElement(e);
            }
          },
        },
        art,
        h(
          'div.card-body',
          h('h3', ELEMENT_INFO[e].name.toUpperCase()),
          h('div.where', where[e]),
          h('div.desc', desc[e]),
          h(
            'div.card-facts',
            info.master ? h('div', h('span.fact-k', 'Master'), h('span.fact-v', info.master)) : null,
            info.quest ? h('div', h('span.fact-k', 'First quest'), h('span.fact-v', h('b', info.quest.title), ' — ', info.quest.summary)) : null,
          ),
          h('div.card-cta', 'Begin here ›'),
        ),
      );
      card.style.setProperty('--el-glow', c.glow);
      card.style.setProperty('--el-shadow', c.shadow);
      card.style.setProperty('--el-color', c.color);
      return card;
    });
    this.el.append(
      h(
        'div.element-select',
        h('div.es-head', h('h1.title', 'BEGIN YOUR JOURNEY AS THE AVATAR'), h('p.lead', 'Choose the element with which your journey begins. Your destiny is to master all four.')),
        h('div.element-cards', cards),
        h('div.row.es-actions', h('button.btn', { 'data-action': 'element-back', onclick: () => this.ui.close() }, 'Back')),
      ),
    );
    (this.el.querySelector('.element-card') as HTMLElement | null)?.focus({ preventScroll: true });
  }

  /** Card art: the tour's snapshot of the start city when one exists, otherwise the painted element backdrop. */
  private paintArt(art: HTMLElement, e: Element): void {
    const v = getVista(e);
    art.style.background = v ? `linear-gradient(180deg, rgba(0,0,0,0) 55%, rgba(8,6,4,0.55)), center / cover no-repeat url("${v}")` : CARD_BG[e];
    art.classList.toggle('vista', !!v);
  }

  private onTour(): void {
    if (this.step !== 'element') return;
    for (const art of Array.from(this.el.querySelectorAll<HTMLElement>('.card-art[data-art]'))) this.paintArt(art, art.dataset.art as Element);
  }

  private chooseElement(e: Element): void {
    this.ctx.audio.play('ui_confirm', { bus: 'ui' });
    if (e !== this.element || this.step === 'element') {
      const changedElement = e !== this.element;
      this.element = e;
      // A new nation brings its starting look; the chosen body type stays.
      const body = this.app.body;
      this.app = cloneAppearance(DEFAULT_APPEARANCE[e]);
      if (body === 'female') this.app = withBodyType(this.app, 'female', e);
      if (changedElement || !this.name) this.name = suggestName(e, undefined, this.app.body ?? 'male');
      this.dirty = true;
      this.rebuildTimer = 0;
    }
    this.step = 'creator';
    this.tab = 'body';
    this.setView('body');
    this.render();
    this.studio?.humanoid.animator.play('bow', { fadeIn: 0.2 });
  }

  // ---------------------------------------------------------------------------
  // Studio (3D preview)
  // ---------------------------------------------------------------------------

  private ensureStudio(): void {
    if (this.studio) {
      this.applyStudioTheme();
      return;
    }
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.05, 100);
    const disposables: Array<{ dispose(): void }> = [];
    scene.add(new THREE.HemisphereLight(0xfff2e0, 0x3a3440, 1.15));
    const key = new THREE.DirectionalLight(0xfff1e0, 2.5);
    key.position.set(2.2, 4.2, 3.4);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xc6dcff, 0.75);
    fill.position.set(-3, 1.8, 2.2);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xd8e8ff, 1.9);
    rim.position.set(-1.6, 3, -3.6);
    scene.add(rim);
    const bgMat = new THREE.ShaderMaterial({
      uniforms: { top: { value: new THREE.Color() }, bottom: { value: new THREE.Color() } },
      vertexShader: 'varying vec3 vP;\nvoid main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top;\nuniform vec3 bottom;\nvarying vec3 vP;\nvoid main(){ float t = clamp(normalize(vP).y*0.85+0.42,0.0,1.0); gl_FragColor = vec4(mix(bottom, top, t),1.0);\n#include <colorspace_fragment>\n}',
      side: THREE.BackSide,
      depthWrite: false,
    });
    const bgGeo = new THREE.SphereGeometry(30, 32, 16);
    scene.add(new THREE.Mesh(bgGeo, bgMat));
    const pedGeo = new THREE.CylinderGeometry(0.78, 0.86, 0.16, 56);
    const pedestalMat = new THREE.MeshStandardMaterial({ color: '#c8b48a', roughness: 0.75 });
    const pedestal = new THREE.Mesh(pedGeo, pedestalMat);
    pedestal.position.y = -0.08;
    scene.add(pedestal);
    const ringGeo = new THREE.TorusGeometry(0.8, 0.012, 8, 72);
    const ringMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.002;
    scene.add(ring);
    // Soft contact shadow (no shadow maps needed).
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const g = cv.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    grad.addColorStop(0, 'rgba(0,0,0,0.55)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const shadowTex = new THREE.CanvasTexture(cv);
    const shadowGeo = new THREE.PlaneGeometry(1.1, 1.1);
    const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false });
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.004;
    scene.add(shadow);
    disposables.push(bgGeo, bgMat, pedGeo, pedestalMat, ringGeo, ringMat, shadowTex, shadowGeo, shadowMat);
    const humanoid = new Humanoid(cloneAppearance(this.app), { castShadow: false, lod: 'high' });
    scene.add(humanoid.root);
    this.studio = { scene, camera, humanoid, bgMat, pedestalMat, ringMat, disposables };
    document.body.classList.add('ngf-studio');
    this.dirty = false;
    this.applyStudioTheme();
    this.ctx.game.setStage({ scene, camera });
  }

  private applyStudioTheme(): void {
    if (!this.studio) return;
    const t = STUDIO[this.element];
    this.studio.bgMat.uniforms.top.value.set(t.top);
    this.studio.bgMat.uniforms.bottom.value.set(t.bottom);
    this.studio.pedestalMat.color.set(t.pedestal);
    this.studio.ringMat.color.set(t.ring);
  }

  /** Homeland companion beside the Avatar (journey preview only). */
  private setCompanion(on: boolean): void {
    const s = this.studio;
    if (this.companion && (!on || !s || this.companion.element !== this.element)) {
      this.companion.model.root.removeFromParent();
      this.companion.model.dispose();
      this.companion = null;
    }
    if (!on || !s || this.companion) return;
    const c = COMPANION[this.element];
    try {
      const model = createModel(c.species, 0, 1, c.scale);
      if (!model) return;
      model.setShadows(false);
      model.root.position.set(c.x, 0, c.z);
      model.root.rotation.y = c.yaw;
      s.scene.add(model.root);
      const anim = defaultAnim();
      model.update(anim);
      this.companion = { model, anim, element: this.element };
    } catch (err) {
      console.error('[NewGameFlow] companion preview failed', err);
    }
  }

  private disposeStudio(): void {
    if (!this.studio) return;
    this.setCompanion(false);
    this.studio.humanoid.dispose();
    for (const d of this.studio.disposables) d.dispose();
    this.studio = null;
    document.body.classList.remove('ngf-studio');
    this.ctx.game.setStage(null);
  }

  private stageEl(): HTMLElement {
    const stage = h('div.ngf-stage', {
      onpointerdown: (e: PointerEvent) => {
        this.dragging = true;
        this.autoSpin = false;
        this.lastX = e.clientX;
        stage.classList.add('dragging');
        stage.setPointerCapture?.(e.pointerId);
      },
      onpointermove: (e: PointerEvent) => {
        if (!this.dragging) return;
        this.yaw += (e.clientX - this.lastX) * 0.012;
        this.lastX = e.clientX;
      },
      onpointerup: () => {
        this.dragging = false;
        stage.classList.remove('dragging');
      },
      onpointercancel: () => {
        this.dragging = false;
        stage.classList.remove('dragging');
      },
      onwheel: (e: WheelEvent) => {
        e.preventDefault();
        this.zoomTarget = Math.max(0, Math.min(1, this.zoomTarget + (e.deltaY < 0 ? 0.2 : -0.2)));
        this.view = this.zoomTarget > 0.5 ? 'face' : 'body';
        this.refreshViewBar();
      },
      ondblclick: () => this.setView(this.view === 'face' ? 'body' : 'face'),
    });
    return stage;
  }

  private setView(v: View): void {
    this.view = v;
    this.zoomTarget = v === 'face' ? 1 : 0;
    this.refreshViewBar();
  }

  private refreshViewBar(): void {
    if (!this.viewBar) return;
    for (const b of Array.from(this.viewBar.querySelectorAll<HTMLButtonElement>('button[data-view]'))) b.classList.toggle('active', b.dataset.view === this.view);
  }

  private viewBarEl(): HTMLElement {
    this.viewBar = h(
      'div.ngf-viewbar',
      h('button.chip', { 'data-view': 'body', title: 'Full body', onclick: () => this.setView('body') }, 'Full Body'),
      h('button.chip', { 'data-view': 'face', title: 'Face close-up', onclick: () => this.setView('face') }, 'Face'),
      h('button.chip', { title: 'Turn around', onclick: () => { this.autoSpin = false; this.yaw += Math.PI / 2; } }, '⟳ Turn'),
      h('button.chip', { title: 'Strike a pose', 'data-action': 'creator-pose', onclick: () => this.studio?.humanoid.animator.play(SHOWCASE[this.element], { fadeIn: 0.12 }) }, 'Pose'),
    );
    this.refreshViewBar();
    return this.viewBar;
  }

  /** Screen-space rectangle not covered by panels (the character is framed inside it). */
  private freeRect(): { x: number; y: number; w: number; h: number } {
    const W = window.innerWidth, H = window.innerHeight;
    const L = this.leftPanel?.getBoundingClientRect();
    const R = this.rightPanel?.getBoundingClientRect();
    if (L && L.width > W * 0.85) {
      // Phone: bottom sheet.
      return { x: 0, y: 0, w: W, h: Math.max(120, L.top) };
    }
    const x0 = L && L.width > 0 ? L.right : 0;
    const x1 = R && R.width > 0 ? R.left : W;
    return { x: x0, y: 0, w: Math.max(120, x1 - x0), h: H };
  }

  update(dt: number): void {
    if (this.ui.currentScreen === this.id) gamepadNav(this.el, () => (this.step === 'element' ? this.ui.close() : this.back()));
    if (!this.studio) return;
    const s = this.studio;
    if (this.companion) {
      const a = this.companion.anim;
      a.dt = dt;
      a.time += dt;
      this.companion.model.update(a);
    }
    if (this.dirty) {
      this.rebuildTimer -= dt;
      if (this.rebuildTimer <= 0) {
        this.dirty = false;
        s.humanoid.setAppearance(cloneAppearance(this.app));
      }
    }
    if (this.autoSpin && !this.dragging) this.yaw += dt * 0.18;
    s.humanoid.root.rotation.y = this.yaw;
    s.humanoid.animator.loco.style = this.element;
    s.humanoid.update(dt);
    this.zoom += (this.zoomTarget - this.zoom) * Math.min(1, dt * 6);
    this.frameCamera();
  }

  private frameCamera(): void {
    if (!this.studio) return;
    const cam = this.studio.camera;
    const W = Math.max(1, window.innerWidth), H = Math.max(1, window.innerHeight);
    const fr = this.freeRect();
    const hgt = this.studio.humanoid.height;
    const z = this.zoom;
    const focusY = THREE.MathUtils.lerp(hgt * 0.5, hgt * 0.925, z);
    let span = THREE.MathUtils.lerp(hgt * 1.16 + 0.12, 0.44, z);
    let spanW = THREE.MathUtils.lerp(0.95, 0.4, z);
    let lookX = 0;
    if (this.companion && this.step === 'preview') {
      // Frame the Avatar together with their homeland companion.
      const b = new THREE.Box3().setFromObject(this.companion.model.root);
      const left = -0.75;
      const right = Math.max(1, b.max.x + 0.15);
      spanW = Math.max(spanW, (right - left) * 1.02);
      span = Math.max(span, b.max.y * 1.12 + 0.15);
      lookX = (left + right) / 2;
    }
    // Shift the projection centre to the middle of the free area.
    const cx = fr.x + fr.w / 2, cy = fr.y + fr.h / 2;
    const dx = cx - W / 2, dy = cy - H / 2;
    const fullW = W + 2 * Math.abs(dx), fullH = H + 2 * Math.abs(dy);
    cam.aspect = fullW / fullH;
    cam.setViewOffset(fullW, fullH, Math.abs(dx) - dx, Math.abs(dy) - dy, W, H);
    const tanH = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    const pxPerUnitAt1 = fullH / (2 * tanH);
    const dist = Math.max((span * pxPerUnitAt1) / (fr.h * 0.9), (spanW * pxPerUnitAt1) / (fr.w * 0.9));
    cam.position.set(lookX, focusY + dist * THREE.MathUtils.lerp(0.06, 0.015, z), dist);
    cam.lookAt(lookX, focusY, 0);
    cam.updateProjectionMatrix();
    if (this.viewBar) this.viewBar.style.left = `${cx}px`;
    if (this.hint) this.hint.style.left = `${cx}px`;
  }

  private changed(): void {
    this.dirty = true;
    this.rebuildTimer = 0.04;
  }

  // ---------------------------------------------------------------------------
  // Step 2: creator
  // ---------------------------------------------------------------------------

  private renderCreator(): void {
    this.ensureStudio();
    this.setCompanion(false);
    const left = h('div.panel.ngf-left');
    this.leftPanel = left;
    const tabBar = h('div.ngf-tabs');
    const content = h('div.ngf-scroll');
    const renderTab = () => {
      clear(tabBar);
      for (const t of TABS) {
        tabBar.append(
          h(`button.tab${this.tab === t.id ? '.active' : ''}`, {
            'data-tab': t.id,
            onclick: () => {
              this.tab = t.id;
              this.setView(t.view);
              renderTab();
              content.scrollTop = 0;
            },
          }, t.label),
        );
      }
      const top = content.scrollTop;
      clear(content);
      content.append(...this.tabContent(this.tab, renderTab));
      content.scrollTop = top;
    };
    renderTab();
    left.append(
      h('div.ngf-head', emblem(this.element, 'emblem'), h('h2.title', 'Create Your Avatar')),
      this.nameField(),
      tabBar,
      content,
      h(
        'div.ngf-actions.ngf-mobile',
        h('button.btn', { onclick: () => this.back() }, 'Back'),
        h('button.btn', { onclick: () => this.randomize() }, 'Randomize'),
        h('div.grow'),
        this.continueButton(),
      ),
    );
    const start = STARTS[this.element];
    const right = h(
      'div.panel.ngf-right',
      h('div.row', emblem(this.element, 'emblem'), h('div', h('div.title', { style: { fontSize: '17px' } }, `${ELEMENT_INFO[this.element].name} Avatar`), h('div.muted', { style: { fontSize: '14px' } }, regionById(start.regionId)?.name ?? ''))),
      h('div.divider'),
      h('p.muted.ngf-sum', 'Drag the preview to turn your Avatar, scroll or use Face for a close-up. Every choice updates the preview immediately, and your look stays the same in battle, while riding and in the Avatar State.'),
      h('div.spacer'),
      h('button.btn', { 'data-action': 'creator-randomize', onclick: () => this.randomize(), style: { marginBottom: '8px' } }, 'Randomize'),
      h('button.btn', { onclick: () => { this.app = cloneAppearance(DEFAULT_APPEARANCE[this.element]); this.changed(); this.render(); }, style: { marginBottom: '8px' } }, 'Reset Look'),
      h('div.ngf-actions', h('button.btn', { onclick: () => this.back() }, 'Back'), h('div.grow'), this.continueButton()),
    );
    this.rightPanel = right;
    this.hint = h('div.ngf-hint', '⟲ drag to turn · scroll to zoom · double-click for the face');
    this.el.append(h('div.ngf-root', this.stageEl(), left, right, this.viewBarEl(), this.hint));
    this.validate();
  }

  private back(): void {
    if (this.step === 'preview') this.step = 'creator';
    else this.step = 'element';
    this.render();
  }

  private nameField(): HTMLElement {
    const input = h('input', {
      type: 'text',
      value: this.name,
      maxlength: NAME_MAX + 4,
      autocomplete: 'off',
      spellcheck: false,
      'aria-label': 'Character name',
      'data-field': 'name',
      oninput: (e: Event) => {
        this.name = (e.target as HTMLInputElement).value;
        this.validate();
      },
      onblur: () => {
        if (!validateName(this.name)) {
          this.name = normalizeName(this.name);
          input.value = this.name;
        }
      },
    }) as HTMLInputElement;
    this.nameInput = input;
    this.nameError = h('div.ngf-error', { 'data-field': 'name-error' });
    return h(
      'div.field',
      { style: { marginBottom: '8px' } },
      h('label', 'NAME'),
      h('div.ngf-name', input, h('button.btn', { title: 'Suggest a name', onclick: () => this.setName(suggestName(this.element, undefined, this.app.body ?? 'male')) }, '🎲')),
      this.nameError,
    );
  }

  private setName(name: string): void {
    this.name = name;
    if (this.nameInput) this.nameInput.value = name;
    this.validate();
  }

  /** Switch male / female: refit the look and, unless the player typed their own, suggest a fitting name. */
  private setBodyType(body: BodyType): void {
    this.app = withBodyType(this.app, body, this.element);
    if (!this.name.trim() || isSuggestedName(this.name)) this.setName(suggestName(this.element, undefined, body));
  }

  private continueButton(): HTMLButtonElement {
    const b = h('button.btn.primary', { 'data-action': 'creator-continue', onclick: () => this.goPreview() }, 'Continue') as HTMLButtonElement;
    this.continueBtns.push(b);
    return b;
  }

  /** Validate the name; updates the error line and the Continue buttons. Returns true when valid. */
  private validate(): boolean {
    const err = validateName(this.name);
    this.continueBtns = this.continueBtns.filter((b) => b.isConnected);
    for (const b of this.continueBtns) b.disabled = !!err;
    if (this.nameError) {
      this.nameError.textContent = err ?? `${normalizeName(this.name)} of the ${NATION_NAMES[this.element]}`;
      this.nameError.classList.toggle('ok', !err);
    }
    return !err;
  }

  private goPreview(): void {
    if (!this.validate()) return;
    this.name = normalizeName(this.name);
    this.step = 'preview';
    this.setView('body');
    this.autoSpin = true;
    this.render();
    this.studio?.humanoid.animator.play(SHOWCASE[this.element], { fadeIn: 0.15 });
  }

  // ---------------------------------------------------------------------------
  // Controls
  // ---------------------------------------------------------------------------

  private swatchRow(colors: string[], current: string, set: (c: string) => void, rerender: () => void, custom = true): HTMLElement {
    const row = h(
      'div.swatches',
      colors.map((c) => h(`div.swatch${c.toLowerCase() === current.toLowerCase() ? '.active' : ''}`, { style: { background: c }, title: c, onclick: () => { set(c); this.changed(); rerender(); } })),
    );
    if (custom) {
      row.append(
        h('input.ngf-custom', {
          type: 'color',
          value: /^#[0-9a-f]{6}$/i.test(current) ? current : '#888888',
          title: 'Custom colour',
          oninput: (e: Event) => {
            set((e.target as HTMLInputElement).value);
            this.changed();
          },
          onchange: () => rerender(),
        }),
      );
    }
    return row;
  }

  private chipRow<T extends string>(items: Array<{ id: T; name: string }>, current: T, set: (v: T) => void, rerender: () => void, attr?: string): HTMLElement {
    return h('div.chips', items.map((it) => h(`button.chip${it.id === current ? '.active' : ''}`, { 'data-opt': attr ? `${attr}:${it.id}` : undefined, onclick: () => { set(it.id); this.changed(); rerender(); } }, it.name)));
  }

  private slider(label: string, value: number, min: number, max: number, step: number, set: (v: number) => void, attr?: string): HTMLElement {
    const out = h('span.muted', { style: { float: 'right', fontSize: '12px' } }, value.toFixed(2));
    return h(
      'div.field',
      h('label', label, out),
      h('input', {
        type: 'range',
        min,
        max,
        step,
        value,
        'data-opt': attr,
        oninput: (e: Event) => {
          const v = Number((e.target as HTMLInputElement).value);
          out.textContent = v.toFixed(2);
          set(v);
          this.changed();
        },
      }),
    );
  }

  private tabContent(tab: string, rerender: () => void): HTMLElement[] {
    const a = this.app;
    switch (tab) {
      case 'body':
        return [
          // Male / female: refits hairstyle, face, brows, height and build to the nation's start for that body.
          h('div.field', h('label', 'BODY'), this.chipRow(BODY_OPTIONS, a.body ?? 'male', (v) => this.setBodyType(v), rerender, 'bodyType')),
          h('div.field', h('label', 'FRAME'), this.chipRow(FRAME_OPTIONS, a.frame, (v) => (a.frame = v), rerender, 'frame')),
          this.slider('HEIGHT', a.height, 0.9, 1.1, 0.01, (v) => (a.height = v), 'height'),
          this.slider('BUILD', a.build, 0, 1, 0.01, (v) => (a.build = v), 'build'),
          h('div.field', h('label', 'SKIN TONE'), this.swatchRow(SKIN_TONES, a.skinTone, (c) => (a.skinTone = c), rerender)),
        ];
      case 'face':
        return [
          h('div.field', h('label', 'FACE SHAPE'), this.chipRow(FACE_PRESET_NAMES.map((n, i) => ({ id: String(i), name: n })), String(a.face.preset), (v) => (a.face.preset = Number(v)), rerender, 'face')),
          this.slider('JAW', a.face.jaw, -1, 1, 0.05, (v) => (a.face.jaw = v), 'jaw'),
          this.slider('CHEEKBONES', a.face.cheeks, -1, 1, 0.05, (v) => (a.face.cheeks = v), 'cheeks'),
          this.slider('NOSE', a.face.nose, -1, 1, 0.05, (v) => (a.face.nose = v), 'nose'),
          this.slider('EYE SPACING', a.face.eyeSpacing, -1, 1, 0.05, (v) => (a.face.eyeSpacing = v), 'eyeSpacing'),
          h('div.field', h('label', 'EYE SHAPE'), this.chipRow(EYE_SHAPES, a.eyes.shape, (v) => (a.eyes.shape = v), rerender, 'eyes')),
          h('div.field', h('label', 'EYE COLOUR'), this.swatchRow(EYE_COLORS, a.eyes.color, (c) => (a.eyes.color = c), rerender)),
          h('div.field', h('label', 'EYEBROWS'), this.chipRow(BROW_NAMES.map((n, i) => ({ id: String(i), name: n })), String(a.brows.style), (v) => (a.brows.style = Number(v)), rerender, 'brows')),
          this.slider('BROW THICKNESS', a.brows.thickness, 0, 1, 0.05, (v) => (a.brows.thickness = v), 'browThickness'),
        ];
      case 'hair': {
        const byNation = (n: Element | undefined) => HAIRSTYLES.filter((s) => s.nation === n);
        const groups: Array<[string, typeof HAIRSTYLES]> = [
          ['Traditional', HAIRSTYLES.filter((s) => s.nation)],
          ['Any nation', byNation(undefined)],
        ];
        return [
          h('div.field', h('label', 'HAIRSTYLE'), ...groups.map(([g, list]) => [h('div.ngf-group', g), this.chipRow(list, a.hair.style, (v) => (a.hair.style = v), rerender, 'hair')])),
          h('div.field', h('label', 'HAIR COLOUR'), this.swatchRow(HAIR_COLORS, a.hair.color, (c) => { a.hair.color = c; a.brows.color = c; }, rerender)),
          a.body === 'female' ? null : h('div.field', h('label', 'FACIAL HAIR'), this.chipRow(FACIAL_HAIR, a.facialHair, (v) => (a.facialHair = v), rerender, 'facialHair')),
        ].filter((x): x is HTMLElement => !!x);
      }
      case 'marks':
        return [
          h('div.field', h('label', 'AIR NOMAD TATTOOS'), this.chipRow(TATTOO_STYLES, a.tattoos, (v) => (a.tattoos = v), rerender, 'tattoos'), h('div.muted', { style: { fontSize: '13px' } }, TATTOO_STYLES.find((t) => t.id === a.tattoos)?.desc ?? '')),
          h('div.field', h('label', 'TATTOO COLOUR'), this.swatchRow(TATTOO_COLORS, a.tattooColor, (c) => (a.tattooColor = c), rerender)),
          h('div.field', h('label', 'SCARS'), h('div.chips', SCARS.map((s) => h(`button.chip${a.scars.includes(s.id) ? '.active' : ''}`, { 'data-opt': `scar:${s.id}`, onclick: () => { a.scars = a.scars.includes(s.id) ? a.scars.filter((x) => x !== s.id) : [...a.scars, s.id]; this.changed(); rerender(); } }, s.name)))),
        ];
      case 'attire':
        return this.attireTab(rerender);
      case 'colors':
      default:
        return this.colorsTab(rerender);
    }
  }

  private attireTab(rerender: () => void): HTMLElement[] {
    const a = this.app;
    const out: HTMLElement[] = [];
    // Complete nation outfits first (home nation first).
    const nations: Element[] = [this.element, ...ELEMENTS.filter((e) => e !== this.element)];
    const presetsField = h('div.field', h('label', 'NATION OUTFITS'));
    for (const n of nations) {
      presetsField.append(h('div.ngf-group', NATION_NAMES[n]));
      presetsField.append(
        h(
          'div.ngf-presets',
          creatorPresets(n).map((p) => {
            const active = (Object.keys(p.outfit) as Array<keyof OutfitSlots>).every((k) => sameItem(a.outfit[k], p.outfit[k]));
            return h(
              `button.ngf-preset${active ? '.active' : ''}`,
              { 'data-preset': p.id, onclick: () => { this.app = withPreset(this.app, p.id); this.changed(); rerender(); } },
              h('b', p.name),
              h('span', p.blurb),
              h('div.ngf-dots', [p.colors.primary, p.colors.secondary, p.colors.accent, p.colors.trim].map((c) => h('i', { style: { background: c } }))),
            );
          }),
        ),
      );
    }
    out.push(presetsField);
    // Individual slots, items grouped by nation.
    for (const [key, slot, label] of SLOT_LABELS) {
      const items = COSMETICS.filter((c) => c.slot === slot && c.unlock === 'start');
      const current = EMPTY_IDS.has(a.outfit[key]) ? items.find((c) => EMPTY_IDS.has(c.id))?.id ?? a.outfit[key] : a.outfit[key];
      const field = h('div.field', h('label', label));
      const empty = items.filter((c) => EMPTY_IDS.has(c.id));
      if (empty.length) field.append(this.itemChips(empty, current, key, rerender));
      for (const n of NATION_ORDER) {
        const group = items.filter((c) => c.nation === n && !EMPTY_IDS.has(c.id));
        if (!group.length) continue;
        field.append(h('div.ngf-group', n === 'any' ? 'Any nation' : NATION_NAMES[n]), this.itemChips(group, current, key, rerender));
      }
      out.push(field);
    }
    return out;
  }

  private itemChips(items: CosmeticDef[], current: string, key: keyof OutfitSlots, rerender: () => void): HTMLElement {
    return h(
      'div.chips',
      items.map((c) =>
        h(
          `button.chip${c.id === current ? '.active' : ''}`,
          {
            title: c.description,
            'data-item': c.id,
            onclick: () => {
              this.app.outfit[key] = c.id;
              this.changed();
              rerender();
            },
          },
          c.name,
        ),
      ),
    );
  }

  private colorsTab(rerender: () => void): HTMLElement[] {
    const a = this.app;
    const palettes = h('div.field', h('label', 'NATION PALETTES'));
    for (const n of [this.element, ...ELEMENTS.filter((e) => e !== this.element)]) {
      palettes.append(h('div.ngf-group', NATION_NAMES[n]));
      palettes.append(
        h(
          'div.ngf-palettes',
          NATION_PALETTES[n].map((p) => {
            const active = (['primary', 'secondary', 'accent', 'trim'] as const).every((k) => a.colors[k].toLowerCase() === p[k].toLowerCase());
            return h(
              `div.ngf-pal${active ? '.active' : ''}`,
              { title: `${NATION_NAMES[n]} palette`, onclick: () => { a.colors = { ...p }; this.changed(); rerender(); } },
              [p.primary, p.secondary, p.accent, p.trim].map((c) => h('i', { style: { background: c } })),
            );
          }),
        ),
      );
    }
    const swatches = ['#e8a33a', '#c8642a', '#f4d48a', '#7a3a1a', '#2f5f9e', '#1e3a66', '#6aa6d6', '#e9eef5', '#4f7f3a', '#2f4f25', '#c9b27a', '#6b4a2a', '#a8241c', '#2a1a18', '#d4a43a', '#5a1410', '#e8e2d0', '#3a3a3a', '#8a7a5a', '#5a6a7a'];
    const names: Record<string, string> = { primary: 'PRIMARY (main cloth)', secondary: 'SECONDARY (trousers, sash)', accent: 'ACCENT (patterns, linings)', trim: 'TRIM (edges, embroidery)' };
    return [
      palettes,
      ...(['primary', 'secondary', 'accent', 'trim'] as const).map((k) => h('div.field', h('label', names[k]), this.swatchRow(swatches, a.colors[k], (c) => (a.colors[k] = c), rerender))),
    ];
  }

  private randomize(): void {
    const keepName = this.name;
    const body = this.app.body;
    this.app = randomLook(this.element, new Random((Math.random() * 1e9) | 0));
    if (body === 'female') {
      this.app.body = 'female';
      this.app.facialHair = 'none';
    }
    this.name = keepName;
    this.changed();
    this.render();
  }

  // ---------------------------------------------------------------------------
  // Step 3: preview & confirm
  // ---------------------------------------------------------------------------

  private renderPreview(): void {
    this.ensureStudio();
    this.setCompanion(true);
    const e = this.element;
    const start = STARTS[e];
    const info = startInfo(e);
    const species = SPECIES.find((s) => s.id === COMPANION[e].species);
    // Default slot: keep a previous choice if still empty, else the first empty one, else the oldest journey.
    const metas = SAVE_SLOTS.map((s) => this.ctx.save.getMeta(s));
    const idx = SAVE_SLOTS.indexOf(this.slot as (typeof SAVE_SLOTS)[number]);
    if (idx < 0 || metas[idx]) {
      const empty = metas.findIndex((m) => !m);
      const oldest = metas.reduce((best, m, i) => (m && (best < 0 || m.savedAt < metas[best]!.savedAt) ? i : best), -1);
      this.slot = SAVE_SLOTS[empty >= 0 ? empty : Math.max(0, oldest)];
    }
    const section = (title: string, ...kids: Array<HTMLElement | string | null>) => h('div.ngf-sec', h('div.ngf-sec-title', title), ...kids);
    const slotRow = h('div.ngf-slots');
    const slotNote = h('div.ngf-slot-note.muted');
    const paintSlots = () => {
      clear(slotRow);
      SAVE_SLOTS.forEach((s, i) => {
        const m = metas[i];
        slotRow.append(
          h(
            `button.ngf-slot${s === this.slot ? '.active' : ''}${m ? '.used' : ''}`,
            { 'data-slot': s, onclick: () => { this.slot = s; paintSlots(); } },
            h('b', `Slot ${i + 1}`),
            h('span', m ? `${m.characterName} · Lv ${m.level}` : 'Empty'),
          ),
        );
      });
      const m = metas[SAVE_SLOTS.indexOf(this.slot as (typeof SAVE_SLOTS)[number])];
      slotNote.textContent = m ? `${m.characterName}'s journey in this slot will be replaced (you will be asked to confirm).` : 'Your journey will be saved here. Autosaves keep it up to date.';
      slotNote.classList.toggle('warn', !!m);
    };
    paintSlots();
    const panel = h(
      'div.panel.ngf-left.ngf-preview-sheet',
      h('div.ngf-head', emblem(e, 'emblem'), h('h2.title', 'Your Journey Begins')),
      h(
        'div.ngf-scroll',
        { style: { marginTop: '0' } },
        h('div.ngf-who', h('div.ngf-who-name', this.name || 'Avatar'), h('div.muted', `${ELEMENT_INFO[e].name}bender · ${start.title}`)),
        section(
          'Homeland Companion',
          h('div.ngf-comp', h('b', species?.name ?? 'Companion'), h('span.muted', ' — befriend one on your travels')),
          h('p.muted.ngf-sum', HOMELAND_CREATURES[e]),
        ),
        section('Starting Equipment', h('div.ngf-items', STARTER_ITEMS[e].map((it) => h('div.ngf-item', h('i', '◆'), h('div', h('div', it.name), h('div.muted', it.detail)))))),
        info.quest ? section('First Quest', h('div', h('b', info.quest.title)), h('p.muted.ngf-sum', info.quest.summary), info.master ? h('div.muted.ngf-sum', `Your first teacher in ${info.region}: ${info.master}.`) : null) : null,
        section('Save Slot', slotRow, slotNote),
        h('p.muted.ngf-sum', `You begin with ${ELEMENT_INFO[e].name}bending. As the Avatar you can learn ${ELEMENTS.filter((x) => x !== e).map((x) => ELEMENT_INFO[x].name).join(', ')} from masters across the world — and enter the Avatar State at will.`),
      ),
      h('div.ngf-actions', { style: { paddingTop: '8px' } }, h('button.btn', { 'data-action': 'preview-back', onclick: () => this.back() }, 'Back'), h('div.grow'), h('button.btn.primary', { 'data-action': 'confirm-journey', onclick: () => this.confirm() }, 'Begin Journey')),
    );
    this.leftPanel = panel;
    this.el.append(h('div.ngf-root', this.stageEl(), panel, this.viewBarEl()));
  }

  /** Never overwrite a journey silently: an occupied slot needs explicit confirmation. */
  private confirm(): void {
    const slot = this.slot;
    const meta = this.ctx.save.getMeta(slot);
    if (!meta) {
      this.launch(slot);
      return;
    }
    const n = SAVE_SLOTS.indexOf(slot as (typeof SAVE_SLOTS)[number]) + 1;
    this.ui.confirm(`Slot ${n} holds ${meta.characterName}'s journey (Lv ${meta.level}, ${meta.regionName}). Replace it with this new journey? It will be permanently overwritten.`, [
      { text: 'Replace Journey', danger: true, onClick: () => this.launch(slot) },
      { text: 'Cancel', primary: true },
    ]);
  }

  private launch(slot: string): void {
    const name = validateName(this.name) ? 'Avatar' : normalizeName(this.name);
    const cfg = { element: this.element, name, appearance: cloneAppearance(this.app), slot };
    this.disposeStudio();
    this.ui.close(this.id);
    this.ui.close('mainMenu');
    void this.ctx.game.newGame(cfg).then(() => {
      // Starter supplies.
      const inv = this.ctx.inventory;
      inv.add('healing_herbs', 3, true);
      const food: Record<Element, string> = { water: 'sea_prunes', earth: 'cabbage', fire: 'fire_flakes', air: 'moon_peaches' };
      inv.add(food[cfg.element], 5, true);
      inv.addCurrency(30);
    });
  }

  onKey(e: KeyboardEvent): boolean {
    if ((e.target as HTMLElement | null)?.tagName === 'INPUT' && e.key !== 'Escape') return false;
    if (e.key === 'Escape') {
      if (this.step === 'element') {
        this.ui.close();
        return true;
      }
      this.back();
      return true;
    }
    return false;
  }

  /** Test hooks: window.__game.debug.creator */
  private installDebug(): void {
    const api = (window as unknown as { __game?: { debug?: Record<string, unknown> } }).__game;
    if (!api) return;
    api.debug = api.debug ?? {};
    api.debug.creator = {
      state: () => ({ step: this.step, element: this.element, name: this.name, view: this.view, zoom: +this.zoom.toFixed(2), appearance: cloneAppearance(this.app), height: this.studio?.humanoid.height ?? 0, stats: this.studio?.humanoid.stats ?? null }),
      setAppearance: (a: Appearance) => {
        this.app = cloneAppearance(a);
        this.changed();
        this.render();
      },
      flush: () => {
        if (this.studio && this.dirty) {
          this.dirty = false;
          this.studio.humanoid.setAppearance(cloneAppearance(this.app));
        }
        return this.studio?.humanoid.stats ?? null;
      },
      setYaw: (y: number) => {
        this.autoSpin = false;
        this.yaw = y;
      },
      setView: (v: View) => {
        this.setView(v);
        this.zoom = this.zoomTarget;
      },
      /** Checksum of the preview mesh geometry (changes when a slider reshapes the body/face). */
      geomHash: () => {
        const m = this.studio?.humanoid.root.getObjectByName('humanoid_mesh') as THREE.Mesh | undefined;
        const pos = m?.geometry.getAttribute('position');
        if (!pos) return 0;
        let s = 0;
        for (let i = 0; i < pos.array.length; i += 7) s += (pos.array[i] as number) * ((i % 13) + 1);
        return +s.toFixed(4);
      },
    };
  }
}

function sameItem(a: string, b: string): boolean {
  return a === b || (EMPTY_IDS.has(a) && EMPTY_IDS.has(b));
}

// -----------------------------------------------------------------------------
// Arrival: letterbox for the opening camera sweep, then the first quest prompt.
// -----------------------------------------------------------------------------

/**
 * Letterbox bars + skip control for the arrival cinematic (the HUD fades out
 * meanwhile). `isActive` is polled every frame; when it turns false (session
 * ended, camera taken over) the overlay removes itself without the prompt.
 */
export function arrivalOverlay(ctx: GameContext, isActive: () => boolean, onSkip?: () => void): { close(showPrompt: boolean): void } {
  const root = ctx.ui.root;
  let closed = false;
  const touch = isTouchPlay(ctx);
  const skip = h('button.cine-skip', { 'data-action': 'skip-arrival', onclick: () => onSkip?.() }, touch ? null : h('span.kbd', ctx.input.label('jump')), touch ? 'Skip ›' : ' Skip');
  const el = h('div.cine', h('div.cine-bar.top'), h('div.cine-bar.bottom', skip));
  ctx.ui.layers.overlay.appendChild(el);
  root.classList.add('cinematic');
  const close = (showPrompt: boolean) => {
    if (closed) return;
    closed = true;
    root.classList.remove('cinematic');
    el.classList.add('out');
    setTimeout(() => el.remove(), 700);
    if (showPrompt) showFirstQuestPrompt(ctx);
  };
  const tick = () => {
    if (closed) return;
    if (!isActive()) close(false);
    else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return { close };
}

/** Playing by touch (phone / tablet, or the on-screen controls are up): hints speak of taps, not keys. */
function isTouchPlay(ctx: GameContext): boolean {
  return ctx.settings.device.mobile || ctx.input.lastDevice === 'touch' || !!ctx.ui.touch?.shown;
}

/** "New quest" card for the opening quest: title, summary, first objectives and where to look. */
export function showFirstQuestPrompt(ctx: GameContext): void {
  const q = ctx.quests;
  const id = q.tracked ?? [...q.active.keys()][0];
  const def = id ? q.get(id) : undefined;
  if (!def || !ctx.session.active) return;
  document.querySelector('.quest-prompt')?.remove();
  const lines = (q.objectiveText()?.lines ?? []).filter((l) => !l.done).slice(0, 2);
  let gone = false;
  const dismiss = () => {
    if (gone) return;
    gone = true;
    card.classList.add('out');
    setTimeout(() => card.remove(), 450);
  };
  const card = h(
    'div.quest-prompt.panel',
    { role: 'status', 'data-quest': def.id },
    h('div.qp-kicker', '◆ New Quest'),
    h('div.qp-title', def.title),
    def.summary ? h('p.qp-summary', def.summary) : null,
    lines.length ? h('div.qp-obj', lines.map((l) => h('div', h('span.qp-dot', '◇'), l.text))) : null,
    h(
      'div.qp-foot',
      isTouchPlay(ctx) ? h('span.muted', 'Journal and map: ☰ Menu · follow the quest marker') : h('span.muted', h('span.kbd', ctx.input.label('journal')), ' Journal · follow the ◆ on your compass'),
      h('button.btn.small.primary', { 'data-action': 'quest-ok', onclick: dismiss }, 'Got it'),
    ),
  );
  ctx.ui.layers.overlay.appendChild(card);
  setTimeout(dismiss, 14000);
  ctx.events.once('session:ending', () => card.remove());
}
