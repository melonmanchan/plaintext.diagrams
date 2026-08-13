import { COLS, ROWS } from './constants';
import { rasterize } from './raster';
import type { Shape } from './types';

/** Render shapes to trimmed ASCII text — the product of the whole app. */
export function exportAscii(shapes: Shape[]): string {
  const r = rasterize(shapes);
  let minX = COLS, minY = ROWS, maxX = -1, maxY = -1;
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++)
      if (r.ch[y * COLS + x] !== ' ') {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
  if (maxX < 0) return '';
  const lines: string[] = [];
  for (let y = minY; y <= maxY; y++) {
    let line = '';
    for (let x = minX; x <= maxX; x++) line += r.ch[y * COLS + x];
    lines.push(line.replace(/\s+$/, ''));
  }
  return lines.join('\n');
}
