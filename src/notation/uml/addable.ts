// What can be added under an element (explorer and diagram "Add ▸" menus),
// and the quick-edit actions that create a related classifier next to a view.
import { type Element, ref } from "../../core/element";
import { create, uniqueName } from "../../core/factory";
import { meta } from "../../core/meta/registry";
import type { Repository } from "../../core/repository";
import { boundsOf } from "../views";
import { ownerFor } from "./commands";

const ADDABLE: [string, string[]][] = [
  ["Project", ["UMLModel", "UMLPackage", "UMLProfile", "ERDDataModel"]],
  ["ERDDataModel", ["ERDEntity"]],
  ["ERDEntity", ["ERDColumn"]],
  ["RAQuery", ["RARelation", "RAOperator"]],
  [
    "UMLPackage",
    ["UMLPackage", "UMLModel", "UMLSubsystem", "UMLClass", "UMLInterface", "UMLEnumeration", "UMLDataType", "UMLPrimitiveType", "UMLSignal", "UMLActor", "UMLUseCase", "UMLComponent", "UMLArtifact", "UMLNode", "UMLObject", "UMLCollaboration", "UMLInteraction", "UMLActivity", "UMLStateMachine", "UMLInformationItem", "UMLStereotype", "UMLConstraint"],
  ],
  ["UMLEnumeration", ["UMLEnumerationLiteral", "UMLAttribute", "UMLOperation", "UMLConstraint"]],
  ["UMLInteraction", ["UMLLifeline", "UMLMessage", "UMLCombinedFragment", "UMLInteractionUse", "UMLStateInvariant"]],
  ["UMLActivity", ["UMLAction", "UMLObjectNode", "UMLActivityPartition"]],
  ["UMLStateMachine", ["UMLRegion"]],
  ["UMLUseCase", ["UMLExtensionPoint", "UMLAttribute", "UMLOperation"]],
  // Same order as StarUML's Add menu for classifiers.
  ["UMLClassifier", ["UMLTemplateParameter", "UMLAttribute", "UMLPort", "UMLOperation", "UMLReception", "UMLClass", "UMLInterface", "UMLSignal", "UMLDataType", "UMLPrimitiveType", "UMLEnumeration", "UMLInteraction", "UMLActivity", "UMLStateMachine", "UMLConstraint"]],
  ["UMLRegion", ["UMLState", "UMLPseudostate", "UMLFinalState"]],
  ["UMLState", ["UMLRegion"]],
  ["UMLCombinedFragment", ["UMLInteractionOperand"]],
  ["UMLInstance", ["UMLSlot"]],
  ["UMLAction", ["UMLInputPin", "UMLOutputPin"]],
  ["UMLOperation", ["UMLParameter"]],
];

/** Element types that can be created under `el`, in menu order. */
export function addableTypes(el: Element): string[] {
  const out = new Set<string>();
  for (const [base, types] of ADDABLE) if (meta.isKindOf(el._type, base)) for (const x of types) out.add(x);
  if (meta.isKindOf(el._type, "ExtensibleModel")) out.add("Tag");
  return [...out];
}

/** Features edited inline in a classifier view: the list they live in. */
export const FEATURE_LISTS: Record<string, "attributes" | "operations" | "receptions" | "literals" | "templateParameters"> = {
  UMLAttribute: "attributes",
  UMLOperation: "operations",
  UMLReception: "receptions",
  UMLEnumerationLiteral: "literals",
  UMLTemplateParameter: "templateParameters",
};

export type LinkKind = "superclass" | "subclass" | "providedInterface" | "requiredInterface" | "association" | "aggregation" | "composition";

/** Free spot near `from` in direction (dx, dy) that overlaps no other view. */
function freeSpot(diagram: Element, from: Element, dx: number, dy: number, w: number, h: number): { x: number; y: number } {
  const r = boundsOf(from);
  let x = dx > 0 ? r.x + r.w + 80 : dx < 0 ? r.x - w - 80 : r.x + (r.w - w) / 2;
  let y = dy > 0 ? r.y + r.h + 70 : dy < 0 ? r.y - h - 70 : r.y;
  const others = ((diagram.ownedViews ?? []) as Element[]).filter((v) => meta.isKindOf(v._type, "NodeView")).map(boundsOf);
  const M = 20; // keep a margin around existing views
  const hits = (px: number, py: number) => others.some((o) => px < o.x + o.w + M && px + w + M > o.x && py < o.y + o.h + M && py + h + M > o.y);
  // Slide along the free axis until the spot is empty.
  for (let i = 0; i < 40 && hits(x, y); i++) {
    if (dy !== 0) x += w + 30;
    else y += h + 30;
  }
  // Negative coordinates are fine: the diagram extends in every direction.
  return { x: Math.round(x), y: Math.round(y) };
}

/**
 * Creates a classifier linked to the one shown by `fromView` (superclass,
 * subclass, interface, associated class) with its view placed nearby, as one
 * undoable step. Returns the new node view.
 */
export function addLinkedClassifier(repo: Repository, diagram: Element, fromView: Element, kind: LinkKind): Element {
  const source = repo.deref(fromView.model);
  if (!source || !meta.isKindOf(source._type, "UMLClassifier")) throw new Error("Choisis une classe ou une interface.");
  const isInterface = kind === "providedInterface" || kind === "requiredInterface";
  const type = isInterface ? "UMLInterface" : source._type === "UMLInterface" && (kind === "superclass" || kind === "subclass") ? "UMLInterface" : "UMLClass";
  const [w, h] = isInterface ? [30, 30] : [120, 70];
  const dir: Record<LinkKind, [number, number]> = { superclass: [0, -1], subclass: [0, 1], providedInterface: [1, 0], requiredInterface: [1, 0], association: [1, 0], aggregation: [1, 0], composition: [1, 0] };
  const spot = freeSpot(diagram, fromView, ...dir[kind], w, h);
  return repo.transact(`Add ${kind}`, (tx) => {
    const [owner, field] = ownerFor(repo, tx, diagram, type);
    const model = tx.insert(owner, field, create(type, { name: uniqueName(type === "UMLInterface" ? "Interface" : "Class", owner[field]) }));
    const viewType = type === "UMLInterface" ? "UMLInterfaceView" : "UMLClassView";
    const view = tx.insert(
      diagram,
      "ownedViews",
      create(viewType, { model: ref(model), left: spot.x, top: spot.y, width: w, height: h, ...(isInterface ? { stereotypeDisplay: "icon" } : {}) }),
    );
    // Relationship from the child / client to the parent / supplier, owned by its source.
    let rel: Element;
    let edgeType: string;
    let [tail, head] = [fromView, view];
    if (kind === "superclass") {
      rel = tx.insert(source, "ownedElements", create("UMLGeneralization", { source: ref(source), target: ref(model) }));
      edgeType = "UMLGeneralizationView";
    } else if (kind === "subclass") {
      [tail, head] = [view, fromView];
      rel = tx.insert(model, "ownedElements", create("UMLGeneralization", { source: ref(model), target: ref(source) }));
      edgeType = "UMLGeneralizationView";
    } else if (kind === "providedInterface") {
      rel = tx.insert(source, "ownedElements", create("UMLInterfaceRealization", { source: ref(source), target: ref(model) }));
      edgeType = "UMLInterfaceRealizationView";
    } else if (kind === "requiredInterface") {
      rel = tx.insert(source, "ownedElements", create("UMLDependency", { source: ref(source), target: ref(model) }));
      edgeType = "UMLDependencyView";
    } else {
      rel = create("UMLAssociation");
      rel.end1 = create("UMLAssociationEnd", { _parent: ref(rel), reference: ref(source), aggregation: kind === "aggregation" ? "shared" : kind === "composition" ? "composite" : "none" });
      rel.end2 = create("UMLAssociationEnd", { _parent: ref(rel), reference: ref(model) });
      tx.insert(source, "ownedElements", rel);
      edgeType = "UMLAssociationView";
    }
    tx.insert(diagram, "ownedViews", create(edgeType, { model: ref(rel), tail: ref(tail), head: ref(head), lineStyle: 0, points: "" }));
    return view;
  });
}
