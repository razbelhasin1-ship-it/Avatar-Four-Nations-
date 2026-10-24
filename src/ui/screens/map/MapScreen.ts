import * as THREE from 'three';
import type { GameContext } from '../../../core/GameContext';
import { HABITATS, speciesById } from '../../../data/creatures';
import { DEFAULT_DANGER, REGION_DANGER } from '../../../data/enemies';
import type { QuestMarker } from '../../../quests/QuestSystem';
import { heightAt } from '../../../world/Heightfield';
import { LANDMARKS, MOUNTAIN_RANGES, REGIONS, RIVERS, ROADS, WORLD_HALF, type LandmarkDef, type LandmarkKind } from '../../../world/WorldLayout';
import { clear, h } from '../../dom';
import type { UIManager } from '../../UIManager';
import { GameScreen, type PadFrame } from '../gsBase';
import { renderMapRaster } from './mapRender';

// -----------------------------------------------------------------------------
// Raster cache: generated once (Web Worker; inline fallback), kept for the session.
// -----------------------------------------------------------------------------

const FULL = 1024;
let raster: HTMLCanvasElement | null = null;
let rasterSize = 0;
let worker: Worker | null = null;
const rasterListeners = new Set<() => void>();

function acceptRaster(size: number, px: Uint8ClampedArray): void {
  if (size <= rasterSize) return;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(px), size, size), 0, 0);
  raster = c;
  rasterSize = size;
  for (const f of rasterListeners) f();
}

function inlineRaster(size: number): void {
  try {
    acceptRaster(size, renderMapRaster(size));
  } catch (err) {
    console.warn('[Map] inline raster failed', err);
  }
}

/** Start generating the map image in the background (idempotent). */
export function ensureMapRaster(): void {
  if (worker || rasterSize >= FULL) return;
  try {
    worker = new Worker(new URL('./mapWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ size: number; px: Uint8ClampedArray }>) => {
      acceptRaster(e.data.size, e.data.px);
      if (e.data.size >= FULL) {
        worker?.terminate();
        worker = null;
      }
    };
    worker.onerror = (e) => {
      e.preventDefault();
      console.warn('[Map] worker unavailable, rendering inline');
      worker?.terminate();
      worker = null;
      if (rasterSize < 320) inlineRaster(320);
    };
    worker.postMessage({ size: 256 });
    worker.postMessage({ size: FULL });
  } catch {
    worker = null;
    inlineRaster(320);
  }
}

export function mapRasterSize(): number {
  return rasterSize;
}

// -----------------------------------------------------------------------------
// Glyphs
// -----------------------------------------------------------------------------

const INK = '#4a3622';
const KIND_LABEL: Record<LandmarkKind, string> = {
  capital: 'Capital',
  city: 'City',
  village: 'Village',
  temple: 'Temple',
  shrine: 'Shrine',
  cave: 'Cave',
  viewpoint: 'Viewpoint',
  dock: 'Harbour',
  training: 'Training ground',
  ruin: 'Ruins',
  camp: 'Outpost',
  oasis: 'Oasis',
  habitat: 'Habitat',
  landmark: 'Landmark',
};

function glyph(g: CanvasRenderingContext2D, kind: LandmarkKind | 'paw' | 'star' | 'quest', x: number, y: number, s: number, fill: string, faded = false): void {
  g.save();
  g.translate(x, y);
  g.globalAlpha = faded ? 0.5 : 1;
  g.lineWidth = Math.max(1, s * 0.13);
  g.strokeStyle = INK;
  g.fillStyle = fill;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  const badge = (r: number) => {
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.fillStyle = faded ? 'rgba(240,230,205,0.6)' : fill;
    g.fill();
    g.stroke();
    g.fillStyle = INK;
  };
  switch (kind) {
    case 'capital':
    case 'temple': {
      badge(s);
      // pagoda: two stacked roofs + base
      g.beginPath();
      g.moveTo(-s * 0.62, -s * 0.05);
      g.quadraticCurveTo(0, -s * 0.42, s * 0.62, -s * 0.05);
      g.lineTo(-s * 0.62, -s * 0.05);
      g.moveTo(-s * 0.45, -s * 0.4);
      g.quadraticCurveTo(0, -s * 0.78, s * 0.45, -s * 0.4);
      g.fill();
      g.stroke();
      g.fillRect(-s * 0.36, -s * 0.05, s * 0.72, s * 0.5);
      if (kind === 'capital') {
        g.beginPath();
        g.moveTo(0, -s * 0.78);
        g.lineTo(0, -s * 0.98);
        g.stroke();
      }
      break;
    }
    case 'city':
    case 'village': {
      badge(s * (kind === 'city' ? 0.95 : 0.8));
      const k = kind === 'city' ? 0.5 : 0.42;
      g.beginPath();
      g.moveTo(-s * k, s * 0.38);
      g.lineTo(-s * k, -s * 0.05);
      g.lineTo(0, -s * 0.5);
      g.lineTo(s * k, -s * 0.05);
      g.lineTo(s * k, s * 0.38);
      g.closePath();
      g.fill();
      break;
    }
    case 'shrine':
    case 'training': {
      badge(s * 0.8);
      g.beginPath();
      g.moveTo(-s * 0.5, -s * 0.32);
      g.lineTo(s * 0.5, -s * 0.32);
      g.moveTo(-s * 0.38, -s * 0.1);
      g.lineTo(s * 0.38, -s * 0.1);
      g.moveTo(-s * 0.28, -s * 0.32);
      g.lineTo(-s * 0.28, s * 0.42);
      g.moveTo(s * 0.28, -s * 0.32);
      g.lineTo(s * 0.28, s * 0.42);
      g.stroke();
      break;
    }
    case 'dock': {
      badge(s * 0.8);
      g.beginPath();
      g.moveTo(0, -s * 0.45);
      g.lineTo(0, s * 0.4);
      g.moveTo(-s * 0.3, -s * 0.2);
      g.lineTo(s * 0.3, -s * 0.2);
      g.moveTo(-s * 0.42, s * 0.05);
      g.quadraticCurveTo(0, s * 0.62, s * 0.42, s * 0.05);
      g.stroke();
      break;
    }
    case 'cave':
    case 'ruin': {
      badge(s * 0.8);
      g.beginPath();
      if (kind === 'cave') {
        g.moveTo(-s * 0.45, s * 0.35);
        g.quadraticCurveTo(-s * 0.4, -s * 0.5, 0, -s * 0.45);
        g.quadraticCurveTo(s * 0.4, -s * 0.5, s * 0.45, s * 0.35);
        g.closePath();
        g.fill();
      } else {
        g.fillRect(-s * 0.42, -s * 0.2, s * 0.18, s * 0.58);
        g.fillRect(-s * 0.09, -s * 0.42, s * 0.18, s * 0.8);
        g.fillRect(s * 0.24, -s * 0.05, s * 0.18, s * 0.43);
      }
      break;
    }
    case 'camp': {
      badge(s * 0.8);
      g.beginPath();
      g.moveTo(-s * 0.45, s * 0.35);
      g.lineTo(0, -s * 0.45);
      g.lineTo(s * 0.45, s * 0.35);
      g.closePath();
      g.fill();
      break;
    }
    case 'oasis': {
      badge(s * 0.8);
      g.beginPath();
      g.moveTo(0, s * 0.42);
      g.quadraticCurveTo(s * 0.06, 0, 0, -s * 0.25);
      g.moveTo(0, -s * 0.25);
      g.quadraticCurveTo(-s * 0.35, -s * 0.45, -s * 0.5, -s * 0.1);
      g.moveTo(0, -s * 0.25);
      g.quadraticCurveTo(s * 0.35, -s * 0.45, s * 0.5, -s * 0.1);
      g.stroke();
      break;
    }
    case 'habitat':
    case 'paw': {
      badge(s * 0.8);
      g.beginPath();
      g.ellipse(0, s * 0.14, s * 0.24, s * 0.19, 0, 0, Math.PI * 2);
      for (const [dx, dy] of [[-0.3, -0.18], [-0.1, -0.36], [0.1, -0.36], [0.3, -0.18]]) {
        g.moveTo(s * dx + s * 0.09, s * dy);
        g.arc(s * dx, s * dy, s * 0.09, 0, Math.PI * 2);
      }
      g.fill();
      break;
    }
    case 'star': {
      g.beginPath();
      for (let i = 0; i < 8; i++) {
        const r = i % 2 === 0 ? s : s * 0.38;
        const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
        g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      g.closePath();
      g.fill();
      g.stroke();
      break;
    }
    case 'quest': {
      g.beginPath();
      g.moveTo(0, -s);
      g.lineTo(s * 0.7, 0);
      g.lineTo(0, s);
      g.lineTo(-s * 0.7, 0);
      g.closePath();
      g.fill();
      g.stroke();
      break;
    }
    default: {
      badge(s * 0.7);
      g.beginPath();
      g.moveTo(0, -s * 0.35);
      g.lineTo(s * 0.28, 0);
      g.lineTo(0, s * 0.35);
      g.lineTo(-s * 0.28, 0);
      g.closePath();
      g.fill();
    }
  }
  g.restore();
}

// -----------------------------------------------------------------------------

type Pick =
  | { type: 'landmark'; l: LandmarkDef }
  | { type: 'marker'; m: QuestMarker }
  | { type: 'habitat'; id: string; name: string; species: string; x: number; z: number };

interface View {
  w: number;
  h: number;
  scale: number;
}

const ZOOM_MIN = 1;
const ZOOM_MAX = 9;

/** World map (M): parchment map of the real terrain with travel, markers, legend, fog and danger. */
export class MapScreen extends GameScreen {
  readonly id = 'map';
  private canvas: HTMLCanvasElement;
  private stage: HTMLElement;
  private side: HTMLElement;
  private info: HTMLElement;
  private readout: HTMLElement;
  private zoom = 1.6;
  private cx = 0;
  private cz = 0;
  private hover: Pick | null = null;
  private selected: Pick | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private drag: { x: number; y: number; cx: number; cz: number; moved: boolean } | null = null;
  private pinch: { d: number; zoom: number } | null = null;
  private dirty = true;
  private pulse = 0;
  private fog: HTMLCanvasElement | null = null;
  private fogSig = '';
  private cursorMode = false;
  private onRaster = () => (this.dirty = true);

  constructor(ui: UIManager) {
    super(ui, 'World Map', 'map');
    this.canvas = h('canvas.mp-canvas', { tabindex: '0', 'aria-label': 'World map. Arrow keys pan, plus and minus zoom, Enter travels.' }) as HTMLCanvasElement;
    this.readout = h('div.mp-readout');
    const zbtn = (label: string, title: string, fn: () => void, action: string) => h('button.mp-zbtn', { type: 'button', title, 'aria-label': title, 'data-action': action, onclick: fn }, label);
    this.stage = h(
      'div.mp-stage',
      this.canvas,
      h('div.mp-cross'),
      h('div.mp-zoom', zbtn('+', 'Zoom in', () => this.zoomBy(1.35), 'zoom-in'), zbtn('−', 'Zoom out', () => this.zoomBy(1 / 1.35), 'zoom-out'), zbtn('◎', 'Center on you', () => this.centerOnPlayer(), 'center')),
      this.readout,
    );
    this.info = h('div.mp-info');
    this.side = h('aside.mp-side.gs-scroll', this.info, this.legend());
    this.bindPointer();
  }

  protected override hints(): Array<[string, string]> {
    const pad = this.ctx.input.lastDevice === 'gamepad';
    return pad
      ? [['L-stick', 'Pan'], ['LT/RT', 'Zoom'], ['Ⓨ', 'Center'], ['Ⓐ', 'Travel']]
      : [['Drag/WASD', 'Pan'], ['Wheel/+−', 'Zoom'], ['C', 'Center'], ['Enter', 'Travel']];
  }

  override onOpen(ctx: GameContext, arg?: unknown): void {
    this.ctx = ctx;
    ensureMapRaster();
    rasterListeners.add(this.onRaster);
    const focus = (arg as { focus?: { x: number; z: number } } | undefined)?.focus;
    const p = ctx.player;
    if (focus) {
      this.cx = focus.x;
      this.cz = focus.z;
      this.zoom = Math.max(this.zoom, 2.4);
    } else if (p) {
      this.cx = p.position.x;
      this.cz = p.position.z;
    }
    this.selected = null;
    this.hover = null;
    super.onOpen(ctx, arg);
    requestAnimationFrame(() => this.canvas.focus({ preventScroll: true }));
  }

  onClose(): void {
    rasterListeners.delete(this.onRaster);
    this.pointers.clear();
    this.drag = null;
    this.pinch = null;
  }

  protected renderBody(): void {
    clear(this.body);
    this.body.className = 'gs-body mp-body';
    this.body.append(this.stage, this.side);
    this.renderInfo();
    this.dirty = true;
  }

  // ---------------------------------------------------------------------------
  // View math
  // ---------------------------------------------------------------------------

  private view(): View {
    const w = this.canvas.clientWidth || 640;
    const hh = this.canvas.clientHeight || 420;
    return { w, h: hh, scale: (Math.min(w, hh) / (WORLD_HALF * 2)) * this.zoom };
  }

  private toScreen(x: number, z: number, v: View): { x: number; y: number } {
    return { x: v.w / 2 + (x - this.cx) * v.scale, y: v.h / 2 + (z - this.cz) * v.scale };
  }

  private toWorld(sx: number, sy: number, v: View): { x: number; z: number } {
    return { x: this.cx + (sx - v.w / 2) / v.scale, z: this.cz + (sy - v.h / 2) / v.scale };
  }

  private clampCenter(): void {
    const v = this.view();
    const halfW = v.w / 2 / v.scale, halfH = v.h / 2 / v.scale;
    const lim = (half: number) => Math.max(0, WORLD_HALF - half);
    this.cx = Math.max(-lim(halfW), Math.min(lim(halfW), this.cx));
    this.cz = Math.max(-lim(halfH), Math.min(lim(halfH), this.cz));
  }

  /** Client (page) coordinates of a world point on the map canvas (tests, tutorials). */
  clientPointOf(x: number, z: number): { x: number; y: number; inside: boolean } {
    const v = this.view();
    const s = this.toScreen(x, z, v);
    const r = this.canvas.getBoundingClientRect();
    return { x: r.left + s.x, y: r.top + s.y, inside: s.x >= 0 && s.y >= 0 && s.x <= v.w && s.y <= v.h };
  }

  /** Centre the view on a world point. */
  focusOn(x: number, z: number, zoom?: number): void {
    if (zoom) this.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom));
    this.cx = x;
    this.cz = z;
    this.clampCenter();
    this.dirty = true;
  }

  zoomBy(f: number, sx?: number, sy?: number): void {
    const v = this.view();
    const ax = sx ?? v.w / 2, ay = sy ?? v.h / 2;
    const before = this.toWorld(ax, ay, v);
    this.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, this.zoom * f));
    const v2 = this.view();
    const after = this.toWorld(ax, ay, v2);
    this.cx += before.x - after.x;
    this.cz += before.z - after.z;
    this.clampCenter();
    this.dirty = true;
  }

  pan(dxPx: number, dyPx: number): void {
    const v = this.view();
    this.cx += dxPx / v.scale;
    this.cz += dyPx / v.scale;
    this.clampCenter();
    this.dirty = true;
    if (this.cursorMode) this.pickAtCenter();
  }

  centerOnPlayer(): void {
    const p = this.ctx.player;
    if (!p) return;
    this.cx = p.position.x;
    this.cz = p.position.z;
    this.clampCenter();
    this.dirty = true;
  }

  // ---------------------------------------------------------------------------
  // Picking
  // ---------------------------------------------------------------------------

  private revealed(x: number, z: number): boolean {
    const w = this.ctx.world;
    for (const r of REGIONS) {
      if ((r.known || w.visitedRegions.has(r.id)) && Math.hypot(x - r.x, z - r.z) < r.r * 1.05) return true;
    }
    return false;
  }

  private landmarkVisible(l: LandmarkDef): 'full' | 'faded' | null {
    if (this.ctx.world.discovered.has(l.id)) return 'full';
    if (l.hidden) return null;
    return this.revealed(l.x, l.z) ? 'faded' : null;
  }

  private habitats(): Array<{ id: string; name: string; species: string; x: number; z: number }> {
    const known = this.ctx.companions.habitatsKnown;
    return HABITATS.filter((x) => known.has(x.id)).map((x) => ({ id: x.id, name: x.name, species: x.species, x: x.x, z: x.z }));
  }

  private pickAt(sx: number, sy: number, radius = 18): Pick | null {
    const v = this.view();
    let best: Pick | null = null;
    let bd = radius;
    const consider = (x: number, z: number, p: Pick, bias = 0) => {
      const s = this.toScreen(x, z, v);
      const d = Math.hypot(s.x - sx, s.y - sy) - bias;
      if (d < bd) {
        bd = d;
        best = p;
      }
    };
    for (const m of this.ctx.quests.markers()) consider(m.position.x, m.position.z, { type: 'marker', m }, m.tracked ? 4 : 0);
    for (const hb of this.habitats()) consider(hb.x, hb.z, { type: 'habitat', ...hb });
    for (const l of LANDMARKS) if (this.landmarkVisible(l)) consider(l.x, l.z, { type: 'landmark', l }, l.fastTravel && this.ctx.world.discovered.has(l.id) ? 3 : 0);
    return best;
  }

  private pickAtCenter(): void {
    const v = this.view();
    const p = this.pickAt(v.w / 2, v.h / 2, 26);
    if (!samePick(p, this.selected)) {
      this.selected = p;
      this.renderInfo();
    }
  }

  private select(p: Pick | null): void {
    this.selected = p;
    this.renderInfo();
    this.dirty = true;
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------

  private bindPointer(): void {
    const c = this.canvas;
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      this.cursorMode = false;
      this.zoomBy(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.cursorMode = false;
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: this.zoom };
        this.drag = null;
      } else this.drag = { x: e.clientX, y: e.clientY, cx: this.cx, cz: this.cz, moved: false };
    });
    c.addEventListener('pointermove', (e) => {
      const r = c.getBoundingClientRect();
      if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pinch && this.pointers.size >= 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const target = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, this.pinch.zoom * (d / Math.max(1, this.pinch.d))));
        this.zoomBy(target / this.zoom, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
        return;
      }
      if (this.drag) {
        const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
        if (Math.hypot(dx, dy) > 4) this.drag.moved = true;
        if (this.drag.moved) {
          const v = this.view();
          this.cx = this.drag.cx - dx / v.scale;
          this.cz = this.drag.cz - dy / v.scale;
          this.clampCenter();
          this.dirty = true;
        }
        return;
      }
      const p = this.pickAt(e.clientX - r.left, e.clientY - r.top);
      if (!samePick(p, this.hover)) {
        this.hover = p;
        c.style.cursor = p ? 'pointer' : 'grab';
        this.dirty = true;
      }
    });
    const up = (e: PointerEvent) => {
      const wasDrag = this.drag;
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      this.drag = null;
      if (wasDrag && !wasDrag.moved && e.type === 'pointerup') {
        const r = c.getBoundingClientRect();
        const p = this.pickAt(e.clientX - r.left, e.clientY - r.top, e.pointerType === 'touch' ? 28 : 18);
        if (p && samePick(p, this.selected) && p.type === 'landmark') this.requestTravel(p.l);
        else this.select(p);
      }
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('dblclick', (e) => {
      const r = c.getBoundingClientRect();
      const p = this.pickAt(e.clientX - r.left, e.clientY - r.top);
      if (p?.type === 'landmark') this.requestTravel(p.l);
    });
  }

  protected override key(e: KeyboardEvent): boolean {
    if (document.activeElement !== this.canvas) {
      if (e.key === '+' || e.key === '=' || e.key === '-' || e.key === 'c' || e.key === 'C') return this.mapKey(e);
      return false;
    }
    return this.mapKey(e);
  }

  private mapKey(e: KeyboardEvent): boolean {
    const step = 60;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const pan: Record<string, [number, number]> = { ArrowUp: [0, -step], w: [0, -step], ArrowDown: [0, step], s: [0, step], ArrowLeft: [-step, 0], a: [-step, 0], ArrowRight: [step, 0], d: [step, 0] };
    if (pan[k]) {
      e.preventDefault();
      this.cursorMode = true;
      this.pan(pan[k][0], pan[k][1]);
      return true;
    }
    if (k === '+' || k === '=' || k === 'PageUp') {
      this.zoomBy(1.3);
      if (this.cursorMode) this.pickAtCenter();
      return true;
    }
    if (k === '-' || k === 'PageDown') {
      this.zoomBy(1 / 1.3);
      if (this.cursorMode) this.pickAtCenter();
      return true;
    }
    if (k === 'c') {
      this.centerOnPlayer();
      return true;
    }
    if (k === 'Enter' || k === ' ') {
      e.preventDefault();
      if (this.selected?.type === 'landmark') this.requestTravel(this.selected.l);
      else {
        this.cursorMode = true;
        this.pickAtCenter();
      }
      return true;
    }
    return false;
  }

  protected override padInput(p: PadFrame, dt: number): boolean {
    const ax = p.axes[0] ?? 0, ay = p.axes[1] ?? 0;
    const inSide = this.side.contains(document.activeElement);
    if (!inSide && Math.hypot(ax, ay) > 0.18) {
      this.cursorMode = true;
      this.pan(ax * dt * 700, ay * dt * 700);
    }
    const lt = p.held(6), rt = p.held(7);
    const ry = p.axes[3] ?? 0;
    if (lt || rt || Math.abs(ry) > 0.3) {
      this.zoomBy(Math.pow(1.9, dt * ((rt ? 1 : 0) - (lt ? 1 : 0) - (Math.abs(ry) > 0.3 ? ry : 0))));
      if (this.cursorMode) this.pickAtCenter();
    }
    if (p.edge(3)) this.centerOnPlayer();
    if (p.edge(0) && !inSide) {
      if (this.selected?.type === 'landmark') this.requestTravel(this.selected.l);
      else this.pickAtCenter();
      return true;
    }
    if (p.edge(1)) {
      this.back();
      return true;
    }
    if (p.dir === 'right' && !inSide && p.held(15)) {
      const b = this.side.querySelector('button') as HTMLElement | null;
      b?.focus();
      return true;
    }
    return !inSide;
  }

  // ---------------------------------------------------------------------------
  // Travel
  // ---------------------------------------------------------------------------

  /** Why fast travel to `l` is refused right now, or null when allowed. */
  travelBlock(l: LandmarkDef): string | null {
    const ctx = this.ctx;
    if (!l.fastTravel) return 'There is no travel point here.';
    if (!ctx.world.discovered.has(l.id)) return 'Discover this place on foot before travelling here.';
    const p = ctx.player;
    if (!p) return 'No traveller.';
    if (p.defeated) return 'You cannot travel while defeated.';
    if (ctx.entities.queryRadius(p.position, 35, { teams: ['hostile'], aliveOnly: true }).length > 0) return 'You cannot fast travel while enemies are near.';
    return null;
  }

  requestTravel(l: LandmarkDef): void {
    const block = this.travelBlock(l);
    if (block) {
      this.ctx.events.emit('ui:notify', { text: block, kind: 'warning' });
      this.select({ type: 'landmark', l });
      return;
    }
    this.ui.confirm(`Fast travel to ${l.name}?`, [
      { text: 'Travel', primary: true, onClick: () => void this.travel(l) },
      { text: 'Cancel' },
    ]);
    requestAnimationFrame(() => (document.querySelector('.confirm .btn.primary') as HTMLElement | null)?.focus());
  }

  /** Streams the destination in behind the loading screen before placing the player, so regions exist when they land. */
  async travel(target: LandmarkDef): Promise<boolean> {
    const ctx = this.ctx;
    if (this.travelBlock(target)) return false;
    this.ui.closeAll();
    if (ctx.game.paused) ctx.game.setPaused(false);
    if (ctx.companions.mounted) ctx.companions.dismount();
    const x = target.x + 6, z = target.z + 6;
    this.ui.showLoading(target.name);
    try {
      await ctx.world.preload(new THREE.Vector3(x, heightAt(x, z), z), (f, label) => this.ui.setLoadingProgress(f, label));
    } finally {
      this.ui.hideLoading();
    }
    ctx.player?.teleport(new THREE.Vector3(x, ctx.world.groundAt(x, z).y + 0.1, z));
    ctx.events.emit('ui:notify', { text: `Arrived at ${target.name}`, kind: 'discovery' });
    return true;
  }

  // ---------------------------------------------------------------------------
  // Side panel
  // ---------------------------------------------------------------------------

  private legend(): HTMLElement {
    const row = (kind: Parameters<typeof glyph>[1], label: string, fill = '#efe0bd') => {
      const c = document.createElement('canvas');
      c.width = c.height = 44;
      const g = c.getContext('2d')!;
      g.scale(2, 2);
      glyph(g, kind, 11, 11, 8, fill);
      return h('div.mp-leg', c, h('span', label));
    };
    const you = document.createElement('canvas');
    you.width = you.height = 44;
    const yg = you.getContext('2d')!;
    yg.scale(2, 2);
    drawArrow(yg, 11, 12, 0, 1);
    return h(
      'details.mp-legend',
      { open: window.innerWidth > 760 },
      h('summary', 'Legend'),
      h(
        'div.mp-leg-grid',
        h('div.mp-leg', you, h('span', 'You')),
        row('capital', 'Capital / temple'),
        row('city', 'City / village'),
        row('shrine', 'Shrine / training'),
        row('dock', 'Harbour'),
        row('ruin', 'Ruins / cave'),
        row('paw', 'Companion habitat', '#cfe3b8'),
        row('quest', 'Tracked quest', '#ffcc33'),
        row('quest', 'Quest objective', '#e8e2d0'),
        row('star', 'Master', '#9fd8ff'),
      ),
      h('div.mp-leg-note', h('span.mp-ft', '⟡'), ' gold ring: fast travel point'),
      h('div.mp-leg-note', h('span.mp-danger', '●●●'), ' region danger (1–5)'),
    );
  }

  private renderInfo(): void {
    clear(this.info);
    const ctx = this.ctx;
    const sel = this.selected;
    const p = ctx.player;
    const dist = (x: number, z: number) => (p ? `${Math.round(Math.hypot(x - p.position.x, z - p.position.z))} m away` : '');
    if (!sel) {
      const reg = p ? ctx.world.regionAt(p.position.x, p.position.z) : null;
      this.info.append(
        h('div.gs-kicker', 'You are in'),
        h('h3.gs-h', reg?.name ?? 'The Wilds'),
        reg ? dangerRow(REGION_DANGER[reg.id] ?? DEFAULT_DANGER) : dangerRow(DEFAULT_DANGER),
        h('p.muted', reg?.blurb ?? 'Untamed country between the nations.'),
        h('p.mp-tip', 'Select a place to see details. Discovered travel points (gold ring) can be travelled to — never while enemies are near.'),
      );
      return;
    }
    if (sel.type === 'landmark') {
      const l = sel.l;
      const disc = ctx.world.discovered.has(l.id);
      const reg = REGIONS.find((r) => r.id === l.regionId);
      const block = this.travelBlock(l);
      this.info.append(h(
        'div.mp-sel',
        h('div.gs-kicker', `${KIND_LABEL[l.kind]}${reg ? ` · ${reg.name}` : ''}`),
        h('h3.gs-h', l.name),
        dangerRow(REGION_DANGER[l.regionId] ?? DEFAULT_DANGER),
        h('p', l.blurb ?? reg?.blurb ?? ''),
        h('div.mp-status', disc ? '✓ Discovered' : '◇ Not yet discovered', ' · ', dist(l.x, l.z)),
        l.fastTravel
          ? h('button.btn.primary.mp-travel', { type: 'button', 'data-action': 'travel', 'data-landmark': l.id, disabled: !!block && !disc ? true : undefined, onclick: () => this.requestTravel(l) }, '⟡ Fast Travel')
          : h('p.muted', 'No travel point here.'),
        l.fastTravel && block ? h('p.mp-block', block) : null,
      ));
    } else if (sel.type === 'marker') {
      const m = sel.m;
      const master = m.questId.startsWith('master:');
      this.info.append(h(
        'div.mp-sel',
        h('div.gs-kicker', master ? 'Master' : m.tracked ? 'Tracked quest' : 'Quest'),
        h('h3.gs-h', m.title),
        h('p', m.text),
        h('div.mp-status', dist(m.position.x, m.position.z)),
        !master && ctx.quests.active.has(m.questId) ? h(`button.btn${m.tracked ? '' : '.primary'}`, { type: 'button', 'data-action': 'track', onclick: () => (ctx.quests.track(m.tracked ? null : m.questId), this.select(null)) }, m.tracked ? 'Stop Tracking' : 'Track Quest') : null,
      ));
    } else {
      const s = speciesById(sel.species);
      this.info.append(h('div.gs-kicker', 'Companion habitat'), h('h3.gs-h', sel.name), h('p', s ? `${s.name}. ${s.habitatText}` : ''), h('div.mp-status', dist(sel.x, sel.z)));
    }
  }

  // ---------------------------------------------------------------------------
  // Drawing
  // ---------------------------------------------------------------------------

  override update(dt: number): void {
    super.update(dt);
    if (!this.el.isConnected) return;
    this.pulse += dt;
    // Redraw on change, plus a gentle 4 Hz tick for the pulsing markers.
    if (this.dirty || this.pulse > 0.25) {
      this.pulse = 0;
      this.dirty = false;
      this.draw();
    }
  }

  private fogLayer(): HTMLCanvasElement {
    const w = this.ctx.world;
    const sig = REGIONS.filter((r) => r.known || w.visitedRegions.has(r.id)).map((r) => r.id).join(',') + '|' + w.discovered.size;
    if (this.fog && sig === this.fogSig) return this.fog;
    this.fogSig = sig;
    const S = 256;
    const c = this.fog ?? document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d')!;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, S, S);
    g.fillStyle = 'rgba(226, 212, 176, 0.86)';
    g.fillRect(0, 0, S, S);
    // Cloud mottling
    for (let i = 0; i < 160; i++) {
      const x = (Math.sin(i * 12.9898) * 43758.5453) % 1, y = (Math.sin(i * 78.233) * 12345.6789) % 1;
      g.fillStyle = `rgba(${i % 2 ? 245 : 205}, ${i % 2 ? 236 : 192}, ${i % 2 ? 214 : 160}, 0.18)`;
      g.beginPath();
      g.arc(Math.abs(x) * S, Math.abs(y) * S, 6 + (i % 7) * 3, 0, Math.PI * 2);
      g.fill();
    }
    g.globalCompositeOperation = 'destination-out';
    const k = S / (WORLD_HALF * 2);
    const hole = (x: number, z: number, r: number) => {
      const px = (x + WORLD_HALF) * k, py = (z + WORLD_HALF) * k, pr = r * k;
      const grad = g.createRadialGradient(px, py, pr * 0.55, px, py, pr);
      grad.addColorStop(0, 'rgba(0,0,0,1)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(px, py, pr, 0, Math.PI * 2);
      g.fill();
    };
    for (const r of REGIONS) if (r.known || w.visitedRegions.has(r.id)) hole(r.x, r.z, r.r * 1.25);
    for (const l of LANDMARKS) if (w.discovered.has(l.id)) hole(l.x, l.z, 260);
    g.globalCompositeOperation = 'source-over';
    this.fog = c;
    return c;
  }

  private draw(): void {
    const c = this.canvas;
    const v = this.view();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (c.width !== Math.round(v.w * dpr) || c.height !== Math.round(v.h * dpr)) {
      c.width = Math.round(v.w * dpr);
      c.height = Math.round(v.h * dpr);
    }
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#b9cbc4';
    g.fillRect(0, 0, v.w, v.h);
    const ctx = this.ctx;
    const o = this.toScreen(-WORLD_HALF, -WORLD_HALF, v);
    const size = WORLD_HALF * 2 * v.scale;
    if (raster) {
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'medium';
      g.drawImage(raster, o.x, o.y, size, size);
    } else {
      g.fillStyle = '#e8dcbc';
      g.fillRect(o.x, o.y, size, size);
      g.fillStyle = INK;
      g.font = '600 16px Cinzel, serif';
      g.textAlign = 'center';
      g.fillText('Charting the world…', v.w / 2, v.h / 2);
    }
    const line = (pts: Array<{ x: number; z: number }>) => {
      g.beginPath();
      pts.forEach((pt, i) => {
        const s = this.toScreen(pt.x, pt.z, v);
        if (i === 0) g.moveTo(s.x, s.y);
        else g.lineTo(s.x, s.y);
      });
      g.stroke();
    };
    // Rivers (crisp over the raster)
    g.strokeStyle = 'rgba(70,118,150,0.85)';
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const r of RIVERS) {
      g.lineWidth = Math.max(1.2, ((r.width[0] + r.width[1]) / 2) * v.scale * 0.8);
      line(r.points);
    }
    // Roads: dashed ink
    g.strokeStyle = 'rgba(110,72,40,0.75)';
    g.lineWidth = Math.max(1.2, 1.1 + this.zoom * 0.2);
    g.setLineDash([5, 4]);
    for (const r of ROADS) line(r.points);
    g.setLineDash([]);
    // Mountain glyphs along the ranges
    g.strokeStyle = 'rgba(74,54,34,0.55)';
    g.lineWidth = 1.2;
    for (const r of MOUNTAIN_RANGES) {
      for (let i = 0; i < r.points.length - 1; i++) {
        const a = r.points[i], b = r.points[i + 1];
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        const n = Math.max(1, Math.floor(len / 90));
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n;
          const s = this.toScreen(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, v);
          const m = Math.max(4, Math.min(12, 3 + this.zoom * 1.6)) * (k % 2 ? 0.8 : 1);
          g.beginPath();
          g.moveTo(s.x - m, s.y + m * 0.45);
          g.lineTo(s.x, s.y - m * 0.75);
          g.lineTo(s.x + m, s.y + m * 0.45);
          g.stroke();
        }
      }
    }
    // Fog of the unexplored
    g.drawImage(this.fogLayer(), o.x, o.y, size, size);
    // Region names + danger
    for (const r of REGIONS) {
      const shown = r.known || ctx.world.visitedRegions.has(r.id);
      const s = this.toScreen(r.x, r.z, v);
      if (s.x < -200 || s.y < -60 || s.x > v.w + 200 || s.y > v.h + 60) continue;
      const fs = Math.max(11, Math.min(22, 9 + this.zoom * 2.4));
      g.font = `700 ${fs}px Cinzel, serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = shown ? 'rgba(58,40,22,0.82)' : 'rgba(90,70,45,0.45)';
      const name = shown ? r.name.toUpperCase().split('').join(' ') : '? ? ?';
      g.strokeStyle = 'rgba(240,228,198,0.7)';
      g.lineWidth = 3;
      g.strokeText(name, s.x, s.y - 26);
      g.fillText(name, s.x, s.y - 26);
      if (shown) {
        const d = REGION_DANGER[r.id] ?? DEFAULT_DANGER;
        for (let i = 0; i < 5; i++) {
          g.beginPath();
          g.arc(s.x - 16 + i * 8, s.y - 26 + fs * 0.75, 2.4, 0, Math.PI * 2);
          g.fillStyle = i < d ? 'rgba(150,40,24,0.85)' : 'rgba(90,70,45,0.25)';
          g.fill();
        }
      }
    }
    // Habitats
    for (const hb of this.habitats()) {
      const s = this.toScreen(hb.x, hb.z, v);
      glyph(g, 'paw', s.x, s.y, 7 + this.zoom * 0.6, '#cfe3b8');
    }
    // Landmarks
    const labelAll = this.zoom >= 2.6;
    for (const l of LANDMARKS) {
      const vis = this.landmarkVisible(l);
      if (!vis) continue;
      const s = this.toScreen(l.x, l.z, v);
      if (s.x < -30 || s.y < -30 || s.x > v.w + 30 || s.y > v.h + 30) continue;
      const big = l.kind === 'capital' || l.kind === 'temple';
      const sz = (big ? 9 : 7) + Math.min(5, this.zoom * 0.6);
      const ft = l.fastTravel && vis === 'full';
      if (ft) {
        g.beginPath();
        g.arc(s.x, s.y, sz + 3.5, 0, Math.PI * 2);
        g.strokeStyle = '#c8962e';
        g.lineWidth = 2.4;
        g.stroke();
      }
      glyph(g, l.kind, s.x, s.y, sz, big ? '#f3d98f' : '#efe0bd', vis === 'faded');
      const hl = samePick(this.hover, { type: 'landmark', l }) || samePick(this.selected, { type: 'landmark', l });
      if (hl) {
        g.beginPath();
        g.arc(s.x, s.y, sz + 7, 0, Math.PI * 2);
        g.strokeStyle = 'rgba(255,240,190,0.95)';
        g.lineWidth = 2;
        g.stroke();
      }
      if (vis === 'full' && (labelAll || big || hl)) {
        g.font = `600 ${big ? 13 : 12}px Alegreya, serif`;
        g.textAlign = 'center';
        g.textBaseline = 'top';
        g.lineWidth = 3;
        g.strokeStyle = 'rgba(240,228,198,0.85)';
        g.strokeText(l.name, s.x, s.y + sz + 4);
        g.fillStyle = '#2e2014';
        g.fillText(l.name, s.x, s.y + sz + 4);
      }
    }
    // Quest & master markers
    const t = performance.now() / 1000;
    const p = ctx.player;
    let tracked: QuestMarker | null = null;
    for (const m of ctx.quests.markers()) {
      const s = this.toScreen(m.position.x, m.position.z, v);
      if (m.questId.startsWith('master:')) {
        glyph(g, 'star', s.x, s.y, 7 + this.zoom * 0.5, m.color ?? '#ffffff');
        continue;
      }
      if (m.tracked) {
        tracked = m;
        const pr = 10 + (Math.sin(t * 4) * 0.5 + 0.5) * 6;
        g.beginPath();
        g.arc(s.x, s.y, pr, 0, Math.PI * 2);
        g.strokeStyle = 'rgba(255,204,51,0.6)';
        g.lineWidth = 2;
        g.stroke();
      }
      glyph(g, 'quest', s.x, s.y, m.tracked ? 9 : 6.5, m.color ?? (m.tracked ? '#ffcc33' : '#e8e2d0'));
    }
    if (p) {
      const s = this.toScreen(p.position.x, p.position.z, v);
      if (tracked) {
        const e = this.toScreen(tracked.position.x, tracked.position.z, v);
        g.setLineDash([3, 5]);
        g.strokeStyle = 'rgba(255,204,51,0.75)';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(s.x, s.y);
        g.lineTo(e.x, e.y);
        g.stroke();
        g.setLineDash([]);
      }
      drawArrow(g, s.x, s.y, p.yaw, 1 + Math.min(0.6, this.zoom * 0.05), t);
    }
    // Readout
    const cw = this.cursorMode ? { x: this.cx, z: this.cz } : null;
    const reg = cw ? ctx.world.regionAt(cw.x, cw.z) : p ? ctx.world.regionAt(p.position.x, p.position.z) : null;
    const text = `${reg?.name ?? 'The Wilds'} · ×${this.zoom.toFixed(1)}${rasterSize && rasterSize < FULL ? ' · refining…' : ''}`;
    if (this.readout.textContent !== text) this.readout.textContent = text;
    this.stage.classList.toggle('cursor', this.cursorMode);
  }
}

function drawArrow(g: CanvasRenderingContext2D, x: number, y: number, yaw: number, k = 1, t = 0): void {
  g.save();
  g.translate(x, y);
  if (t) {
    g.beginPath();
    g.arc(0, 0, 11 * k + (Math.sin(t * 3) * 0.5 + 0.5) * 4, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255,90,58,0.18)';
    g.fill();
  }
  // yaw 0 faces +Z (south, down on the map); rotate so the tip points along the facing.
  g.rotate(Math.PI - yaw);
  g.beginPath();
  g.moveTo(0, -11 * k);
  g.lineTo(7 * k, 8 * k);
  g.lineTo(0, 4 * k);
  g.lineTo(-7 * k, 8 * k);
  g.closePath();
  g.fillStyle = '#e8492c';
  g.strokeStyle = '#fff6e0';
  g.lineWidth = 2;
  g.stroke();
  g.fill();
  g.restore();
}

function dangerRow(d: number): HTMLElement {
  const label = ['Sanctuary', 'Peaceful', 'Watchful', 'Dangerous', 'Perilous', 'Deadly'][Math.max(0, Math.min(5, d))];
  return h('div.mp-danger-row', { title: `Danger ${d} of 5` }, h('span.mp-danger', '●'.repeat(d) + '○'.repeat(Math.max(0, 5 - d))), h('span', label));
}

function samePick(a: Pick | null, b: Pick | null): boolean {
  if (!a || !b) return a === b;
  if (a.type !== b.type) return false;
  if (a.type === 'landmark' && b.type === 'landmark') return a.l.id === b.l.id;
  if (a.type === 'marker' && b.type === 'marker') return a.m.questId === b.m.questId && a.m.text === b.m.text;
  if (a.type === 'habitat' && b.type === 'habitat') return a.id === b.id;
  return false;
}

