// High-level modeling commands. Each produces exactly one undoable operation.
import { type Element, cloneWithNewIds, isElement, ref, walk } from "../../core/element";
import { create, uniqueName } from "../../core/factory";
import { meta } from "../../core/meta/registry";
import type { Repository, Transaction } from "../../core/repository";
import { formatPoints, parsePoints } from "../edges";
import type { Rect } from "../../render/graphics";
import { type EdgeTool, type NodeTool, VIEW_FOR_MODEL } from "./toolbox";
import { ParseError, parseAttribute, parseName, parseOperation } from "./text";

export class CommandError extends Error {}

/** Namespace receiving model elements created in `diagram`. */
export function namespaceOf(repo: Repository, diagram: Element): Element {
  return repo.parentOf(diagram) ?? repo.root!;
}

function viewDefaults(viewType: string): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  if (viewType === "UMLInterfaceView") d.suppressAttributes = false;
  return d;
}

export function createNode(repo: Repository, diagram: Element, tool: NodeTool, rect: Rect): Element {
  return repo.transact(`Create ${tool.id}`, (tx) => {
    let model: Element | undefined;
    if (tool.modelType) {
      const owner = namespaceOf(repo, diagram);
      const field = meta.containerField(owner._type, tool.modelType) ?? "ownedElements";
      model = create(tool.modelType, { name: uniqueName(tool.baseName ?? "Element", owner[field]), ...tool.init });
      tx.insert(owner, field, model);
    }
    const view = create(tool.viewType, {
      ...(model ? { model: ref(model) } : {}),
      left: Math.round(rect.x),
      top: Math.round(rect.y),
      width: Math.round(Math.max(rect.w, 20)),
      height: Math.round(Math.max(rect.h, 20)),
      ...viewDefaults(tool.viewType),
      ...tool.viewInit,
    });
    tx.insert(diagram, "ownedViews", view);
    return view;
  });
}

/** Free-standing text created by double-clicking the diagram background. */
export function createText(repo: Repository, diagram: Element, x: number, y: number, text = ""): Element {
  return repo.transact("Create text", (tx) => tx.insert(diagram, "ownedViews", create("UMLTextView", { left: Math.round(x), top: Math.round(y), width: 120, height: 25, text })));
}

const isClassifier = (m?: Element) => !!m && meta.isKindOf(m._type, "UMLClassifier");

/** Whether `tool` may connect `tail` → `head`; returns an explanation if not. */
export function canConnect(repo: Repository, tool: EdgeTool, tail: Element, head: Element): string | null {
  if (tool.id === "freeline") return null;
  if (tool.id === "noteLink") {
    return tail._type === "UMLNoteView" || head._type === "UMLNoteView" ? null : "Un lien de note doit partir ou arriver sur une note.";
  }
  const tm = repo.deref(tail.model), hm = repo.deref(head.model);
  if (!tm || !hm) return "Ce lien relie deux éléments du modèle.";
  switch (tool.id) {
    case "generalization":
      if (!isClassifier(tm) || !isClassifier(hm)) return "La généralisation relie deux classificateurs.";
      if (tm === hm) return "Un élément ne peut pas hériter de lui-même.";
      return null;
    case "interfaceRealization":
      if (!isClassifier(tm) || hm._type !== "UMLInterface") return "La réalisation d'interface va d'un classificateur vers une interface.";
      return null;
    case "dependency":
    case "realization":
      return null;
    default:
      return isClassifier(tm) && isClassifier(hm) ? null : "L'association relie deux classificateurs.";
  }
}

export function createEdge(repo: Repository, diagram: Element, tool: EdgeTool, tail: Element, head: Element, points?: string): Element {
  const reason = canConnect(repo, tool, tail, head);
  if (reason) throw new CommandError(reason);
  return repo.transact(`Create ${tool.id}`, (tx) => {
    let model: Element | undefined;
    if (tool.modelType) {
      const tm = repo.deref(tail.model)!, hm = repo.deref(head.model)!;
      // Relationships are owned by their source (as in .mdj files).
      const owner = meta.containerField(tm._type, tool.modelType) ? tm : namespaceOf(repo, diagram);
      if (tool.modelType === "UMLAssociation") {
        model = create("UMLAssociation");
        const end1 = create("UMLAssociationEnd", { reference: ref(tm), _parent: ref(model) });
        const end2 = create("UMLAssociationEnd", { reference: ref(hm), _parent: ref(model) });
        if (tool.variant === "directed") end1.navigable = false;
        if (tool.variant === "aggregation") end1.aggregation = "shared";
        if (tool.variant === "composition") end1.aggregation = "composite";
        model.end1 = end1;
        model.end2 = end2;
      } else {
        model = create(tool.modelType, { source: ref(tm), target: ref(hm) });
      }
      tx.insert(owner, "ownedElements", model);
    }
    const view = create(tool.viewType, {
      ...(model ? { model: ref(model) } : {}),
      tail: ref(tail),
      head: ref(head),
      lineStyle: tool.id === "noteLink" || tool.id === "freeline" ? 1 : 0,
      points: points ?? "",
    });
    tx.insert(diagram, "ownedViews", view);
    return view;
  });
}

/** Creates a view of an existing model element (drag from the explorer). */
export function addViewOfModel(repo: Repository, diagram: Element, model: Element, x: number, y: number): Element | null {
  const viewType = VIEW_FOR_MODEL[model._type];
  if (!viewType) return null;
  if (meta.isKindOf(viewType, "EdgeView")) {
    const [a, b] = model._type === "UMLAssociation" ? [model.end1?.reference, model.end2?.reference] : [model.source, model.target];
    const views: Element[] = diagram.ownedViews ?? [];
    const tail = views.find((v) => v.model?.$ref === a?.$ref && !meta.isKindOf(v._type, "EdgeView"));
    const head = views.find((v) => v.model?.$ref === b?.$ref && !meta.isKindOf(v._type, "EdgeView"));
    if (!tail || !head) throw new CommandError("Les deux extrémités doivent déjà être présentes dans le diagramme.");
    return repo.transact("Add view", (tx) => tx.insert(diagram, "ownedViews", create(viewType, { model: ref(model), tail: ref(tail), head: ref(head), lineStyle: 0 })));
  }
  return repo.transact("Add view", (tx) => {
    const view = create(viewType, { model: ref(model), left: Math.round(x), top: Math.round(y), width: 120, height: 60, ...viewDefaults(viewType) });
    tx.insert(diagram, "ownedViews", view);
    // Also show existing relationships to elements already in the diagram.
    for (const rel of repo.relationshipsOf(model._id)) {
      const relViewType = VIEW_FOR_MODEL[rel._type];
      if (!relViewType || (diagram.ownedViews as Element[]).some((v) => v.model?.$ref === rel._id)) continue;
      const [a, b] = rel._type === "UMLAssociation" ? [rel.end1?.reference?.$ref, rel.end2?.reference?.$ref] : [rel.source?.$ref, rel.target?.$ref];
      const find = (id: string) => (diagram.ownedViews as Element[]).find((v) => v.model?.$ref === id && !meta.isKindOf(v._type, "EdgeView"));
      const tail = find(a), head = find(b);
      if (tail && head) tx.insert(diagram, "ownedViews", create(relViewType, { model: ref(rel), tail: ref(tail), head: ref(head), lineStyle: 0 }));
    }
    return view;
  });
}

// ---- deletion -------------------------------------------------------------

const isFeatureView = (v: Element) => meta.isKindOf(v._type, "UMLFeatureView");
const isLabel = (v: Element) => v._type === "EdgeLabelView";

/** Top-level views of a diagram that depend on `views` (attached edges, recursively). */
function closeOverEdges(repo: Repository, views: Set<Element>): Set<Element> {
  let grew = true;
  while (grew) {
    grew = false;
    for (const v of views) {
      for (const r of repo.referrers(v._id)) {
        if (meta.isKindOf(r._type, "EdgeView") && (r.head?.$ref === v._id || r.tail?.$ref === v._id) && !views.has(r)) {
          views.add(r);
          grew = true;
        }
      }
    }
  }
  return views;
}

/** Delete (Suppr): removes views only; feature lines delete their feature. */
export function deleteViews(repo: Repository, selection: Element[]): void {
  const features = selection.filter(isFeatureView).map((v) => repo.deref(v.model)).filter((m): m is Element => !!m);
  const top = new Set(selection.filter((v) => !isFeatureView(v) && !isLabel(v) && repo.diagramOf(v)?.ownedViews?.includes(v)));
  if (top.size === 0 && features.length === 0) return;
  repo.transact("Delete", (tx) => {
    for (const f of features) if (repo.get(f._id)) tx.remove(f);
    for (const v of closeOverEdges(repo, top)) if (repo.get(v._id)) tx.remove(v);
  });
}

/** Delete from model (Ctrl+Suppr): models, their relationships and all their views. */
export function deleteFromModel(repo: Repository, selection: Element[]): void {
  const models = new Set<Element>();
  for (const s of selection) {
    if (meta.isKindOf(s._type, "View")) {
      const m = repo.deref(s.model);
      if (m) models.add(m);
    } else if (s !== repo.root) models.add(s);
  }
  if (models.size === 0) return deleteViews(repo, selection);
  // Relationships attached to deleted elements go too.
  for (const m of [...models]) for (const e of walk(m)) for (const rel of repo.relationshipsOf(e._id)) models.add(rel);
  const doomedIds = new Set<string>();
  for (const m of models) for (const e of walk(m)) doomedIds.add(e._id);
  const views = new Set<Element>();
  for (const id of doomedIds) for (const v of repo.viewsOf(id)) {
    const d = repo.diagramOf(v);
    // Only top-level views; sub-views disappear with their owner.
    if (d && d.ownedViews?.includes(v) && !doomedIds.has(d._id)) views.add(v);
  }
  closeOverEdges(repo, views);
  // Skip models nested inside other doomed models.
  const roots = [...models].filter((m) => {
    let p = repo.parentOf(m);
    while (p) {
      if (models.has(p)) return false;
      p = repo.parentOf(p);
    }
    return true;
  });
  repo.transact("Delete from model", (tx) => {
    for (const v of views) if (repo.get(v._id)) tx.remove(v);
    for (const m of roots) if (repo.get(m._id)) tx.remove(m);
  });
}

// ---- features & quick edit ------------------------------------------------

function applyCommon(tx: Transaction, el: Element, p: { stereotype?: string; visibility?: string; name: string }): void {
  tx.set(el, "name", p.name);
  if (p.visibility) tx.set(el, "visibility", p.visibility);
  if (p.stereotype !== undefined) tx.set(el, "stereotype", p.stereotype || undefined);
}

export function renameElement(repo: Repository, el: Element, expression: string): void {
  const p = parseName(expression);
  if (!p.name) throw new ParseError("Nom vide");
  repo.transact("Rename", (tx) => applyCommon(tx, el, p));
}

export function editAttribute(repo: Repository, attr: Element, expression: string): void {
  const p = parseAttribute(expression);
  repo.transact("Edit attribute", (tx) => writeAttribute(tx, attr, p));
}

function writeAttribute(tx: Transaction, attr: Element, p: ReturnType<typeof parseAttribute>): void {
  applyCommon(tx, attr, p);
  tx.set(attr, "type", p.type ?? "");
  tx.set(attr, "multiplicity", p.multiplicity ?? "");
  tx.set(attr, "defaultValue", p.defaultValue ?? "");
  if (attr._type === "UMLAttribute") tx.set(attr, "isDerived", !!p.isDerived);
}

export function editOperation(repo: Repository, op: Element, expression: string): void {
  const p = parseOperation(expression);
  repo.transact("Edit operation", (tx) => writeOperation(tx, op, p));
}

function writeOperation(tx: Transaction, op: Element, p: ReturnType<typeof parseOperation>): void {
  applyCommon(tx, op, p);
  const existing: Element[] = [...(op.parameters ?? [])];
  const wanted = [...(p.parameters ?? []).map((x) => ({ ...x, direction: x.direction ?? "in" }))];
  const ret = existing.find((x) => x.direction === "return");
  const inputs = existing.filter((x) => x.direction !== "return");
  wanted.forEach((w, i) => {
    let par = inputs[i];
    if (!par) {
      par = create("UMLParameter");
      tx.insert(op, "parameters", par, ret ? op.parameters.indexOf(ret) : undefined);
    }
    tx.set(par, "name", w.name);
    tx.set(par, "type", w.type ?? "");
    tx.set(par, "direction", w.direction);
    tx.set(par, "multiplicity", w.multiplicity ?? "");
    tx.set(par, "defaultValue", w.defaultValue ?? "");
  });
  for (const extra of inputs.slice(wanted.length)) tx.remove(extra);
  if (p.returnType) {
    const r = ret ?? tx.insert(op, "parameters", create("UMLParameter", { direction: "return" }));
    tx.set(r, "type", p.returnType);
  } else if (ret && p.parameters !== undefined) tx.remove(ret);
}

export type FeatureKind = "attributes" | "operations" | "literals" | "receptions";

const FEATURE_TYPE: Record<FeatureKind, string> = {
  attributes: "UMLAttribute",
  operations: "UMLOperation",
  literals: "UMLEnumerationLiteral",
  receptions: "UMLReception",
};

const FEATURE_BASE: Record<FeatureKind, string> = { attributes: "attribute", operations: "operation", literals: "literal", receptions: "reception" };

/** Adds a feature (optionally parsed from quick-edit text) after `afterIndex`. */
export function addFeature(repo: Repository, owner: Element, kind: FeatureKind, expression?: string, afterIndex?: number): Element {
  return repo.transact(`Add ${kind}`, (tx) => {
    const list: Element[] = owner[kind] ?? [];
    const el = create(FEATURE_TYPE[kind], { name: uniqueName(FEATURE_BASE[kind], list) });
    tx.insert(owner, kind, el, afterIndex === undefined ? undefined : afterIndex + 1);
    if (expression?.trim()) {
      if (kind === "attributes") writeAttribute(tx, el, parseAttribute(expression));
      else if (kind === "operations") writeOperation(tx, el, parseOperation(expression));
      else applyCommon(tx, el, parseName(expression));
    }
    return el;
  });
}

/** Moves an element up/down among its siblings (Ctrl+Shift+↑/↓). */
export function moveInParent(repo: Repository, el: Element, delta: -1 | 1): boolean {
  const owner = repo.parentOf(el);
  if (!owner) return false;
  for (const key in owner) {
    const arr = owner[key];
    if (!Array.isArray(arr)) continue;
    const i = arr.indexOf(el);
    if (i < 0) continue;
    const j = i + delta;
    if (j < 0 || j >= arr.length) return false;
    repo.transact("Move", (tx) => tx.move(el, owner, key, j));
    return true;
  }
  return false;
}

/** Re-parents a model element (explorer drag & drop). */
export function moveToOwner(repo: Repository, el: Element, newOwner: Element): void {
  if (el === newOwner) throw new CommandError("Impossible de déplacer un élément dans lui-même.");
  for (const e of walk(el)) if (e === newOwner) throw new CommandError("Impossible de déplacer un élément dans l'un de ses descendants.");
  const field = meta.containerField(newOwner._type, el._type);
  if (!field) throw new CommandError(`${newOwner.name ?? newOwner._type} ne peut pas contenir ${el._type}.`);
  repo.transact("Move", (tx) => tx.move(el, newOwner, field));
}

export function addModelElement(repo: Repository, owner: Element, type: string): Element {
  const field = meta.containerField(owner._type, type) ?? (meta.isKindOf(type, "Diagram") ? "ownedElements" : undefined);
  if (!field) throw new CommandError(`${owner.name ?? owner._type} ne peut pas contenir ${type}.`);
  return repo.transact(`Add ${type}`, (tx) => {
    const base = type.replace(/^UML/, "");
    return tx.insert(owner, field, create(type, { name: uniqueName(base, owner[field]) }));
  });
}

export function addDiagram(repo: Repository, owner: Element, type = "UMLClassDiagram"): Element {
  return repo.transact("Add diagram", (tx) => {
    const base = type.replace(/^UML/, "");
    return tx.insert(owner, "ownedElements", create(type, { name: uniqueName(base, owner.ownedElements) }));
  });
}

// ---- geometry ---------------------------------------------------------------

/** Moves node views (and bend points of edges whose both ends move). */
export function moveViews(repo: Repository, views: Element[], dx: number, dy: number, mergeKey?: string): void {
  if (dx === 0 && dy === 0) return;
  const nodes = views.filter((v) => meta.isKindOf(v._type, "NodeView") && v._type !== "EdgeLabelView");
  const ids = new Set(nodes.map((n) => n._id));
  repo.transact(
    "Move",
    (tx) => {
      for (const n of nodes) {
        tx.set(n, "left", Math.round(n.left + dx));
        tx.set(n, "top", Math.round(n.top + dy));
      }
      const edges = new Set<Element>();
      for (const n of nodes) for (const r of repo.referrers(n._id)) if (meta.isKindOf(r._type, "EdgeView")) edges.add(r);
      for (const e of views) if (meta.isKindOf(e._type, "EdgeView")) edges.add(e);
      for (const e of edges) {
        const both = ids.has(e.head?.$ref) && ids.has(e.tail?.$ref);
        if (!both && !views.includes(e)) continue;
        const pts = parsePoints(e.points).map((p) => ({ x: p.x + dx, y: p.y + dy }));
        tx.set(e, "points", formatPoints(pts));
      }
    },
    mergeKey,
  );
}

export function resizeView(repo: Repository, view: Element, r: Rect, mergeKey?: string): void {
  repo.transact(
    "Resize",
    (tx) => {
      tx.set(view, "left", Math.round(r.x));
      tx.set(view, "top", Math.round(r.y));
      tx.set(view, "width", Math.round(Math.max(10, r.w)));
      tx.set(view, "height", Math.round(Math.max(10, r.h)));
      if (view.autoResize) tx.set(view, "autoResize", false);
    },
    mergeKey,
  );
}

/** Sets a style/format field on several views at once. */
export function setViewField(repo: Repository, views: Element[], field: string, value: unknown, name = "Format"): void {
  repo.transact(name, (tx) => {
    for (const v of views) tx.set(v, field, value);
  });
}

export function setField(repo: Repository, el: Element, field: string, value: unknown): void {
  repo.transact(`Set ${field}`, (tx) => tx.set(el, field, value));
}

// ---- clipboard ------------------------------------------------------------------

export interface ViewClipboard {
  kind: "views";
  views: Element[];
}

export interface ModelClipboard {
  kind: "model";
  element: Element;
}

/** Copies top-level views (edges only if both ends are copied). */
export function copyViews(repo: Repository, selection: Element[]): ViewClipboard | null {
  const top = selection.filter((v) => repo.diagramOf(v)?.ownedViews?.includes(v));
  const ids = new Set(top.map((v) => v._id));
  const keep = top.filter((v) => !meta.isKindOf(v._type, "EdgeView") || (ids.has(v.head?.$ref) && ids.has(v.tail?.$ref)) || (!v.head && !v.tail));
  if (!keep.length) return null;
  return { kind: "views", views: keep.map((v) => JSON.parse(JSON.stringify(v))) };
}

/**
 * Pastes views into `diagram`. Views keep pointing at the same model elements
 * (another view of the same model), as long as those still exist.
 */
export function pasteViews(repo: Repository, diagram: Element, clip: ViewClipboard, offset: number): Element[] {
  const idMap = new Map<string, string>();
  const clones = clip.views
    .filter((v) => !v.model || repo.deref(v.model))
    .map((v) => {
      const c = cloneWithNewIds({ ...v, _parent: undefined } as Element);
      idMap.set(v._id, c._id);
      return c;
    });
  if (!clones.length) return [];
  return repo.transact("Paste", (tx) => {
    for (const c of clones) {
      delete c._parent;
      if (c.head) c.head = { $ref: idMap.get(c.head.$ref) ?? c.head.$ref };
      if (c.tail) c.tail = { $ref: idMap.get(c.tail.$ref) ?? c.tail.$ref };
      if (meta.isKindOf(c._type, "NodeView")) {
        c.left += offset;
        c.top += offset;
      } else if (c.points) {
        c.points = formatPoints(parsePoints(c.points).map((p) => ({ x: p.x + offset, y: p.y + offset })));
      }
      // Derived sub-views are rebuilt on layout.
      c.subViews = [];
      tx.insert(diagram, "ownedViews", c);
    }
    return clones;
  });
}

export function copyModel(el: Element): ModelClipboard {
  return { kind: "model", element: JSON.parse(JSON.stringify(el)) };
}

/** Pastes a deep copy of a model element (fresh ids) under `owner`. */
export function pasteModel(repo: Repository, owner: Element, clip: ModelClipboard): Element {
  const field = meta.containerField(owner._type, clip.element._type) ?? (meta.isKindOf(clip.element._type, "Diagram") ? "ownedElements" : undefined);
  if (!field) throw new CommandError(`${owner.name ?? owner._type} ne peut pas contenir cet élément.`);
  const copy = cloneWithNewIds(clip.element);
  delete copy._parent;
  for (const e of walk(copy)) for (const k in e) if (isElement(e[k])) e[k]._parent = ref(e);
  return repo.transact("Paste", (tx) => tx.insert(owner, field, copy));
}
