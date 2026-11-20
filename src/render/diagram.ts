import type { Element } from "../core/element";
import { assignPorts, routeOf } from "../notation/edges";
import { type RenderCtx, boundsOf, isEdgeView, layoutState, paintedBoundsOf, paintedExtraOf, viewKind } from "../notation/views";
import "../notation/uml";
import { type Theme, resolveColor } from "./colors";
import { type Graphics, type Point, type Rect, type TextMeasurer, intersects, union } from "./graphics";
import { SvgGraphics } from "./svg";

/** Top-level views of a diagram split into nodes and edges (draw order). */
export function diagramViews(diagram: Element): { nodes: Element[]; edges: Element[] } {
  const nodes: Element[] = [], edges: Element[] = [];
  for (const v of (diagram.ownedViews ?? []) as Element[]) (isEdgeView(v) ? edges : nodes).push(v);
  return { nodes, edges };
}

/** Epoch, measurer and theme of each diagram's last full layout. */
const arranged = new WeakMap<Element, { epoch: number; measure: TextMeasurer; theme: Theme }>();

// Views whose layout depends on other views' positions (activations from messages…).
const POSITION_DEPENDENT = /^UML(Seq|Comm|Timing|CombinedFragment|InteractionOperand|StateInvariant|Continuation|Endpoint|Gate|Swimlane)/;

/**
 * Lays out the views of a diagram (nodes first, edges use node bounds). When
 * only the geometry of some views changed since the last layout (drag,
 * resize), only those views and the edges around them are laid out again.
 */
export function arrangeDiagram(diagram: Element, ctx: RenderCtx): void {
  const { nodes, edges } = diagramViews(diagram);
  const st = layoutState(ctx.repo);
  const prev = arranged.get(diagram);
  const repo = ctx.repo;
  const inDiagram = (v: Element) => repo.diagramOf(v) === diagram;
  const moved = [...st.moved].map((id) => repo.get(id)).filter((v): v is Element => !!v && inDiagram(v));
  for (const v of moved) st.moved.delete(v._id);
  const full = !prev || prev.epoch !== st.epoch || prev.measure !== ctx.measure || prev.theme !== ctx.theme || moved.some((v) => POSITION_DEPENDENT.test(v._type));
  if (full) {
    for (const v of nodes) viewKind(v._type)?.arrange?.(v, ctx);
    assignPorts(edges, ctx);
    for (const v of edges) viewKind(v._type)?.arrange?.(v, ctx);
    arranged.set(diagram, { epoch: st.epoch, measure: ctx.measure, theme: ctx.theme });
    return;
  }
  if (!moved.length) return;
  const nodeSet = new Set<Element>();
  const edgeSet = new Set<Element>();
  const addNode = (v: Element) => {
    if (nodeSet.has(v)) return;
    nodeSet.add(v);
    for (const r of (v.containedViews ?? []) as unknown[]) {
      const c = repo.deref(r);
      if (c) addNode(c);
    }
  };
  for (const v of moved) {
    if (v._type === "EdgeLabelView") {
      const host = repo.deref(v.hostEdge);
      if (host) edgeSet.add(host);
    } else if (isEdgeView(v)) edgeSet.add(v);
    else {
      addNode(v);
      for (let c = repo.deref(v.containerView); c; c = repo.deref(c.containerView)) nodeSet.add(c);
    }
  }
  const incident = (id: string | undefined) => (id ? repo.referrers(id).filter((r) => isEdgeView(r) && (r.tail?.$ref === id || r.head?.$ref === id)) : []);
  for (const n of nodeSet) for (const e of incident(n._id)) edgeSet.add(e);
  // Ports are shared per node side: the sides of every node touched by a changed
  // edge are re-spread, and every edge attached to those nodes is re-routed.
  const portNodes = new Set<string>();
  for (const e of edgeSet) for (const id of [e.tail?.$ref, e.head?.$ref]) if (id) portNodes.add(id);
  const reroute = new Set(edgeSet);
  for (const id of portNodes) for (const x of incident(id)) reroute.add(x);
  for (const v of nodes) if (nodeSet.has(v)) viewKind(v._type)?.arrange?.(v, ctx);
  assignPorts(edges, ctx, portNodes);
  for (const v of edges) if (reroute.has(v)) viewKind(v._type)?.arrange?.(v, ctx);
}

/**
 * Draws the diagram. With `clip` (the visible area), views entirely outside
 * it are skipped; containers are kept so their children stay on top.
 */
export function drawDiagram(diagram: Element, ctx: RenderCtx & { g: Graphics }, clip?: Rect): void {
  const { nodes, edges } = diagramViews(diagram);
  const margin = 40; // shadows, labels drawn just outside a view
  const area = clip && { x: clip.x - margin, y: clip.y - margin, w: clip.w + margin * 2, h: clip.h + margin * 2 };
  const nodeVisible = (v: Element) => !area || intersects(area, paintedBoundsOf(v));
  const edgeVisible = (v: Element) => {
    if (!area) return true;
    const pts = routeOf(v, ctx);
    if (!pts.length) return true;
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const minX = Math.min(...xs), minY = Math.min(...ys);
    return intersects(area, { x: minX - margin, y: minY - margin, w: Math.max(...xs) - minX + margin * 2, h: Math.max(...ys) - minY + margin * 2 });
  };
  for (const v of nodes) if (v.visible !== false && nodeVisible(v)) viewKind(v._type)?.draw(v, ctx);
  for (const v of edges) if (v.visible !== false && edgeVisible(v)) viewKind(v._type)?.draw(v, ctx);
}

/** Bounding box of everything drawn (labels included). */
export function diagramBounds(diagram: Element): Rect | null {
  const rects: Rect[] = [];
  for (const v of (diagram.ownedViews ?? []) as Element[]) {
    if (v.visible === false) continue;
    if (isEdgeView(v)) {
      const pts = String(v.points ?? "")
        .split(";")
        .map((p) => p.split(":").map(Number));
      for (const [x, y] of pts) if (Number.isFinite(x) && Number.isFinite(y)) rects.push({ x, y, w: 1, h: 1 });
      for (const l of (v.subViews ?? []) as Element[]) if (l.visible && l.text) rects.push(boundsOf(l));
      const extra = paintedExtraOf(v);
      if (extra) rects.push(extra);
    } else rects.push(paintedBoundsOf(v));
  }
  return union(rects);
}

/** Topmost selectable view under `p` (edges and their labels first). */
export function hitTest(diagram: Element, p: Point, tol: number, ctx: RenderCtx): Element | null {
  const { nodes, edges } = diagramViews(diagram);
  for (let i = edges.length - 1; i >= 0; i--) {
    const v = edges[i];
    if (v.visible === false) continue;
    const h = viewKind(v._type)?.hit?.(v, p, tol, ctx);
    if (h) return h;
  }
  for (let i = nodes.length - 1; i >= 0; i--) {
    const v = nodes[i];
    if (v.visible === false) continue;
    const h = viewKind(v._type)?.hit?.(v, p, tol, ctx);
    if (h) return h;
  }
  return null;
}

export interface ExportOptions {
  theme: Theme;
  margin: number;
  background: boolean;
  scale?: number;
}

export function exportSvg(diagram: Element, ctx: Omit<RenderCtx, "g" | "theme">, opts: ExportOptions, measure: TextMeasurer): string {
  const rc: RenderCtx = { ...ctx, theme: opts.theme, measure };
  arrangeDiagram(diagram, rc);
  const b = diagramBounds(diagram) ?? { x: 0, y: 0, w: 100, h: 100 };
  const g = new SvgGraphics(measure);
  g.translate(opts.margin - b.x, opts.margin - b.y);
  drawDiagram(diagram, { ...rc, g });
  return g.toString(b.w + opts.margin * 2, b.h + opts.margin * 2, opts.background ? resolveColor("$background", opts.theme) : null);
}
