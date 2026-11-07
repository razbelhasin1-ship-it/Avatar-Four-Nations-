import * as THREE from 'three';
import { heightAt } from '../../Heightfield';
import { A, KI, yawOutward } from '../../landforms/kyoshiIsland';
import type { BuildEnv } from '../earth/env';
import { off } from './kit';

/**
 * The Kyoshi Shrine (image 2): on its knoll along the path from the dojo — an open-sided octagonal
 * pavilion with a grey-tiled hip roof on a stone platform with steps, in a circular stone plaza;
 * bonsai-like pines and rocks around, lawn, the sea beyond. Inside, the Avatar's relics (green
 * kimono, metal fans, headdress, boots) and a large mural, "The Birth of Kyoshi", painted at sunset.
 */

export interface ShrineOut {
  marks: Record<string, { x: number; y: number; z: number }>;
  owned: Array<THREE.Material | THREE.Texture>;
  lanterns: THREE.Vector3[];
}

/** The mural: a sunset over the sea, the peninsula breaking from the mainland, Kyoshi with her fans. */
function muralTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 288;
  const g = c.getContext('2d')!;
  const sky = g.createLinearGradient(0, 0, 0, 200);
  sky.addColorStop(0, '#3b2b5c');
  sky.addColorStop(0.45, '#c8546a');
  sky.addColorStop(0.8, '#f2a24a');
  sky.addColorStop(1, '#f7d27a');
  g.fillStyle = sky;
  g.fillRect(0, 0, 512, 200);
  g.fillStyle = '#ffe9a8';
  g.beginPath();
  g.arc(300, 182, 30, 0, Math.PI * 2);
  g.fill();
  const sea = g.createLinearGradient(0, 190, 0, 288);
  sea.addColorStop(0, '#d98a4a');
  sea.addColorStop(0.25, '#3a4c74');
  sea.addColorStop(1, '#1d2a48');
  g.fillStyle = sea;
  g.fillRect(0, 190, 512, 98);
  // Mainland (left) and the island torn free (right) with the crack of churning water between.
  g.fillStyle = '#4a3a3a';
  g.beginPath();
  g.moveTo(0, 150);
  g.lineTo(80, 128);
  g.lineTo(150, 160);
  g.lineTo(196, 200);
  g.lineTo(0, 200);
  g.fill();
  g.fillStyle = '#5a6a3a';
  g.beginPath();
  g.moveTo(232, 200);
  g.lineTo(262, 150);
  g.lineTo(330, 132);
  g.lineTo(420, 156);
  g.lineTo(470, 200);
  g.fill();
  g.strokeStyle = '#f7f0d8';
  g.lineWidth = 3;
  for (let i = 0; i < 6; i++) {
    g.beginPath();
    g.moveTo(200 + i * 5, 202 + i * 10);
    g.quadraticCurveTo(214 + i * 4, 196 + i * 10, 226 + i * 3, 204 + i * 10);
    g.stroke();
  }
  // Kyoshi: a towering figure in green with fans raised.
  g.fillStyle = '#2f6a3a';
  g.beginPath();
  g.moveTo(352, 150);
  g.lineTo(334, 80);
  g.lineTo(350, 52);
  g.lineTo(370, 52);
  g.lineTo(386, 80);
  g.lineTo(370, 150);
  g.fill();
  g.fillStyle = '#f4efe2';
  g.beginPath();
  g.arc(360, 42, 11, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#d9a82a';
  g.fillRect(350, 26, 20, 8);
  for (const [x, y, a] of [[322, 36, -0.6], [398, 36, 0.6]] as const) {
    g.save();
    g.translate(x, y);
    g.rotate(a);
    g.beginPath();
    g.moveTo(0, 14);
    g.arc(0, 14, 22, Math.PI * 1.1, Math.PI * 1.9);
    g.closePath();
    g.fill();
    g.restore();
  }
  g.strokeStyle = '#2f6a3a';
  g.lineWidth = 7;
  g.beginPath();
  g.moveTo(342, 60);
  g.lineTo(326, 44);
  g.moveTo(378, 60);
  g.lineTo(394, 44);
  g.stroke();
  // Painted frame and title.
  g.strokeStyle = '#7a3a1a';
  g.lineWidth = 10;
  g.strokeRect(5, 5, 502, 278);
  g.fillStyle = '#f7ead0';
  g.font = 'italic 20px Georgia, serif';
  g.textAlign = 'center';
  g.fillText('The Birth of Kyoshi', 256, 272);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Octagonal hip roof with gently upturned eaves (eaves at y = 0). */
function octRoof(R: number, h: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.12, R, h, 8, 3, true);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) + h / 2;
    const k = Math.min(1, Math.max(0, 1 - y / h));
    // concave slope: lower part flatter (upturned eaves)
    p.setY(i, h * Math.pow(1 - k, 1.35) * 0.98 + (k > 0.92 ? (k - 0.92) * 2.2 : 0));
  }
  g.computeVertexNormals();
  return g;
}

/** A small bonsai-like pine: crooked trunk and flattened foliage pads. */
function bonsai(b: import('../../kit/Builder').ContentBuilder, mats: BuildEnv['mats'], x: number, y: number, z: number, s: number, seed: number): void {
  const trunk = new THREE.CylinderGeometry(0.12 * s, 0.2 * s, 2.2 * s, 6);
  trunk.translate(0, 1.1 * s, 0);
  trunk.rotateZ(0.25 * Math.sin(seed));
  b.mesh(mats.bark, trunk, { x, y, z, yaw: seed });
  trunk.dispose();
  const pad = new THREE.SphereGeometry(1, 8, 5);
  pad.scale(1.2 * s, 0.38 * s, 1.0 * s);
  for (let i = 0; i < 3; i++) {
    const a = seed + i * 2.1;
    b.mesh(mats.leaf, pad, { x: x + Math.cos(a) * 0.7 * s, y: y + (1.5 + i * 0.55) * s, z: z + Math.sin(a) * 0.7 * s, yaw: a });
  }
  pad.dispose();
}

export function* buildShrine(env: BuildEnv, out: ShrineOut): Generator<unknown, void, unknown> {
  const c = A(KI.shrine.u, KI.shrine.r);
  const y = heightAt(c.x, c.z);
  // The path arrives from the dojo side (inland, slightly east): the entrance faces it, the sea behind.
  const yaw = yawOutward(KI.shrine.u) - 0.35;
  const major = env.chunks.at('major', c.x, c.z).builder;
  const props = env.chunks.at('props', c.x, c.z).builder;
  // Circular stone plaza.
  const plaza = new THREE.CircleGeometry(11.5, 40);
  plaza.rotateX(-Math.PI / 2);
  major.mesh('paving', plaza, { x: c.x, y: y + 0.05, z: c.z });
  plaza.dispose();
  const kerb = new THREE.TorusGeometry(11.5, 0.22, 4, 48);
  kerb.rotateX(Math.PI / 2);
  major.mesh('stone_grey', kerb, { x: c.x, y: y + 0.05, z: c.z });
  kerb.dispose();
  // Stone platform with steps toward the path, the pavilion's eight posts, rails and roof.
  const R = 4.6, PH = 0.9;
  major.cylinder('stone_light', { x: c.x, y, z: c.z, r: R + 0.9, rTop: R + 0.8, h: PH, segments: 8 }, { collide: true, walkable: true, solid: true });
  const s0 = off(c, yaw, 0, R + 3.2), s1 = off(c, yaw, 0, R + 0.7);
  major.stairs({ from: new THREE.Vector3(s0.x, y + 0.02, s0.z), to: new THREE.Vector3(s1.x, y + PH, s1.z), width: 2.6, material: 'stone_light' });
  const py = y + PH;
  for (let i = 0; i < 8; i++) {
    const a = yaw + Math.PI / 8 + (i * Math.PI) / 4;
    const x = c.x + Math.sin(a) * R, z = c.z + Math.cos(a) * R;
    major.cylinder('wood_red', { x, y: py, z, r: 0.2, h: 3.4, segments: 10 }, { collide: true, solid: true });
    major.cylinder('stone_grey', { x, y: py, z, r: 0.3, h: 0.25, segments: 10 });
  }
  // Tie beams under the eaves and the tiled octagonal roof with a bronze finial.
  const beam = new THREE.CylinderGeometry(R + 0.25, R + 0.25, 0.32, 8, 1, true);
  major.mesh('wood_dark', beam, { x: c.x, y: py + 3.35, z: c.z, yaw: yaw + Math.PI / 8 });
  beam.dispose();
  const rf = octRoof(R + 1.9, 3.4);
  major.mesh('roof_dark', rf, { x: c.x, y: py + 3.45, z: c.z, yaw: yaw + Math.PI / 8 });
  rf.dispose();
  // Timber ceiling under the roof (seen from inside the pavilion) and the eaves' soffit.
  const ceil = new THREE.CircleGeometry(R + 0.3, 8);
  ceil.rotateX(Math.PI / 2);
  major.mesh('wood_dark', ceil, { x: c.x, y: py + 3.5, z: c.z, yaw: yaw + Math.PI / 8 });
  ceil.dispose();
  const soffit = new THREE.RingGeometry(R + 0.3, R + 1.95, 8, 1);
  soffit.rotateX(Math.PI / 2);
  major.mesh('wood', soffit, { x: c.x, y: py + 3.62, z: c.z, yaw: yaw + Math.PI / 8 });
  soffit.dispose();
  major.cylinder('bronze', { x: c.x, y: py + 6.7, z: c.z, r: 0.18, rTop: 0.05, h: 1.1, segments: 8 });
  major.cylinder('bronze', { x: c.x, y: py + 6.6, z: c.z, r: 0.32, h: 0.2, segments: 8 });
  out.marks.shrine = { x: c.x, y: py, z: c.z };
  yield;
  // Relics on a low dais: Kyoshi's green kimono on a stand, her metal fans, headdress and boots.
  const dais = off(c, yaw, 0, -1.2);
  props.cylinder('wood_dark', { x: dais.x, y: py, z: dais.z, r: 1.5, h: 0.35, segments: 8 }, { collide: true, walkable: true, solid: true });
  const dy = py + 0.35;
  const kim = off(dais, yaw, 0, -0.3);
  props.box('wood_dark', { x: kim.x, y: dy + 1.0, z: kim.z, sx: 0.08, sy: 2.0, sz: 0.08, yaw });
  props.box('wood_dark', { x: kim.x, y: dy + 1.85, z: kim.z, sx: 1.6, sy: 0.08, sz: 0.08, yaw });
  props.cylinder('cloth_green', { x: kim.x, y: dy + 0.25, z: kim.z, r: 0.62, rTop: 0.34, h: 1.55, segments: 12 });
  props.box('cloth_green', { x: kim.x, y: dy + 1.7, z: kim.z, sx: 1.5, sy: 0.32, sz: 0.3, yaw });
  props.box('gold', { x: kim.x, y: dy + 1.15, z: kim.z, sx: 0.66, sy: 0.12, sz: 0.66, yaw });
  for (const sgn of [-1, 1]) {
    const f = off(dais, yaw, sgn * 0.95, 0.35);
    const fan = new THREE.CircleGeometry(0.42, 12, Math.PI * 0.1, Math.PI * 0.8);
    props.mesh('gold', fan, { x: f.x, y: dy + 0.75, z: f.z, yaw: yaw + sgn * 0.4, pitch: -0.3 });
    fan.dispose();
    props.box('wood_dark', { x: f.x, y: dy + 0.25, z: f.z, sx: 0.4, sy: 0.5, sz: 0.3, yaw });
  }
  const hd = off(dais, yaw, 0, 0.9);
  props.box('wood_dark', { x: hd.x, y: dy + 0.35, z: hd.z, sx: 0.5, sy: 0.7, sz: 0.4, yaw });
  props.cylinder('gold', { x: hd.x, y: dy + 0.7, z: hd.z, r: 0.2, h: 0.1, segments: 12 });
  props.box('gold', { x: hd.x, y: dy + 0.86, z: hd.z, sx: 0.22, sy: 0.26, sz: 0.04, yaw });
  for (const sgn of [-1, 1]) {
    const bt = off(dais, yaw, sgn * 0.3, 1.25);
    props.box('stone_dark', { x: bt.x, y: dy + 0.17, z: bt.z, sx: 0.16, sy: 0.34, sz: 0.3, yaw });
  }
  // The mural on a standing screen at the back, facing the entrance.
  const mtex = muralTexture();
  const mmat = new THREE.MeshStandardMaterial({ map: mtex, roughness: 0.8 });
  mmat.name = 'kyoshi_mural';
  out.owned.push(mmat, mtex);
  const ms = off(c, yaw, 0, -R + 0.55);
  props.box('wood_dark', { x: ms.x, y: py + 1.6, z: ms.z, sx: 4.6, sy: 2.75, sz: 0.16, yaw }, { collide: true, solid: true });
  const face = new THREE.PlaneGeometry(4.3, 2.42);
  const mf = off(ms, yaw, 0, 0.09);
  props.mesh(mmat, face, { x: mf.x, y: py + 1.6, z: mf.z, yaw });
  face.dispose();
  out.marks.mural = { x: mf.x, y: py + 1.6, z: mf.z };
  // Incense bowl and lanterns at the steps; bonsai pines and rocks round the plaza.
  const bowl = off(c, yaw, 0, R + 3.9);
  props.cylinder('bronze', { x: bowl.x, y: y + 0.05, z: bowl.z, r: 0.5, rTop: 0.62, h: 0.6, segments: 12 }, { collide: true, solid: true });
  for (const sgn of [-1, 1]) {
    const q = off(c, yaw, sgn * 2.4, R + 3.6);
    props.lantern(new THREE.Vector3(q.x, y + 2.9, q.z), { color: 'warm', post: true });
    out.lanterns.push(new THREE.Vector3(q.x, y + 2.9, q.z));
  }
  const rnd = env.rnd;
  for (let i = 0; i < 7; i++) {
    const a = yaw + Math.PI * 0.35 + i * 0.75 + rnd.range(-0.15, 0.15);
    const r = 12.8 + rnd.range(0, 2.5);
    const x = c.x + Math.sin(a) * r, z = c.z + Math.cos(a) * r;
    bonsai(props, env.mats, x, heightAt(x, z), z, rnd.range(0.9, 1.4), i * 1.7 + 0.3);
    const rx = c.x + Math.sin(a + 0.35) * (r - 1.2), rz = c.z + Math.cos(a + 0.35) * (r - 1.2);
    const rock = new THREE.DodecahedronGeometry(rnd.range(0.5, 0.9), 0);
    rock.scale(1.2, 0.7, 1);
    props.rock('stone_grey', rock, { x: rx, y: heightAt(rx, rz) + 0.2, z: rz, yaw: a });
    rock.dispose();
  }
}
