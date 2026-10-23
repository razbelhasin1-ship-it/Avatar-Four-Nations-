import * as THREE from 'three';
import { RefCache } from './CharacterBuild';
import { blankAtlas } from './CharMaterial';
import { ATLAS_RECT, type AtlasRegion, type AtlasSpec } from './buildUtil';

/**
 * Cloth pattern-mask atlas. Patterns (waves, flames, swirls, stripes, trims) are
 * painted into a canvas as colour *weights*, not colours:
 *   black = primary, red = trim, green = accent, blue = secondary.
 * CharMaterial mixes the character's four cloth colours with these weights, so
 * one texture serves every colour scheme and recolouring never repaints.
 * Textures are cached per garment combination and shared between characters.
 */

const P = '#000000';
const T = '#ff0000';
const A = '#00ff00';
const S = '#0000ff';

const SIZE = 512;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function rectOf(r: AtlasRegion): Rect {
  const q = ATLAS_RECT[r];
  return { x: q[0] * SIZE, y: q[1] * SIZE, w: q[2] * SIZE, h: q[3] * SIZE };
}

type G = CanvasRenderingContext2D;

/** Draw a repeating motif band. `y` = band bottom (px), height px; motif count tiles the width exactly. */
function motifBand(g: G, r: Rect, kind: string, yBottom: number, height: number, spacingPx: number, color: string): void {
  const n = Math.max(1, Math.round(r.w / spacingPx));
  const sp = r.w / n;
  g.save();
  g.beginPath();
  g.rect(r.x, r.y, r.w, r.h);
  g.clip();
  g.fillStyle = color;
  g.strokeStyle = color;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (let k = -1; k <= n; k++) {
    const cx = r.x + (k + 0.5) * sp;
    const yB = yBottom;
    const yT = yBottom - height;
    switch (kind) {
      case 'waves': {
        g.lineWidth = Math.max(2, height * 0.16);
        g.beginPath();
        g.moveTo(cx - sp * 0.5, yB - height * 0.12);
        g.bezierCurveTo(cx - sp * 0.28, yB - height * 0.1, cx - sp * 0.22, yT + height * 0.05, cx + sp * 0.06, yT + height * 0.08);
        const rr = height * 0.26;
        g.arc(cx + sp * 0.06, yT + height * 0.08 + rr, rr, -Math.PI / 2, Math.PI * 0.75, false);
        g.stroke();
        g.fillRect(cx - sp * 0.5, yB - height * 0.14, sp + 1, height * 0.1);
        break;
      }
      case 'flames': {
        const tall = (k + 100) % 2 === 0 ? 1 : 0.65;
        const h = height * tall;
        const w = sp * 0.34;
        g.beginPath();
        g.moveTo(cx - w, yB);
        g.bezierCurveTo(cx - w * 1.15, yB - h * 0.5, cx + w * 0.25, yB - h * 0.55, cx - w * 0.05, yB - h);
        g.bezierCurveTo(cx + w * 0.95, yB - h * 0.6, cx + w * 1.15, yB - h * 0.3, cx + w, yB);
        g.closePath();
        g.fill();
        break;
      }
      case 'swirls': {
        g.lineWidth = Math.max(1.5, height * 0.12);
        g.beginPath();
        const cy = yB - height * 0.55;
        const R = Math.min(height * 0.42, sp * 0.3);
        for (let t = 0; t <= 1.0001; t += 0.04) {
          const ang = -Math.PI / 2 + t * Math.PI * 3.2;
          const rad = R * (1 - t * 0.75);
          const px = cx + Math.cos(ang) * rad;
          const py = cy + Math.sin(ang) * rad;
          if (t === 0) g.moveTo(cx - sp * 0.5, cy - R);
          g.lineTo(px, py);
        }
        g.stroke();
        g.fillRect(cx - sp * 0.5, yB - height * 0.06, sp + 1, height * 0.06);
        break;
      }
      case 'diamonds': {
        g.beginPath();
        g.moveTo(cx, yT);
        g.lineTo(cx + sp * 0.3, yT + height / 2);
        g.lineTo(cx, yB);
        g.lineTo(cx - sp * 0.3, yT + height / 2);
        g.closePath();
        g.fill();
        break;
      }
    }
  }
  g.restore();
}

function hband(g: G, r: Rect, v0: number, v1: number, color: string): void {
  g.fillStyle = color;
  g.fillRect(r.x, r.y + v0, r.w, Math.max(1, v1 - v0));
}

function paintTop(g: G, spec: NonNullable<AtlasSpec['top']>): void {
  const r = rectOf('top');
  const pu = r.w / spec.circM;
  const pv = r.h / Math.max(0.2, spec.lengthM);
  g.fillStyle = P;
  g.fillRect(r.x, r.y, r.w, r.h);
  // Stripes first (under the hem band).
  if (spec.pattern === 'stripes') {
    const step = 0.11 * pu;
    const n = Math.max(2, Math.round(r.w / step));
    g.fillStyle = T;
    for (let k = 0; k < n; k++) g.fillRect(r.x + (k + 0.5) * (r.w / n) - 0.009 * pu, r.y, 0.018 * pu, r.h);
  }
  // Collar trim follows the neckline (top row).
  hband(g, r, 0, Math.max(3, 0.018 * pv), T);
  if (spec.collar === 'wrap') {
    // Overlapping front panel edge.
    g.strokeStyle = T;
    g.lineWidth = 0.032 * pu;
    g.lineCap = 'butt';
    g.beginPath();
    g.moveTo(r.x + (0.5 + 0.03) * r.w, r.y);
    g.lineTo(r.x + (0.5 - 0.13) * r.w, r.y + Math.min(1, spec.waistV) * r.h);
    g.lineTo(r.x + (0.5 - 0.15) * r.w, r.y + r.h);
    g.stroke();
  }
  if (spec.open) {
    g.fillStyle = T;
    g.fillRect(r.x + 0.5 * r.w - 0.011 * pu, r.y, 0.022 * pu, r.h);
  }
  // Hem.
  const hem = Math.max(4, 0.032 * pv);
  hband(g, r, r.h - hem, r.h, T);
  const bandBottom = r.y + r.h - hem - 0.012 * pv;
  switch (spec.pattern) {
    case 'waves':
      motifBand(g, r, 'waves', bandBottom, 0.07 * pv, 0.1 * pu, A);
      break;
    case 'flames':
      motifBand(g, r, 'flames', r.y + r.h - hem, 0.11 * pv, 0.075 * pu, A);
      break;
    case 'swirls':
      motifBand(g, r, 'swirls', bandBottom, 0.065 * pv, 0.09 * pu, A);
      hband(g, r, r.h - hem - 0.09 * pv, r.h - hem - 0.082 * pv, A);
      break;
    case 'trim':
      hband(g, r, r.h - hem - 0.03 * pv, r.h - hem - 0.018 * pv, A);
      break;
    case 'stripes':
      break;
    default:
      break;
  }
  if (spec.fur) hband(g, r, r.h - hem * 0.5, r.h, T);
}

function paintSleeve(g: G, spec: NonNullable<AtlasSpec['sleeve']>): void {
  const r = rectOf('sleeve');
  const pv = r.h / spec.lengthM;
  const pu = r.w / spec.circM;
  g.fillStyle = P;
  g.fillRect(r.x, r.y, r.w, r.h);
  const cuff = Math.max(3, 0.03 * pv);
  hband(g, r, r.h - cuff, r.h, T);
  if (spec.wide) {
    const kind = spec.pattern === 'flames' ? 'flames' : spec.pattern === 'waves' ? 'waves' : spec.pattern === 'none' || spec.pattern === 'trim' || spec.pattern === 'stripes' ? '' : 'swirls';
    if (kind) motifBand(g, r, kind, r.y + r.h - cuff - (kind === 'flames' ? 0 : 0.01 * pv), 0.06 * pv, 0.08 * pu, A);
    else hband(g, r, r.h - cuff - 0.02 * pv, r.h - cuff - 0.012 * pv, A);
  }
}

function paintLayer(g: G, spec: NonNullable<AtlasSpec['layer']>): void {
  const r = rectOf('layer');
  const pv = r.h / spec.lengthM;
  const pu = r.w / spec.circM;
  g.fillStyle = S;
  g.fillRect(r.x, r.y, r.w, r.h);
  hband(g, r, 0, Math.max(2, 0.015 * pv), T);
  const hem = Math.max(3, 0.03 * pv);
  hband(g, r, r.h - hem, r.h, T);
  if (spec.pattern === 'flames') motifBand(g, r, 'flames', r.y + r.h - hem, 0.08 * pv, 0.07 * pu, A);
  else if (spec.pattern === 'waves') motifBand(g, r, 'waves', r.y + r.h - hem - 2, 0.06 * pv, 0.09 * pu, A);
  else if (spec.pattern === 'swirls') motifBand(g, r, 'swirls', r.y + r.h - hem - 2, 0.055 * pv, 0.08 * pu, A);
}

function paintOuter(g: G, spec: NonNullable<AtlasSpec['outer']>): void {
  const r = rectOf('outer');
  const pu = r.w / spec.wM;
  const pv = r.h / spec.hM;
  const base = spec.style === 'mantle' ? A : S;
  g.fillStyle = base;
  g.fillRect(r.x, r.y, r.w, r.h);
  const edge = Math.max(3, 0.024 * pv);
  switch (spec.style) {
    case 'mantle':
      hband(g, r, r.h - edge, r.h, T);
      hband(g, r, 0, Math.max(2, 0.012 * pv), T);
      break;
    case 'shawl':
      hband(g, r, r.h - edge, r.h, T);
      motifBand(g, r, 'waves', r.y + r.h - edge - 3, 0.05 * pv, 0.09 * pu, A);
      break;
    case 'cape':
    case 'cloak': {
      hband(g, r, r.h - edge, r.h, T);
      g.fillStyle = T;
      g.fillRect(r.x, r.y, Math.max(3, 0.025 * pu), r.h);
      g.fillRect(r.x + r.w - Math.max(3, 0.025 * pu), r.y, Math.max(3, 0.025 * pu), r.h);
      if (spec.style === 'cape') motifBand(g, r, spec.pattern === 'swirls' ? 'swirls' : 'diamonds', r.y + r.h - edge - 4, 0.08 * pv, 0.12 * pu, A);
      break;
    }
    case 'vest': {
      hband(g, r, r.h - edge, r.h, T);
      g.fillStyle = T;
      const w = Math.max(4, 0.028 * pu);
      g.fillRect(r.x, r.y, w, r.h);
      g.fillRect(r.x + r.w - w, r.y, w, r.h);
      hband(g, r, 0, Math.max(3, 0.02 * pv), T);
      break;
    }
  }
}

/** Paint the atlas for a spec (browser only). */
export function paintAtlas(spec: AtlasSpec): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const g = c.getContext('2d');
  if (!g) return null;
  g.fillStyle = P;
  g.fillRect(0, 0, SIZE, SIZE);
  if (spec.top) paintTop(g, spec.top);
  if (spec.sleeve) paintSleeve(g, spec.sleeve);
  else {
    // Plain cuffs for sleeves without a dedicated spec.
    const r = rectOf('sleeve');
    g.fillStyle = P;
    g.fillRect(r.x, r.y, r.w, r.h);
    hband(g, r, r.h - 6, r.h, T);
  }
  if (spec.layer) paintLayer(g, spec.layer);
  if (spec.outer) paintOuter(g, spec.outer);
  return c;
}

export function atlasKey(spec: AtlasSpec): string {
  return JSON.stringify(spec);
}

export const atlasCache = new RefCache<THREE.Texture>(
  () => blankAtlas(),
  (t) => {
    if (t !== blankAtlas()) t.dispose();
  },
  24,
);

export function makeAtlasTexture(spec: AtlasSpec): THREE.Texture {
  const c = paintAtlas(spec);
  if (!c) return blankAtlas();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}
