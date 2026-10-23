import * as THREE from 'three';
import {
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
  type OutfitSlots,
} from '../../character/Appearance';
import { Humanoid } from '../../character/Humanoid';
import type { GameContext } from '../../core/GameContext';
import { Random } from '../../core/Random';
import { ELEMENT_INFO, ELEMENTS, type Element } from '../../core/types';
import { COSMETICS, type CosmeticSlot } from '../../data/cosmetics';
import { STARTS, regionById } from '../../world/WorldLayout';
import { clear, h } from '../dom';
import { ELEMENT_COLORS, emblem } from '../icons';
import type { Screen, UIManager } from '../UIManager';

const CARD_BG: Record<Element, string> = {
  air: 'linear-gradient(160deg, #f7e2b0 0%, #e8b04a 35%, #6a8fb8 100%)',
  water: 'linear-gradient(160deg, #e6f4ff 0%, #6aa6d6 40%, #1e3a66 100%)',
  earth: 'linear-gradient(160deg, #d8e8b0 0%, #6a9a4a 40%, #2f4f25 100%)',
  fire: 'linear-gradient(160deg, #ffd8a0 0%, #d0362a 45%, #2a1010 100%)',
};

const STUDIO_BG: Record<Element, [string, string]> = {
  air: ['#f2d9a0', '#7a8fb0'],
  water: ['#cfe8f8', '#2a4a78'],
  earth: ['#c8d8a0', '#3a4a2a'],
  fire: ['#f0b080', '#3a1414'],
};

const STARTER_ITEMS: Record<Element, Array<{ name: string; detail: string }>> = {
  water: [
    { name: 'Northern Parka & Fur Boots', detail: 'Warm attire of the Northern Water Tribe.' },
    { name: 'Carved Wave Choker', detail: 'A blue ribbon with the tribe’s carved stone.' },
    { name: '3 × Healing Herbs, 5 × Sea Prunes', detail: 'Supplies for the road (and for polar bear dogs).' },
  ],
  earth: [
    { name: 'Earth Kingdom Tunic & Boots', detail: 'Sturdy clothes from the Lower Ring.' },
    { name: 'Jade Pendant', detail: 'A simple green stone for luck.' },
    { name: '3 × Healing Herbs, 5 × Cabbages', detail: 'Supplies — and badgermoles love cabbage.' },
  ],
  fire: [
    { name: 'Fire Nation Tunic & Topknot Ornament', detail: 'Proper attire for the capital.' },
    { name: 'Leather Bracers', detail: 'Protection for quick strikes.' },
    { name: '3 × Healing Herbs, 5 × Fire Flakes', detail: 'Spicy supplies. Some creatures adore them.' },
  ],
  air: [
    { name: 'Air Nomad Robe & Mantle', detail: 'Light garments for running along the wind.' },
    { name: 'Prayer Beads', detail: 'A gift from the temple elders.' },
    { name: '3 × Healing Herbs, 5 × Moon Peaches', detail: 'Sky bison cannot resist moon peaches.' },
  ],
};

const HOMELAND_CREATURES: Record<Element, string> = {
  water: 'Polar bear dogs roam the northern ice. Win their trust with patience and stewed sea prunes.',
  earth: 'Badgermoles tunnel beneath the Earth Kingdom; ostrich horses graze its farmland.',
  fire: 'Rare dragons are said to sleep near the ancient Sun Warrior ruins. Only the worthy approach.',
  air: 'Sky bison drift above the temple meadows. A gentle hand and moon peaches go a long way.',
};

type Step = 'element' | 'creator' | 'preview';

export class NewGameFlow implements Screen {
  readonly id = 'newGame';
  readonly el: HTMLElement;
  modal = true;
  private ctx!: GameContext;
  private step: Step = 'element';
  private element: Element = 'water';
  private name = 'Avatar';
  private app: Appearance = cloneAppearance(DEFAULT_APPEARANCE.water);
  private studio: { scene: THREE.Scene; camera: THREE.PerspectiveCamera; humanoid: Humanoid; pedestal: THREE.Mesh; bg: THREE.Mesh } | null = null;
  private yaw = 0.4;
  private zoom = 0;
  private dragging = false;
  private lastX = 0;
  private tab = 'body';
  private leftPanel: HTMLElement | null = null;
  private rebuildTimer = 0;
  private dirty = false;

  constructor(private readonly ui: UIManager) {
    this.el = h('div.layer.interactive');
  }

  onOpen(ctx: GameContext): void {
    this.ctx = ctx;
    this.step = 'element';
    this.render();
  }

  onClose(): void {
    this.disposeStudio();
  }

  private render(): void {
    clear(this.el);
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
      const card = h(
        'div.element-card',
        {
          tabindex: 0,
          'data-element': e,
          style: { background: CARD_BG[e], animationDelay: `${i * 0.06}s` },
          onclick: () => this.chooseElement(e),
          onkeydown: (ev: KeyboardEvent) => {
            if (ev.key === 'Enter') this.chooseElement(e);
          },
        },
        emblem(e),
        h('h3', ELEMENT_INFO[e].name.toUpperCase()),
        h('div.where', where[e]),
        h('div.desc', desc[e]),
      );
      card.style.setProperty('--el-glow', c.glow);
      card.style.setProperty('--el-shadow', c.shadow);
      return card;
    });
    this.el.append(
      h(
        'div.element-select',
        h('h1.title', 'BEGIN YOUR JOURNEY AS THE AVATAR'),
        h('p.lead', 'Choose the element with which your journey begins. Your destiny is to master all four.'),
        h('div.element-cards', cards),
        h('div.row', { style: { marginTop: '22px' } }, h('button.btn', { onclick: () => this.ui.close() }, 'Back')),
      ),
    );
  }

  private chooseElement(e: Element): void {
    this.ctx.audio.play('ui_confirm', { bus: 'ui' });
    if (e !== this.element || this.step === 'element') {
      this.element = e;
      this.app = cloneAppearance(DEFAULT_APPEARANCE[e]);
    }
    this.step = 'creator';
    this.render();
  }

  // ---------------------------------------------------------------------------
  // Step 2: creator
  // ---------------------------------------------------------------------------

  private ensureStudio(): void {
    if (this.studio) {
      this.applyStudioTheme();
      return;
    }
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, window.innerWidth / window.innerHeight, 0.05, 100);
    scene.add(new THREE.HemisphereLight(0xfff4e0, 0x404050, 1.4));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(2, 4, 3);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xbfd8ff, 1.6);
    rim.position.set(-3, 2.5, -3);
    scene.add(rim);
    const bgMat = new THREE.ShaderMaterial({
      uniforms: { top: { value: new THREE.Color() }, bottom: { value: new THREE.Color() } },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float t = clamp(normalize(vP).y*0.8+0.5,0.0,1.0); gl_FragColor = vec4(mix(bottom, top, t),1.0); #include <colorspace_fragment> }',
      side: THREE.BackSide,
      depthWrite: false,
    });
    const bg = new THREE.Mesh(new THREE.SphereGeometry(30, 32, 16), bgMat);
    scene.add(bg);
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.0, 0.18, 48), new THREE.MeshStandardMaterial({ color: '#c8b48a', roughness: 0.8 }));
    pedestal.position.y = -0.09;
    scene.add(pedestal);
    const humanoid = new Humanoid(this.app, { castShadow: false });
    scene.add(humanoid.root);
    this.studio = { scene, camera, humanoid, pedestal, bg };
    this.applyStudioTheme();
    this.ctx.game.setStage({ scene, camera });
    const canvas = this.ctx.render.canvas;
    canvas.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: true });
  }

  private applyStudioTheme(): void {
    if (!this.studio) return;
    const [top, bottom] = STUDIO_BG[this.element];
    const u = (this.studio.bg.material as THREE.ShaderMaterial).uniforms;
    u.top.value.set(top);
    u.bottom.value.set(bottom);
    (this.studio.pedestal.material as THREE.MeshStandardMaterial).color.set(this.element === 'water' ? '#dfeef8' : this.element === 'fire' ? '#5a2a20' : this.element === 'earth' ? '#8a7a5a' : '#e8d8b0');
  }

  private onDown = (e: PointerEvent) => {
    this.dragging = true;
    this.lastX = e.clientX;
  };
  private onMove = (e: PointerEvent) => {
    if (!this.dragging) return;
    this.yaw += (e.clientX - this.lastX) * 0.01;
    this.lastX = e.clientX;
  };
  private onUp = () => {
    this.dragging = false;
  };
  private onWheel = (e: WheelEvent) => {
    this.zoom = Math.max(0, Math.min(1, this.zoom + (e.deltaY < 0 ? 0.15 : -0.15)));
  };

  private disposeStudio(): void {
    if (!this.studio) return;
    const canvas = this.ctx.render.canvas;
    canvas.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    canvas.removeEventListener('wheel', this.onWheel);
    this.studio.humanoid.dispose();
    this.studio.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    });
    this.studio = null;
    this.ctx.game.setStage(null);
  }

  update(dt: number): void {
    if (!this.studio) return;
    const s = this.studio;
    if (this.dirty) {
      this.rebuildTimer -= dt;
      if (this.rebuildTimer <= 0) {
        this.dirty = false;
        s.humanoid.setAppearance(cloneAppearance(this.app));
      }
    }
    if (!this.dragging) this.yaw += dt * 0.15;
    s.humanoid.root.rotation.y = this.yaw;
    s.humanoid.animator.loco.style = this.element;
    s.humanoid.update(dt);
    const hgt = s.humanoid.height;
    const focusY = THREE.MathUtils.lerp(hgt * 0.55, hgt * 0.92, this.zoom);
    const dist = THREE.MathUtils.lerp(4.4, 1.3, this.zoom);
    // Shift the character to the screen centre between the panels.
    s.camera.position.set(0, focusY + 0.1, dist);
    s.camera.lookAt(0, focusY, 0);
    s.camera.aspect = window.innerWidth / window.innerHeight;
    s.camera.updateProjectionMatrix();
  }

  private changed(): void {
    this.dirty = true;
    this.rebuildTimer = 0.05;
  }

  private renderCreator(): void {
    this.ensureStudio();
    this.leftPanel = h('div.panel.side');
    const tabs: Array<[string, string]> = [
      ['body', 'Body'],
      ['face', 'Face'],
      ['hair', 'Hair'],
      ['marks', 'Markings'],
      ['attire', 'Attire'],
      ['colors', 'Colours'],
    ];
    const tabBar = h('div.tabs');
    const content = h('div.scroll', { style: { flex: '1', minHeight: '0', paddingRight: '6px', marginTop: '10px' } });
    const renderTab = () => {
      clear(tabBar);
      for (const [id, label] of tabs) tabBar.append(h(`button.tab${this.tab === id ? '.active' : ''}`, { onclick: () => { this.tab = id; renderTab(); } }, label));
      clear(content);
      content.append(...this.tabContent(this.tab, renderTab));
    };
    renderTab();
    const nameInput = h('input', { type: 'text', value: this.name, maxlength: 24, oninput: (e: Event) => (this.name = (e.target as HTMLInputElement).value) }) as HTMLInputElement;
    this.leftPanel.append(
      h('h2.title', { style: { margin: '0 0 8px', fontSize: '20px' } }, 'Create Your Avatar'),
      h('div.field', h('label', 'NAME'), nameInput),
      tabBar,
      content,
    );
    const start = STARTS[this.element];
    const right = h(
      'div.panel.side',
      h('div.row', emblem(this.element, 'emblem'), h('div', h('div.title', { style: { fontSize: '17px' } }, `${ELEMENT_INFO[this.element].name} Avatar`), h('div.muted', { style: { fontSize: '14px' } }, regionById(start.regionId)?.name ?? ''))),
      h('div.divider'),
      h('p.muted', { style: { fontSize: '14px', lineHeight: '1.4' } }, 'Drag to rotate the preview. Scroll to zoom on the face. Your look stays the same everywhere — in battle, while riding, and in the Avatar State.'),
      h('div.spacer'),
      h('button.btn', { onclick: () => this.randomize(), style: { marginBottom: '8px' } }, 'Randomize'),
      h('button.btn', { onclick: () => { this.app = cloneAppearance(DEFAULT_APPEARANCE[this.element]); this.changed(); this.render(); }, style: { marginBottom: '8px' } }, 'Reset Look'),
      h('div.row', h('button.btn', { onclick: () => { this.step = 'element'; this.render(); } }, 'Back'), h('div.spacer'), h('button.btn.primary', { 'data-action': 'creator-continue', onclick: () => { this.step = 'preview'; this.render(); } }, 'Continue')),
    );
    (right as HTMLElement).style.display = 'flex';
    (right as HTMLElement).style.flexDirection = 'column';
    this.el.append(h('div.creator', this.leftPanel, h('div.preview-hint', '⟲ drag to rotate · scroll to zoom'), right));
  }

  private swatchRow(colors: string[], current: string, set: (c: string) => void, rerender: () => void): HTMLElement {
    return h(
      'div.swatches',
      colors.map((c) => h(`div.swatch${c.toLowerCase() === current.toLowerCase() ? '.active' : ''}`, { style: { background: c }, title: c, onclick: () => { set(c); this.changed(); rerender(); } })),
    );
  }

  private chipRow<T extends string>(items: Array<{ id: T; name: string }>, current: T, set: (v: T) => void, rerender: () => void): HTMLElement {
    return h('div.chips', items.map((it) => h(`button.chip${it.id === current ? '.active' : ''}`, { onclick: () => { set(it.id); this.changed(); rerender(); } }, it.name)));
  }

  private slider(label: string, value: number, min: number, max: number, step: number, set: (v: number) => void): HTMLElement {
    return h('div.field', h('label', label), h('input', { type: 'range', min, max, step, value, oninput: (e: Event) => { set(Number((e.target as HTMLInputElement).value)); this.changed(); } }));
  }

  private tabContent(tab: string, rerender: () => void): HTMLElement[] {
    const a = this.app;
    switch (tab) {
      case 'body':
        return [
          h('div.field', h('label', 'FRAME'), this.chipRow(FRAME_OPTIONS, a.frame, (v) => (a.frame = v), rerender)),
          this.slider('HEIGHT', a.height, 0.9, 1.1, 0.01, (v) => (a.height = v)),
          this.slider('BUILD', a.build, 0, 1, 0.01, (v) => (a.build = v)),
          h('div.field', h('label', 'SKIN TONE'), this.swatchRow(SKIN_TONES, a.skinTone, (c) => (a.skinTone = c), rerender)),
        ];
      case 'face':
        return [
          h('div.field', h('label', 'FACE PRESET'), this.chipRow([0, 1, 2, 3, 4, 5].map((i) => ({ id: String(i), name: `Face ${i + 1}` })), String(a.face.preset), (v) => (a.face.preset = Number(v)), rerender)),
          this.slider('JAW', a.face.jaw, -1, 1, 0.05, (v) => (a.face.jaw = v)),
          this.slider('CHEEKBONES', a.face.cheeks, -1, 1, 0.05, (v) => (a.face.cheeks = v)),
          this.slider('NOSE', a.face.nose, -1, 1, 0.05, (v) => (a.face.nose = v)),
          this.slider('EYE SPACING', a.face.eyeSpacing, -1, 1, 0.05, (v) => (a.face.eyeSpacing = v)),
          h('div.field', h('label', 'EYE SHAPE'), this.chipRow([{ id: 'round', name: 'Round' }, { id: 'almond', name: 'Almond' }, { id: 'narrow', name: 'Narrow' }, { id: 'wide', name: 'Wide' }] as const as any, a.eyes.shape, (v) => (a.eyes.shape = v as any), rerender)),
          h('div.field', h('label', 'EYE COLOUR'), this.swatchRow(EYE_COLORS, a.eyes.color, (c) => (a.eyes.color = c), rerender)),
          h('div.field', h('label', 'EYEBROWS'), this.chipRow([0, 1, 2, 3, 4, 5].map((i) => ({ id: String(i), name: `Style ${i + 1}` })), String(a.brows.style), (v) => (a.brows.style = Number(v)), rerender)),
          this.slider('BROW THICKNESS', a.brows.thickness, 0, 1, 0.05, (v) => (a.brows.thickness = v)),
        ];
      case 'hair':
        return [
          h('div.field', h('label', 'HAIRSTYLE'), this.chipRow(HAIRSTYLES, a.hair.style, (v) => (a.hair.style = v), rerender)),
          h('div.field', h('label', 'HAIR COLOUR'), this.swatchRow(HAIR_COLORS, a.hair.color, (c) => { a.hair.color = c; a.brows.color = c; }, rerender)),
          h('div.field', h('label', 'FACIAL HAIR'), this.chipRow(FACIAL_HAIR, a.facialHair, (v) => (a.facialHair = v), rerender)),
        ];
      case 'marks':
        return [
          h('div.field', h('label', 'AIR NOMAD TATTOOS'), this.chipRow(TATTOO_STYLES, a.tattoos, (v) => (a.tattoos = v), rerender), h('div.muted', { style: { fontSize: '13px' } }, TATTOO_STYLES.find((t) => t.id === a.tattoos)?.desc ?? '')),
          h('div.field', h('label', 'TATTOO COLOUR'), this.swatchRow(TATTOO_COLORS, a.tattooColor, (c) => (a.tattooColor = c), rerender)),
          h('div.field', h('label', 'SCARS'), h('div.chips', SCARS.map((s) => h(`button.chip${a.scars.includes(s.id) ? '.active' : ''}`, { onclick: () => { a.scars = a.scars.includes(s.id) ? a.scars.filter((x) => x !== s.id) : [...a.scars, s.id]; this.changed(); rerender(); } }, s.name)))),
        ];
      case 'attire': {
        const slots: Array<[keyof OutfitSlots, CosmeticSlot, string]> = [
          ['top', 'top', 'TOP / ROBE'],
          ['bottom', 'bottom', 'TROUSERS'],
          ['footwear', 'footwear', 'FOOTWEAR'],
          ['outer', 'outer', 'OUTER LAYER'],
          ['gloves', 'gloves', 'GLOVES & WRAPS'],
          ['belt', 'belt', 'BELT / SASH'],
          ['headwear', 'headwear', 'HEADWEAR'],
          ['necklace', 'necklace', 'NECKLACE'],
          ['accessory', 'accessory', 'ACCESSORY'],
        ];
        return slots.map(([key, slot, label]) => {
          const items = COSMETICS.filter((c) => c.slot === slot && c.unlock === 'start');
          return h('div.field', h('label', label), this.chipRow(items.map((c) => ({ id: c.id, name: c.name })), a.outfit[key] === 'none' ? items[0]?.id ?? 'none' : a.outfit[key], (v) => (a.outfit[key] = v), rerender));
        });
      }
      case 'colors':
      default: {
        const palette = ['#e8a33a', '#c8642a', '#f4d48a', '#2f5f9e', '#1e3a66', '#e9eef5', '#4f7f3a', '#2f4f25', '#c9b27a', '#a8241c', '#2a1a18', '#d4a43a', '#6b4a2a', '#7a3a1a', '#5a1410', '#3a3a3a', '#e8e2d0', '#8a7a5a'];
        return (['primary', 'secondary', 'accent', 'trim'] as const).map((k) => h('div.field', h('label', `${k.toUpperCase()} COLOUR`), this.swatchRow(palette, a.colors[k], (c) => (a.colors[k] = c), rerender)));
      }
    }
  }

  private randomize(): void {
    const r = new Random((Math.random() * 1e9) | 0);
    const a = this.app;
    a.frame = r.pick(FRAME_OPTIONS).id;
    a.height = r.range(0.93, 1.07);
    a.build = r.range(0.2, 0.8);
    a.skinTone = r.pick(SKIN_TONES);
    a.face = { preset: r.int(0, 5), jaw: r.range(-0.6, 0.6), cheeks: r.range(-0.6, 0.6), nose: r.range(-0.6, 0.6), eyeSpacing: r.range(-0.5, 0.5) };
    a.eyes = { color: r.pick(EYE_COLORS), shape: r.pick(['round', 'almond', 'narrow', 'wide'] as const) };
    a.hair = { style: r.pick(HAIRSTYLES).id, color: r.pick(HAIR_COLORS) };
    a.brows = { style: r.int(0, 5), thickness: r.range(0.2, 0.9), color: a.hair.color };
    a.facialHair = r.chance(0.25) ? r.pick(FACIAL_HAIR).id : 'none';
    a.tattoos = this.element === 'air' ? r.pick(['arrows', 'arrows_head', 'none', 'arrow_partial'] as const) : r.chance(0.15) ? 'arrows' : 'none';
    this.changed();
    this.render();
  }

  // ---------------------------------------------------------------------------
  // Step 3: preview & confirm
  // ---------------------------------------------------------------------------

  private renderPreview(): void {
    this.ensureStudio();
    const e = this.element;
    const start = STARTS[e];
    const panel = h(
      'div.panel.side',
      { style: { display: 'flex', flexDirection: 'column' } },
      h('h2.title', { style: { margin: '0 0 6px', fontSize: '20px' } }, 'Your Journey Begins'),
      h('div.row', emblem(e, 'emblem'), h('div', h('div', { style: { fontSize: '18px' } }, this.name || 'Avatar'), h('div.muted', start.title))),
      h('div.divider'),
      h('div.title', { style: { fontSize: '14px', marginBottom: '6px' } }, 'Starting Equipment'),
      ...STARTER_ITEMS[e].map((it) => h('div', { style: { marginBottom: '6px' } }, h('div', it.name), h('div.muted', { style: { fontSize: '13px' } }, it.detail))),
      h('div.divider'),
      h('div.title', { style: { fontSize: '14px', marginBottom: '6px' } }, 'Companions of your Homeland'),
      h('p.muted', { style: { fontSize: '14px', lineHeight: '1.4', margin: '0' } }, HOMELAND_CREATURES[e]),
      h('div.divider'),
      h('p.muted', { style: { fontSize: '14px', lineHeight: '1.4' } }, `You begin with ${ELEMENT_INFO[e].name}bending. As the Avatar you can learn ${ELEMENTS.filter((x) => x !== e).map((x) => ELEMENT_INFO[x].name).join(', ')} from masters across the world — and enter the Avatar State at will.`),
      h('div.spacer'),
      h('div.row', h('button.btn', { onclick: () => { this.step = 'creator'; this.render(); } }, 'Back'), h('div.spacer'), h('button.btn.primary', { 'data-action': 'confirm-journey', onclick: () => this.confirm() }, 'Begin Journey')),
    );
    this.el.append(h('div.creator', panel, h('div.preview-hint', ''), h('div')));
  }

  private confirm(): void {
    const save = this.ctx.save;
    const empty = save.firstEmptySlot();
    if (empty) {
      this.launch(empty);
      return;
    }
    // All slots used: never overwrite silently.
    const metas = save.listSlots();
    this.ui.confirm('All three journey slots are in use. Choose a journey to replace — it will be permanently overwritten.', [
      ...metas.map((m, i) => ({
        text: m ? `Replace ${m.characterName} (Lv ${m.level})` : `Slot ${i + 1}`,
        danger: true,
        onClick: () => this.launch(`slot${i + 1}`),
      })),
      { text: 'Cancel', primary: true },
    ]);
  }

  private launch(slot: string): void {
    const cfg = { element: this.element, name: this.name.trim() || 'Avatar', appearance: cloneAppearance(this.app), slot };
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
    if (e.key === 'Escape') {
      if (this.step === 'preview') this.step = 'creator';
      else if (this.step === 'creator') this.step = 'element';
      else {
        this.ui.close();
        return true;
      }
      this.render();
      return true;
    }
    return false;
  }
}
