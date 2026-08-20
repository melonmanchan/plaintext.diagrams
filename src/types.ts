export interface BoxShape {
  type: 'box';
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  /** Border style; absent means square corners. */
  style?: 'round';
}

/** Double-line frame that visually encapsulates other shapes. */
export interface GroupShape {
  type: 'group';
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Title shown in the top-left corner of the frame. */
  text: string;
  /** Vertical swimlane titles; 2+ entries render lane separators. */
  lanes?: string[];
}

export interface TextShape {
  type: 'text';
  id: number;
  x: number;
  y: number;
  text: string;
}

/** A box border side; used for arrow anchoring. */
export type Side = 'left' | 'right' | 'top' | 'bottom';

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
  /** Line style; absent means solid. */
  style?: 'dashed';
  /** Pinned anchor sides per endpoint; absent means auto (router picks). */
  side1?: Side;
  side2?: Side;
  /**
   * Exact anchor offset along the pinned side, relative to the box origin
   * (rows for left/right, columns for top/bottom). Only meaningful with
   * the matching sideN; absent means the router slides toward the target.
   */
  at1?: number;
  at2?: number;
}

export type Shape = BoxShape | GroupShape | ArrowShape | TextShape;

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

export type Tool = 'select' | 'box' | 'arrow' | 'text' | 'group';

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

/** A contained shape's lane assignment captured at resize start. */
export interface LaneSlot {
  id: number;
  lane: number;
  offX: number;
  offY: number;
}

export type Put = (x: number, y: number, c: string, sid: number, p: number) => void;

export type Drag =
  | { mode: 'move'; sx: number; sy: number; orig: Map<number, Shape>; snap: string; moved: boolean }
  | { mode: 'marquee'; sx: number; sy: number; cx: number; cy: number; base: Set<number>; moved: boolean }
  | { mode: 'resize'; id: number; corner: Corner; orig: BoxShape | GroupShape; snap: string; moved: boolean; slots?: LaneSlot[] }
  | { mode: 'endpoint'; id: number; which: 1 | 2; snap: string; moved: boolean }
  | { mode: 'create-box'; kind: 'box' | 'group'; sx: number; sy: number; id: number | null; snap: string; moved: boolean }
  | { mode: 'create-arrow'; id: number; snap: string; moved: boolean };
