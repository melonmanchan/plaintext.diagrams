import { MAX_COLS, MAX_ROWS } from './constants';
import { rasterize, stylize } from './raster';
import { contentExtent } from './shapes';
import type { Shape } from './types';

/** Render shapes to trimmed ASCII text — the product of the whole app. */
export function exportAscii(shapes: Shape[], unicode = false): string {
  const ext = contentExtent(shapes);
  // +16: loop routes around box sides extend beyond shape extents.
  const cols = Math.min(MAX_COLS, Math.max(1, ext.x + 16));
  const rows = Math.min(MAX_ROWS, Math.max(1, ext.y + 16));
  const r = rasterize(shapes, cols, rows);
  const ch = unicode ? stylize(r) : r.ch;
  let minX = cols, minY = rows, maxX = -1, maxY = -1;
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++)
      if (r.ch[y * cols + x] !== ' ') {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
  if (maxX < 0) return '';
  const lines: string[] = [];
  for (let y = minY; y <= maxY; y++) {
    let line = '';
    for (let x = minX; x <= maxX; x++) line += ch[y * cols + x];
    lines.push(line.replace(/\s+$/, ''));
  }
  return lines.join('\n');
}
