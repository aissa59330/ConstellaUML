// Relational model (MLD) notation: a table is its name above one row of
// attributes between two rules — primary key underlined, foreign keys
// starred, types in parentheses — and foreign keys are arrows "FK(cols)"
// from the referencing table to the referenced one.
import type { Element } from "../../core/element";
import { contains, withStyle } from "../../render/graphics";
import { type RenderCtx, boundsOf, colors, fontOf, lineHeight, registerViewKind } from "../views";
import { generalLabels, makeEdgeKind } from "../uml/edge-views";
import { columnType } from "./text";

const PAD = 6;
const GAP = 14;

interface Cell {
  name: string;
  type: string;
  pk: boolean;
  fk: boolean;
  w: number;
}

const layouts = new WeakMap<Element, { cells: Cell[]; nameH: number; rowH: number }>();

function cellsOf(v: Element, ctx: RenderCtx): Cell[] {
  const m = ctx.repo.deref(v.model);
  const showTypes = ctx.repo.diagramOf(v)?.showColumnTypes !== false;
  const font = fontOf(v);
  return ((m?.columns ?? []) as Element[]).map((c) => {
    const name = `${c.name ?? ""}${c.foreignKey ? "*" : ""}`;
    const type = showTypes && columnType(c) ? ` (${columnType(c).toLowerCase()})` : "";
    return { name, type, pk: !!c.primaryKey, fk: !!c.foreignKey, w: ctx.measure.width(name, font) + ctx.measure.width(type, font) };
  });
}

registerViewKind("ERDTableView", {
  arrange(v, ctx) {
    const font = fontOf(v);
    const lh = lineHeight(font);
    const cells = cellsOf(v, ctx);
    const m = ctx.repo.deref(v.model);
    const nameH = lh + PAD;
    const rowH = lh + PAD * 2;
    const rowW = cells.reduce((a, c) => a + c.w, 0) + GAP * Math.max(0, cells.length - 1) + PAD * 2;
    v.width = Math.max(v.width ?? 0, Math.ceil(Math.max(rowW, ctx.measure.width(m?.name ?? "", withStyle(font, true)) + PAD * 2, 80)));
    v.height = Math.max(v.height ?? 0, Math.ceil(nameH + rowH));
    layouts.set(v, { cells, nameH, rowH });
  },
  draw(v, ctx) {
    const lay = layouts.get(v);
    if (!lay) return;
    const { g } = ctx;
    const r = boundsOf(v);
    const c = colors(v, ctx);
    const font = fontOf(v);
    const m = ctx.repo.deref(v.model);
    // Transparent background area keeps the table selectable without a box.
    g.rect(r, v.fillColor && v.fillColor !== "$background" ? c.fill : null, null);
    g.text(m?.name ?? "", r.x + PAD, r.y + lay.nameH / 2, withStyle(font, true), c.font, "left");
    const top = r.y + lay.nameH;
    g.polyline([{ x: r.x, y: top }, { x: r.x + r.w, y: top }], { color: c.line });
    g.polyline([{ x: r.x, y: r.y + r.h }, { x: r.x + r.w, y: r.y + r.h }], { color: c.line });
    let x = r.x + PAD;
    const y = top + lay.rowH / 2;
    for (const cell of lay.cells) {
      g.text(cell.name, x, y, font, c.font, "left", cell.pk);
      g.text(cell.type, x + ctx.measure.width(cell.name, font), y, font, c.font, "left");
      x += cell.w + GAP;
    }
  },
  hit(v, p) {
    return contains(boundsOf(v), p) ? v : null;
  },
});

/** "FK(col1, col2)": columns of the referencing table that point to the referenced one. */
export function foreignKeyLabel(e: Element, ctx: RenderCtx): string {
  const child = ctx.repo.deref(ctx.repo.deref(e.tail)?.model);
  const parent = ctx.repo.deref(ctx.repo.deref(e.head)?.model);
  const cols = ((child?.columns ?? []) as Element[]).filter((c) => {
    const target = ctx.repo.deref(c.referenceTo);
    return target && ctx.repo.parentOf(target) === parent;
  });
  const name = ctx.repo.deref(e.model)?.name;
  if (name) return name;
  return cols.length ? `FK(${cols.map((c) => c.name).join(", ")})` : "FK";
}

registerViewKind(
  "ERDForeignKeyView",
  makeEdgeKind(
    () => ({ dashed: false, head: "solidArrow", tail: "none" }),
    (e, ctx) => generalLabels(e, ctx, undefined, foreignKeyLabel(e, ctx)),
  ),
);
