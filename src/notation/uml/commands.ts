// High-level modeling commands. Each produces exactly one undoable operation.
import { type Element, cloneWithNewIds, isElement, ref, walk } from "../../core/element";
import { create, uniqueName } from "../../core/factory";
import { meta } from "../../core/meta/registry";
import type { Repository, Transaction } from "../../core/repository";
import { formatPoints, parsePoints } from "../edges";
import type { Rect } from "../../render/graphics";
import { type EdgeTool, type NodeTool, viewTypeFor } from "./toolbox";
import { RA_OPERATORS, RA_SYMBOLS } from "../../core/meta/ra.meta";
import { formatColumn, parseColumn } from "../erd/text";
import { ParseError, parseAttribute, parseFlow, parseMessage, parseName, parseOperation, parseTransition } from "./text";

export class CommandError extends Error {}

/** Namespace receiving model elements created in `diagram`. */
export function namespaceOf(repo: Repository, diagram: Element): Element {
  return repo.parentOf(diagram) ?? repo.root!;
}

/**
 * Where a new model element of `type` goes: the container's model when it can
 * hold it, else the diagram's namespace (state machines put vertices and
 * transitions in their first region).
 */
export function ownerFor(repo: Repository, tx: Transaction, diagram: Element, type: string, preferred?: Element): [Element, string] {
  if (preferred) {
    let target = preferred;
    if (meta.isKindOf(target._type, "UMLState") && (meta.isKindOf(type, "UMLVertex") || type === "UMLTransition")) target = regionOf(tx, target);
    const f = meta.containerField(target._type, type);
    if (f && !(f === "ownedElements" && meta.isKindOf(type, "UMLActivityNode"))) return [target, f];
  }
  let ns = namespaceOf(repo, diagram);
  if (ns._type === "UMLStateMachine" && (meta.isKindOf(type, "UMLVertex") || type === "UMLTransition")) ns = regionOf(tx, ns);
  return [ns, meta.containerField(ns._type, type) ?? "ownedElements"];
}

/** First region of a state machine / composite state (created on demand). */
function regionOf(tx: Transaction, owner: Element): Element {
  const existing = (owner.regions ?? [])[0];
  if (existing) return existing;
  return tx.insert(owner, "regions", create("UMLRegion"));
}

function viewDefaults(viewType: string): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  if (viewType === "UMLInterfaceView") d.suppressAttributes = false;
  return d;
}

export function createNode(repo: Repository, diagram: Element, tool: NodeTool, rect: Rect, container?: Element): Element {
  return repo.transact(`Create ${tool.id}`, (tx) => {
    let model: Element | undefined;
    if (tool.modelType) {
      const [owner, field] = ownerFor(repo, tx, diagram, tool.modelType, container ? repo.deref(container.model) : undefined);
      const nameless = meta.isKindOf(tool.modelType, "UMLControlNode") || tool.modelType === "UMLPseudostate" || tool.modelType === "UMLFinalState";
      model = create(tool.modelType, { ...(nameless ? {} : { name: uniqueName(tool.baseName ?? "Element", owner[field]) }), ...tool.init });
      if (tool.modelType === "UMLCombinedFragment") model.operands = [create("UMLInteractionOperand", { _parent: ref(model), guard: "" })];
      if (tool.modelType === "UMLLifeline" && diagram._type === "UMLTimingDiagram" && !model.timingStates) Object.assign(model, { timingStates: "Actif, Inactif", timeline: "Inactif@0; Actif@10; Inactif@30" });
      tx.insert(owner, field, model);
    }
    const view = create(tool.viewType, {
      ...(model ? { model: ref(model) } : {}),
      left: Math.round(rect.x),
      top: Math.round(rect.y),
      width: Math.round(Math.max(rect.w, 4)),
      height: Math.round(Math.max(rect.h, 4)),
      ...viewDefaults(tool.viewType),
      ...tool.viewInit,
    });
    if (container) {
      view.containerView = ref(container);
      tx.set(container, "containedViews", [...(container.containedViews ?? []), ref(view)]);
    }
    tx.insert(diagram, "ownedViews", view);
    return view;
  });
}

/** Views nested in `v` (recursively), e.g. use cases inside a subject. */
export function containedViewsOf(repo: Repository, v: Element): Element[] {
  const out: Element[] = [];
  const visit = (x: Element) => {
    for (const r of (x.containedViews ?? []) as { $ref: string }[]) {
      const c = repo.get(r.$ref);
      if (c && !out.includes(c)) {
        out.push(c);
        visit(c);
      }
    }
  };
  visit(v);
  return out;
}

/** Re-parents a view into another container view (or out of any). */
export function setContainer(repo: Repository, view: Element, container: Element | null): void {
  const old = repo.deref(view.containerView);
  if (old === container || view === container) return;
  if (container && containedViewsOf(repo, view).includes(container)) return;
  repo.transact("Move into", (tx) => {
    if (old) tx.set(old, "containedViews", (old.containedViews ?? []).filter((r: { $ref: string }) => r.$ref !== view._id));
    if (container) {
      tx.set(container, "containedViews", [...(container.containedViews ?? []), ref(view)]);
      tx.set(view, "containerView", ref(container));
      // Draw order: a nested view (and its own children) must come after its container.
      const diagram = repo.diagramOf(view);
      const views: Element[] = diagram?.ownedViews ?? [];
      if (diagram && views.indexOf(view) < views.indexOf(container)) {
        for (const v of [view, ...containedViewsOf(repo, view)]) tx.move(v, diagram, "ownedViews", diagram.ownedViews.length);
      }
    } else tx.set(view, "containerView", undefined);
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
    case "association":
    case "directedAssociation":
    case "aggregation":
    case "composition":
      return isClassifier(tm) && isClassifier(hm) ? null : "L'association relie deux classificateurs.";
    case "include":
    case "extend":
      return tm._type === "UMLUseCase" && hm._type === "UMLUseCase" ? null : "Ce lien relie deux cas d'utilisation.";
    case "transition":
      return meta.isKindOf(tm._type, "UMLVertex") && meta.isKindOf(hm._type, "UMLVertex") ? null : "Une transition relie deux états.";
    case "controlFlow":
    case "objectFlow":
    case "activityInterrupt":
    case "exceptionHandler":
      // Interaction overview diagrams also chain interaction uses / inline interactions.
      return [tm, hm].every((m) => meta.isKindOf(m._type, "UMLActivityNode") || meta.isKindOf(m._type, "UMLInteractionFragment") || m._type === "UMLInteraction") ? null : "Un flot relie deux nœuds d'activité.";
    case "syncMessage":
    case "asyncMessage":
    case "replyMessage":
    case "createMessage":
    case "deleteMessage":
    case "commMessage":
    case "commAsyncMessage":
      return tm._type === "UMLLifeline" && hm._type === "UMLLifeline" ? null : "Un message relie deux lignes de vie.";
    case "extension":
      return tm._type === "UMLStereotype" && hm._type === "UMLMetaClass" ? null : "Une extension va d'un stéréotype vers une métaclasse.";
    case "relOneToOne":
    case "relOneToMany":
    case "relManyToMany":
    case "relIdentifying":
      return tm._type === "ERDEntity" && hm._type === "ERDEntity" ? null : "Une relation relie deux entités.";
    case "flow":
      return tm._type.startsWith("RA") && hm._type.startsWith("RA") && tm !== hm ? null : "Un flux relie deux nœuds de l'arbre.";
    case "foreignKey":
      return tm._type === "ERDEntity" && hm._type === "ERDEntity" ? null : "Une clé étrangère va d'une table vers la table référencée.";
    default:
      return null;
  }
}

export function createEdge(repo: Repository, diagram: Element, tool: EdgeTool, tail: Element, head: Element, points?: string): Element {
  const reason = canConnect(repo, tool, tail, head);
  if (reason) throw new CommandError(reason);
  return repo.transact(`Create ${tool.id}`, (tx) => {
    let model: Element | undefined;
    if (tool.modelType === "UMLMessage" && tool.viewType === "UMLConnectorView") return createCommMessage(repo, tx, diagram, tool, tail, head);
    if (tool.modelType) {
      const tm = repo.deref(tail.model)!, hm = repo.deref(head.model)!;
      // Relationships are owned by their source (as in .mdj files), unless the
      // behavior has a dedicated list (activity edges, transitions, messages).
      const [nsOwner, nsField] = ownerFor(repo, tx, diagram, tool.modelType);
      const dedicated = nsField !== "ownedElements";
      const owner = dedicated ? nsOwner : meta.containerField(tm._type, tool.modelType) ? tm : nsOwner;
      const field = dedicated ? nsField : "ownedElements";
      if (tool.modelType === "UMLMessage") {
        model = create("UMLMessage", { name: tool.variant === "reply" ? "" : uniqueName("message", owner.messages), messageSort: tool.variant ?? "synchCall", source: ref(tm), target: ref(hm) });
        tx.insert(owner, field, model);
      } else if (tool.modelType === "ERDRelationship" && tool.variant === "fk") {
        // Foreign key drawn from the referencing table (tail) to the referenced one (head).
        model = create("ERDRelationship", { name: "" });
        model.end1 = create("ERDRelationshipEnd", { reference: ref(hm), cardinality: "1", _parent: ref(model) });
        model.end2 = create("ERDRelationshipEnd", { reference: ref(tm), cardinality: "0..*", _parent: ref(model) });
        tx.insert(hm, "ownedElements", model);
        addForeignKeyColumns(tx, tm, hm);
      } else if (tool.modelType === "ERDRelationship") {
        // variant "card1:card2[:identifying]" — end1 is the source (parent) entity.
        const [c1, c2, flag] = (tool.variant ?? "1:0..*").split(":");
        model = create("ERDRelationship", { name: "", identifying: flag === "identifying" });
        model.end1 = create("ERDRelationshipEnd", { reference: ref(tm), cardinality: c1, _parent: ref(model) });
        model.end2 = create("ERDRelationshipEnd", { reference: ref(hm), cardinality: c2, _parent: ref(model) });
        tx.insert(owner, field, model);
      } else if (["UMLAssociation", "UMLCommunicationPath", "UMLConnector", "UMLLink"].includes(tool.modelType)) {
        model = create(tool.modelType);
        const endType = tool.modelType === "UMLConnector" ? "UMLConnectorEnd" : tool.modelType === "UMLLink" ? "UMLLinkEnd" : "UMLAssociationEnd";
        const end1 = create(endType, { reference: ref(tm), _parent: ref(model) });
        const end2 = create(endType, { reference: ref(hm), _parent: ref(model) });
        if (tool.variant === "directed") end1.navigable = false;
        if (tool.variant === "aggregation") end1.aggregation = "shared";
        if (tool.variant === "composition") end1.aggregation = "composite";
        model.end1 = end1;
        model.end2 = end2;
        tx.insert(owner, field, model);
      } else {
        model = create(tool.modelType, { source: ref(tm), target: ref(hm) });
        if (tool.modelType === "UMLDependency" && tool.variant) model.stereotype = tool.variant;
        tx.insert(owner, field, model);
      }
    }
    if (tool.id === "containment") {
      const owner = repo.deref(tail.model), child = repo.deref(head.model);
      if (owner && child) {
        const f = meta.containerField(owner._type, child._type);
        if (!f) throw new CommandError(`${owner.name ?? owner._type} ne peut pas contenir ${child.name ?? child._type}.`);
        tx.move(child, owner, f);
      }
    }
    const view = create(tool.viewType, {
      ...(model ? { model: ref(model) } : {}),
      tail: ref(tail),
      head: ref(head),
      lineStyle: tool.id === "noteLink" || tool.id === "freeline" || tool.viewType === "UMLSeqMessageView" || tool.viewType === "UMLTransitionView" ? 1 : 0,
      points: points ?? "",
    });
    tx.insert(diagram, "ownedViews", view);
    return view;
  });
}

/**
 * Gives `child` a column referencing each primary-key column of `parent`
 * (same name and type, marked FK), unless it already references `parent`.
 */
function addForeignKeyColumns(tx: Transaction, child: Element, parent: Element): void {
  const cols = (child.columns ?? []) as Element[];
  const pks = ((parent.columns ?? []) as Element[]).filter((c) => c.primaryKey);
  const refersToParent = (c: Element) => pks.some((pk) => c.referenceTo?.$ref === pk._id);
  if (cols.some(refersToParent)) return;
  for (const pk of pks) {
    let name = pk.name ?? "id";
    if (cols.some((c) => c.name === name)) name = `${name}_${parent.name ?? "ref"}`;
    tx.insert(child, "columns", create("ERDColumn", { name, type: pk.type, length: pk.length, foreignKey: true, referenceTo: ref(pk) }));
  }
}

/** Communication message: reuses (or creates) the connector between two lifelines. */
function createCommMessage(repo: Repository, tx: Transaction, diagram: Element, tool: EdgeTool, tail: Element, head: Element): Element {
  const tm = repo.deref(tail.model)!, hm = repo.deref(head.model)!;
  let connView = ((diagram.ownedViews ?? []) as Element[]).find(
    (v) => v._type === "UMLConnectorView" && ((v.tail?.$ref === tail._id && v.head?.$ref === head._id) || (v.tail?.$ref === head._id && v.head?.$ref === tail._id)),
  );
  const [owner] = ownerFor(repo, tx, diagram, "UMLMessage");
  if (!connView) {
    const conn = create("UMLConnector");
    conn.end1 = create("UMLConnectorEnd", { reference: ref(tm), _parent: ref(conn) });
    conn.end2 = create("UMLConnectorEnd", { reference: ref(hm), _parent: ref(conn) });
    tx.insert(owner, "ownedElements", conn);
    connView = create("UMLConnectorView", { model: ref(conn), tail: ref(tail), head: ref(head), lineStyle: 1, points: "" });
    tx.insert(diagram, "ownedViews", connView);
  }
  const msg = create("UMLMessage", { name: uniqueName("message", owner.messages), messageSort: tool.variant ?? "synchCall", source: ref(tm), target: ref(hm), connector: connView.model });
  tx.insert(owner, "messages", msg);
  return connView;
}

/** Model elements at the tail and head of a relationship's view (FK arrows point to the referenced table). */
export function edgeEndRefs(rel: Element, viewType: string): [{ $ref: string } | undefined, { $ref: string } | undefined] {
  if (rel.end1) {
    const ends: [any, any] = [rel.end1?.reference, rel.end2?.reference];
    return viewType === "ERDForeignKeyView" ? [ends[1], ends[0]] : ends;
  }
  return [rel.source, rel.target];
}

/** Creates a view of an existing model element (drag from the explorer). */
export function addViewOfModel(repo: Repository, diagram: Element, model: Element, x: number, y: number): Element | null {
  const viewType = viewTypeFor(diagram, model._type);
  if (!viewType) return null;
  if (meta.isKindOf(viewType, "EdgeView")) {
    const [a, b] = edgeEndRefs(model, viewType);
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
      const relViewType = viewTypeFor(diagram, rel._type);
      if (!relViewType || (diagram.ownedViews as Element[]).some((v) => v.model?.$ref === rel._id)) continue;
      const [a, b] = edgeEndRefs(rel, relViewType).map((r) => r?.$ref);
      const find = (id?: string) => (id ? (diagram.ownedViews as Element[]).find((v) => v.model?.$ref === id && !meta.isKindOf(v._type, "EdgeView")) : undefined);
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
  for (const v of [...top]) for (const c of containedViewsOf(repo, v)) top.add(c);
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

/** Quick edit of a transition: "evt1, evt2 [guard] / action". */
export function editTransition(repo: Repository, tr: Element, expression: string): void {
  const p = parseTransition(expression);
  repo.transact("Edit transition", (tx) => {
    for (const old of [...(tr.triggers ?? [])]) tx.remove(old);
    for (const old of [...(tr.effects ?? [])]) tx.remove(old);
    for (const name of p.triggers) tx.insert(tr, "triggers", create("UMLEvent", { name }));
    for (const name of p.effects) tx.insert(tr, "effects", create("UMLOpaqueBehavior", { name }));
    tx.set(tr, "guard", p.guard);
  });
}

/** Quick edit of a message: "[guard] result = name(args)". */
export function editMessage(repo: Repository, msg: Element, expression: string): void {
  const p = parseMessage(expression);
  repo.transact("Edit message", (tx) => {
    tx.set(msg, "name", p.name);
    tx.set(msg, "arguments", p.arguments);
    tx.set(msg, "assignmentTarget", p.assignmentTarget);
    tx.set(msg, "guard", p.guard);
  });
}

/** Quick edit of an activity edge: "[guard] name". */
export function editFlow(repo: Repository, flow: Element, expression: string): void {
  const p = parseFlow(expression);
  repo.transact("Edit flow", (tx) => {
    tx.set(flow, "guard", p.guard);
    tx.set(flow, "name", p.name);
  });
}

export type FeatureKind = "attributes" | "operations" | "literals" | "receptions" | "templateParameters";

const FEATURE_TYPE: Record<FeatureKind, string> = {
  attributes: "UMLAttribute",
  operations: "UMLOperation",
  literals: "UMLEnumerationLiteral",
  receptions: "UMLReception",
  templateParameters: "UMLTemplateParameter",
};

const FEATURE_BASE: Record<FeatureKind, string> = { attributes: "attribute", operations: "operation", literals: "literal", receptions: "reception", templateParameters: "T" };

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
    const base = type.replace(/^(UML|ERD)/, "");
    return tx.insert(owner, field, create(type, { name: uniqueName(base, owner[field]) }));
  });
}

const BEHAVIOR_FOR: Record<string, string> = {
  UMLSequenceDiagram: "UMLInteraction",
  UMLCommunicationDiagram: "UMLInteraction",
  UMLTimingDiagram: "UMLInteraction",
  UMLInteractionOverviewDiagram: "UMLActivity",
  UMLActivityDiagram: "UMLActivity",
  UMLStatechartDiagram: "UMLStateMachine",
  ERDDiagram: "ERDDataModel",
  ERDRelationalDiagram: "ERDDataModel",
  RAQueryDiagram: "RAQuery",
};

/**
 * Adds a diagram. Behavior diagrams live inside their behavior (interaction,
 * activity, state machine), created on the fly unless `owner` already is one.
 */
export function addDiagram(repo: Repository, owner: Element, type = "UMLClassDiagram"): Element {
  return repo.transact("Add diagram", (tx) => {
    let target = owner;
    const behavior = BEHAVIOR_FOR[type];
    if (behavior && owner._type !== behavior) {
      const field = meta.containerField(owner._type, behavior) ?? "ownedElements";
      target = tx.insert(owner, field, create(behavior, { name: uniqueName(behavior.replace(/^(UML|ERD|RA)/, ""), owner[field]) }));
      if (behavior === "UMLStateMachine") tx.insert(target, "regions", create("UMLRegion"));
    }
    const base = type.replace(/^(UML|ERD)/, "");
    return tx.insert(target, "ownedElements", create(type, { name: uniqueName(base, target.ownedElements) }));
  });
}

// ---- geometry ---------------------------------------------------------------

/** Moves node views (and bend points of edges whose both ends move). */
export function moveViews(repo: Repository, views: Element[], dx: number, dy: number, mergeKey?: string): void {
  if (dx === 0 && dy === 0) return;
  const direct = views.filter((v) => meta.isKindOf(v._type, "NodeView") && v._type !== "EdgeLabelView");
  const nodes = [...new Set([...direct, ...direct.flatMap((v) => containedViewsOf(repo, v))])];
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

// ---- ERD ⇄ relational model -------------------------------------------------

/**
 * Creates a diagram of `targetType` next to `source` showing the same entities
 * and relationships in the other notation (ER diagram ⇄ relational model), at
 * the same positions.
 */
export function convertDiagram(repo: Repository, source: Element, targetType: "ERDDiagram" | "ERDRelationalDiagram"): Element {
  const owner = repo.parentOf(source) ?? repo.root!;
  return repo.transact("Convert diagram", (tx) => {
    const base = targetType === "ERDRelationalDiagram" ? "Relational" : "ERD";
    const target = tx.insert(owner, "ownedElements", create(targetType, { name: `${source.name ?? base} (${targetType === "ERDRelationalDiagram" ? "MLD" : "MCD"})` }));
    const byModel = new Map<string, Element>();
    for (const v of (source.ownedViews ?? []) as Element[]) {
      const m = repo.deref(v.model);
      if (m?._type !== "ERDEntity") continue;
      const view = create(viewTypeFor(target, "ERDEntity")!, { model: ref(m), left: v.left, top: v.top, width: 40, height: 20 });
      tx.insert(target, "ownedViews", view);
      byModel.set(m._id, view);
    }
    const seen = new Set<string>();
    for (const m of byModel.keys()) {
      for (const rel of repo.relationshipsOf(m)) {
        if (rel._type !== "ERDRelationship" || seen.has(rel._id)) continue;
        seen.add(rel._id);
        const viewType = viewTypeFor(target, "ERDRelationship")!;
        const [a, b] = edgeEndRefs(rel, viewType);
        const tail = a && byModel.get(a.$ref), head = b && byModel.get(b.$ref);
        if (tail && head) tx.insert(target, "ownedViews", create(viewType, { model: ref(rel), tail: ref(tail), head: ref(head), lineStyle: targetType === "ERDRelationalDiagram" ? 1 : 0 }));
      }
    }
    return target;
  });
}

// ---- ERD / query tree quick-edit ------------------------------------------------

/** Entity as text: first line the name, then one column per line (`id: INT PK`). */
export function entityText(entity: Element): string {
  return [entity.name ?? "", ...((entity.columns ?? []) as Element[]).map(formatColumn)].join("\n");
}

/** Applies `entityText` back: renames, updates columns in order, adds or removes the rest. */
export function editEntity(repo: Repository, entity: Element, text: string): void {
  const [name = "", ...lines] = text.split(/\r?\n/).map((l) => l.trim());
  const parsed = lines.filter(Boolean).map(parseColumn);
  repo.transact("Edit entity", (tx) => {
    if (name && name !== entity.name) tx.set(entity, "name", name);
    const cols = [...((entity.columns ?? []) as Element[])];
    parsed.forEach((p, i) => {
      const values = { name: p.name, type: p.type ?? "VARCHAR", length: p.length ?? "", primaryKey: p.primaryKey, foreignKey: p.foreignKey || !!cols[i]?.referenceTo, nullable: p.nullable, unique: p.unique, defaultValue: p.defaultValue ?? "" };
      const col = cols[i];
      if (!col) tx.insert(entity, "columns", create("ERDColumn", values));
      else for (const [k, v] of Object.entries(values)) if ((col[k] ?? "") !== v) tx.set(col, k, v);
    });
    for (const extra of cols.slice(parsed.length)) tx.remove(extra);
  });
}

/** "WHERE idAlbum = 156" → operator WHERE, expression "idAlbum = 156" (σ, π… accepted too). */
export function editOperator(repo: Repository, op: Element, text: string): void {
  const src = text.trim();
  const bySymbol = Object.entries(RA_SYMBOLS).find(([, sym]) => src.startsWith(sym));
  const byWord = [...RA_OPERATORS].sort((a, b) => b.length - a.length).find((o) => src.toUpperCase().startsWith(o) && !/\w/.test(src[o.length] ?? ""));
  const operator = byWord ?? bySymbol?.[0] ?? op.operator;
  const expression = byWord ? src.slice(byWord.length).trim() : bySymbol ? src.slice(bySymbol[1].length).trim() : src;
  repo.transact("Edit operator", (tx) => {
    if (operator !== op.operator) tx.set(op, "operator", operator);
    if (expression !== op.expression) tx.set(op, "expression", expression);
  });
}

/** "Album a" → relation Album, alias a. */
export function editRelation(repo: Repository, rel: Element, text: string): void {
  const [name = "", alias = ""] = text.trim().split(/\s+(?:AS\s+)?/i);
  repo.transact("Edit relation", (tx) => {
    tx.set(rel, "name", name);
    tx.set(rel, "alias", alias);
  });
}
