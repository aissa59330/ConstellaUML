// Drawing surface shared by the screen (Canvas2D) and exports (SVG). Views
// only ever talk to this interface, so what you see is what gets exported.

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FontSpec {
  family: string;
  size: number;
  bold: boolean;
  italic: boolean;
}

export type HAlign = "left" | "center" | "right";

export interface StrokeStyle {
  color: string;
  width?: number;
  dash?: number[];
}

export interface TextMeasurer {
  width(text: string, font: FontSpec): number;
}

export interface Graphics extends TextMeasurer {
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  scale(s: number): void;
  setShadow(on: boolean): void;
  rect(r: Rect, fill: string | null, stroke: StrokeStyle | null, radius?: number): void;
  ellipse(r: Rect, fill: string | null, stroke: StrokeStyle | null): void;
  polygon(pts: Point[], fill: string | null, stroke: StrokeStyle | null): void;
  polyline(pts: Point[], stroke: StrokeStyle, mode?: "straight" | "rounded" | "curve"): void;
  text(s: string, x: number, y: number, font: FontSpec, color: string, align?: HAlign, underline?: boolean): void;
  image?(src: string, r: Rect): void;
}

/** "Arial;13;1" → family, size, style (0 normal, 1 bold, 2 italic, 3 bold italic). */
export function parseFont(spec: string | undefined): FontSpec {
  const [family = "Arial", size = "13", style = "0"] = (spec ?? "").split(";");
  const st = Number(style) || 0;
  return { family: family || "Arial", size: Number(size) || 13, bold: (st & 1) === 1, italic: (st & 2) === 2 };
}

export function formatFont(f: FontSpec): string {
  return `${f.family};${f.size};${(f.bold ? 1 : 0) | (f.italic ? 2 : 0)}`;
}

export function withStyle(f: FontSpec, bold?: boolean, italic?: boolean): FontSpec {
  return { ...f, bold: bold ?? f.bold, italic: italic ?? f.italic };
}

export function cssFont(f: FontSpec): string {
  return `${f.italic ? "italic " : ""}${f.bold ? "bold " : ""}${f.size}px "${f.family}", "Liberation Sans", Arial, sans-serif`;
}

/** Text measurer usable outside the browser (tests, CLI): average glyph widths. */
export const approxMeasurer: TextMeasurer = {
  width(text, font) {
    let w = 0;
    for (const ch of text) w += /[il.,:;'|!]/.test(ch) ? 0.28 : /[mwMW@]/.test(ch) ? 0.85 : /[A-Z]/.test(ch) ? 0.66 : 0.55;
    return w * font.size * (font.bold ? 1.06 : 1);
  },
};

export function inflate(r: Rect, d: number): Rect {
  return { x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d };
}

export function contains(r: Rect, p: Point): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function union(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const r of rects) {
    x1 = Math.min(x1, r.x);
    y1 = Math.min(y1, r.y);
    x2 = Math.max(x2, r.x + r.w);
    y2 = Math.max(y2, r.y + r.h);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
