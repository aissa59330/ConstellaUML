import { type Element, newId } from "./element";
import { meta } from "./meta/registry";

/** New element of `type` with metamodel defaults, overridden by `props`. */
export function create(type: string, props: Record<string, unknown> = {}): Element {
  const el: Element = { _type: type, _id: newId() };
  for (const f of meta.fields(type)) {
    if (f.default === undefined) continue;
    el[f.name] = Array.isArray(f.default) ? [...f.default] : f.default;
  }
  return Object.assign(el, props);
}

/** Default name for a new element: "Class1", "Class2"… unique among siblings. */
export function uniqueName(base: string, siblings: Element[] | undefined): string {
  const used = new Set((siblings ?? []).map((s) => s.name));
  for (let i = 1; ; i++) if (!used.has(base + i)) return base + i;
}
