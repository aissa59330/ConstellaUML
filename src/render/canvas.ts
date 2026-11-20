import { type FontSpec, type Graphics, type HAlign, type Point, type Rect, type StrokeStyle, type TextMeasurer, cssFont } from "./graphics";

const measureCache = new Map<string, number>();
let measureCtx: CanvasRenderingContext2D | null = null;

/** Browser text measurer with a cache (text layout runs on every frame). */
export const canvasMeasurer: TextMeasurer = {
  width(text, font) {
    const key = cssFont(font) + "\u0000" + text;
    let w = measureCache.get(key);
    if (w === undefined) {
      measureCtx ??= document.createElement("canvas").getContext("2d")!;
      measureCtx.font = cssFont(font);
      w = measureCtx.measureText(text).width;
      if (measureCache.size > 20000) measureCache.clear();
      measureCache.set(key, w);
    }
    return w;
  },
};

export class CanvasGraphics implements Graphics {
  private shadow = false;

  constructor(private ctx: CanvasRenderingContext2D) {}

  width(text: string, font: FontSpec): number {
    return canvasMeasurer.width(text, font);
  }

  save(): void {
    this.ctx.save();
  }

  restore(): void {
    this.ctx.restore();
  }

  translate(x: number, y: number): void {
    this.ctx.translate(x, y);
  }

  scale(s: number): void {
    this.ctx.scale(s, s);
  }

  setShadow(on: boolean): void {
    this.shadow = on;
  }

  private applyStroke(s: StrokeStyle): void {
    this.ctx.strokeStyle = s.color;
    this.ctx.lineWidth = s.width ?? 1;
    this.ctx.setLineDash(s.dash ?? []);
  }

  private fillWithShadow(fill: string): void {
    const c = this.ctx;
    c.fillStyle = fill;
    if (this.shadow) {
      c.save();
      c.shadowColor = "rgba(0,0,0,0.18)";
      c.shadowBlur = 6;
      c.shadowOffsetX = 2;
      c.shadowOffsetY = 2;
      c.fill();
      c.restore();
    } else c.fill();
  }

  rect(r: Rect, fill: string | null, stroke: StrokeStyle | null, radius = 0): void {
    const c = this.ctx;
    c.beginPath();
    if (radius > 0) c.roundRect(r.x, r.y, r.w, r.h, radius);
    else c.rect(r.x, r.y, r.w, r.h);
    if (fill && fill !== "transparent") this.fillWithShadow(fill);
    if (stroke) {
      this.applyStroke(stroke);
      c.stroke();
    }
  }

  ellipse(r: Rect, fill: string | null, stroke: StrokeStyle | null): void {
    const c = this.ctx;
    c.beginPath();
    c.ellipse(r.x + r.w / 2, r.y + r.h / 2, Math.max(0, r.w / 2), Math.max(0, r.h / 2), 0, 0, Math.PI * 2);
    if (fill && fill !== "transparent") this.fillWithShadow(fill);
    if (stroke) {
      this.applyStroke(stroke);
      c.stroke();
    }
  }

  polygon(pts: Point[], fill: string | null, stroke: StrokeStyle | null): void {
    const c = this.ctx;
    c.beginPath();
    pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
    c.closePath();
    if (fill && fill !== "transparent") {
      c.fillStyle = fill;
      c.fill();
    }
    if (stroke) {
      this.applyStroke(stroke);
      c.stroke();
    }
  }

  polyline(pts: Point[], stroke: StrokeStyle, mode: "straight" | "rounded" | "curve" = "straight"): void {
    const c = this.ctx;
    c.beginPath();
    tracePath(pts, mode, (x, y) => c.moveTo(x, y), (x, y) => c.lineTo(x, y), (cx, cy, x, y) => c.quadraticCurveTo(cx, cy, x, y));
    this.applyStroke(stroke);
    c.stroke();
  }

  text(s: string, x: number, y: number, font: FontSpec, color: string, align: HAlign = "left", underline = false): void {
    const c = this.ctx;
    c.font = cssFont(font);
    c.fillStyle = color;
    c.textAlign = align;
    c.textBaseline = "middle";
    c.fillText(s, x, y);
    if (underline) {
      const w = this.width(s, font);
      const x0 = align === "center" ? x - w / 2 : align === "right" ? x - w : x;
      c.fillRect(x0, y + font.size / 2 - 1, w, 1);
    }
  }
}

/** Shared path tracing for rounded and curved polylines (canvas and SVG). */
export function tracePath(
  pts: Point[],
  mode: "straight" | "rounded" | "curve",
  moveTo: (x: number, y: number) => void,
  lineTo: (x: number, y: number) => void,
  quadTo: (cx: number, cy: number, x: number, y: number) => void,
): void {
  if (pts.length === 0) return;
  moveTo(pts[0].x, pts[0].y);
  if (mode === "straight" || pts.length < 3) {
    for (let i = 1; i < pts.length; i++) lineTo(pts[i].x, pts[i].y);
    return;
  }
  for (let i = 1; i < pts.length - 1; i++) {
    const p0 = pts[i - 1], p1 = pts[i], p2 = pts[i + 1];
    if (mode === "curve") {
      const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
      quadTo(p1.x, p1.y, i === pts.length - 2 ? p2.x : mx, i === pts.length - 2 ? p2.y : my);
    } else {
      const r = Math.min(10, Math.hypot(p1.x - p0.x, p1.y - p0.y) / 2, Math.hypot(p2.x - p1.x, p2.y - p1.y) / 2);
      const a = towards(p1, p0, r), b = towards(p1, p2, r);
      lineTo(a.x, a.y);
      quadTo(p1.x, p1.y, b.x, b.y);
    }
  }
  if (mode === "rounded") lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
}

function towards(from: Point, to: Point, d: number): Point {
  const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  return { x: from.x + ((to.x - from.x) / len) * d, y: from.y + ((to.y - from.y) / len) * d };
}
