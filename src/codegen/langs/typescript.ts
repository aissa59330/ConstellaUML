import type { CgOperation, CgType, CgTypeRef } from "../model";
import { type GenOptions, type VirtualFile, Writer, indentUnit } from "../types";
import { blockDoc, primitiveMap, referencedTypes, relativePath } from "./common";

const prim = primitiveMap({
  Integer: "number",
  Real: "number",
  UnlimitedNatural: "number",
  int: "number",
  long: "number",
  double: "number",
  float: "number",
  Boolean: "boolean",
  String: "string",
});
const VIS: Record<string, string> = { public: "", protected: "protected ", private: "private ", package: "" };

function typeName(r: CgTypeRef | null, many: boolean, fallback: string): string {
  const base = r ? prim(r.name) ?? r.name : fallback;
  return many ? `${base}[]` : base;
}

function doc(w: Writer, text: string, o: GenOptions) {
  if (o.docComments) w.lines_(blockDoc(text, "/**", " * ", " */"));
}

function params(op: CgOperation): string {
  return op.params.map((p) => `${p.name}: ${typeName(p.type, p.many, "unknown")}${p.defaultValue ? ` = ${p.defaultValue}` : ""}`).join(", ");
}

export function generateTypeScript(types: CgType[], o: GenOptions): VirtualFile[] {
  return types.map((t) => {
    const w = new Writer(indentUnit(o));
    // Only a superclass is needed at runtime; everything else is a type-only import.
    const runtime = new Set((t.kind === "class" ? t.supers.slice(0, 1) : []).map((r) => r.target).filter(Boolean) as CgType[]);
    const refs = referencedTypes(t);
    const imports = refs.map((r) => `import ${runtime.has(r) ? "" : "type "}{ ${r.name} } from "${relativePath(t.pkg, [...r.pkg, r.name])}";`);
    if (imports.length) w.lines_(imports.sort()).line();
    doc(w, t.doc, o);
    const tp = t.typeParams.length ? `<${t.typeParams.join(", ")}>` : "";
    if (t.kind === "enum") {
      w.line(`export enum ${t.name} {`).in();
      for (const l of t.literals) {
        doc(w, l.doc, o);
        w.line(`${l.name},`);
      }
    } else if (t.kind === "interface") {
      const ext = [...t.supers, ...t.interfaces].map((r) => r.name);
      w.line(`export interface ${t.name}${tp}${ext.length ? ` extends ${ext.join(", ")}` : ""} {`).in();
      for (const f of t.fields) {
        doc(w, f.doc, o);
        w.line(`${f.isReadOnly ? "readonly " : ""}${f.name}: ${typeName(f.type, f.many, "unknown")};`);
      }
      for (const op of t.operations) {
        doc(w, op.doc, o);
        w.line(`${op.name}(${params(op)}): ${typeName(op.returns, op.returnsMany, "void")};`);
      }
    } else {
      const ext = t.supers[0] ? ` extends ${t.supers[0].name}` : "";
      const impl = t.interfaces.length ? ` implements ${t.interfaces.map((r) => r.name).join(", ")}` : "";
      w.line(`export ${t.isAbstract ? "abstract " : ""}class ${t.name}${tp}${ext}${impl} {`).in();
      for (const f of t.fields) {
        doc(w, f.doc, o);
        const mods = (VIS[f.visibility] ?? "") + (f.isStatic ? "static " : "") + (f.isReadOnly ? "readonly " : "");
        const type = typeName(f.type, f.many, "unknown");
        w.line(`${mods}${f.name}${f.defaultValue ? "" : f.many ? "" : "!"}: ${type}${f.defaultValue ? ` = ${f.defaultValue}` : f.many ? " = []" : ""};`);
      }
      if (t.fields.length) w.line();
      for (const op of t.operations) {
        doc(w, op.doc, o);
        const abstract = op.isAbstract && !op.isStatic;
        const mods = (VIS[op.visibility] ?? "") + (op.isStatic ? "static " : "") + (abstract ? "abstract " : "");
        const sig = `${mods}${op.name}(${params(op)}): ${typeName(op.returns, op.returnsMany, "void")}`;
        if (abstract) w.line(`${sig};`).line();
        else {
          w.line(`${sig} {`).in();
          w.lines_(op.body ? op.body.split(/\r?\n/) : [`throw new Error("Not implemented: ${op.name}");`]);
          w.out().line("}").line();
        }
      }
    }
    w.trimEnd().out().line("}");
    return { path: [...t.pkg, `${t.name}.ts`].join("/"), content: w.toString() };
  });
}
