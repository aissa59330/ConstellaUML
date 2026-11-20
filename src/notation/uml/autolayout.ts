// Diagrams created from model elements (reverse engineering, SQL import):
// views for the elements and the relationships between them, then a layered
// layout where supertypes sit above their subtypes.
import { type Element, ref } from "../../core/element";
import { create } from "../../core/factory";
import { meta } from "../../core/meta/registry";
import type { Repository } from "../../core/repository";
import type { TextMeasurer } from "../../render/graphics";
import type { Theme } from "../../render/colors";
import { viewKind } from "../views";
import { edgeEndRefs } from "./commands";
import { viewTypeFor } from "./toolbox";

const H_GAP = 40;
const V_GAP = 70;
const MAX_ROW = 1400;

/**
 * Adds `diagramType` under `owner` showing `elements` and the relationships
 * among them, laid out automatically. `mergeKey` lets the caller fold this
 * into the same undo step as the model creation.
 */
export function diagramOfElements(repo: Repository, owner: Element, diagramType: string, name: string, elements: Element[], measure: TextMeasurer, theme: Theme, mergeKey?: string): Element {
  const key = mergeKey ?? `layout-${Date.now()}`;
  const diagram = repo.transact(
    "Add diagram",
    (tx) => {
      const d = tx.insert(owner, "ownedElements", create(diagramType, { name }));
      const views = new Map<string, Element>();
      for (const el of elements) {
        const vt = viewTypeFor(d, el._type);
        if (!vt || meta.isKindOf(vt, "EdgeView")) continue;
        const v = tx.insert(d, "ownedViews", create(vt, { model: ref(el), left: 0, top: 0, width: 20, height: 20 }));
        views.set(el._id, v);
      }
      const seen = new Set<string>();
      for (const el of elements)
        for (const rel of repo.relationshipsOf(el._id)) {
          if (seen.has(rel._id)) continue;
          seen.add(rel._id);
          const vt = viewTypeFor(d, rel._type);
          if (!vt) continue;
          const [a, b] = edgeEndRefs(rel, vt);
          const tail = a && views.get(a.$ref), head = b && views.get(b.$ref);
          if (tail && head) tx.insert(d, "ownedViews", create(vt, { model: ref(rel), tail: ref(tail), head: ref(head), lineStyle: 0 }));
        }
      return d;
    },
    key,
  );
  layoutDiagram(repo, diagram, measure, theme, key);
  return diagram;
}

/** Layered layout of a diagram's top-level node views (one undoable step, or merged with `mergeKey`). */
export function layoutDiagram(repo: Repository, diagram: Element, measure: TextMeasurer, theme: Theme, mergeKey?: string): void {
  const ctx = { repo, theme, measure };
  const all = (diagram.ownedViews ?? []) as Element[];
  const nodes = all.filter((v) => meta.isKindOf(v._type, "NodeView") && !v.containerView);
  // Real sizes come from each view's own arrange().
  for (const v of nodes) viewKind(v._type)?.arrange?.(v, ctx);
  const size = new Map(nodes.map((v) => [v, { w: v.width ?? 100, h: v.height ?? 50 }]));
  const byId = new Map(nodes.map((v) => [v._id, v]));
  // Parents of a view: heads of generalization-like edges leaving it.
  const parents = new Map<Element, Element[]>();
  for (const e of all) {
    // ER relationships run from the referenced (parent) entity to the referencing one.
    const reversed = e._type === "ERDRelationshipView";
    if (!reversed && !/Generalization|Realization|ForeignKey/.test(e._type)) continue;
    const child = byId.get((reversed ? e.head : e.tail)?.$ref), parent = byId.get((reversed ? e.tail : e.head)?.$ref);
    if (child && parent && child !== parent) parents.set(child, [...(parents.get(child) ?? []), parent]);
  }
  const layer = new Map<Element, number>();
  const layerOf = (v: Element, stack = new Set<Element>()): number => {
    if (layer.has(v)) return layer.get(v)!;
    if (stack.has(v)) return 0;
    stack.add(v);
    const l = Math.max(-1, ...(parents.get(v) ?? []).map((p) => layerOf(p, stack))) + 1;
    layer.set(v, l);
    return l;
  };
  nodes.forEach((v) => layerOf(v));
  const layers: Element[][] = [];
  for (const v of nodes) (layers[layer.get(v)!] ??= []).push(v);
  const pos = new Map<Element, { x: number; y: number }>();
  let y = 20;
  for (const row of layers.filter(Boolean)) {
    // Children near their parents: sort by the parents' mean x.
    const bary = (v: Element) => {
      const ps = (parents.get(v) ?? []).map((p) => pos.get(p)).filter(Boolean) as { x: number }[];
      return ps.length ? ps.reduce((a, p) => a + p.x, 0) / ps.length : Number.MAX_SAFE_INTEGER;
    };
    row.sort((a, b) => bary(a) - bary(b));
    let x = 20;
    let rowH = 0;
    for (const v of row) {
      const s = size.get(v)!;
      if (x > 20 && x + s.w > MAX_ROW) {
        x = 20;
        y += rowH + V_GAP;
        rowH = 0;
      }
      pos.set(v, { x, y });
      x += s.w + H_GAP;
      rowH = Math.max(rowH, s.h);
    }
    y += rowH + V_GAP;
  }
  repo.transact(
    "Layout",
    (tx) => {
      for (const [v, p] of pos) {
        tx.set(v, "left", Math.round(p.x));
        tx.set(v, "top", Math.round(p.y));
      }
      for (const e of all) if (meta.isKindOf(e._type, "EdgeView")) tx.set(e, "points", "");
    },
    mergeKey,
  );
}
