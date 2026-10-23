import { test } from 'vitest';
import { heightAt, waterAt } from '../../src/world/Heightfield';
test('probe', () => {
  for (let z = 1480; z <= 1960; z += 12) {
    let row = `z ${String(z).padStart(5)}: `;
    for (let x = -40; x <= 480; x += 10) {
      const h = heightAt(x, z);
      const w = waterAt(x, z, h);
      row += w ? (w.frozen ? '#' : '~') : h < 1 ? '.' : h < 2.5 ? ',' : h < 3.5 ? '3' : h < 6 ? '5' : h < 10 ? '8' : 'H';
    }
    console.log(row);
  }
});
