import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { KitMaterialName } from '../world/kit/Materials';

/**
 * Shared props for travel: procedural ships (Water Tribe trader, Fire Nation merchant, Earth Kingdom
 * ferry / junk, Kyoshi fishing boat) and painted signboards. Geometry only: callers either merge the
 * parts into a ContentBuilder (static, moored) or wrap them in meshes they own (moving ships).
 */

export type ShipStyle = 'water' | 'fire' | 'earth' | 'fishing';

export interface ShipPart {
  mat: KitMaterialName;
  geo: THREE.BufferGeometry;
}

/**
 * A hull: half-width tapers to a sharp bow (+Z) and a blunter stern, the sheer rises at both ends,
 * the keel is deepest amidships. Origin at the waterline amidships; y up; +Z forward.
 */
export function hullGeometry(L: number, B: number, D: number, freeboard: number, bowRise = 0.9): THREE.BufferGeometry {
  const NZ = 22, NU = 9;
  const pos: number[] = [], idx: number[] = [];
  for (let i = 0; i <= NZ; i++) {
    const v = i / NZ; // 0 stern .. 1 bow
    const z = -L / 2 + v * L;
    const bow = Math.max(0, (v - 0.55) / 0.45), stern = Math.max(0, (0.18 - v) / 0.18);
    const half = (B / 2) * Math.max(0.04, (1 - Math.pow(bow, 1.6)) * (1 - 0.45 * Math.pow(stern, 2)));
    const top = freeboard + bowRise * (Math.pow(bow, 2) * 1.0 + Math.pow(stern, 2) * 0.6);
    const keel = -D * (1 - 0.7 * Math.pow(bow, 2) - 0.5 * Math.pow(stern, 2));
    for (let j = 0; j <= NU; j++) {
      const a = (j / NU) * Math.PI; // 0 = port deck edge .. π = starboard deck edge
      const s = Math.sin(a), c = Math.cos(a);
      const x = c * half * (0.55 + 0.45 * Math.pow(s, 0.35));
      const y = top - (top - keel) * Math.pow(s, 0.7);
      pos.push(x, y, z);
    }
  }
  const row = NU + 1;
  for (let i = 0; i < NZ; i++) {
    for (let j = 0; j < NU; j++) {
      const a = i * row + j, b = a + 1, c = a + row, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  // Transom (flat stern) cap.
  const base = pos.length / 3;
  pos.push(0, freeboard * 0.6, -L / 2);
  for (let j = 0; j < NU; j++) idx.push(base, j + 1, j);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function box(sx: number, sy: number, sz: number, x: number, y: number, z: number, rx = 0, ry = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return g;
}

function cyl(r0: number, r1: number, h: number, x: number, y: number, z: number, seg = 8): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r0, r1, h, seg);
  g.translate(x, y + h / 2, z);
  return g;
}

/** A sail: a softly bellied panel (battened junk sail when `battens`), facing +Z. */
function sail(w: number, h: number, x: number, y0: number, z: number, belly: number, battens = 0): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h, 6, Math.max(4, battens * 2));
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) / w, v = (p.getY(i) + h / 2) / h;
    let d = belly * Math.cos(u * Math.PI) * Math.sin(v * Math.PI * 0.9 + 0.1);
    if (battens) d *= 0.65 + 0.35 * Math.abs(Math.sin(v * battens * Math.PI));
    p.setZ(i, d);
  }
  g.computeVertexNormals();
  g.translate(x, y0 + h / 2, z);
  return g;
}

function merged(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const parts = list.map((g) => (g.index ? g.toNonIndexed() : g));
  for (const g of parts) {
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((g.getAttribute('position').count) * 2), 2));
  }
  const m = mergeGeometries(parts, false)!;
  for (const g of list) g.dispose();
  for (const g of parts) if (!list.includes(g)) g.dispose();
  return m;
}

/** Ship parts in local space (waterline at y = 0, bow toward +Z). Lengths ~ 9 m (fishing) to 24 m (merchant). */
export function shipParts(style: ShipStyle): { parts: ShipPart[]; length: number; beam: number } {
  const L = style === 'fire' ? 24 : style === 'earth' ? 20 : style === 'water' ? 15 : 9;
  const B = style === 'fire' ? 6.4 : style === 'earth' ? 6 : style === 'water' ? 4.4 : 2.6;
  const D = style === 'fishing' ? 0.9 : 1.8;
  const fb = style === 'fishing' ? 0.7 : 1.4;
  const hullMat: KitMaterialName = style === 'fire' ? 'wood_dark' : style === 'water' ? 'wood' : 'wood_dark';
  const parts: ShipPart[] = [{ mat: hullMat, geo: hullGeometry(L, B, D, fb, style === 'earth' ? 1.6 : 0.9) }];
  const deckY = fb - 0.12;
  const deck = box(B * 0.78, 0.14, L * 0.82, 0, deckY, -L * 0.02);
  const trim: THREE.BufferGeometry[] = [];
  const wood: THREE.BufferGeometry[] = [deck];
  const sails: THREE.BufferGeometry[] = [];
  if (style === 'fishing') {
    wood.push(cyl(0.08, 0.1, 5.2, 0, deckY, L * 0.1));
    wood.push(box(1.6, 0.9, 1.8, 0, deckY + 0.45, -L * 0.28)); // little cabin
    sails.push(sail(2.4, 3.4, 0, deckY + 1.4, L * 0.1 + 0.15, 0.25, 4));
    return { parts: [...parts, { mat: 'wood', geo: merged(wood) }, { mat: 'cloth_white', geo: merged(sails) }], length: L, beam: B };
  }
  // Bulwark rails and a raised stern deck.
  for (const sx of [-1, 1]) trim.push(box(0.14, 0.5, L * 0.7, sx * B * 0.37, deckY + 0.3, 0));
  wood.push(box(B * 0.72, 1.3, L * 0.22, 0, deckY + 0.65, -L * 0.36)); // stern castle
  wood.push(box(B * 0.5, 0.9, L * 0.12, 0, deckY + 0.45, L * 0.3)); // forecastle box
  const masts = style === 'fire' ? [L * 0.22, -L * 0.1] : style === 'earth' ? [L * 0.18, -L * 0.12] : [L * 0.08];
  const mastH = style === 'fire' ? 14 : style === 'earth' ? 12 : 10;
  for (const mz of masts) {
    wood.push(cyl(0.14, 0.22, mastH, 0, deckY, mz));
    wood.push(box(0.12, 0.12, 0.12, 0, deckY + mastH, mz));
    if (style === 'earth') {
      sails.push(sail(B * 1.15, mastH * 0.7, 0, deckY + mastH * 0.22, mz + 0.25, 0.35, 6));
    } else {
      const yard = new THREE.CylinderGeometry(0.07, 0.07, B * 1.3, 6);
      yard.rotateZ(Math.PI / 2);
      yard.translate(0, deckY + mastH * 0.92, mz + 0.2);
      wood.push(yard);
      sails.push(sail(B * 1.2, mastH * 0.62, 0, deckY + mastH * 0.28, mz + 0.35, 0.55));
    }
  }
  const sailMat: KitMaterialName = style === 'fire' ? 'cloth_red' : style === 'water' ? 'cloth_blue' : 'cloth_yellow';
  const trimMat: KitMaterialName = style === 'fire' ? 'wood_red' : style === 'water' ? 'cloth_white' : 'roof_green';
  parts.push({ mat: 'wood', geo: merged(wood) }, { mat: trimMat, geo: merged(trim) }, { mat: sailMat, geo: merged(sails) });
  return { parts, length: L, beam: B };
}

/**
 * A painted signboard texture: an emblem (Kyoshi fan, wave, flame, earth or air) above short
 * English lines. Callers own (dispose) the texture.
 */
export function signTexture(lines: string[], o: { bg: string; fg: string; emblem: 'fan' | 'water' | 'fire' | 'earth' | 'air'; accent?: string }): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 320;
  const g = c.getContext('2d')!;
  g.fillStyle = o.bg;
  g.fillRect(0, 0, 256, 320);
  g.strokeStyle = o.accent ?? o.fg;
  g.lineWidth = 10;
  g.strokeRect(8, 8, 240, 304);
  g.fillStyle = o.accent ?? o.fg;
  g.strokeStyle = o.accent ?? o.fg;
  g.lineWidth = 6;
  const cx = 128, cy = 92;
  switch (o.emblem) {
    case 'fan':
      g.beginPath();
      g.moveTo(cx, cy + 40);
      g.arc(cx, cy + 40, 66, Math.PI * 1.15, Math.PI * 1.85);
      g.closePath();
      g.fill();
      g.fillStyle = o.bg;
      for (let k = 0; k < 6; k++) {
        const a = Math.PI * (1.18 + k * 0.124);
        g.fillRect(cx + Math.cos(a) * 30 - 1.5, cy + 40 + Math.sin(a) * 30 - 1.5, 3, 3);
      }
      break;
    case 'water':
      g.beginPath();
      g.arc(cx, cy, 48, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.arc(cx + 10, cy - 6, 30, Math.PI * 0.6, Math.PI * 1.6);
      g.stroke();
      g.beginPath();
      g.arc(cx - 10, cy + 6, 30, Math.PI * 1.6, Math.PI * 2.6);
      g.stroke();
      break;
    case 'fire':
      g.beginPath();
      g.moveTo(cx, cy - 56);
      g.quadraticCurveTo(cx + 46, cy - 6, cx + 26, cy + 42);
      g.quadraticCurveTo(cx + 8, cy + 14, cx, cy + 50);
      g.quadraticCurveTo(cx - 8, cy + 14, cx - 26, cy + 42);
      g.quadraticCurveTo(cx - 46, cy - 6, cx, cy - 56);
      g.fill();
      break;
    case 'earth':
      g.beginPath();
      g.arc(cx, cy, 50, 0, Math.PI * 2);
      g.stroke();
      g.strokeRect(cx - 26, cy - 26, 52, 52);
      g.beginPath();
      g.moveTo(cx - 26, cy);
      g.lineTo(cx + 26, cy);
      g.stroke();
      break;
    case 'air':
      g.beginPath();
      for (let a = 0; a < Math.PI * 3.2; a += 0.05) {
        const r = 6 + a * 7;
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        if (a === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
      break;
  }
  g.fillStyle = o.fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  lines.forEach((t, i) => {
    g.font = i === 0 ? 'bold 34px Georgia, serif' : '24px Georgia, serif';
    g.fillText(t, 128, 196 + i * 40, 230);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
