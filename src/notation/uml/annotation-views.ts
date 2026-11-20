import type { Element } from "../../core/element";
import { contains } from "../../render/graphics";
import { boundsOf, colors, fontOf, lineHeight, registerViewKind, wrapText, type RenderCtx } from "../views";

const PAD = 5;

function textLines(v: Element, ctx: RenderCtx, width: number): string[] {
  const text: string = v.text ?? "";
  return v.wordWrap === false ? text.split("\n") : wrapText(text, width, fontOf(v), ctx.measure);
}

function fitHeight(v: Element, ctx: RenderCtx, inner: number, extra = 0): void {
  const lines = textLines(v, ctx, inner);
  const minH = lines.length * lineHeight(fontOf(v)) + PAD * 2 + extra;
  if ((v.height ?? 0) < minH) v.height = Math.ceil(minH);
  if ((v.width ?? 0) < 20) v.width = 20;
}

const rectHit = (v: Element, p: { x: number; y: number }) => (contains(boundsOf(v), p) ? v : null);

registerViewKind("UMLNoteView", {
  arrange: (v, ctx) => fitHeight(v, ctx, (v.width ?? 0) - PAD * 2 - 10),
  draw(v, ctx) {
    const { g } = ctx;
    const c = colors(v, ctx);
    const r = boundsOf(v);
    const fold = 10;
    g.setShadow(v.showShadow !== false);
    g.polygon(
      [
        { x: r.x, y: r.y },
        { x: r.x + r.w - fold, y: r.y },
        { x: r.x + r.w, y: r.y + fold },
        { x: r.x + r.w, y: r.y + r.h },
        { x: r.x, y: r.y + r.h },
      ],
      c.fill,
      { color: c.line },
    );
    g.setShadow(false);
    g.polyline([{ x: r.x + r.w - fold, y: r.y }, { x: r.x + r.w - fold, y: r.y + fold }, { x: r.x + r.w, y: r.y + fold }], { color: c.line });
    const lh = lineHeight(fontOf(v));
    textLines(v, ctx, r.w - PAD * 2 - 10).forEach((l, i) => g.text(l, r.x + PAD, r.y + PAD + i * lh + lh / 2, fontOf(v), c.font));
  },
  hit: rectHit,
});

registerViewKind("UMLTextView", {
  arrange: (v, ctx) => fitHeight(v, ctx, (v.width ?? 0) - PAD * 2),
  draw(v, ctx) {
    const c = colors(v, ctx);
    const r = boundsOf(v);
    const lh = lineHeight(fontOf(v));
    textLines(v, ctx, r.w - PAD * 2).forEach((l, i) => ctx.g.text(l, r.x + PAD, r.y + PAD + i * lh + lh / 2, fontOf(v), c.font));
  },
  hit: rectHit,
});

function shape(kind: "rect" | "round" | "ellipse") {
  return {
    arrange: (v: Element, ctx: RenderCtx) => fitHeight(v, ctx, (v.width ?? 0) - PAD * 2),
    draw(v: Element, ctx: RenderCtx & { g: NonNullable<RenderCtx["g"]> }) {
      const { g } = ctx;
      const c = colors(v, ctx);
      const r = boundsOf(v);
      g.setShadow(v.showShadow !== false);
      if (kind === "ellipse") g.ellipse(r, c.fill, { color: c.line });
      else g.rect(r, c.fill, { color: c.line }, kind === "round" ? 10 : 0);
      g.setShadow(false);
      const lines = textLines(v, ctx, r.w - PAD * 2);
      const lh = lineHeight(fontOf(v));
      const top = r.y + (r.h - lines.length * lh) / 2;
      lines.forEach((l, i) => g.text(l, r.x + r.w / 2, top + i * lh + lh / 2, fontOf(v), c.font, "center"));
    },
    hit: rectHit,
  };
}

registerViewKind("RectangleView", shape("rect"));
registerViewKind("RoundRectView", shape("round"));
registerViewKind("EllipseView", shape("ellipse"));

registerViewKind("HyperlinkView", {
  arrange(v, ctx) {
    const label = hyperlinkText(v, ctx);
    v.width = Math.max(v.width ?? 0, Math.ceil(ctx.measure.width(label, fontOf(v)) + PAD * 2));
    v.height = Math.max(v.height ?? 0, lineHeight(fontOf(v)) + PAD * 2);
  },
  draw(v, ctx) {
    const r = boundsOf(v);
    const color = ctx.theme === "dark" ? "#70b8ff" : "#0d74ce";
    ctx.g.text(hyperlinkText(v, ctx), r.x + PAD, r.y + r.h / 2, fontOf(v), color, "left", true);
  },
  hit: rectHit,
});

export function hyperlinkText(v: Element, ctx: RenderCtx): string {
  const target = ctx.repo.deref(v.reference);
  if (v.showName && v.name) return v.name;
  return target?.name ?? v.url ?? "(lien)";
}
