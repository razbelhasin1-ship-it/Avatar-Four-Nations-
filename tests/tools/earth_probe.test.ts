/**
 * Dev tool: prints terrain heights / water around the Earth Kingdom sites.
 * Runs only when EARTH_PROBE is set:
 *   EARTH_PROBE=polar EARTH_C=850,-50 EARTH_RS=0,100,200 npx vitest run tests/tools/earth_probe.test.ts
 *   EARTH_PROBE=grid EARTH_GRID=x0,z0,x1,z1,step ...
 *   EARTH_PROBE=pts EARTH_PTS="x,z;x,z" ...
 */
import { writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { heightAt, waterAt, initHeightfield } from '../../src/world/Heightfield';

describe.skipIf(!process.env.EARTH_PROBE)('earth probe', () => {
  it('prints', async () => {
    initHeightfield();
    const mode = process.env.EARTH_PROBE;
    const out: string[] = [];
    if (mode === 'polar') {
      const [cx, cz] = (process.env.EARTH_C ?? '850,-50').split(',').map(Number);
      const rs = (process.env.EARTH_RS ?? '0,100,200,300,380,400,420,440,470,520').split(',').map(Number);
      out.push('ang\\r ' + rs.map((r) => String(r).padStart(6)).join(''));
      for (let a = 0; a < 360; a += 15) {
        const row = rs.map((r) => {
          const x = cx + Math.cos((a * Math.PI) / 180) * r, z = cz + Math.sin((a * Math.PI) / 180) * r;
          const h = heightAt(x, z);
          return ((waterAt(x, z, h) ? '~' : '') + h.toFixed(1)).padStart(6);
        });
        out.push(String(a).padStart(6) + ' ' + row.join(''));
      }
    }
    if (mode === 'pts') {
      for (const p of (process.env.EARTH_PTS ?? '640,-30').split(';')) {
        const [x, z] = p.split(',').map(Number);
        const h = heightAt(x, z);
        const w = waterAt(x, z, h);
        out.push(`${x},${z}: h=${h.toFixed(2)}${w ? ` water=${JSON.stringify(w)}` : ''}`);
      }
    }
    if (mode === 'grid') {
      const [x0, z0, x1, z1, step] = (process.env.EARTH_GRID ?? '60,-620,180,-500,10').split(',').map(Number);
      const xs: number[] = [];
      for (let x = x0; x <= x1; x += step) xs.push(x);
      out.push('z\\x   ' + xs.map((x) => String(x).padStart(6)).join(''));
      for (let z = z0; z <= z1; z += step) {
        out.push(
          String(z).padStart(6) +
            ' ' +
            xs
              .map((x) => {
                const h = heightAt(x, z);
                return ((waterAt(x, z, h) ? '~' : '') + h.toFixed(1)).padStart(6);
              })
              .join(''),
        );
      }
    }
    if (mode === 'blocks') {
      // Free angular intervals for Ba Sing Se ring blocks (no viaduct / station / avenue overlap).
      const L = await import('../../src/world/regions/earth/bssLayout');
      const { railPath } = await import('../../src/world/regions/earth/bssWalls');
      const r0 = Number(process.env.BSS_R0 ?? 121), r1 = Number(process.env.BSS_R1 ?? 151);
      const pts: Array<{ x: number; z: number; cl: number }> = [];
      for (const l of L.RAIL_LINES) {
        const path = railPath(l.id);
        for (let s = 0; s < path.total; s += 1) {
          const p = path.at(s);
          const rr = Math.hypot(p.x - L.C.x, p.z - L.C.z);
          if (rr > r0 - 30 && rr < r1 + 30) pts.push({ x: p.x, z: p.z, cl: L.RAIL.deckW / 2 + 1.2 });
        }
        for (const st of l.stations) pts.push({ x: st.at.x, z: st.at.z, cl: 14 });
      }
      const rm = (r0 + r1) / 2, hd = (r1 - r0) / 2;
      for (const hw of (process.env.BSS_HW ?? '8,10,13,15,22').split(',').map(Number)) {
        const free: string[] = [];
        let start = -1;
        for (let d = 0; d <= 360; d += 0.5) {
          const t = d * L.DEG;
          const c = L.polar(t, rm);
          const tx = -Math.sin(t), tz = Math.cos(t), rx = Math.cos(t), rz = Math.sin(t);
          let ok = true;
          for (const p of pts) {
            const u = (p.x - c.x) * tx + (p.z - c.z) * tz, v = (p.x - c.x) * rx + (p.z - c.z) * rz;
            if (Math.hypot(Math.max(Math.abs(u) - hw, 0), Math.max(Math.abs(v) - hd, 0)) < p.cl) { ok = false; break; }
          }
          for (const a of L.AVENUES) if (ok && Math.abs(Math.sin(t - a.theta)) * r0 < hw + a.width / 2 + 4 && Math.cos(t - a.theta) > 0) ok = false;
          if (ok && start < 0) start = d;
          if ((!ok || d === 360) && start >= 0) { free.push(`${start}-${d - 0.5}`); start = -1; }
        }
        out.push(`hw ${hw} (r ${r0}-${r1}): ${free.join(' ')}`);
      }
    }
    if (mode === 'layout') {
      const L = await import('../../src/world/regions/earth/bssLayout');
      const r1 = (o: unknown) => JSON.stringify(o, (_k, v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : v));
      out.push('GATES ' + r1(L.GATES.map((g) => ({ ...g, deg: (g.theta * 180) / Math.PI }))));
      out.push('AVENUES ' + r1(L.AVENUES));
      out.push('FARM_ROADS ' + r1(L.FARM_ROADS));
      out.push('STATIONS ' + r1(L.STATIONS));
      for (const id of ['ba_sing_se_west', 'southern_road', 'eastern_road', 'northern_road']) {
        const { ROADS } = await import('../../src/world/WorldLayout');
        out.push(id + ' ' + r1(ROADS.find((r) => r.id === id)));
      }
    }
    if (mode === 'spots') {
      const { EARTH_SPOTS } = await import('../../src/world/regions/earth/spots');
      for (const [id, sp] of Object.entries(EARTH_SPOTS)) out.push(`${id}: (${sp.x.toFixed(1)}, ${(sp.y ?? NaN).toFixed(1)}, ${sp.z.toFixed(1)})${sp.r ? ` r=${sp.r}` : ''} ${sp.label ?? ''}`);
    }
    writeFileSync(process.env.EARTH_OUT ?? 'earth_probe.txt', out.join('\n'));
  });
});
