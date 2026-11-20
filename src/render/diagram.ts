import type { Element } from "../core/element";
import { type RenderCtx, boundsOf, isEdgeView, viewKind } from "../notation/views";
import "../notation/uml";
import { type Theme, resolveColor } from "./colors";
import { type Graphics, type Point, type Rect, type TextMeasurer, union } from "./graphics";
import { SvgGraphics } from "./svg";

/** Top-level views of a diagram split into nodes and edges (draw order). */
export function diagramViews(diagram: Element): { nodes: Element[]; edges: Element[] } {
  const nodes: Element[] = [], edges: Element[] = [];
  for (const v of (diagram.ownedViews ?? []) as Element[]) (isEdgeView(v) ? edges : nodes).push(v);
  return { nodes, edges };
}

/** Lays out every view (nodes first, edges use node bounds). */
export function arrangeDiagram(diagram: Element, ctx: RenderCtx): void {
  const { nodes, edges } = diagramViews(diagram);
  for (const v of nodes) viewKind(v._type)?.arrange?.(v, ctx);
  for (const v of edges) viewKind(v._type)?.arrange?.(v, ctx);
}

export function drawDiagram(diagram: Element, ctx: RenderCtx & { g: Graphics }): void {
  const { nodes, edges } = diagramViews(diagram);
  for (const v of nodes) if (v.visible !== false) viewKind(v._type)?.draw(v, ctx);
  for (const v of edges) if (v.visible !== false) viewKind(v._type)?.draw(v, ctx);
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
    } else rects.push(boundsOf(v));
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
