import type { Element } from "../../core/element";
import { contains, type FontSpec, type Graphics, type Point, type Rect, withStyle } from "../../render/graphics";
import {
  type RenderCtx,
  boundsOf,
  colors,
  ensureSub,
  fontOf,
  lineHeight,
  registerViewKind,
  setBounds,
  syncList,
} from "../views";
import { type FeatureFormat, formatAttribute, formatOperation, formatTemplateParameter, stereotypeName, visibilitySymbol } from "./text";

const PAD = 5;
const EMPTY_COMPARTMENT = 10;

const KEYWORD: Record<string, string> = {
  UMLInterface: "interface",
  UMLDataType: "dataType",
  UMLPrimitiveType: "primitive",
  UMLEnumeration: "enumeration",
  UMLSignal: "signal",
  UMLSubsystem: "subsystem",
  UMLModel: "model",
};

interface Line {
  text: string;
  font: FontSpec;
  underline?: boolean;
  view?: Element;
}

interface Box {
  view: Element;
  rect: Rect;
  lines: Line[];
  visible: boolean;
}

/** Computed layout of a classifier view, cached per repository version. */
const layouts = new WeakMap<Element, { version: number; boxes: Box[] }>();

function featureFormat(v: Element): FeatureFormat {
  return {
    showVisibility: v.showVisibility !== false,
    showType: v.showType !== false,
    showMultiplicity: v.showMultiplicity !== false,
    showProperty: v.showProperty !== false,
    showOperationSignature: v.showOperationSignature !== false,
  };
}

function nameLines(v: Element, model: Element | undefined, ctx: RenderCtx, font: FontSpec): Line[] {
  const lines: Line[] = [];
  if (!model) return [{ text: "(élément supprimé)", font: withStyle(font, false, true) }];
  const resolve = (r: unknown) => ctx.repo.deref(r);
  const st = stereotypeName(model.stereotype, resolve);
  const keyword = KEYWORD[model._type];
  if (v.stereotypeDisplay !== "none") {
    if (keyword && st) lines.push({ text: `«${keyword}, ${st}»`, font });
    else if (keyword || st) lines.push({ text: `«${keyword ?? st}»`, font });
  }
  const vis = v.showVisibility !== false && model.visibility && model.visibility !== "public" ? visibilitySymbol(model.visibility) : "";
  lines.push({ text: vis + (model.name ?? ""), font: withStyle(font, true, !!model.isAbstract) });
  if (v.showNamespace) {
    const ns = ctx.repo.parentOf(model);
    if (ns?.name) lines.push({ text: `(from ${ns.name})`, font });
  }
  if (v.showProperty !== false) {
    const props: string[] = [];
    if (model.isLeaf) props.push("leaf");
    if (model.isFinalSpecialization) props.push("final");
    for (const t of (model.tags ?? []) as Element[]) {
      if (t.kind === "hidden") continue;
      const val = t.kind === "boolean" ? String(!!t.checked) : t.kind === "number" ? String(t.number ?? 0) : t.kind === "reference" ? ctx.repo.deref(t.reference)?.name ?? "" : t.value ?? "";
      props.push(val ? `${t.name}=${val}` : t.name);
    }
    if (props.length) lines.push({ text: `{${props.join(", ")}}`, font });
  }
  return lines;
}

function linesHeight(lines: Line[], font: FontSpec): number {
  return lines.length ? lines.length * lineHeight(font) + PAD * 2 : EMPTY_COMPARTMENT;
}

function linesWidth(lines: Line[], ctx: RenderCtx): number {
  return Math.max(0, ...lines.map((l) => ctx.measure.width(l.text, l.font)));
}

/** Lays out compartments and keeps the .mdj sub-view structure in sync. */
function arrangeClassifier(v: Element, ctx: RenderCtx): void {
  const { repo } = ctx;
  const model = repo.deref(v.model);
  const font = fontOf(v);
  const fmt = featureFormat(v);
  const resolve = (r: unknown) => repo.deref(r);
  const isEnum = model?._type === "UMLEnumeration";

  const nameComp = ensureSub(repo, v, "nameCompartment", "UMLNameCompartmentView", { model: v.model });
  for (const f of ["stereotypeLabel", "nameLabel", "namespaceLabel", "propertyLabel"]) ensureSub(repo, nameComp, f, "LabelView");
  const head = nameLines(v, model, ctx, font);
  const nameLabel = repo.deref(nameComp.nameLabel);
  if (nameLabel) nameLabel.text = model?.name ?? "";

  const boxes: Box[] = [{ view: nameComp, rect: { x: 0, y: 0, w: 0, h: 0 }, lines: head, visible: true }];

  const list = (field: string, type: string, models: Element[], fmtLine: (m: Element) => string, visible: boolean, featureType: string) => {
    const comp = ensureSub(repo, v, field, type, { model: v.model });
    const subs = syncList(repo, comp, models, featureType);
    const lines: Line[] = subs.map((sv, i) => {
      const m = models[i];
      const text = fmtLine(m);
      sv.text = text;
      // "Inherit style" off: the line keeps its own font (and color, see draw).
      const own = sv.parentStyle === false ? fontOf(sv) : font;
      return { text, font: withStyle(own, own.bold && sv.parentStyle === false, !!m.isAbstract || (own.italic && sv.parentStyle === false)), underline: !!m.isStatic, view: sv };
    });
    comp.visible = visible;
    boxes.push({ view: comp, rect: { x: 0, y: 0, w: 0, h: 0 }, lines, visible });
  };

  if (isEnum) {
    list("enumerationLiteralCompartment", "UMLEnumerationLiteralCompartmentView", model?.literals ?? [], (l) => l.name ?? "", !v.suppressLiterals, "UMLEnumerationLiteralView");
  }
  list("attributeCompartment", "UMLAttributeCompartmentView", model?.attributes ?? [], (a) => formatAttribute(a, resolve, fmt), !v.suppressAttributes, "UMLAttributeView");
  list("operationCompartment", "UMLOperationCompartmentView", model?.operations ?? [], (o) => formatOperation(o, resolve, fmt), !v.suppressOperations, "UMLOperationView");
  const receptions: Element[] = model?.receptions ?? [];
  list(
    "receptionCompartment",
    "UMLReceptionCompartmentView",
    receptions,
    (r) => `«signal» ${fmt.showVisibility ? visibilitySymbol(r.visibility) : ""}${r.name ?? ""}`,
    !v.suppressReceptions && receptions.length > 0,
    "UMLReceptionView",
  );
  const tparams: Element[] = model?.templateParameters ?? [];
  const tcomp = ensureSub(repo, v, "templateParameterCompartment", "UMLTemplateParameterCompartmentView", { model: v.model });
  syncList(repo, tcomp, tparams, "UMLTemplateParameterView").forEach((sv, i) => (sv.text = formatTemplateParameter(tparams[i])));
  tcomp.visible = tparams.length > 0;

  // Size: grow to fit content, never shrink below what the user set.
  const shown = boxes.filter((b) => b.visible);
  const minW = Math.max(40, ...shown.map((b) => linesWidth(b.lines, ctx) + PAD * 2 + 4));
  const heights = shown.map((b, i) => (i === 0 ? Math.max(linesHeight(b.lines, font), lineHeight(font) + PAD * 2) : linesHeight(b.lines, font)));
  const minH = heights.reduce((a, b) => a + b, 0);
  if (v.autoResize) {
    v.width = Math.ceil(minW);
    v.height = Math.ceil(minH);
  } else {
    if ((v.width ?? 0) < minW) v.width = Math.ceil(minW);
    if ((v.height ?? 0) < minH) v.height = Math.ceil(minH);
  }
  let y = v.top;
  shown.forEach((b, i) => {
    const h = i === shown.length - 1 ? v.top + v.height - y : heights[i];
    b.rect = { x: v.left, y, w: v.width, h };
    setBounds(b.view, b.rect);
    b.lines.forEach((l, j) => {
      if (l.view) setBounds(l.view, { x: v.left + PAD, y: y + PAD + j * lineHeight(font), w: v.width - PAD * 2, h: lineHeight(font) });
    });
    y += h;
  });
  for (const b of boxes) if (!b.visible) setBounds(b.view, { x: v.left, y: v.top, w: 0, h: 0 });
  layouts.set(v, { version: ctx.repo.version, boxes: shown });
}

function drawClassifier(v: Element, ctx: RenderCtx & { g: Graphics }): void {
  const g = ctx.g;
  const layout = layouts.get(v);
  if (!layout) return;
  const c = colors(v, ctx);
  const font = fontOf(v);
  const r = boundsOf(v);
  g.setShadow(v.showShadow !== false);
  g.rect(r, c.fill, { color: c.line });
  g.setShadow(false);
  layout.boxes.forEach((b, i) => {
    if (i > 0) g.polyline([{ x: r.x, y: b.rect.y }, { x: r.x + r.w, y: b.rect.y }], { color: c.line });
    const lh = lineHeight(font);
    b.lines.forEach((l, j) => {
      const cy = b.rect.y + PAD + j * lh + lh / 2;
      const color = l.view && l.view.parentStyle === false ? colors(l.view, ctx).font : c.font;
      if (i === 0) g.text(l.text, r.x + r.w / 2, cy, l.font, color, "center", l.underline);
      else g.text(l.text, r.x + PAD, cy, l.font, color, "left", l.underline);
    });
  });
}


function hitClassifier(v: Element, p: Point): Element | null {
  if (!contains(boundsOf(v), p)) return null;
  const layout = layouts.get(v);
  for (const b of layout?.boxes ?? []) for (const l of b.lines) if (l.view && contains(boundsOf(l.view), p)) return l.view;
  return v;
}

for (const t of ["UMLClassView", "UMLInterfaceView", "UMLSignalView", "UMLDataTypeView", "UMLPrimitiveTypeView", "UMLEnumerationView"]) {
  registerViewKind(t, { arrange: arrangeClassifier, draw: drawClassifier, hit: hitClassifier });
}

// ---- interface as a lollipop ("icon" stereotype display) ------------------

registerViewKind("UMLInterfaceView", {
  arrange(v, ctx) {
    if (v.stereotypeDisplay === "icon" || v.stereotypeDisplay === "icon-label") {
      const model = ctx.repo.deref(v.model);
      const font = withStyle(fontOf(v), true);
      const w = Math.max(24, ctx.measure.width(model?.name ?? "", font) + 4);
      v.width = Math.ceil(w);
      v.height = 24 + lineHeight(font) + 2;
      layouts.set(v, { version: ctx.repo.version, boxes: [] });
      return;
    }
    arrangeClassifier(v, ctx);
  },
  draw(v, ctx) {
    if (v.stereotypeDisplay === "icon" || v.stereotypeDisplay === "icon-label") {
      const c = colors(v, ctx);
      const r = boundsOf(v);
      const model = ctx.repo.deref(v.model);
      ctx.g.ellipse({ x: r.x + r.w / 2 - 10, y: r.y + 2, w: 20, h: 20 }, c.fill, { color: c.line, width: 1.2 });
      ctx.g.text(model?.name ?? "", r.x + r.w / 2, r.y + 24 + lineHeight(fontOf(v)) / 2, withStyle(fontOf(v), true), c.font, "center");
      return;
    }
    drawClassifier(v, ctx);
  },
  hit: (v, p) => (contains(boundsOf(v), p) ? hitClassifier(v, p) ?? v : null),
});

// ---- packages -------------------------------------------------------------

const TAB_H = 15;

registerViewKind("UMLPackageView", {
  arrange(v, ctx) {
    const model = ctx.repo.deref(v.model);
    const font = fontOf(v);
    const nameComp = ensureSub(ctx.repo, v, "nameCompartment", "UMLNameCompartmentView", { model: v.model });
    for (const f of ["stereotypeLabel", "nameLabel", "namespaceLabel", "propertyLabel"]) ensureSub(ctx.repo, nameComp, f, "LabelView");
    const lines = nameLines(v, model, ctx, font);
    const minW = Math.max(60, linesWidth(lines, ctx) + PAD * 4);
    const minH = TAB_H + linesHeight(lines, font) + 10;
    if ((v.width ?? 0) < minW) v.width = Math.ceil(minW);
    if ((v.height ?? 0) < minH) v.height = Math.ceil(minH);
    setBounds(nameComp, { x: v.left, y: v.top + TAB_H, w: v.width, h: linesHeight(lines, font) });
    layouts.set(v, { version: ctx.repo.version, boxes: [{ view: nameComp, rect: boundsOf(nameComp), lines, visible: true }] });
  },
  draw(v, ctx) {
    const g = ctx.g;
    const c = colors(v, ctx);
    const r = boundsOf(v);
    const tabW = Math.min(r.w * 0.4, 60);
    g.setShadow(v.showShadow !== false);
    g.rect({ x: r.x, y: r.y, w: tabW, h: TAB_H }, c.fill, { color: c.line });
    g.rect({ x: r.x, y: r.y + TAB_H, w: r.w, h: r.h - TAB_H }, c.fill, { color: c.line });
    g.setShadow(false);
    const model = ctx.repo.deref(v.model);
    if (model?._type === "UMLModel") g.polygon([{ x: r.x + r.w - 18, y: r.y + TAB_H + 14 }, { x: r.x + r.w - 12, y: r.y + TAB_H + 4 }, { x: r.x + r.w - 6, y: r.y + TAB_H + 14 }], null, { color: c.line });
    const layout = layouts.get(v);
    const lines = layout?.boxes[0]?.lines ?? [];
    const font = fontOf(v);
    const lh = lineHeight(font);
    const top = r.y + TAB_H + (r.h - TAB_H - lines.length * lh) / 2;
    lines.forEach((l, j) => g.text(l.text, r.x + r.w / 2, top + j * lh + lh / 2, l.font, c.font, "center"));
  },
  hit: (v, p) => (contains(boundsOf(v), p) ? v : null),
});
