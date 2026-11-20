import type { CgType, CgTypeRef } from "../model";

/** UML primitive types (and common spellings) → language types. */
export function primitiveMap(table: Record<string, string>) {
  const map = new Map<string, string>();
  for (const [k, v] of Object.entries(table)) map.set(k.toLowerCase(), v);
  return (name: string) => map.get(name.toLowerCase());
}

export const UML_PRIMITIVES = ["Integer", "Boolean", "Real", "String", "UnlimitedNatural"];

/** Model types referenced by `t` (supers, fields, parameters, returns). */
export function referencedTypes(t: CgType): CgType[] {
  const out = new Set<CgType>();
  const add = (r: CgTypeRef | null) => {
    if (r?.target && r.target !== t) out.add(r.target);
  };
  t.supers.forEach(add);
  t.interfaces.forEach(add);
  for (const f of t.fields) add(f.type);
  for (const o of t.operations) {
    add(o.returns);
    o.params.forEach((p) => add(p.type));
  }
  return [...out];
}

export const usesMany = (t: CgType) => t.fields.some((f) => f.many) || t.operations.some((o) => o.returnsMany || o.params.some((p) => p.many));

/** Relative module path from directory `from` to file `to` (both as segments). */
export function relativePath(from: string[], to: string[]): string {
  let i = 0;
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
  const up = from.length - i;
  return (up ? "../".repeat(up) : "./") + to.slice(i).join("/");
}

export const snake = (s: string) =>
  s
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/[^\w]+/g, "_")
    .toLowerCase();

export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Comment block lines: ["/**", " * line", " *\/"] style or prefix style. */
export function blockDoc(doc: string, open: string, prefix: string, close: string): string[] {
  const lines = doc.trim() ? doc.trim().split(/\r?\n/) : [];
  if (!lines.length) return [];
  return [open, ...lines.map((l) => (prefix + l).trimEnd()), close];
}
