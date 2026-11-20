// View registry: each view type knows how to lay itself out (`arrange`, which
// may update derived geometry/sub-views), draw itself and answer hit tests.
import type { Element } from "../core/element";
import { create } from "../core/factory";
import { meta } from "../core/meta/registry";
import type { Repository } from "../core/repository";
import { type Theme, resolveColor } from "../render/colors";
import { type FontSpec, type Graphics, type Point, type Rect, type TextMeasurer, parseFont } from "../render/graphics";

export interface RenderCtx {
  repo: Repository;
  theme: Theme;
  measure: TextMeasurer;
  /** Set while drawing; undefined during arrange-only passes. */
  g?: Graphics;
}

export interface ViewKind {
  arrange?(v: Element, ctx: RenderCtx): void;
  draw(v: Element, ctx: RenderCtx & { g: Graphics }): void;
  /** Deepest selectable view under `p` (the view itself, a feature line…). */
  hit?(v: Element, p: Point, tol: number, ctx: RenderCtx): Element | null;
  isEdge?: boolean;
}

const kinds = new Map<string, ViewKind>();

export function registerViewKind(type: string, kind: ViewKind): void {
  kinds.set(type, kind);
}

export function viewKind(type: string): ViewKind | undefined {
  for (const t of meta.ancestors(type)) {
    const k = kinds.get(t);
    if (k) return k;
  }
  return undefined;
}

export function isEdgeView(v: Element): boolean {
  return meta.isKindOf(v._type, "EdgeView");
}

export function isNodeView(v: Element): boolean {
  return meta.isKindOf(v._type, "NodeView");
}

export function boundsOf(v: Element): Rect {
  return { x: v.left ?? 0, y: v.top ?? 0, w: v.width ?? 0, h: v.height ?? 0 };
}

// Area painted outside a view's bounds (e.g. an actor's name below it),
// recorded by arrange() so exports and "fit" include it.
const outer = new WeakMap<Element, Rect>();
export function setPaintedBounds(v: Element, r: Rect): void {
  outer.set(v, r);
}
export function paintedBoundsOf(v: Element): Rect {
  return outer.get(v) ?? boundsOf(v);
}
/** Extra painted area recorded for an edge (labels it draws itself). */
export function paintedExtraOf(v: Element): Rect | undefined {
  return outer.get(v);
}

// ---- style helpers --------------------------------------------------------

export function colors(v: Element, ctx: RenderCtx) {
  return {
    line: resolveColor(v.lineColor, ctx.theme, "$foreground"),
    fill: resolveColor(v.fillColor, ctx.theme, "$background"),
    font: resolveColor(v.fontColor, ctx.theme, "$foreground"),
  };
}

export function fontOf(v: Element): FontSpec {
  return parseFont(v.font);
}

export function lineHeight(f: FontSpec): number {
  return f.size + 2;
}

/** Word-wraps `text` (keeping explicit newlines) to `width`. */
export function wrapText(text: string, width: number, font: FontSpec, m: TextMeasurer): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    if (width <= 0) {
      out.push(para);
      continue;
    }
    let line = "";
    for (const word of para.split(/(\s+)/)) {
      const cand = line + word;
      if (line && m.width(cand.trimEnd(), font) > width) {
        out.push(line.trimEnd());
        line = word.trimStart();
      } else line = cand;
    }
    out.push(line);
  }
  return out;
}

// ---- derived sub-views ----------------------------------------------------

/**
 * Returns the sub-view referenced by `field`, creating it (as derived data) if
 * missing. Keeps the .mdj structure that other tools expect.
 */
export function ensureSub(repo: Repository, owner: Element, field: string, type: string, init: Record<string, unknown> = {}): Element {
  const existing = repo.deref(owner[field]);
  if (existing && Array.isArray(owner.subViews) && owner.subViews.includes(existing)) return existing;
  const sub = create(type, { _parent: { $ref: owner._id }, ...init });
  (owner.subViews ??= []).push(sub);
  const before = owner[field];
  owner[field] = { $ref: sub._id };
  repo.registerDerived(sub);
  repo.reindexRefs(owner, { [field]: before });
  return sub;
}

/** Makes `compartment.subViews` mirror `models` (one `viewType` per model). */
export function syncList(repo: Repository, compartment: Element, models: Element[], viewType: string): Element[] {
  const current: Element[] = compartment.subViews ?? [];
  const byModel = new Map(current.map((v) => [v.model?.$ref, v]));
  const next = models.map((m) => {
    const found = byModel.get(m._id);
    if (found) return found;
    const v = create(viewType, { _parent: { $ref: compartment._id }, model: { $ref: m._id }, horizontalAlignment: 0, parentStyle: true });
    repo.registerDerived(v);
    return v;
  });
  for (const v of current) if (!next.includes(v)) repo.unregisterDerived(v);
  compartment.subViews = next;
  return next;
}

export function setBounds(v: Element, r: Rect): void {
  v.left = Math.round(r.x);
  v.top = Math.round(r.y);
  v.width = Math.round(r.w);
  v.height = Math.round(r.h);
}

// ---- layout epochs ------------------------------------------------------------------
// Layout caches (routes, ports…) stay valid while only geometry changes: moving or
// resizing views only re-lays out those views and their edges. Any other change
// (content, style, structure) starts a new epoch and a full layout.

const GEOMETRY = new Set(["left", "top", "width", "height", "points"]);

export interface LayoutState {
  epoch: number;
  /** Ids of views whose geometry changed since they were last laid out. */
  moved: Set<string>;
}

const layoutStates = new WeakMap<Repository, LayoutState>();

export function layoutState(repo: Repository): LayoutState {
  let st = layoutStates.get(repo);
  if (!st) {
    const state: LayoutState = { epoch: 1, moved: new Set() };
    repo.subscribe(({ op }) => {
      const geometric = op.changes.length > 0 && op.changes.every((c) => c.kind === "set" && GEOMETRY.has(c.field));
      if (geometric) for (const c of op.changes) state.moved.add((c as { id: string }).id);
      else {
        state.epoch++;
        state.moved.clear();
      }
    });
    layoutStates.set(repo, (st = state));
  }
  return st;
}

export const layoutEpoch = (repo: Repository): number => layoutState(repo).epoch;
