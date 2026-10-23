/**
 * Dev tool: terrain probe for enemy boss/camp placement.
 * Runs only when ENEMY_PROBE is set:  ENEMY_PROBE=1 npx vitest run tests/tools/enemies_probe.test.ts
 */
import { writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { heightAt, initHeightfield, normalAt, waterAt } from '../../src/world/Heightfield';

describe.skipIf(!process.env.ENEMY_PROBE)('enemy probe', () => {
  it('prints', () => {
    initHeightfield();
    const out: string[] = [];
    const info = (x: number, z: number) => {
      const h = heightAt(x, z);
      const w = waterAt(x, z, h);
      const n = normalAt(x, z, 1);
      return `${x},${z}: h=${h.toFixed(1)} ny=${n.y.toFixed(2)}${w ? ` water(${w.kind},lvl ${w.level.toFixed(1)}${w.frozen ? ',frozen' : ''})` : ''}`;
    };
    const pts = (process.env.ENEMY_PTS ?? '-772,691;-760,670;-790,660;-740,650;1060,170;1010,170;1110,170;1060,230;1060,110;1000,200').split(';');
    for (const p of pts) {
      const [x, z] = p.split(',').map(Number);
      out.push(info(x, z));
    }
    // Southern coast candidates: dry, gentle land within 25 m of liquid ocean.
    const cands: string[] = [];
    for (let x = -700; x <= 1200; x += 40) {
      for (let z = 1100; z <= 1800; z += 40) {
        const h = heightAt(x, z);
        if (h < 1 || h > 8) continue;
        if (Math.hypot(x - 220, z - 1600) < 330) continue;
        if (Math.hypot(x - 1450, z - 1250) < 450) continue;
        const n = normalAt(x, z, 1);
        if (n.y < 0.95) continue;
        let ocean = false;
        for (let a = 0; a < 8 && !ocean; a++) {
          const sx = x + Math.cos(a * Math.PI / 4) * 22, sz = z + Math.sin(a * Math.PI / 4) * 22;
          const w = waterAt(sx, sz);
          if (w && w.kind === 'ocean' && !w.frozen) ocean = true;
        }
        if (ocean) cands.push(`${x},${z} h=${h.toFixed(1)}`);
      }
    }
    out.push('south coast: ' + cands.slice(0, 40).join(' | '));
    writeFileSync(process.env.ENEMY_OUT ?? '/tmp/claude-0/-home-user-Avatar-Four-Nations-/109f6a46-95c8-5cb7-b442-4929e597d312/scratchpad/enemies/probe.txt', out.join('\n'));
  });
});
