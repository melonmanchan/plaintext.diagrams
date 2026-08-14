export interface BoxShape {
  type: 'box';
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
}

export interface TextShape {
  type: 'text';
  id: number;
  x: number;
  y: number;
  text: string;
}

export interface ArrowShape {
  type: 'arrow';
  id: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Attached box ids; when set, the endpoint follows the box. */
  box1: number | null;
  box2: number | null;
  text?: string;
  /** Arrowhead placement; absent means 'end'. */
  heads?: 'end' | 'both' | 'start';
}

export type Shape = BoxShape | ArrowShape | TextShape;

/** Alignment guide shown while snap-dragging, in world px. */
export interface Guide {
  axis: 'v' | 'h';
  px: number;
}

export interface DocState {
  seq: number;
  shapes: Shape[];
}

export interface Project {
  id: string;
  name: string;
}

export type Tool = 'select' | 'box' | 'arrow' | 'text';

export interface Point {
  x: number;
  y: number;
}

export type Corner = 'nw' | 'ne' | 'sw' | 'se';

/** Character grid produced by the rasterizer; also the hit-test source. */
export interface Raster {
  ch: string[];
  id: Int32Array;
  pri: Uint8Array;
  cols: number;
  rows: number;
}

export type Put = (x: number, y: number, c: string, sid: number, p: number) => void;

export type Drag =
  | { mode: 'move'; sx: number; sy: number; orig: Map<number, Shape>; snap: string; moved: boolean }
  | { mode: 'marquee'; sx: number; sy: number; cx: number; cy: number; base: Set<number>; moved: boolean }
  | { mode: 'resize'; id: number; corner: Corner; orig: BoxShape; snap: string; moved: boolean }
  | { mode: 'endpoint'; id: number; which: 1 | 2; snap: string; moved: boolean }
  | { mode: 'create-box'; sx: number; sy: number; id: number | null; snap: string; moved: boolean }
  | { mode: 'create-arrow'; id: number; snap: string; moved: boolean };
