// ERD entity (name band + key/column/type rows) and relationship (crow's foot) views.
import type { Element } from "../../core/element";
import { contains, withStyle } from "../../render/graphics";
import type { EndStyle } from "../edges";
import { type RenderCtx, boundsOf, colors, fontOf, lineHeight, registerViewKind } from "../views";
import { generalLabels, makeEdgeKind } from "../uml/edge-views";
import { columnType, keyMarker } from "./text";

const PAD = 6;
const GUTTER_GAP = 8;

interface EntityLayout {
  headH: number;
  keyW: number;
  nameW: number;
  rows: { key: string; name: string; type: string; nullable: boolean }[];
}

const layouts = new WeakMap<Element, EntityLayout>();

function layoutOf(v: Element, ctx: RenderCtx): EntityLayout {
  const m = ctx.repo.deref(v.model);
  const font = fontOf(v);
  const bold = withStyle(font, true);
  const lh = lineHeight(font);
  const cols = v.suppressColumns ? [] : ((m?.columns ?? []) as Element[]);
  const rows = cols.map((c) => ({ key: keyMarker(c), name: c.name ?? "", type: columnType(c), nullable: !!c.nullable }));
  const keyW = rows.some((r) => r.key) ? ctx.measure.width("PF", bold) + GUTTER_GAP : 0;
  const nameW = Math.max(0, ...rows.map((r) => ctx.measure.width(r.name, font)));
  const typeW = Math.max(0, ...rows.map((r) => ctx.measure.width(r.type, font)));
  const minW = Math.max(ctx.measure.width(m?.name ?? "", bold) + PAD * 2, PAD * 2 + keyW + nameW + (typeW ? GUTTER_GAP * 2 + typeW : 0));
  const headH = lh + PAD * 2;
  v.width = Math.max(v.width ?? 0, Math.ceil(minW), 80);
  v.height = Math.max(v.height ?? 0, Math.ceil(headH + (rows.length ? rows.length * lh + PAD * 2 : 14)));
  const out = { headH, keyW, nameW, rows };
  layouts.set(v, out);
  return out;
}

registerViewKind("ERDEntityView", {
  arrange(v, ctx) {
    layoutOf(v, ctx);
  },
  draw(v, ctx) {
    const lay = layouts.get(v) ?? layoutOf(v, ctx);
    const { g } = ctx;
    const r = boundsOf(v);
    const c = colors(v, ctx);
    const font = fontOf(v);
    const bold = withStyle(font, true);
    const lh = lineHeight(font);
    const m = ctx.repo.deref(v.model);
    g.setShadow(v.showShadow !== false);
    g.rect(r, c.fill, { color: c.line });
    g.setShadow(false);
    g.text(m?.name ?? "", r.x + r.w / 2, r.y + lay.headH / 2, bold, c.font, "center");
    g.polyline([{ x: r.x, y: r.y + lay.headH }, { x: r.x + r.w, y: r.y + lay.headH }], { color: c.line });
    if (lay.keyW) g.polyline([{ x: r.x + PAD + lay.keyW - GUTTER_GAP / 2, y: r.y + lay.headH }, { x: r.x + PAD + lay.keyW - GUTTER_GAP / 2, y: r.y + r.h }], { color: c.line });
    lay.rows.forEach((row, i) => {
      const y = r.y + lay.headH + PAD + i * lh + lh / 2;
      if (row.key) g.text(row.key, r.x + PAD, y, bold, c.font, "left");
      g.text(row.name, r.x + PAD + lay.keyW, y, row.key.startsWith("P") ? bold : font, c.font, "left", row.key.startsWith("P"));
      if (row.type) g.text(row.type, r.x + r.w - PAD, y, withStyle(font, false, row.nullable), c.font, "right");
    });
  },
  hit(v, p) {
    return contains(boundsOf(v), p) ? v : null;
  },
});

const CROW: Record<string, EndStyle> = { "1": "crowOne", "0..1": "crowZeroOne", "1..*": "crowOneMany", "0..*": "crowZeroMany", "*": "crowZeroMany" };

// Identifying relationships are drawn solid, non-identifying ones dashed.
registerViewKind(
  "ERDRelationshipView",
  makeEdgeKind((e, ctx) => {
    const m = ctx.repo.deref(e.model);
    return { dashed: !m?.identifying, tail: CROW[m?.end1?.cardinality ?? "1"] ?? "none", head: CROW[m?.end2?.cardinality ?? "1"] ?? "none" };
  }, (e, ctx) => generalLabels(e, ctx, undefined, ctx.repo.deref(e.model)?.name ?? "")),
);
