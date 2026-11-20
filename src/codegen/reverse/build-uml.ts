// Reverse-engineered types → UML model elements (packages, classifiers,
// attributes, operations, generalizations, realizations, associations).
import { type Element, ref } from "../../core/element";
import { create } from "../../core/factory";
import type { Repository, Transaction } from "../../core/repository";
import { type RType, unwrapType } from "./ir";

export interface BuildOptions {
  /** Fields typed by another reversed class become associations. */
  associations: boolean;
}

export interface BuildResult {
  /** Created (or reused) packages by path ("" = the owner itself). */
  packages: Map<string, Element>;
  /** Created classifiers, in source order. */
  classifiers: Element[];
}

const TYPE: Record<RType["kind"], string> = { class: "UMLClass", interface: "UMLInterface", enum: "UMLEnumeration" };
const VISIBILITIES = ["public", "protected", "private", "package"];

export function buildUmlModel(repo: Repository, owner: Element, types: RType[], o: BuildOptions, mergeKey?: string): BuildResult {
  return repo.transact(
    "Reverse engineering",
    (tx) => {
      const packages = new Map<string, Element>([["", owner]]);
      const packageOf = (path: string[]): Element => {
        const key = path.join("/");
        const existing = packages.get(key);
        if (existing) return existing;
        const parent = packageOf(path.slice(0, -1));
        const name = path[path.length - 1];
        const found = ((parent.ownedElements ?? []) as Element[]).find((e) => e._type === "UMLPackage" && e.name === name);
        const pkg = found ?? tx.insert(parent, "ownedElements", create("UMLPackage", { name }));
        packages.set(key, pkg);
        return pkg;
      };

      // Pass 1: classifiers, so that every type name can be resolved afterwards.
      const made: [RType, Element][] = [];
      for (const t of types) {
        const pkg = packageOf(t.pkg);
        const el = tx.insert(
          pkg,
          "ownedElements",
          create(TYPE[t.kind], {
            name: t.name,
            visibility: VISIBILITIES.includes(t.visibility) ? t.visibility : "public",
            isAbstract: t.isAbstract && t.kind === "class",
            isFinalSpecialization: t.isFinal,
            documentation: t.doc,
          }),
        );
        made.push([t, el]);
      }
      const byName = new Map<string, [RType, Element][]>();
      for (const pair of made) byName.set(pair[0].name, [...(byName.get(pair[0].name) ?? []), pair]);
      /** Same-package match first, then any. */
      const resolve = (name: string, from: RType): Element | undefined => {
        const simple = name.replace(/<.*$/, "").split(/[.\\:]+/).pop()!.trim();
        const candidates = byName.get(simple);
        if (!candidates) return undefined;
        return (candidates.find(([t]) => t.pkg.join("/") === from.pkg.join("/")) ?? candidates[0])[1];
      };
      const typeValue = (type: string, from: RType) => {
        const { base, many } = unwrapType(type);
        const target = resolve(base, from);
        return { value: target ? ref(target) : type.trim() ? (many ? base : type.trim()) : "", target, many };
      };

      // Pass 2: features and relationships.
      for (const [t, el] of made) {
        if (t.kind === "enum") for (const l of t.literals) tx.insert(el, "literals", create("UMLEnumerationLiteral", { name: l }));
        for (const f of t.fields) {
          const { value, target, many } = typeValue(f.type, t);
          if (o.associations && target && t.kind !== "enum") {
            addAssociation(tx, el, target, f.name, many, f.visibility);
            continue;
          }
          tx.insert(
            el,
            "attributes",
            create("UMLAttribute", {
              name: f.name,
              type: value,
              multiplicity: many ? "*" : "",
              visibility: VISIBILITIES.includes(f.visibility) ? f.visibility : "public",
              isStatic: f.isStatic,
              isReadOnly: f.isReadOnly,
              defaultValue: f.defaultValue,
              documentation: f.doc,
            }),
          );
        }
        for (const m of t.methods) {
          const op = tx.insert(
            el,
            "operations",
            create("UMLOperation", {
              name: m.name,
              visibility: VISIBILITIES.includes(m.visibility) ? m.visibility : "public",
              isStatic: m.isStatic,
              isAbstract: m.isAbstract,
              documentation: m.doc,
            }),
          );
          for (const p of m.params) {
            const { value, many } = typeValue(p.type, t);
            tx.insert(op, "parameters", create("UMLParameter", { name: p.name, type: value, multiplicity: many ? "*" : "", defaultValue: p.defaultValue }));
          }
          if (m.returnType && m.returnType !== "void") {
            const { value, many } = typeValue(m.returnType, t);
            tx.insert(op, "parameters", create("UMLParameter", { name: "", type: value, multiplicity: many ? "*" : "", direction: "return" }));
          }
        }
        for (const s of t.supers) {
          const target = resolve(s, t);
          // An interface extending an interface, or a class extending a class.
          if (target) tx.insert(el, "ownedElements", create("UMLGeneralization", { source: ref(el), target: ref(target) }));
        }
        for (const i of t.interfaces) {
          const target = resolve(i, t);
          if (target) tx.insert(el, "ownedElements", create(target._type === "UMLInterface" ? "UMLInterfaceRealization" : "UMLGeneralization", { source: ref(el), target: ref(target) }));
        }
      }
      return { packages, classifiers: made.map(([, el]) => el) };
    },
    mergeKey,
  );
}

function addAssociation(tx: Transaction, owner: Element, target: Element, name: string, many: boolean, visibility: string): void {
  const assoc = create("UMLAssociation");
  assoc.end1 = create("UMLAssociationEnd", { _parent: ref(assoc), reference: ref(owner), navigable: false });
  assoc.end2 = create("UMLAssociationEnd", {
    _parent: ref(assoc),
    reference: ref(target),
    name,
    multiplicity: many ? "0..*" : "0..1",
    visibility: VISIBILITIES.includes(visibility) ? visibility : "public",
  });
  tx.insert(owner, "ownedElements", assoc);
}
