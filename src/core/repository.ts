import { type Element, type Ref, isElement, isRef, walk, ref } from "./element";
import { meta } from "./meta/registry";

// Every persistent change goes through an Operation made of primitive Changes.
// Each change stores before/after so it can be inverted: undo/redo is unlimited
// and exact.
export type Change =
  | { kind: "set"; id: string; field: string; before: unknown; after: unknown }
  | { kind: "insert"; ownerId: string; field: string; index: number; element: Element }
  | { kind: "remove"; ownerId: string; field: string; index: number; element: Element };

export interface Operation {
  name: string;
  changes: Change[];
  /** Consecutive operations with the same mergeKey collapse into one undo step. */
  mergeKey?: string;
}

export type ChangeEvent = { op: Operation; direction: "do" | "undo" | "redo" };
type Listener = (e: ChangeEvent) => void;

export class Repository {
  root: Element | null = null;
  private index = new Map<string, Element>();
  private undoStack: Operation[] = [];
  private redoStack: Operation[] = [];
  private listeners = new Set<Listener>();
  private reverseCache: Map<string, Element[]> | null = null;
  private current: Operation | null = null;
  /** Incremented on every change; cheap cache key for derived data. */
  version = 0;
  /** Undo depth at last save; `dirty` compares against it. */
  private savedMarker: Operation | null = null;

  load(root: Element): void {
    this.root = root;
    this.index.clear();
    for (const el of walk(root)) this.index.set(el._id, el);
    this.undoStack = [];
    this.redoStack = [];
    this.savedMarker = null;
    this.touch();
  }

  get(id: string | undefined | null): Element | undefined {
    return id ? this.index.get(id) : undefined;
  }

  deref<T extends Element = Element>(r: unknown): T | undefined {
    return isRef(r) ? (this.index.get(r.$ref) as T | undefined) : undefined;
  }

  parentOf(el: Element): Element | undefined {
    return this.deref(el._parent);
  }

  all(): IterableIterator<Element> {
    return this.index.values();
  }

  size(): number {
    return this.index.size;
  }

  /** Elements whose fields reference `id` (excluding `_parent`). */
  referrers(id: string): Element[] {
    if (!this.reverseCache) {
      const cache = new Map<string, Element[]>();
      for (const el of this.index.values()) {
        for (const key in el) {
          if (key === "_parent") continue;
          const v = el[key];
          const add = (r: Ref) => {
            let arr = cache.get(r.$ref);
            if (!arr) cache.set(r.$ref, (arr = []));
            arr.push(el);
          };
          if (isRef(v)) add(v);
          else if (Array.isArray(v)) for (const x of v) if (isRef(x)) add(x);
        }
      }
      this.reverseCache = cache;
    }
    return this.reverseCache.get(id) ?? [];
  }

  /** All views (in any diagram) whose `model` is `id`. */
  viewsOf(id: string): Element[] {
    return this.referrers(id).filter((v) => meta.isKindOf(v._type, "View") && v.model?.$ref === id);
  }

  /** Relationships attached to a model element (source/target/ends). */
  relationshipsOf(id: string): Element[] {
    const out = new Set<Element>();
    for (const r of this.referrers(id)) {
      if (meta.isKindOf(r._type, "UMLDirectedRelationship") && (r.source?.$ref === id || r.target?.$ref === id)) out.add(r);
      if (r._type === "UMLAssociationEnd") {
        const assoc = this.parentOf(r);
        if (assoc) out.add(assoc);
      }
    }
    return [...out];
  }

  /** Diagram containing a view. */
  diagramOf(view: Element): Element | undefined {
    let p: Element | undefined = view;
    while (p && !meta.isKindOf(p._type, "Diagram")) p = this.parentOf(p);
    return p;
  }

  // ---- events ---------------------------------------------------------

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private touch(): void {
    this.version++;
    this.reverseCache = null;
  }

  private emit(e: ChangeEvent): void {
    for (const l of this.listeners) l(e);
  }

  // ---- transactions ---------------------------------------------------

  /**
   * Runs `fn` as a single undoable operation. Changes are applied immediately,
   * so `fn` can read its own writes. On exception everything is rolled back.
   */
  transact<T>(name: string, fn: (tx: Transaction) => T, mergeKey?: string): T {
    if (this.current) return fn(new Transaction(this, this.current));
    const op: Operation = { name, changes: [], mergeKey };
    this.current = op;
    let result: T;
    try {
      result = fn(new Transaction(this, op));
    } catch (err) {
      for (let i = op.changes.length - 1; i >= 0; i--) this.applyChange(invert(op.changes[i]));
      this.touch();
      throw err;
    } finally {
      this.current = null;
    }
    if (op.changes.length === 0) return result;
    const last = this.undoStack[this.undoStack.length - 1];
    if (mergeKey && last && last.mergeKey === mergeKey && this.redoStack.length === 0 && last !== this.savedMarker) {
      last.changes.push(...op.changes);
    } else {
      this.undoStack.push(op);
    }
    this.redoStack = [];
    this.emit({ op, direction: "do" });
    return result;
  }

  /** Low-level: apply one change and record it in the running operation. */
  record(op: Operation, c: Change): void {
    this.applyChange(c);
    op.changes.push(c);
    this.touch();
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undoName(): string | undefined {
    return this.undoStack[this.undoStack.length - 1]?.name;
  }

  redoName(): string | undefined {
    return this.redoStack[this.redoStack.length - 1]?.name;
  }

  undo(): void {
    const op = this.undoStack.pop();
    if (!op) return;
    for (let i = op.changes.length - 1; i >= 0; i--) this.applyChange(invert(op.changes[i]));
    this.redoStack.push(op);
    this.touch();
    this.emit({ op, direction: "undo" });
  }

  redo(): void {
    const op = this.redoStack.pop();
    if (!op) return;
    for (const c of op.changes) this.applyChange(c);
    this.undoStack.push(op);
    this.touch();
    this.emit({ op, direction: "redo" });
  }

  markSaved(): void {
    this.savedMarker = this.undoStack[this.undoStack.length - 1] ?? null;
  }

  /** Marks the document modified without an undoable change (recovered autosave). */
  markUnsaved(): void {
    this.savedMarker = { name: "unsaved", changes: [] };
  }

  /** Notifies listeners of an out-of-band change (file migration). */
  bump(): void {
    this.touch();
    this.emit({ op: { name: "external", changes: [] }, direction: "do" });
  }

  get dirty(): boolean {
    return (this.undoStack[this.undoStack.length - 1] ?? null) !== this.savedMarker;
  }

  // ---- derived (non-undoable) structure --------------------------------

  /**
   * Layout code keeps compartments and labels in sync with the model. Those
   * sub-views are derived data, recomputed after every change, so they are
   * registered without going through an operation.
   */
  registerDerived(el: Element): void {
    for (const e of walk(el)) this.index.set(e._id, e);
    this.reverseCache = null;
  }

  unregisterDerived(el: Element): void {
    for (const e of walk(el)) this.index.delete(e._id);
    this.reverseCache = null;
  }

  // ---- internals --------------------------------------------------------

  private applyChange(c: Change): void {
    if (c.kind === "set") {
      const el = this.index.get(c.id);
      if (!el) throw new Error(`set: unknown element ${c.id}`);
      if (isElement(el[c.field])) for (const e of walk(el[c.field])) this.index.delete(e._id);
      if (c.after === undefined) delete el[c.field];
      else el[c.field] = c.after;
      if (isElement(c.after)) {
        c.after._parent = ref(el);
        for (const e of walk(c.after)) this.index.set(e._id, e);
      }
    } else {
      const owner = this.index.get(c.ownerId);
      if (!owner) throw new Error(`${c.kind}: unknown owner ${c.ownerId}`);
      let arr: Element[] = owner[c.field];
      if (c.kind === "insert") {
        if (!Array.isArray(arr)) owner[c.field] = arr = [];
        arr.splice(c.index, 0, c.element);
        c.element._parent = ref(owner);
        for (const e of walk(c.element)) this.index.set(e._id, e);
      } else {
        if (!Array.isArray(arr) || arr[c.index] !== c.element) throw new Error(`remove: element not at ${c.field}[${c.index}]`);
        arr.splice(c.index, 1);
        for (const e of walk(c.element)) this.index.delete(e._id);
      }
    }
  }
}

function invert(c: Change): Change {
  switch (c.kind) {
    case "set":
      return { ...c, before: c.after, after: c.before };
    case "insert":
      return { ...c, kind: "remove" };
    case "remove":
      return { ...c, kind: "insert" };
  }
}

export class Transaction {
  constructor(
    readonly repo: Repository,
    private op: Operation,
  ) {}

  set(el: Element, field: string, value: unknown): void {
    const before = el[field];
    if (before === value) return;
    if (sameValue(before, value)) return;
    this.repo.record(this.op, { kind: "set", id: el._id, field, before, after: value });
  }

  insert(owner: Element, field: string, element: Element, index?: number): Element {
    const arr: unknown[] = Array.isArray(owner[field]) ? owner[field] : [];
    const i = index === undefined || index < 0 || index > arr.length ? arr.length : index;
    this.repo.record(this.op, { kind: "insert", ownerId: owner._id, field, index: i, element });
    return element;
  }

  /** Removes `element` from wherever its owner holds it. */
  remove(element: Element): void {
    const owner = this.repo.parentOf(element);
    if (!owner) throw new Error(`remove: ${element._id} has no owner`);
    for (const key in owner) {
      const v = owner[key];
      if (Array.isArray(v)) {
        const i = v.indexOf(element);
        if (i >= 0) {
          this.repo.record(this.op, { kind: "remove", ownerId: owner._id, field: key, index: i, element });
          return;
        }
      } else if (v === element) {
        this.repo.record(this.op, { kind: "set", id: owner._id, field: key, before: element, after: undefined });
        return;
      }
    }
    throw new Error(`remove: ${element._id} not found in its owner`);
  }

  move(element: Element, newOwner: Element, field: string, index?: number): void {
    this.remove(element);
    this.insert(newOwner, field, element, index);
  }
}

function sameValue(a: unknown, b: unknown): boolean {
  if (isRef(a) && isRef(b)) return a.$ref === b.$ref;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => sameValue(x, b[i]));
  return false;
}
