/**
 * Dev tool: terrain / water / road probes for the wilds sites (src/world/regions/wilds).
 * Runs only when WILDS_PROBE is set:
 *   WILDS_PROBE=crossings WILDS_OUT=/tmp/x.txt npx vitest run tests/tools/wilds_probe.test.ts
 *   WILDS_PROBE=grid WILDS_GRID=x0,z0,x1,z1,step ...
 *   WILDS_PROBE=polar WILDS_C=x,z WILDS_RS=0,10,20 ...
 *   WILDS_PROBE=pts WILDS_PTS="x,z;x,z" ...
 */
import { writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { heightAt, waterAt, initHeightfield, getRoadRuntime, getTrailRuntime, roadAt } from '../../src/world/Heightfield';

describe.skipIf(!process.env.WILDS_PROBE)('wilds probe', () => {
  it('prints', async () => {
    initHeightfield();
    const mode = process.env.WILDS_PROBE;
    const out: string[] = [];
    const cell = (x: number, z: number) => {
      const h = heightAt(x, z);
      const w = waterAt(x, z, h);
      return ((w ? (w.kind === 'ocean' ? '≈' : '~') : roadAt(x, z, 0) ? '=' : '') + h.toFixed(1)).padStart(7);
    };
    if (mode === 'crossings') {
      const lines = [...getRoadRuntime().map((r) => ({ ...r, kind: 'road' })), ...getTrailRuntime().map((t) => ({ ...t, surface: 'trail', kind: 'trail' }))];
      for (const r of lines) {
        let run: { s0: number; s1: number; ids: Set<string>; minLevel: number; maxLevel: number } | null = null;
        const flush = () => {
          if (!run) return;
          const a = r.line.pointAt(Math.max(0, run.s0 - 1)), b = r.line.pointAt(Math.min(r.line.length, run.s1 + 1));
          out.push(`${r.id} s=${run.s0.toFixed(1)}..${run.s1.toFixed(1)} len=${(run.s1 - run.s0).toFixed(1)} water=${[...run.ids].join(',')} level=${run.minLevel.toFixed(2)}..${run.maxLevel.toFixed(2)} a=(${a.x.toFixed(1)},${a.z.toFixed(1)}) b=(${b.x.toFixed(1)},${b.z.toFixed(1)}) roadY(a)=${r.height(run.s0 - 1).toFixed(2)} roadY(b)=${r.height(run.s1 + 1).toFixed(2)}`);
          run = null;
        };
        for (let s = 0; s <= r.line.length; s += 0.5) {
          const p = r.line.pointAt(s);
          // centre line and both edges
          let wet: ReturnType<typeof waterAt> = null;
          const tg = r.line.tangentAt(s);
          for (const off of [-r.half, 0, r.half]) {
            const x = p.x - tg.z * off, z = p.z + tg.x * off;
            const w = waterAt(x, z, heightAt(x, z));
            if (w) wet = w;
          }
          if (wet) {
            if (!run) run = { s0: s, s1: s, ids: new Set(), minLevel: wet.level, maxLevel: wet.level };
            run.s1 = s;
            run.ids.add(`${wet.kind}:${wet.id}${wet.frozen ? '(frozen)' : ''}`);
            run.minLevel = Math.min(run.minLevel, wet.level);
            run.maxLevel = Math.max(run.maxLevel, wet.level);
          } else if (run && s - run.s1 > 6) flush();
        }
        flush();
        out.push(`${r.id} length=${r.line.length.toFixed(1)} (${r.kind})`);
      }
    }
    if (mode === 'roadpts') {
      const step = Number(process.env.WILDS_STEP ?? 50);
      for (const r of getRoadRuntime()) {
        for (let s = 0; s <= r.line.length; s += step) {
          const p = r.line.pointAt(s);
          out.push(`${r.id} s=${s} (${p.x.toFixed(0)},${p.z.toFixed(0)}) y=${r.height(s).toFixed(1)} terr=${heightAt(p.x, p.z).toFixed(1)}`);
        }
      }
    }
    if (mode === 'polar') {
      const [cx, cz] = (process.env.WILDS_C ?? '0,0').split(',').map(Number);
      const rs = (process.env.WILDS_RS ?? '0,10,20,30,40,60,80').split(',').map(Number);
      out.push('ang\\r ' + rs.map((r) => String(r).padStart(7)).join(''));
      for (let a = 0; a < 360; a += 30) {
        out.push(String(a).padStart(6) + ' ' + rs.map((r) => cell(cx + Math.cos((a * Math.PI) / 180) * r, cz + Math.sin((a * Math.PI) / 180) * r)).join(''));
      }
    }
    if (mode === 'pts') {
      for (const p of (process.env.WILDS_PTS ?? '0,0').split(';')) {
        const [x, z] = p.split(',').map(Number);
        const h = heightAt(x, z);
        const w = waterAt(x, z, h);
        out.push(`${x},${z}: h=${h.toFixed(2)}${w ? ` water=${JSON.stringify(w)}` : ''}${roadAt(x, z, 0) ? ' road' : ''}`);
      }
    }
    if (mode === 'grid') {
      for (const g of (process.env.WILDS_GRID ?? '0,0,100,100,10').split(';')) {
        const [x0, z0, x1, z1, step] = g.split(',').map(Number);
        const xs: number[] = [];
        for (let x = x0; x <= x1; x += step) xs.push(x);
        out.push(`grid ${g}`);
        out.push('z\\x    ' + xs.map((x) => String(x).padStart(7)).join(''));
        for (let z = z0; z <= z1; z += step) out.push(String(z).padStart(6) + ' ' + xs.map((x) => cell(x, z)).join(''));
      }
    }
    writeFileSync(process.env.WILDS_OUT ?? 'wilds_probe.txt', out.join('\n'));
  });
});
