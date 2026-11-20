// Query tree notation: relations in plain boxes, operators as rounded tags
// (SQL keyword or algebra symbol) with their expression written beside them.
import type { Element } from "../../core/element";
import { RA_SYMBOLS } from "../../core/meta/ra.meta";
import { contains, withStyle } from "../../render/graphics";
import { type RenderCtx, boundsOf, colors, fontOf, lineHeight, registerViewKind, setPaintedBounds } from "../views";
import { makeEdgeKind } from "../uml/edge-views";

const PAD_X = 10;
const PAD_Y = 6;

const relationText = (m: Element | undefined) => (m ? `${m.name ?? ""}${m.alias ? ` ${m.alias}` : ""}` : "");

registerViewKind("RARelationView", {
  arrange(v, ctx) {
    const font = fontOf(v);
    v.width = Math.max(v.width ?? 0, Math.ceil(ctx.measure.width(relationText(ctx.repo.deref(v.model)), font) + PAD_X * 2), 50);
    v.height = Math.max(v.height ?? 0, Math.ceil(lineHeight(font) + PAD_Y * 2));
  },
  draw(v, ctx) {
    const r = boundsOf(v);
    const c = colors(v, ctx);
    ctx.g.rect(r, c.fill, { color: c.line });
    ctx.g.text(relationText(ctx.repo.deref(v.model)), r.x + r.w / 2, r.y + r.h / 2, fontOf(v), c.font, "center");
  },
  hit: (v, p) => (contains(boundsOf(v), p) ? v : null),
});

/** Keyword shown in the tag: "WHERE", or "σ" in algebra notation. */
export function operatorLabel(m: Element | undefined, diagram: Element | undefined): string {
  const op = m?.operator ?? "WHERE";
  return diagram?.notation === "algebra" ? RA_SYMBOLS[op] ?? op : op;
}

function tagLayout(v: Element, ctx: RenderCtx) {
  const m = ctx.repo.deref(v.model);
  const font = fontOf(v);
  const bold = withStyle(font, true);
  const label = operatorLabel(m, ctx.repo.diagramOf(v));
  const expr = String(m?.expression ?? "");
  return { label, expr, font, bold, labelW: ctx.measure.width(label, bold), exprW: ctx.measure.width(expr, font) };
}

registerViewKind("RAOperatorView", {
  arrange(v, ctx) {
    const l = tagLayout(v, ctx);
    const h = Math.ceil(lineHeight(l.font) + PAD_Y * 2);
    // The view is the tag only, so flows attach to it; the expression is painted to its right.
    v.width = Math.ceil(l.labelW + PAD_X * 2);
    v.height = h;
    setPaintedBounds(v, { x: v.left, y: v.top, w: v.width + (l.expr ? 8 + l.exprW : 0), h });
  },
  draw(v, ctx) {
    const l = tagLayout(v, ctx);
    const r = boundsOf(v);
    const c = colors(v, ctx);
    ctx.g.rect(r, c.fill, { color: c.line, width: 1.5 }, r.h / 2);
    ctx.g.text(l.label, r.x + r.w / 2, r.y + r.h / 2, l.bold, c.font, "center");
    if (l.expr) ctx.g.text(l.expr, r.x + r.w + 8, r.y + r.h / 2, l.font, c.font, "left");
  },
  hit(v, p, _tol, ctx) {
    const r = boundsOf(v);
    const l = tagLayout(v, ctx);
    return contains({ ...r, w: r.w + (l.expr ? 8 + l.exprW : 0) }, p) ? v : null;
  },
});

registerViewKind("RAFlowView", makeEdgeKind(() => ({ dashed: false, head: "solidArrow", tail: "none" }), () => []));
