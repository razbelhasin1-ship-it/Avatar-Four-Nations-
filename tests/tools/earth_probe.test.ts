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
    if (mode === 'layout') {
      const L = await import('../../src/world/regions/earth/bssLayout');
      const r1 = (o: unknown) => JSON.stringify(o, (_k, v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : v));
      out.push('OUTER_GATES ' + r1(L.OUTER_GATES.map((g) => ({ ...g, deg: (g.theta * 180) / Math.PI }))));
      out.push('INNER_GATES ' + r1(L.INNER_GATES.map((g) => ({ ...g, deg: (g.theta * 180) / Math.PI }))));
      out.push('MID_GATES ' + r1(L.MID_GATES));
      out.push('UP_GATES ' + r1(L.UP_GATES));
      out.push('AGRARIAN ' + r1(L.AGRARIAN_AVENUES));
      out.push('LOWER ' + r1(L.LOWER_AVENUES));
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
