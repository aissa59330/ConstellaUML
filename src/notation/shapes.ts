// Declarative node views: a shape, a name placement and optional text
// compartments. Covers most UML / non-UML notations without bespoke code.
import type { Element } from "../core/element";
import { type FontSpec, type Graphics, type Point, type Rect, contains, withStyle } from "../render/graphics";
import { type RenderCtx, boundsOf, colors, fontOf, lineHeight, registerViewKind, setPaintedBounds, wrapText } from "./views";

export type Shape =
  | "rect"
  | "roundRect"
  | "pill"
  | "ellipse"
  | "dashedEllipse"
  | "dashedRoundRect"
  | "circle"
  | "dot"
  | "bullseye"
  | "circleX"
  | "diamond"
  | "bar"
  | "actor"
  | "node3d"
  | "component"
  | "artifact"
  | "sendSignal"
  | "acceptSignal"
  | "hourglass"
  | "pin"
  | "history"
  | "deepHistory"
  | "terminate"
  | "entryPoint"
  | "exitPoint"
  | "frame"
  | "infoItem"
  | "database";

export interface NodeSpec {
  shape: Shape | ((m: Element | undefined, v: Element) => Shape);
  /** «keyword» line above the name. */
  keyword?: string | ((m: Element | undefined, v: Element) => string | undefined);
  /** Where the name goes; "none" for control nodes. */
  name?: "center" | "top" | "below" | "none";
  underline?: boolean;
  bold?: boolean;
  nameText?: (m: Element | undefined, v: Element, ctx: RenderCtx) => string;
  /** Extra compartments below the name, separated by lines. */
  compartments?: ((m: Element | undefined, v: Element, ctx: RenderCtx) => string[])[];
  min?: [number, number];
  /** Fixed size (pseudo-states, pins…). */
  fixed?: [number, number] | ((v: Element, m?: Element) => [number, number]);
  /** Can hold other views (packages, subjects, states, lanes…). */
  container?: boolean;
}

const specs = new Map<string, NodeSpec>();

function shapeOf(spec: NodeSpec, m: Element | undefined, v: Element): Shape {
  return typeof spec.shape === "function" ? spec.shape(m, v) : spec.shape;
}
export function nodeSpec(type: string): NodeSpec | undefined {
  return specs.get(type);
}

const PAD = 6;

export function keywordOf(spec: NodeSpec, m: Element | undefined, v: Element): string | undefined {
  return typeof spec.keyword === "function" ? spec.keyword(m, v) : spec.keyword;
}

function nameOf(spec: NodeSpec, m: Element | undefined, v: Element, ctx: RenderCtx): string {
  if (spec.nameText) return spec.nameText(m, v, ctx);
  return m?.name ?? v.text ?? "";
}

interface Layout {
  head: { text: string; font: FontSpec; underline?: boolean }[];
  comps: string[][];
}
const layouts = new WeakMap<Element, Layout>();

export function registerShapeView(viewType: string, spec: NodeSpec): void {
  specs.set(viewType, spec);
  registerViewKind(viewType, {
    arrange(v, ctx) {
      const m = ctx.repo.deref(v.model);
      const shape = shapeOf(spec, m, v);
      const font = fontOf(v);
      const head: Layout["head"] = [];
      const kw = keywordOf(spec, m, v);
      if (kw && v.stereotypeDisplay !== "none") head.push({ text: `«${kw}»`, font });
      if (spec.name !== "none") {
        const n = nameOf(spec, m, v, ctx);
        if (n) head.push({ text: n, font: withStyle(font, spec.bold ?? !spec.underline, !!m?.isAbstract), underline: spec.underline });
      }
      const comps = (spec.compartments ?? []).map((f) => f(m, v, ctx)).filter((c) => c.length > 0);
      layouts.set(v, { head, comps });
      const fixed = typeof spec.fixed === "function" ? spec.fixed(v, m) : spec.fixed;
      if (fixed) {
        // Bars keep the user's length on their long axis.
        if (shape === "bar") {
          if ((v.width ?? 0) < 4 || (v.height ?? 0) < 4) [v.width, v.height] = fixed;
        } else [v.width, v.height] = fixed;
      }
      const lh = lineHeight(font);
      const tw = Math.max(0, ...head.map((l) => ctx.measure.width(l.text, l.font)), ...comps.flat().map((c) => ctx.measure.width(c, font)));
      const below = spec.name === "below";
      if (below) {
        const w = Math.max(v.width, tw);
        setPaintedBounds(v, { x: v.left + (v.width - w) / 2, y: v.top, w, h: v.height + 4 + head.length * lh });
      }
      if (fixed) return;
      const shapePad = shape === "ellipse" || shape === "dashedEllipse" ? 1.45 : 1;
      let minW = Math.max(spec.min?.[0] ?? 30, below ? spec.min?.[0] ?? 30 : tw * shapePad + PAD * 2 + extraWidth(shape));
      let minH = Math.max(spec.min?.[1] ?? 20, below ? spec.min?.[1] ?? 30 : (head.length * lh + PAD * 2) * (shapePad > 1 ? 1.3 : 1) + comps.reduce((a, c) => a + c.length * lh + PAD * 2, 0) + extraHeight(shape));
      if (spec.container || spec.name === "top") minH = Math.max(minH, head.length * lh + PAD * 2 + 20);
      minW = Math.ceil(minW);
      minH = Math.ceil(minH);
      if (v.autoResize) {
        v.width = minW;
        v.height = minH;
      } else {
        if ((v.width ?? 0) < minW) v.width = minW;
        if ((v.height ?? 0) < minH) v.height = minH;
      }
      if (below) setPaintedBounds(v, { x: v.left + (v.width - Math.max(v.width, tw)) / 2, y: v.top, w: Math.max(v.width, tw), h: v.height + 4 + head.length * lh });
    },
    draw(v, ctx) {
      const r = boundsOf(v);
      const c = colors(v, ctx);
      const g = ctx.g;
      const shape = shapeOf(spec, ctx.repo.deref(v.model), v);
      g.setShadow(v.showShadow !== false && !["dot", "bar", "bullseye", "pin", "actor", "terminate"].includes(shape));
      drawShape(g, shape, r, c.fill, c.line, v);
      g.setShadow(false);
      const lay = layouts.get(v);
      if (!lay) return;
      const font = fontOf(v);
      const lh = lineHeight(font);
      if (spec.name === "below") {
        lay.head.forEach((l, i) => g.text(l.text, r.x + r.w / 2, r.y + r.h + 4 + i * lh + lh / 2, l.font, c.font, "center", l.underline));
        return;
      }
      const inner = innerRect(shape, r);
      const compH = lay.comps.reduce((a, cmp) => a + cmp.length * lh + PAD * 2, 0);
      const headH = lay.head.length * lh;
      let y = spec.name === "top" || (spec.container && spec.name !== "center") ? inner.y + PAD : lay.comps.length ? inner.y + PAD : inner.y + (inner.h - compH - headH) / 2;
      if (shape === "frame") {
        const label = lay.head.map((l) => l.text).join(" ");
        const w = Math.min(r.w - 4, g.width(label, font) + 22);
        g.polygon(
          [
            { x: r.x, y: r.y },
            { x: r.x + w, y: r.y },
            { x: r.x + w, y: r.y + lh + 2 },
            { x: r.x + w - 8, y: r.y + lh + 10 },
            { x: r.x, y: r.y + lh + 10 },
          ],
          c.fill,
          { color: c.line },
        );
        g.text(label, r.x + 6, r.y + (lh + 10) / 2, withStyle(font, true), c.font);
        return;
      }
      const align = spec.name === "top" && spec.container ? "left" : "center";
      for (const l of lay.head) {
        g.text(l.text, align === "left" ? inner.x + PAD : inner.x + inner.w / 2, y + lh / 2, l.font, c.font, align, l.underline);
        y += lh;
      }
      y += PAD;
      for (const comp of lay.comps) {
        g.polyline([{ x: r.x, y }, { x: r.x + r.w, y }], { color: c.line });
        y += PAD;
        for (const line of comp) {
          for (const w of wrapText(line, r.w - PAD * 2, font, g)) {
            g.text(w, r.x + PAD, y + lh / 2, font, c.font, "left");
            y += lh;
          }
        }
        y += PAD;
      }
    },
    hit: (v, p) => (contains(boundsOf(v), p) ? v : null),
  });
}

function extraWidth(s: Shape): number {
  return s === "component" || s === "artifact" ? 24 : s === "node3d" ? 12 : s === "sendSignal" || s === "acceptSignal" ? 16 : 0;
}

function extraHeight(s: Shape): number {
  return s === "node3d" ? 12 : 0;
}

/** Area available for text inside the shape. */
function innerRect(s: Shape, r: Rect): Rect {
  if (s === "node3d") return { x: r.x, y: r.y + 10, w: r.w - 10, h: r.h - 10 };
  if (s === "component" || s === "artifact") return { x: r.x, y: r.y, w: r.w - 16, h: r.h };
  return r;
}

export function drawShape(g: Graphics, shape: Shape, r: Rect, fill: string, line: string, v?: Element): void {
  const st = { color: line };
  const dashed = { color: line, dash: [6, 4] };
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  switch (shape) {
    case "rect":
      return g.rect(r, fill, st);
    case "roundRect":
      return g.rect(r, fill, st, Math.min(12, r.h / 3));
    case "pill":
      return g.rect(r, fill, st, r.h / 2);
    case "dashedRoundRect":
      return g.rect(r, fill === "transparent" ? null : fill, dashed, 12);
    case "ellipse":
      return g.ellipse(r, fill, st);
    case "dashedEllipse":
      return g.ellipse(r, fill, dashed);
    case "circle":
      return g.ellipse(r, fill, st);
    case "dot":
      return g.ellipse(r, line, null);
    case "bullseye":
      g.ellipse(r, fill, st);
      return g.ellipse({ x: r.x + r.w * 0.22, y: r.y + r.h * 0.22, w: r.w * 0.56, h: r.h * 0.56 }, line, null);
    case "circleX":
    case "exitPoint": {
      g.ellipse(r, fill, st);
      const d = r.w * 0.15;
      g.polyline([{ x: r.x + d, y: r.y + d }, { x: r.x + r.w - d, y: r.y + r.h - d }], st);
      return g.polyline([{ x: r.x + r.w - d, y: r.y + d }, { x: r.x + d, y: r.y + r.h - d }], st);
    }
    case "entryPoint":
      return g.ellipse(r, fill, st);
    case "terminate":
      g.polyline([{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y + r.h }], { color: line, width: 2 });
      return g.polyline([{ x: r.x + r.w, y: r.y }, { x: r.x, y: r.y + r.h }], { color: line, width: 2 });
    case "history":
    case "deepHistory":
      g.ellipse(r, fill, st);
      return g.text(shape === "history" ? "H" : "H*", cx, cy, { family: "Arial", size: 12, bold: true, italic: false }, line, "center");
    case "diamond":
      return g.polygon([{ x: cx, y: r.y }, { x: r.x + r.w, y: cy }, { x: cx, y: r.y + r.h }, { x: r.x, y: cy }], fill, st);
    case "bar":
      return g.rect(r, line, null);
    case "pin":
      return g.rect(r, fill, st);
    case "actor": {
      const h = r.h, w = r.w;
      const head = Math.min(w, h) * 0.28;
      g.ellipse({ x: cx - head / 2, y: r.y, w: head, h: head }, fill, st);
      const neck = r.y + head, hip = r.y + h * 0.62;
      g.polyline([{ x: cx, y: neck }, { x: cx, y: hip }], st);
      g.polyline([{ x: r.x + w * 0.1, y: r.y + h * 0.36 }, { x: r.x + w * 0.9, y: r.y + h * 0.36 }], st);
      g.polyline([{ x: r.x + w * 0.12, y: r.y + h }, { x: cx, y: hip }, { x: r.x + w * 0.88, y: r.y + h }], st);
      return;
    }
    case "node3d": {
      const d = 10;
      g.polygon([{ x: r.x, y: r.y + d }, { x: r.x + d, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h - d }, { x: r.x + r.w - d, y: r.y + r.h }, { x: r.x, y: r.y + r.h }], fill, st);
      g.rect({ x: r.x, y: r.y + d, w: r.w - d, h: r.h - d }, fill, st);
      return g.polyline([{ x: r.x + r.w - d, y: r.y + d }, { x: r.x + r.w, y: r.y }], st);
    }
    case "component": {
      g.rect(r, fill, st);
      const ix = r.x + r.w - 20, iy = r.y + 6;
      g.rect({ x: ix, y: iy, w: 12, h: 14 }, fill, st);
      g.rect({ x: ix - 3, y: iy + 3, w: 6, h: 3 }, fill, st);
      return g.rect({ x: ix - 3, y: iy + 8, w: 6, h: 3 }, fill, st);
    }
    case "artifact": {
      g.rect(r, fill, st);
      const ix = r.x + r.w - 18, iy = r.y + 6;
      g.polygon([{ x: ix, y: iy }, { x: ix + 7, y: iy }, { x: ix + 11, y: iy + 4 }, { x: ix + 11, y: iy + 14 }, { x: ix, y: iy + 14 }], fill, st);
      return g.polyline([{ x: ix + 7, y: iy }, { x: ix + 7, y: iy + 4 }, { x: ix + 11, y: iy + 4 }], st);
    }
    case "sendSignal":
      return g.polygon([{ x: r.x, y: r.y }, { x: r.x + r.w - 14, y: r.y }, { x: r.x + r.w, y: cy }, { x: r.x + r.w - 14, y: r.y + r.h }, { x: r.x, y: r.y + r.h }], fill, st);
    case "acceptSignal":
      return g.polygon([{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }, { x: r.x + 14, y: cy }], fill, st);
    case "hourglass":
      return g.polygon([{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x, y: r.y + r.h }, { x: r.x + r.w, y: r.y + r.h }], fill, st);
    case "frame":
      return g.rect(r, fill === "transparent" ? null : fill, st);
    case "infoItem": {
      g.rect(r, fill, st);
      const ix = r.x + r.w - 16, iy = r.y + 6;
      return g.polygon([{ x: ix, y: iy }, { x: ix + 10, y: iy + 5 }, { x: ix, y: iy + 10 }], line, null);
    }
    case "database": {
      const e = Math.min(14, r.h / 4);
      g.rect({ x: r.x, y: r.y + e / 2, w: r.w, h: r.h - e }, fill, null);
      g.ellipse({ x: r.x, y: r.y + r.h - e, w: r.w, h: e }, fill, st);
      g.rect({ x: r.x, y: r.y + e / 2, w: r.w, h: r.h - e }, fill, null);
      g.polyline([{ x: r.x, y: r.y + e / 2 }, { x: r.x, y: r.y + r.h - e / 2 }], st);
      g.polyline([{ x: r.x + r.w, y: r.y + e / 2 }, { x: r.x + r.w, y: r.y + r.h - e / 2 }], st);
      return g.ellipse({ x: r.x, y: r.y, w: r.w, h: e }, fill, st);
    }
  }
  void v;
}

/** Point on the border of a shape for edge attachment (ellipses, diamonds). */
export function centerOf(r: Rect): Point {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}
