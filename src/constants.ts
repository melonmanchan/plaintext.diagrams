export const CW = 10, CH = 18;            // cell size, px
export const COLS = 200, ROWS = 100;      // world size, cells
export const FONT = '15px "SF Mono", ui-monospace, Menlo, Consolas, monospace';

export const STORE_INDEX = 'vibedraw:index';
export const DOC_KEY = (id: string) => 'vibedraw:doc:' + id;
export const LEGACY_KEY = 'asciidraw-v1';

/** Raster layer priorities; higher wins per cell. */
export const PRI = {
  boxfill: 1,
  boxborder: 2,
  line: 3,
  head: 4,
  text: 5,
} as const;

export const COLOR = {
  bg: '#0f1115',
  dot: '#1d2330',
  box: '#cdd6f4',
  arrow: '#7dcfff',
  text: '#e0af68',
  sel: '#7aa2f7',
  selBg: 'rgba(122,162,247,0.22)',
  hoverBg: 'rgba(255,255,255,0.06)',
} as const;
