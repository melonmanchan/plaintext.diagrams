export const CW = 10, CH = 18;            // cell size, px
export const COLS = 200, ROWS = 100;      // minimum world size, cells
export const MAX_COLS = 1000, MAX_ROWS = 500; // hard world cap
export const GROW_MARGIN = 30;            // free cells kept beyond content
export const FONT = '15px "SF Mono", ui-monospace, Menlo, Consolas, monospace';

export const STORE_INDEX = 'vibedraw:index';
export const DOC_KEY = (id: string) => 'vibedraw:doc:' + id;
export const LEGACY_KEY = 'asciidraw-v1';

/** Raster layer priorities; higher wins per cell. */
export const PRI = {
  groupborder: 1,
  boxfill: 2,
  boxborder: 3,
  line: 4,
  head: 5,
  text: 6,
} as const;

export const COLOR = {
  bg: '#0f1115',
  dot: '#1d2330',
  box: '#cdd6f4',
  group: '#a6adc8',
  arrow: '#7dcfff',
  text: '#e0af68',
  sel: '#7aa2f7',
  selBg: 'rgba(122,162,247,0.22)',
  hoverBg: 'rgba(255,255,255,0.06)',
} as const;
