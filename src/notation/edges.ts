// Generic edge geometry: routing, endpoint clipping, labels and arrowheads.
import type { Element } from "../core/element";
import { type Graphics, type Point, type Rect, type StrokeStyle, distToSegment } from "../render/graphics";
import { nodeSpec } from "./shapes";
import { type RenderCtx, boundsOf, ensureSub, fontOf, layoutEpoch, lineHeight, setBounds } from "./views";

export const LS_RECTILINEAR = 0;
export const LS_OBLIQUE = 1;
export const LS_ROUNDRECT = 2;
export const LS_CURVE = 3;

export function parsePoints(s: string | undefined): Point[] {
  if (!s) return [];
  return s
    .split(";")
    .map((p) => p.split(":").map(Number))
    .filter((p) => p.length === 2 && p.every(Number.isFinite))
    .map(([x, y]) => ({ x, y }));
}

export function formatPoints(pts: Point[]): string {
  return pts.map((p) => `${Math.round(p.x)}:${Math.round(p.y)}`).join(";");
}

export function center(r: Rect): Point {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

/** Point where the segment from the rect's center towards `to` leaves the rect. */
export function clipToRect(r: Rect, to: Point): Point {
  const c = center(r);
  const dx = to.x - c.x, dy = to.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const sx = dx === 0 ? Infinity : r.w / 2 / Math.abs(dx);
  const sy = dy === 0 ? Infinity : r.h / 2 / Math.abs(dy);
  const s = Math.min(sx, sy);
  return { x: c.x + dx * s, y: c.y + dy * s };
}

/** Orthogonal route between two boxes (straight, L-free Z shapes). */
export function orthogonalRoute(a: Rect, b: Rect): Point[] {
  const ca = center(a), cb = center(b);
  const ox1 = Math.max(a.x, b.x), ox2 = Math.min(a.x + a.w, b.x + b.w);
  const oy1 = Math.max(a.y, b.y), oy2 = Math.min(a.y + a.h, b.y + b.h);
  if (ox2 - ox1 >= 10 && (b.y >= a.y + a.h || a.y >= b.y + b.h)) {
    const x = (ox1 + ox2) / 2;
    return b.y >= a.y + a.h ? [{ x, y: a.y + a.h }, { x, y: b.y }] : [{ x, y: a.y }, { x, y: b.y + b.h }];
  }
  if (oy2 - oy1 >= 10 && (b.x >= a.x + a.w || a.x >= b.x + b.w)) {
    const y = (oy1 + oy2) / 2;
    return b.x >= a.x + a.w ? [{ x: a.x + a.w, y }, { x: b.x, y }] : [{ x: a.x, y }, { x: b.x + b.w, y }];
  }
  const dx = cb.x - ca.x, dy = cb.y - ca.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const x1 = dx > 0 ? a.x + a.w : a.x, x2 = dx > 0 ? b.x : b.x + b.w;
    const mx = (x1 + x2) / 2;
    return [{ x: x1, y: ca.y }, { x: mx, y: ca.y }, { x: mx, y: cb.y }, { x: x2, y: cb.y }];
  }
  const y1 = dy > 0 ? a.y + a.h : a.y, y2 = dy > 0 ? b.y : b.y + b.h;
  const my = (y1 + y2) / 2;
  return [{ x: ca.x, y: y1 }, { x: ca.x, y: my }, { x: cb.x, y: my }, { x: cb.x, y: y2 }];
}

function anchorRect(v: Element | undefined, ctx: RenderCtx): Rect | null {
  if (!v) return null;
  if (v.points !== undefined && v.head) {
    // Edge attached to an edge (e.g. note link to an association): use its midpoint.
    const pts = routeOf(v, ctx);
    const m = pts.length ? pointAt(pts, 0.5) : { x: 0, y: 0 };
    return { x: m.x - 1, y: m.y - 1, w: 2, h: 2 };
  }
  return boundsOf(v);
}

const routes = new WeakMap<Element, { version: number; pts: Point[] }>();

// ---- ports: several rectilinear edges on one side of a node are spread out ----

type Side = "left" | "right" | "top" | "bottom";
const ports = new WeakMap<Element, { version: number; tail?: Point; head?: Point }>();

const isHorizontal = (s: Side) => s === "left" || s === "right";

function sideOf(r: Rect, p: Point): Side {
  const d: [number, Side][] = [
    [Math.abs(p.x - r.x), "left"],
    [Math.abs(p.x - (r.x + r.w)), "right"],
    [Math.abs(p.y - r.y), "top"],
    [Math.abs(p.y - (r.y + r.h)), "bottom"],
  ];
  return d.sort((a, b) => a[0] - b[0])[0][1];
}

const isAuto = (e: Element) => e.lineStyle === LS_RECTILINEAR || e.lineStyle === LS_ROUNDRECT || e.lineStyle === undefined;

/** Computes attachment points so that edges sharing a node side don't overlap. */
/**
 * Spreads the attachment points of rectilinear edges sharing a node side.
 * With `nodes`, only the sides of those nodes are recomputed (each still
 * with every edge attached to it); `edges` must then be all the diagram's edges.
 */
export function assignPorts(edges: Element[], ctx: RenderCtx, nodes?: Set<string>): void {
  interface End {
    edge: Element;
    end: "tail" | "head";
    rect: Rect;
    side: Side;
    other: Point;
  }
  const version = layoutEpoch(ctx.repo);
  const mine = (id: string) => !nodes || nodes.has(id);
  // Forget the ports being recomputed (an edge alone on its side gets none).
  for (const e of edges) {
    const entry = ports.get(e);
    if (!entry) continue;
    if (!nodes || entry.version !== version) ports.delete(e);
    else {
      if (mine(e.tail?.$ref)) delete entry.tail;
      if (mine(e.head?.$ref)) delete entry.head;
    }
  }
  const groups = new Map<string, End[]>();
  const push = (key: string, v: End) => (groups.get(key) ?? groups.set(key, []).get(key)!).push(v);
  for (const e of edges) {
    if (!isAuto(e)) continue;
    const tv = ctx.repo.deref(e.tail), hv = ctx.repo.deref(e.head);
    if (!tv || !hv || tv === hv || tv.points !== undefined || hv.points !== undefined) continue;
    const a = boundsOf(tv), b = boundsOf(hv);
    const nat = orthogonalRoute(a, b);
    if (mine(tv._id)) push(`${tv._id}:${sideOf(a, nat[0])}`, { edge: e, end: "tail", rect: a, side: sideOf(a, nat[0]), other: center(b) });
    if (mine(hv._id)) push(`${hv._id}:${sideOf(b, nat[nat.length - 1])}`, { edge: e, end: "head", rect: b, side: sideOf(b, nat[nat.length - 1]), other: center(a) });
  }
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const h = isHorizontal(list[0].side);
    list.sort((p, q) => (h ? p.other.y - q.other.y : p.other.x - q.other.x));
    list.forEach((it, i) => {
      const t = (i + 1) / (list.length + 1);
      const r = it.rect;
      const pt: Point =
        it.side === "left" ? { x: r.x, y: r.y + r.h * t } : it.side === "right" ? { x: r.x + r.w, y: r.y + r.h * t } : it.side === "top" ? { x: r.x + r.w * t, y: r.y } : { x: r.x + r.w * t, y: r.y + r.h };
      let entry = ports.get(it.edge);
      if (!entry || entry.version !== version) ports.set(it.edge, (entry = { version }));
      entry[it.end] = pt;
    });
  }
}

/** Orthogonal path between two fixed attachment points. */
function orthoBetween(p: Point, sp: Side, q: Point, sq: Side): Point[] {
  if (isHorizontal(sp) && isHorizontal(sq)) {
    if (Math.abs(p.y - q.y) < 1) return [p, q];
    const mx = (p.x + q.x) / 2;
    return [p, { x: mx, y: p.y }, { x: mx, y: q.y }, q];
  }
  if (!isHorizontal(sp) && !isHorizontal(sq)) {
    if (Math.abs(p.x - q.x) < 1) return [p, q];
    const my = (p.y + q.y) / 2;
    return [p, { x: p.x, y: my }, { x: q.x, y: my }, q];
  }
  return isHorizontal(sp) ? [p, { x: q.x, y: p.y }, q] : [p, { x: p.x, y: q.y }, q];
}

/**
 * Recomputes the route of an edge: rectilinear / round-rect edges are routed
 * automatically, oblique / curve edges keep the user's bend points.
 */
export function routeEdge(e: Element, ctx: RenderCtx): Point[] {
  const tail = anchorRect(ctx.repo.deref(e.tail), ctx);
  const head = anchorRect(ctx.repo.deref(e.head), ctx);
  const stored = parsePoints(e.points);
  let pts: Point[];
  if (!tail || !head) {
    pts = stored.length >= 2 ? stored : [];
  } else if (tail === head || sameRect(tail, head)) {
    // Self-association: loop on the top-right corner.
    const r = tail;
    pts = [
      { x: r.x + r.w - 20, y: r.y },
      { x: r.x + r.w - 20, y: r.y - 25 },
      { x: r.x + r.w + 25, y: r.y - 25 },
      { x: r.x + r.w + 25, y: r.y + 20 },
      { x: r.x + r.w, y: r.y + 20 },
    ];
  } else if (isAuto(e)) {
    pts = orthogonalRoute(tail, head);
    const pp = ports.get(e);
    if (pp && pp.version === layoutEpoch(ctx.repo) && (pp.tail || pp.head)) {
      const p = pp.tail ?? pts[0], q = pp.head ?? pts[pts.length - 1];
      pts = orthoBetween(p, sideOf(tail, pts[0]), q, sideOf(head, pts[pts.length - 1]));
    }
  } else {
    const inner = stored.slice(1, -1);
    const first = inner[0] ?? center(head);
    const last = inner[inner.length - 1] ?? center(tail);
    pts = [clipToRect(tail, first), ...inner, clipToRect(head, last)];
  }
  if (pts.length >= 2) {
    const tv = ctx.repo.deref(e.tail), hv = ctx.repo.deref(e.head);
    if (tv && isRound(tv, ctx)) pts[0] = clipToEllipse(boundsOf(tv), pts[1], pts[0]);
    if (hv && isRound(hv, ctx)) pts[pts.length - 1] = clipToEllipse(boundsOf(hv), pts[pts.length - 2], pts[pts.length - 1]);
  }
  e.points = formatPoints(pts);
  routes.set(e, { version: layoutEpoch(ctx.repo), pts });
  return pts;
}

const ROUND_SHAPES = new Set(["ellipse", "dashedEllipse", "circle", "dot", "bullseye", "circleX", "history", "deepHistory", "entryPoint", "exitPoint"]);

function isRound(v: Element, ctx: RenderCtx): boolean {
  const spec = nodeSpec(v._type);
  if (!spec) return false;
  const shape = typeof spec.shape === "function" ? spec.shape(ctx.repo.deref(v.model), v) : spec.shape;
  return ROUND_SHAPES.has(shape);
}

/** First point where the segment outside → end enters the ellipse inscribed in `r`. */
export function clipToEllipse(r: Rect, outside: Point, end: Point): Point {
  const a = r.w / 2, b = r.h / 2;
  if (a <= 0 || b <= 0) return end;
  const cx = r.x + a, cy = r.y + b;
  const x0 = (outside.x - cx) / a, y0 = (outside.y - cy) / b;
  const dx = (end.x - outside.x) / a, dy = (end.y - outside.y) / b;
  const A = dx * dx + dy * dy, B = 2 * (x0 * dx + y0 * dy), C = x0 * x0 + y0 * y0 - 1;
  const disc = B * B - 4 * A * C;
  if (A === 0 || disc < 0) return end;
  const t = (-B - Math.sqrt(disc)) / (2 * A);
  if (t < 0 || t > 1) return end;
  return { x: outside.x + (end.x - outside.x) * t, y: outside.y + (end.y - outside.y) * t };
}

/** Edge types that compute their own route (e.g. sequence messages). */
export const customRouters = new Map<string, (e: Element, ctx: RenderCtx) => Point[]>();

/** Stores a route computed by a notation with its own routing (sequence messages). */
export function setRoute(e: Element, pts: Point[], ctx: RenderCtx): void {
  e.points = formatPoints(pts);
  routes.set(e, { version: layoutEpoch(ctx.repo), pts });
}

export function routeOf(e: Element, ctx: RenderCtx): Point[] {
  const cached = routes.get(e);
  if (cached && cached.version === layoutEpoch(ctx.repo)) return cached.pts;
  if (customRouters.has(e._type)) return customRouters.get(e._type)!(e, ctx);
  return routeEdge(e, ctx);
}

function sameRect(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

export function polylineLength(pts: Point[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return l;
}

/** Point at fraction `t` (0..1) of the polyline length. */
export function pointAt(pts: Point[], t: number): Point {
  const total = polylineLength(pts);
  let target = total * t;
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (target <= seg || i === pts.length - 1) {
      const k = seg === 0 ? 0 : Math.min(1, target / seg);
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * k, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * k };
    }
    target -= seg;
  }
  return pts[0] ?? { x: 0, y: 0 };
}

/**
 * Label anchor and reference direction (radians, y axis pointing up as in the
 * .mdj convention). edgePosition: 0 = head end, 1 = middle, 2 = tail end.
 */
export function labelAnchor(pts: Point[], edgePosition: number): { p: Point; theta: number } {
  if (pts.length < 2) return { p: pts[0] ?? { x: 0, y: 0 }, theta: 0 };
  let a: Point, b: Point, p: Point;
  if (edgePosition === 0) {
    p = pts[pts.length - 1];
    a = p;
    b = pts[pts.length - 2];
  } else if (edgePosition === 2) {
    p = pts[0];
    a = p;
    b = pts[1];
  } else {
    p = pointAt(pts, 0.5);
    a = pts[0];
    b = pts[pts.length - 1];
  }
  return { p, theta: Math.atan2(-(b.y - a.y), b.x - a.x) };
}

export function labelCenter(pts: Point[], label: Element): Point {
  const { p, theta } = labelAnchor(pts, label.edgePosition ?? 1);
  const phi = theta + (label.alpha ?? 0);
  const d = label.distance ?? 0;
  return { x: p.x + d * Math.cos(phi), y: p.y - d * Math.sin(phi) };
}

/** Inverse of labelCenter: alpha/distance that put the label center at `c`. */
export function labelPolar(pts: Point[], edgePosition: number, c: Point): { alpha: number; distance: number } {
  const { p, theta } = labelAnchor(pts, edgePosition);
  const dx = c.x - p.x, dy = -(c.y - p.y);
  return { alpha: Math.atan2(dy, dx) - theta, distance: Math.hypot(dx, dy) };
}

export interface LabelSpec {
  field: string;
  edgePosition: number;
  alpha: number;
  distance: number;
  text: string;
  modelRef?: unknown;
}

/** Ensures label sub-views exist, sets their text and computes their boxes. */
export function arrangeLabels(e: Element, specs: LabelSpec[], ctx: RenderCtx): Element[] {
  const pts = routeOf(e, ctx);
  const font = fontOf(e);
  return specs.map((s) => {
    const lbl = ensureSub(ctx.repo, e, s.field, "EdgeLabelView", {
      model: s.modelRef ?? e.model,
      hostEdge: { $ref: e._id },
      edgePosition: s.edgePosition,
      alpha: s.alpha,
      distance: s.distance,
    });
    lbl.text = s.text;
    lbl.visible = s.text !== "";
    const w = ctx.measure.width(s.text, font);
    const c = labelCenter(pts, lbl);
    setBounds(lbl, { x: c.x - w / 2, y: c.y - lineHeight(font) / 2, w, h: lineHeight(font) });
    return lbl;
  });
}

export function drawLabels(e: Element, labels: Element[], color: string, g: Graphics): void {
  const font = fontOf(e);
  for (const l of labels) {
    if (!l.visible || !l.text) continue;
    g.text(l.text, l.left + l.width / 2, l.top + l.height / 2, font, color, "center", !!l.underline);
  }
}

// ---- arrowheads -----------------------------------------------------------

export type EndStyle =
  | "none"
  | "triangle"
  | "filledTriangle"
  | "open"
  | "solidArrow"
  | "diamond"
  | "filledDiamond"
  | "cross"
  | "circle"
  | "circlePlus"
  // Crow's foot (ERD): exactly one, zero or one, one or many, zero or many.
  | "crowOne"
  | "crowZeroOne"
  | "crowOneMany"
  | "crowZeroMany";

/** Draws a decoration at `tip`, pointing away from `from`. */
export function drawEnd(g: Graphics, style: EndStyle, tip: Point, from: Point, stroke: StrokeStyle, fill: string): void {
  if (style === "none") return;
  const ang = Math.atan2(tip.y - from.y, tip.x - from.x);
  const pt = (d: number, side: number): Point => ({
    x: tip.x - d * Math.cos(ang) + side * Math.sin(ang),
    y: tip.y - d * Math.sin(ang) - side * Math.cos(ang),
  });
  const solid = { ...stroke, dash: [] };
  switch (style) {
    case "triangle":
      g.polygon([tip, pt(14, 7), pt(14, -7)], fill, solid);
      break;
    case "filledTriangle":
      g.polygon([tip, pt(14, 7), pt(14, -7)], stroke.color, solid);
      break;
    case "circlePlus": {
      const c = pt(7, 0);
      g.ellipse({ x: c.x - 7, y: c.y - 7, w: 14, h: 14 }, fill, solid);
      g.polyline([pt(2, 0), pt(12, 0)], solid);
      g.polyline([pt(7, 5), pt(7, -5)], solid);
      break;
    }
    case "open":
      g.polyline([pt(11, 6), tip, pt(11, -6)], solid);
      break;
    case "solidArrow":
      g.polygon([tip, pt(11, 5), pt(11, -5)], stroke.color, solid);
      break;
    case "diamond":
    case "filledDiamond":
      g.polygon([tip, pt(9, 5), pt(18, 0), pt(9, -5)], style === "filledDiamond" ? stroke.color : fill, solid);
      break;
    case "cross":
      g.polyline([pt(8, 5), pt(18, -5)], solid);
      g.polyline([pt(8, -5), pt(18, 5)], solid);
      break;
    case "circle":
      g.ellipse({ x: tip.x - 5, y: tip.y - 5, w: 10, h: 10 }, fill, solid);
      break;
    case "crowOne":
    case "crowZeroOne":
    case "crowOneMany":
    case "crowZeroMany": {
      const many = style === "crowOneMany" || style === "crowZeroMany";
      const zero = style === "crowZeroOne" || style === "crowZeroMany";
      if (many) for (const side of [7, 0, -7]) g.polyline([pt(12, 0), pt(0, side)], solid);
      // Inner mark: a bar for "one"; outer mark: a bar ("exactly") or a circle ("optional").
      g.polyline([pt(many ? 16 : 8, 6), pt(many ? 16 : 8, -6)], solid);
      if (zero) {
        const c = pt(many ? 24 : 18, 0);
        g.ellipse({ x: c.x - 5, y: c.y - 5, w: 10, h: 10 }, fill, solid);
      } else if (!many) g.polyline([pt(14, 6), pt(14, -6)], solid);
      break;
    }
  }
}

export function lineMode(e: Element): "straight" | "rounded" | "curve" {
  return e.lineStyle === LS_ROUNDRECT ? "rounded" : e.lineStyle === LS_CURVE ? "curve" : "straight";
}

export function hitEdge(e: Element, p: Point, tol: number, ctx: RenderCtx): boolean {
  const pts = routeOf(e, ctx);
  for (let i = 1; i < pts.length; i++) if (distToSegment(p, pts[i - 1], pts[i]) <= tol) return true;
  return false;
}
