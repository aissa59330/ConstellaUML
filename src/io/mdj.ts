import { type Element, isElement, walk, ref, newId } from "../core/element";
import { create } from "../core/factory";

export class MdjError extends Error {}

/** Parses a .mdj / .mfj document. Unknown types and fields are kept verbatim. */
export function parseMdj(text: string): Element {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new MdjError(`Fichier JSON invalide : ${(e as Error).message}`);
  }
  if (!isElement(data)) throw new MdjError("Le fichier ne contient pas d'élément racine (_type/_id).");
  // Repair missing _parent links so that the repository can navigate upward.
  for (const el of walk(data)) {
    for (const key in el) {
      if (key === "_parent") continue;
      const v = el[key];
      const fix = (c: unknown) => {
        if (isElement(c) && !c._parent) c._parent = ref(el);
      };
      if (Array.isArray(v)) v.forEach(fix);
      else fix(v);
    }
  }
  return data;
}

const LEADING_KEYS = ["_type", "_id", "_parent", "name"];

function orderedKeys(obj: Record<string, unknown>, sorted: boolean): string[] {
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined);
  if (!sorted) return keys;
  const lead = LEADING_KEYS.filter((k) => keys.includes(k));
  const rest = keys.filter((k) => !LEADING_KEYS.includes(k)).sort();
  return [...lead, ...rest];
}

export interface SerializeOptions {
  /** Deterministic key order (diff-friendly). Default true. */
  sorted?: boolean;
  indent?: number;
}

/**
 * Deterministic JSON: same model ⇒ byte-identical output, keys in a stable
 * order, 2-space indent, trailing newline. Array order is model order.
 */
export function serializeMdj(root: Element, opts: SerializeOptions = {}): string {
  const sorted = opts.sorted ?? true;
  const pad = " ".repeat(opts.indent ?? 2);
  const out: string[] = [];
  const write = (v: unknown, depth: number): void => {
    if (v === null || typeof v !== "object") {
      out.push(JSON.stringify(v ?? null));
      return;
    }
    const inner = pad.repeat(depth + 1);
    if (Array.isArray(v)) {
      if (v.length === 0) return void out.push("[]");
      out.push("[\n");
      v.forEach((x, i) => {
        out.push(inner);
        write(x, depth + 1);
        out.push(i < v.length - 1 ? ",\n" : "\n");
      });
      out.push(pad.repeat(depth), "]");
      return;
    }
    const obj = v as Record<string, unknown>;
    const keys = orderedKeys(obj, sorted);
    if (keys.length === 0) return void out.push("{}");
    // References stay on one line: { "$ref": "…" }
    if (keys.length === 1 && keys[0] === "$ref") return void out.push(`{ "$ref": ${JSON.stringify(obj.$ref)} }`);
    out.push("{\n");
    keys.forEach((k, i) => {
      out.push(inner, JSON.stringify(k), ": ");
      write(obj[k], depth + 1);
      out.push(i < keys.length - 1 ? ",\n" : "\n");
    });
    out.push(pad.repeat(depth), "}");
  };
  write(root, 0);
  out.push("\n");
  return out.join("");
}

/** Empty project with one UML model and one class diagram (File ▸ New). */
export function newProject(): Element {
  const project = create("Project", { name: "Untitled" });
  const model = create("UMLModel", { name: "Model", _parent: ref(project) });
  const diagram = create("UMLClassDiagram", { name: "Main", defaultDiagram: true, _parent: ref(model) });
  model.ownedElements = [diagram];
  project.ownedElements = [model];
  return project;
}

/** Fragment (.mfj): the exported element becomes the root. */
export function exportFragment(el: Element): string {
  const copy = JSON.parse(JSON.stringify(el)) as Element;
  delete copy._parent;
  return serializeMdj(copy);
}

export { newId };
