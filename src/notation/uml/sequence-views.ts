// Interaction notations: sequence (lifelines, messages, activations, combined
// fragments), communication and timing diagrams.
import type { Element } from "../../core/element";
import { contains, type Point, type Rect, union, withStyle } from "../../render/graphics";
import { distToSegment } from "../../render/graphics";
import { arrangeLabels, customRouters, drawEnd, drawLabels, routeOf, setRoute } from "../edges";
import { registerShapeView } from "../shapes";
import { type RenderCtx, boundsOf, colors, fontOf, lineHeight, registerViewKind, setBounds, setPaintedBounds, syncList } from "../views";
import { generalLabels } from "./edge-views";
import { typeName } from "./text";

export const HEAD_H = 40;
const ACT_W = 10;

function lifelineName(m: Element | undefined, ctx: RenderCtx): string {
  if (!m) return "";
  const rep = ctx.repo.deref(m.represent);
  const type = rep ? typeName(rep.type, (r) => ctx.repo.deref(r)) : "";
  const name = `${m.name ?? ""}${m.selector ? `[${m.selector}]` : ""}`;
  return type ? `${name} : ${type}` : name;
}

/** Messages of the diagram, sorted top to bottom. */
function messagesOf(diagram: Element | undefined): Element[] {
  return ((diagram?.ownedViews ?? []) as Element[]).filter((v) => v._type === "UMLSeqMessageView").sort((a, b) => msgY(a) - msgY(b));
}

function msgY(v: Element): number {
  const first = String(v.points ?? "").split(";")[0]?.split(":")[1];
  return Number(first) || 0;
}

/** Activation bars on a lifeline: [start, end] intervals. */
function activations(lifeline: Element, ctx: RenderCtx): [number, number][] {
  const msgs = messagesOf(ctx.repo.diagramOf(lifeline));
  const out: [number, number][] = [];
  for (const m of msgs) {
    if (m.head?.$ref !== lifeline._id) continue;
    const model = ctx.repo.deref(m.model);
    if (!model || model.messageSort === "reply" || model.messageSort === "createMessage" || model.messageSort === "deleteMessage") continue;
    const y = msgY(m);
    const reply = msgs.find((r) => msgY(r) > y && r.tail?.$ref === lifeline._id && ctx.repo.deref(r.model)?.messageSort === "reply");
    // Nested calls from this lifeline extend the activation until their own returns.
    const outgoing = msgs.filter((r) => msgY(r) > y && r.tail?.$ref === lifeline._id && (!reply || msgY(r) < msgY(reply)));
    const end = reply ? msgY(reply) : outgoing.length ? msgY(outgoing[outgoing.length - 1]) + 12 : y + 30;
    out.push([y, end]);
  }
  return out;
}

function activeAt(lifeline: Element, y: number, ctx: RenderCtx): boolean {
  return activations(lifeline, ctx).some(([a, b]) => y >= a - 0.5 && y <= b + 0.5);
}

// ---- lifeline ---------------------------------------------------------------------

registerViewKind("UMLSeqLifelineView", {
  arrange(v, ctx) {
    const m = ctx.repo.deref(v.model);
    const font = withStyle(fontOf(v), false);
    v.width = Math.max(v.width ?? 0, Math.ceil(ctx.measure.width(lifelineName(m, ctx), font) + 20), 80);
    const lowest = Math.max(0, ...messagesOf(ctx.repo.diagramOf(v)).map(msgY));
    v.height = Math.max(v.height ?? 0, 200, Math.ceil(lowest - v.top + 40));
  },
  draw(v, ctx) {
    const { g } = ctx;
    const c = colors(v, ctx);
    const r = boundsOf(v);
    const m = ctx.repo.deref(v.model);
    const cx = r.x + r.w / 2;
    g.polyline([{ x: cx, y: r.y + HEAD_H }, { x: cx, y: r.y + r.h }], { color: c.line, dash: [6, 4] });
    g.setShadow(v.showShadow !== false);
    g.rect({ x: r.x, y: r.y, w: r.w, h: HEAD_H }, c.fill, { color: c.line });
    g.setShadow(false);
    g.text(lifelineName(m, ctx), cx, r.y + HEAD_H / 2, fontOf(v), c.font, "center", false);
    for (const [a, b] of activations(v, ctx)) g.rect({ x: cx - ACT_W / 2, y: a, w: ACT_W, h: Math.max(8, b - a) }, c.fill, { color: c.line });
    // Destroyed lifeline: X at its end.
    const destroyed = messagesOf(ctx.repo.diagramOf(v)).find((x) => x.head?.$ref === v._id && ctx.repo.deref(x.model)?.messageSort === "deleteMessage");
    if (destroyed) {
      const y = msgY(destroyed);
      g.polyline([{ x: cx - 9, y: y - 9 }, { x: cx + 9, y: y + 9 }], { color: c.line, width: 2 });
      g.polyline([{ x: cx + 9, y: y - 9 }, { x: cx - 9, y: y + 9 }], { color: c.line, width: 2 });
    }
  },
  hit(v, p) {
    const r = boundsOf(v);
    if (contains({ x: r.x, y: r.y, w: r.w, h: HEAD_H }, p)) return v;
    return Math.abs(p.x - (r.x + r.w / 2)) <= 7 && p.y >= r.y && p.y <= r.y + r.h ? v : null;
  },
});

// ---- messages -----------------------------------------------------------------------

const labelCache = new WeakMap<Element, Element[]>();

function messageRoute(e: Element, ctx: RenderCtx): Point[] {
  const tail = ctx.repo.deref(e.tail), head = ctx.repo.deref(e.head);
  const model = ctx.repo.deref(e.model);
  const y0 = msgY(e);
  if (!tail || !head) return [];
  const tr = boundsOf(tail), hr = boundsOf(head);
  const tcx = tr.x + tr.w / 2, hcx = hr.x + hr.w / 2;
  const y = Math.max(y0, tr.y + HEAD_H + 10);
  let pts: Point[];
  if (tail === head) {
    const x = tcx + (activeAt(tail, y, ctx) ? ACT_W / 2 : 0);
    pts = [{ x, y }, { x: x + 36, y }, { x: x + 36, y: y + 18 }, { x: x + (ACT_W / 2), y: y + 18 }];
  } else {
    const dir = hcx > tcx ? 1 : -1;
    const tx = tcx + (activeAt(tail, y, ctx) ? (dir * ACT_W) / 2 : 0);
    let hx = hcx - (activeAt(head, y + 1, ctx) ? (dir * ACT_W) / 2 : 0);
    if (model?.messageSort === "createMessage") hx = dir > 0 ? hr.x : hr.x + hr.w;
    pts = [{ x: tx, y }, { x: hx, y }];
  }
  setRoute(e, pts, ctx);
  return pts;
}
customRouters.set("UMLSeqMessageView", messageRoute);

export function messageText(m: Element | undefined, index: number, ctx: RenderCtx): string {
  if (!m) return "";
  const op = ctx.repo.deref(m.signature);
  const name = op?.name ?? m.name ?? "";
  const args = m.arguments ? `(${m.arguments})` : m.messageSort === "reply" || m.messageSort === "createMessage" || m.messageSort === "deleteMessage" || !name ? "" : "()";
  const assign = m.assignmentTarget ? `${m.assignmentTarget} = ` : "";
  const guard = m.guard ? `[${m.guard}] ` : "";
  return `${index}: ${guard}${assign}${name}${args}`;
}

registerViewKind("UMLSeqMessageView", {
  isEdge: true,
  arrange(e, ctx) {
    messageRoute(e, ctx);
    const msgs = messagesOf(ctx.repo.diagramOf(e));
    const m = ctx.repo.deref(e.model);
    const kw = m?.messageSort === "createMessage" ? "create" : m?.messageSort === "deleteMessage" ? "destroy" : undefined;
    const specs = generalLabels(e, ctx, kw, messageText(m, msgs.indexOf(e) + 1, ctx)).map((s) => ({ ...s, distance: s.field === "nameLabel" ? 10 : s.distance }));
    labelCache.set(e, arrangeLabels(e, specs, ctx));
  },
  draw(e, ctx) {
    const pts = routeOf(e, ctx);
    if (pts.length < 2) return;
    const m = ctx.repo.deref(e.model);
    const c = colors(e, ctx);
    const sort = m?.messageSort ?? "synchCall";
    const dashed = sort === "reply" || sort === "createMessage";
    const stroke = { color: c.line, dash: dashed ? [6, 4] : [] };
    ctx.g.polyline(pts, stroke);
    drawEnd(ctx.g, sort === "synchCall" ? "solidArrow" : "open", pts[pts.length - 1], pts[pts.length - 2], stroke, c.fill);
    drawLabels(e, labelCache.get(e) ?? [], c.font, ctx.g);
  },
  hit(e, p, tol, ctx) {
    for (const l of labelCache.get(e) ?? []) if (l.visible && l.text && contains(boundsOf(l), p)) return l;
    const pts = routeOf(e, ctx);
    for (let i = 1; i < pts.length; i++) if (distToSegment(p, pts[i - 1], pts[i]) <= tol) return e;
    return null;
  },
});

// ---- combined fragments ---------------------------------------------------------------

const operandRects = new WeakMap<Element, Rect>();

registerViewKind("UMLCombinedFragmentView", {
  arrange(v, ctx) {
    const m = ctx.repo.deref(v.model);
    const operands: Element[] = m?.operands ?? [];
    v.width = Math.max(v.width ?? 0, 120);
    v.height = Math.max(v.height ?? 0, 30 + operands.length * 30);
    const subs = syncList(ctx.repo, v, operands, "UMLInteractionOperandView");
    const top = v.top + 24;
    const h = (v.top + v.height - top) / Math.max(1, subs.length);
    subs.forEach((sv, i) => {
      const r = { x: v.left, y: top + i * h, w: v.width, h };
      setBounds(sv, r);
      operandRects.set(sv, r);
    });
  },
  draw(v, ctx) {
    const { g } = ctx;
    const c = colors(v, ctx);
    const r = boundsOf(v);
    const m = ctx.repo.deref(v.model);
    const font = fontOf(v);
    const lh = lineHeight(font);
    g.rect(r, null, { color: c.line });
    const op = m?.interactionOperator ?? "alt";
    const w = g.width(op, withStyle(font, true)) + 22;
    g.polygon(
      [
        { x: r.x, y: r.y },
        { x: r.x + w, y: r.y },
        { x: r.x + w, y: r.y + lh },
        { x: r.x + w - 8, y: r.y + lh + 8 },
        { x: r.x, y: r.y + lh + 8 },
      ],
      c.fill,
      { color: c.line },
    );
    g.text(op, r.x + 6, r.y + (lh + 8) / 2, withStyle(font, true), c.font);
    ((v.subViews ?? []) as Element[]).forEach((sv, i) => {
      const or = operandRects.get(sv) ?? boundsOf(sv);
      if (i > 0) g.polyline([{ x: or.x, y: or.y }, { x: or.x + or.w, y: or.y }], { color: c.line, dash: [6, 4] });
      const opm = ctx.repo.deref(sv.model);
      if (opm?.guard) g.text(`[${opm.guard}]`, or.x + (i === 0 ? w + 8 : 8), or.y + (i === 0 ? -6 : lh / 2 + 4), font, c.font);
    });
  },
  hit(v, p) {
    const r = boundsOf(v);
    if (!contains(r, p)) return null;
    // Only the frame, label and operand headers are "solid": lifelines stay clickable inside.
    const nearEdge = p.x - r.x < 6 || r.x + r.w - p.x < 6 || p.y - r.y < 26 || r.y + r.h - p.y < 6;
    for (const sv of (v.subViews ?? []) as Element[]) {
      const or = operandRects.get(sv);
      if (or && p.y >= or.y && p.y <= or.y + 18 && p.x - r.x < 160) return sv;
    }
    return nearEdge ? v : null;
  },
});

registerShapeView("UMLStateInvariantView", { shape: "pill", bold: false, nameText: (m) => `{${m?.invariant || m?.name || ""}}`, min: [80, 28] });
registerShapeView("UMLContinuationView", { shape: "pill", bold: false, min: [90, 30] });
registerShapeView("UMLEndpointView", { shape: "dot", name: "none", fixed: [10, 10] });
registerShapeView("UMLGateView", { shape: "dot", name: "none", fixed: [8, 8] });

// ---- communication ----------------------------------------------------------------------

registerShapeView("UMLCommLifelineView", { shape: "rect", bold: false, nameText: (m, _v, ctx) => lifelineName(m, ctx), min: [100, 40] });

/** Communication messages are drawn along their connector, numbered in interaction order. */
export function commMessagesOn(connectorView: Element, ctx: RenderCtx): { m: Element; index: number; forward: boolean }[] {
  const conn = ctx.repo.deref(connectorView.model);
  if (!conn) return [];
  const interaction = ctx.repo.parentOf(conn);
  const all: Element[] = interaction?.messages ?? [];
  const tailModel = ctx.repo.deref(connectorView.tail)?.model?.$ref;
  return all
    .map((m, i) => ({ m, index: i + 1 }))
    .filter(({ m }) => m.connector?.$ref === conn._id)
    .map(({ m, index }) => ({ m, index, forward: m.source?.$ref === tailModel }));
}

/** Arrow and label placement of the communication messages carried by a connector. */
function commLabels(e: Element, pts: Point[], ctx: RenderCtx) {
  if (pts.length < 2) return [];
  const a = pts[0], b = pts[pts.length - 1];
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
  const nx = -uy, ny = ux;
  const font = fontOf(e);
  const lh = lineHeight(font);
  // Mostly horizontal connectors: text centred under the arrow; otherwise beside it.
  const horizontal = Math.abs(ux) >= Math.abs(uy);
  return commMessagesOn(e, ctx).map(({ m, index, forward }, i) => {
    const off = 12 + i * (horizontal ? lh * 2.4 : lh);
    const arrow = { x: mid.x + nx * off, y: mid.y + ny * off };
    const d = forward ? 1 : -1;
    const p1 = { x: arrow.x - ux * 12 * d, y: arrow.y - uy * 12 * d }, p2 = { x: arrow.x + ux * 12 * d, y: arrow.y + uy * 12 * d };
    const text = messageText(m, index, ctx);
    const w = ctx.measure.width(text, font);
    const base = horizontal ? { x: arrow.x, y: arrow.y + Math.sign(ny || 1) * lh * 1.2 } : arrow;
    return { m, base, p1, p2, text, w, tx: horizontal ? arrow.x - w / 2 : arrow.x + 16 };
  });
}

registerViewKind("UMLConnectorView", {
  isEdge: true,
  arrange(e, ctx) {
    const pts = routeOf(e, ctx);
    const items = commLabels(e, pts, ctx);
    const lh = lineHeight(fontOf(e));
    const rects = items.flatMap((it) => [
      { x: it.tx, y: it.base.y - lh / 2, w: it.w, h: lh },
      { x: Math.min(it.p1.x, it.p2.x) - 6, y: Math.min(it.p1.y, it.p2.y) - 6, w: Math.abs(it.p2.x - it.p1.x) + 12, h: Math.abs(it.p2.y - it.p1.y) + 12 },
    ]);
    if (rects.length) setPaintedBounds(e, union(rects)!);
  },
  draw(e, ctx) {
    const pts = routeOf(e, ctx);
    if (pts.length < 2) return;
    const c = colors(e, ctx);
    ctx.g.polyline(pts, { color: c.line });
    const font = fontOf(e);
    for (const { m, base, p1, p2, text, tx } of commLabels(e, pts, ctx)) {
      ctx.g.polyline([p1, p2], { color: c.line });
      drawEnd(ctx.g, m.messageSort === "synchCall" ? "solidArrow" : "open", p2, p1, { color: c.line }, c.fill);
      ctx.g.text(text, tx, base.y, font, c.font, "left");
    }
  },
  hit(e, p, tol, ctx) {
    const pts = routeOf(e, ctx);
    for (let i = 1; i < pts.length; i++) if (distToSegment(p, pts[i - 1], pts[i]) <= tol) return e;
    return null;
  },
});

// ---- timing ---------------------------------------------------------------------------------

/** "state@time; state@time" → sorted points. */
export function parseTimeline(text: string): { state: string; t: number }[] {
  return String(text ?? "")
    .split(/[;\n]/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const [state, t] = p.split("@");
      return { state: state.trim(), t: Number(t) };
    })
    .filter((x) => x.state && Number.isFinite(x.t))
    .sort((a, b) => a.t - b.t);
}

registerViewKind("UMLTimingLifelineView", {
  arrange(v, ctx) {
    const m = ctx.repo.deref(v.model);
    const states = String(m?.timingStates ?? "").split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
    v.width = Math.max(v.width ?? 0, 360);
    v.height = Math.max(v.height ?? 0, 40 + Math.max(2, states.length) * 22);
  },
  draw(v, ctx) {
    const { g } = ctx;
    const c = colors(v, ctx);
    const r = boundsOf(v);
    const m = ctx.repo.deref(v.model);
    const font = fontOf(v);
    const states = String(m?.timingStates ?? "").split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
    const timeline = parseTimeline(m?.timeline ?? "");
    const nameW = Math.max(28, g.width(m?.name ?? "", withStyle(font, true)) + 14), labelW = Math.max(60, ...states.map((s) => g.width(s, font) + 12));
    g.rect(r, c.fill, { color: c.line });
    g.polyline([{ x: r.x + nameW, y: r.y }, { x: r.x + nameW, y: r.y + r.h }], { color: c.line });
    g.polyline([{ x: r.x + nameW + labelW, y: r.y }, { x: r.x + nameW + labelW, y: r.y + r.h - 20 }], { color: c.line, dash: [3, 3] });
    g.save();
    g.translate(r.x + nameW / 2, r.y + r.h / 2);
    g.text(m?.name ?? "", 0, 0, withStyle(font, true), c.font, "center");
    g.restore();
    const plotX = r.x + nameW + labelW + 8, plotW = r.w - nameW - labelW - 16;
    const rowH = (r.h - 30) / Math.max(1, states.length);
    const yOf = (s: string) => r.y + 8 + rowH * (Math.max(0, states.indexOf(s)) + 0.5);
    states.forEach((s) => g.text(s, r.x + nameW + 6, yOf(s), font, c.font));
    const maxT = Math.max(10, ...timeline.map((p) => p.t));
    const xOf = (t: number) => plotX + (t / maxT) * plotW;
    const axisY = r.y + r.h - 16;
    g.polyline([{ x: plotX, y: axisY }, { x: plotX + plotW, y: axisY }], { color: c.line });
    const step = maxT <= 20 ? 1 : maxT <= 100 ? 10 : Math.pow(10, Math.floor(Math.log10(maxT)) - 0);
    for (let t = 0; t <= maxT + 1e-9; t += step) {
      g.polyline([{ x: xOf(t), y: axisY }, { x: xOf(t), y: axisY + 4 }], { color: c.line });
      if (step >= 1 && (t / step) % (maxT / step > 20 ? 5 : 1) === 0) g.text(String(t), xOf(t), axisY + 9, { ...font, size: Math.max(9, font.size - 3) }, c.font, "center");
    }
    if (timeline.length) {
      const pts: Point[] = [];
      timeline.forEach((p, i) => {
        const y = yOf(p.state);
        if (i > 0) pts.push({ x: xOf(p.t), y: pts[pts.length - 1].y });
        pts.push({ x: xOf(p.t), y });
      });
      pts.push({ x: plotX + plotW, y: pts[pts.length - 1].y });
      g.polyline(pts, { color: c.line, width: 2 });
    }
  },
  hit: (v, p) => (contains(boundsOf(v), p) ? v : null),
});
