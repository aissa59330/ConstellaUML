import type { Element } from "../../core/element";
import { contains } from "../../render/graphics";
import { type EndStyle, type LabelSpec, arrangeLabels, drawEnd, drawLabels, hitEdge, lineMode, routeEdge, routeOf } from "../edges";
import { type RenderCtx, boundsOf, colors, registerViewKind } from "../views";
import { stereotypeName, visibilitySymbol } from "./text";

const labelCache = new WeakMap<Element, Element[]>();

function generalLabels(e: Element, ctx: RenderCtx): LabelSpec[] {
  const model = ctx.repo.deref(e.model);
  const st = model ? stereotypeName(model.stereotype, (r) => ctx.repo.deref(r)) : "";
  const vis = model && e.showVisibility !== false && model.name ? visibilitySymbol(model.visibility) : "";
  return [
    { field: "nameLabel", edgePosition: 1, alpha: Math.PI / 2, distance: 15, text: model?.name ? vis + model.name : "" },
    { field: "stereotypeLabel", edgePosition: 1, alpha: Math.PI / 2, distance: 30, text: st && e.stereotypeDisplay !== "none" ? `«${st}»` : "" },
    { field: "propertyLabel", edgePosition: 1, alpha: -Math.PI / 2, distance: 15, text: "" },
  ];
}

interface EdgeStyle {
  dashed: boolean;
  head: EndStyle;
  tail: EndStyle;
}

function hit(e: Element, p: { x: number; y: number }, tol: number, ctx: RenderCtx): Element | null {
  for (const l of labelCache.get(e) ?? []) if (l.visible && l.text && contains(boundsOf(l), p)) return l;
  return hitEdge(e, p, tol, ctx) ? e : null;
}

function makeEdgeKind(style: (e: Element, ctx: RenderCtx) => EdgeStyle, labels: (e: Element, ctx: RenderCtx) => LabelSpec[] = generalLabels) {
  return {
    isEdge: true,
    arrange(e: Element, ctx: RenderCtx) {
      routeEdge(e, ctx);
      labelCache.set(e, arrangeLabels(e, labels(e, ctx), ctx));
    },
    draw(e: Element, ctx: RenderCtx & { g: NonNullable<RenderCtx["g"]> }) {
      const pts = routeOf(e, ctx);
      if (pts.length < 2) return;
      const c = colors(e, ctx);
      const s = style(e, ctx);
      const stroke = { color: c.line, width: 1, dash: s.dashed ? [6, 4] : [] };
      ctx.g.polyline(pts, stroke, lineMode(e));
      drawEnd(ctx.g, s.head, pts[pts.length - 1], pts[pts.length - 2], stroke, c.fill);
      drawEnd(ctx.g, s.tail, pts[0], pts[1], stroke, c.fill);
      drawLabels(e, labelCache.get(e) ?? [], c.font, ctx.g);
    },
    hit,
  };
}

registerViewKind("UMLGeneralizationView", makeEdgeKind(() => ({ dashed: false, head: "triangle", tail: "none" })));
registerViewKind("UMLInterfaceRealizationView", makeEdgeKind(() => ({ dashed: true, head: "triangle", tail: "none" })));
registerViewKind("UMLRealizationView", makeEdgeKind(() => ({ dashed: true, head: "triangle", tail: "none" })));
registerViewKind("UMLDependencyView", makeEdgeKind(() => ({ dashed: true, head: "open", tail: "none" })));

function endDecoration(end: Element | undefined, other: Element | undefined): EndStyle {
  if (!end) return "none";
  if (end.aggregation === "composite") return "filledDiamond";
  if (end.aggregation === "shared") return "diamond";
  // Arrow only when navigability is one-sided (both navigable = plain line).
  if (end.navigable !== false && other?.navigable === false) return "open";
  return "none";
}

function endLabels(prefix: "tail" | "head", end: Element | undefined, e: Element): LabelSpec[] {
  const pos = prefix === "tail" ? 2 : 0;
  const sign = prefix === "tail" ? 1 : -1;
  const props: string[] = [];
  if (end?.isReadOnly) props.push("readOnly");
  if (end?.isOrdered) props.push("ordered");
  if (end?.isUnique) props.push("unique");
  const showVis = e.showVisibility !== false;
  return [
    { field: `${prefix}RoleNameLabel`, edgePosition: pos, alpha: sign * (Math.PI / 6), distance: 30, text: end?.name ? (showVis ? visibilitySymbol(end.visibility) : "") + end.name : "", modelRef: end ? { $ref: end._id } : undefined },
    { field: `${prefix}PropertyLabel`, edgePosition: pos, alpha: sign * (Math.PI / 4), distance: 40, text: e.showProperty !== false && props.length ? `{${props.join(", ")}}` : "", modelRef: end ? { $ref: end._id } : undefined },
    { field: `${prefix}MultiplicityLabel`, edgePosition: pos, alpha: -sign * (Math.PI / 6), distance: 25, text: e.showMultiplicity !== false ? end?.multiplicity ?? "" : "", modelRef: end ? { $ref: end._id } : undefined },
  ];
}

registerViewKind(
  "UMLAssociationView",
  makeEdgeKind(
    (e, ctx) => {
      const m = ctx.repo.deref(e.model);
      return { dashed: false, tail: endDecoration(m?.end1, m?.end2), head: endDecoration(m?.end2, m?.end1) };
    },
    (e, ctx) => {
      const m = ctx.repo.deref(e.model);
      return [...generalLabels(e, ctx), ...endLabels("tail", m?.end1, e), ...endLabels("head", m?.end2, e)];
    },
  ),
);

registerViewKind("UMLNoteLinkView", makeEdgeKind(() => ({ dashed: true, head: "none", tail: "none" }), () => []));
registerViewKind("FreelineEdgeView", makeEdgeKind(() => ({ dashed: false, head: "none", tail: "none" }), () => []));
