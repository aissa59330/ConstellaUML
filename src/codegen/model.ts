// Language-neutral view of the UML classifiers to generate, read from the
// repository: packages become a path, association ends become fields.
import { type Element, isRef } from "../core/element";
import { meta } from "../core/meta/registry";
import type { Repository } from "../core/repository";

export type CgKind = "class" | "interface" | "enum";

export interface CgTypeRef {
  /** Name as written, or the referenced classifier's name. */
  name: string;
  /** The referenced model type, when it is part of the generated set. */
  target?: CgType;
}

export interface CgField {
  name: string;
  type: CgTypeRef | null;
  many: boolean;
  visibility: string;
  isStatic: boolean;
  isReadOnly: boolean;
  defaultValue: string;
  doc: string;
}

export interface CgParam {
  name: string;
  type: CgTypeRef | null;
  many: boolean;
  defaultValue: string;
}

export interface CgOperation {
  name: string;
  params: CgParam[];
  returns: CgTypeRef | null;
  returnsMany: boolean;
  visibility: string;
  isStatic: boolean;
  isAbstract: boolean;
  body: string;
  doc: string;
}

export interface CgType {
  el: Element;
  kind: CgKind;
  name: string;
  /** Package names from the generation root (excluded) down to the type's package. */
  pkg: string[];
  visibility: string;
  isAbstract: boolean;
  isFinal: boolean;
  doc: string;
  supers: CgTypeRef[];
  interfaces: CgTypeRef[];
  fields: CgField[];
  operations: CgOperation[];
  literals: { name: string; doc: string }[];
  typeParams: string[];
}

/** "*", "0..*", "1..*", "2..5" → more than one value. */
export function isMany(multiplicity: unknown): boolean {
  const m = String(multiplicity ?? "").trim();
  if (!m) return false;
  const upper = m.includes("..") ? m.split("..")[1] : m;
  return upper === "*" || Number(upper) > 1;
}

const isPackage = (e: Element) => meta.isKindOf(e._type, "UMLPackage");

/** Collects the classifiers under `base` (a package, model or the project). */
export function collectTypes(repo: Repository, base: Element, opts: { associationFields: boolean }): CgType[] {
  const types: CgType[] = [];
  const byId = new Map<string, CgType>();

  const visit = (el: Element, pkg: string[]) => {
    for (const child of (el.ownedElements ?? []) as Element[]) {
      if (isPackage(child)) visit(child, [...pkg, child.name ?? "package"]);
      else if (["UMLClass", "UMLInterface", "UMLEnumeration", "UMLDataType", "UMLSignal", "UMLComponent"].some((t) => child._type === t)) {
        const kind: CgKind = child._type === "UMLInterface" ? "interface" : child._type === "UMLEnumeration" ? "enum" : "class";
        const t: CgType = {
          el: child,
          kind,
          name: child.name || "Unnamed",
          pkg,
          visibility: child.visibility ?? "public",
          isAbstract: !!child.isAbstract,
          isFinal: !!child.isFinalSpecialization || !!child.isLeaf,
          doc: child.documentation ?? "",
          supers: [],
          interfaces: [],
          fields: [],
          operations: [],
          literals: ((child.literals ?? []) as Element[]).map((l) => ({ name: l.name ?? "", doc: l.documentation ?? "" })),
          typeParams: ((child.templateParameters ?? []) as Element[]).map((p) => p.name ?? "T"),
        };
        types.push(t);
        byId.set(child._id, t);
        // Nested classifiers are generated next to their owner.
        visit(child, pkg);
      }
    }
  };
  visit(base, []);

  const typeRef = (v: unknown): CgTypeRef | null => {
    if (isRef(v)) {
      const target = repo.deref(v);
      if (!target) return null;
      return { name: target.name ?? "", target: byId.get(target._id) };
    }
    const s = String(v ?? "").trim();
    return s ? { name: s } : null;
  };

  for (const t of types) {
    const el = t.el;
    t.fields = ((el.attributes ?? []) as Element[]).map((a) => ({
      name: a.name ?? "field",
      type: typeRef(a.type),
      many: isMany(a.multiplicity),
      visibility: a.visibility ?? "public",
      isStatic: !!a.isStatic,
      isReadOnly: !!a.isReadOnly,
      defaultValue: a.defaultValue ?? "",
      doc: a.documentation ?? "",
    }));
    t.operations = ((el.operations ?? []) as Element[]).map((o) => {
      const params = (o.parameters ?? []) as Element[];
      const ret = params.find((p) => p.direction === "return");
      return {
        name: o.name ?? "operation",
        params: params.filter((p) => p !== ret).map((p) => ({ name: p.name ?? "arg", type: typeRef(p.type), many: isMany(p.multiplicity), defaultValue: p.defaultValue ?? "" })),
        returns: ret ? typeRef(ret.type) : null,
        returnsMany: ret ? isMany(ret.multiplicity) : false,
        visibility: o.visibility ?? "public",
        isStatic: !!o.isStatic,
        isAbstract: !!o.isAbstract || t.kind === "interface",
        body: String(o.specification ?? "").trim(),
        doc: o.documentation ?? "",
      };
    });
    for (const rel of repo.relationshipsOf(el._id)) {
      if (meta.isKindOf(rel._type, "UMLDirectedRelationship") && rel.source?.$ref === el._id) {
        const target = typeRef(rel.target);
        if (!target) continue;
        if (rel._type === "UMLGeneralization") t.supers.push(target);
        else if (rel._type === "UMLInterfaceRealization") t.interfaces.push(target);
      }
      if (rel._type === "UMLAssociation" && opts.associationFields) {
        for (const [mine, other] of [
          [rel.end1, rel.end2],
          [rel.end2, rel.end1],
        ] as Element[][]) {
          if (mine?.reference?.$ref !== el._id || other?.navigable === false) continue;
          // Self-associations produce one field per navigable end.
          const target = typeRef(other.reference);
          if (!target) continue;
          const name = other.name || target.name.charAt(0).toLowerCase() + target.name.slice(1) + (isMany(other.multiplicity) ? "s" : "");
          if (t.fields.some((f) => f.name === name)) continue;
          t.fields.push({ name, type: target, many: isMany(other.multiplicity), visibility: other.visibility ?? "private", isStatic: false, isReadOnly: !!other.isReadOnly, defaultValue: "", doc: other.documentation ?? "" });
          if (rel.end1 === rel.end2) break;
        }
      }
    }
  }
  return types;
}

/** Splits a documentation string into comment lines. */
export function docLines(doc: string): string[] {
  return doc.trim() ? doc.trim().split(/\r?\n/) : [];
}
