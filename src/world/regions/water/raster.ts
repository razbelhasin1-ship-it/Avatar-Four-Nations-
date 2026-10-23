/**
 * Greedy rectangle decomposition of a rasterised area: the city podium is
 * "everything inside the walls except canals, the gorge and sunken gardens",
 * sampled on a metre grid and merged into as few axis-aligned rectangles as
 * possible (each becomes one box mesh + one walkable collider).
 */
export interface GridRect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export function rasterRects(x0: number, z0: number, x1: number, z1: number, cell: number, solid: (x: number, z: number) => boolean): GridRect[] {
  const nx = Math.round((x1 - x0) / cell);
  const nz = Math.round((z1 - z0) / cell);
  const grid = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    const z = z0 + (j + 0.5) * cell;
    for (let i = 0; i < nx; i++) grid[j * nx + i] = solid(x0 + (i + 0.5) * cell, z) ? 1 : 0;
  }
  const out: GridRect[] = [];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      if (grid[j * nx + i] !== 1) continue;
      // Extend right.
      let w = 1;
      while (i + w < nx && grid[j * nx + i + w] === 1) w++;
      // Extend down while the whole run is free.
      let h = 1;
      outer: while (j + h < nz) {
        for (let k = 0; k < w; k++) if (grid[(j + h) * nx + i + k] !== 1) break outer;
        h++;
      }
      for (let jj = 0; jj < h; jj++) for (let k = 0; k < w; k++) grid[(j + jj) * nx + i + k] = 2;
      out.push({ x0: x0 + i * cell, z0: z0 + j * cell, x1: x0 + (i + w) * cell, z1: z0 + (j + h) * cell });
    }
  }
  return out;
}
