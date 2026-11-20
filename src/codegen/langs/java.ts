import type { CgOperation, CgType, CgTypeRef } from "../model";
import { type GenOptions, type VirtualFile, Writer, indentUnit } from "../types";
import { blockDoc, primitiveMap, referencedTypes, usesMany } from "./common";

const prim = primitiveMap({ Integer: "int", Boolean: "boolean", Real: "double", String: "String", UnlimitedNatural: "long" });
const BOXED: Record<string, string> = { int: "Integer", boolean: "Boolean", double: "Double", long: "Long", float: "Float", char: "Character", byte: "Byte", short: "Short" };
const VIS: Record<string, string> = { public: "public ", protected: "protected ", private: "private ", package: "" };

function typeName(r: CgTypeRef | null, many: boolean, fallback: string): string {
  if (!r) return many ? `List<${fallback === "void" ? "Object" : fallback}>` : fallback;
  const base = prim(r.name) ?? r.name;
  return many ? `List<${BOXED[base] ?? base}>` : base;
}

const defaultReturn = (o: CgOperation) => `throw new UnsupportedOperationException("Not implemented: ${o.name}");`;

function doc(w: Writer, text: string, o: GenOptions) {
  if (o.docComments) w.lines_(blockDoc(text, "/**", " * ", " */"));
}

function operation(w: Writer, t: CgType, op: CgOperation, o: GenOptions) {
  doc(w, op.doc, o);
  const params = op.params.map((p) => `${typeName(p.type, p.many, "Object")} ${p.name}`).join(", ");
  const ret = typeName(op.returns, op.returnsMany, "void");
  const inInterface = t.kind === "interface";
  const abstract = op.isAbstract && !op.isStatic;
  const mods = (inInterface ? "" : VIS[op.visibility] ?? "public ") + (op.isStatic ? "static " : "") + (abstract && !inInterface ? "abstract " : "");
  const sig = `${mods}${ret} ${op.name}(${params})`;
  if (abstract) return void w.line(`${sig};`).line();
  w.line(`${sig} {`).in();
  w.lines_(op.body ? op.body.split(/\r?\n/) : [defaultReturn(op)]);
  w.out().line("}").line();
}

export function generateJava(types: CgType[], o: GenOptions): VirtualFile[] {
  return types.map((t) => {
    const w = new Writer(indentUnit(o));
    if (t.pkg.length) w.line(`package ${t.pkg.join(".")};`).line();
    const imports = new Set<string>();
    if (usesMany(t)) imports.add("java.util.List");
    for (const r of referencedTypes(t)) if (r.pkg.join(".") !== t.pkg.join(".") && r.pkg.length) imports.add([...r.pkg, r.name].join("."));
    if (imports.size) w.lines_([...imports].sort().map((i) => `import ${i};`)).line();

    doc(w, t.doc, o);
    const tp = t.typeParams.length ? `<${t.typeParams.join(", ")}>` : "";
    const vis = VIS[t.visibility] ?? "public ";
    if (t.kind === "interface") {
      const ext = [...t.supers, ...t.interfaces].map((r) => r.name);
      w.line(`${vis}interface ${t.name}${tp}${ext.length ? ` extends ${ext.join(", ")}` : ""} {`);
    } else if (t.kind === "enum") {
      w.line(`${vis}enum ${t.name}${t.interfaces.length ? ` implements ${t.interfaces.map((r) => r.name).join(", ")}` : ""} {`);
    } else {
      const mods = (t.isAbstract ? "abstract " : "") + (t.isFinal ? "final " : "");
      const ext = t.supers[0] ? ` extends ${t.supers[0].name}` : "";
      const impl = t.interfaces.length ? ` implements ${t.interfaces.map((r) => r.name).join(", ")}` : "";
      w.line(`${vis}${mods}class ${t.name}${tp}${ext}${impl} {`);
    }
    w.in();
    if (t.kind === "enum") {
      t.literals.forEach((l, i) => {
        doc(w, l.doc, o);
        w.line(`${l.name}${i < t.literals.length - 1 ? "," : ";"}`);
      });
      if (!t.literals.length) w.line(";");
      w.line();
    }
    for (const f of t.fields) {
      doc(w, f.doc, o);
      // Interface fields are constants: without a value they become getters.
      if (t.kind === "interface" && !f.defaultValue) {
        w.line(`${typeName(f.type, f.many, "Object")} get${f.name.charAt(0).toUpperCase()}${f.name.slice(1)}();`);
        continue;
      }
      const mods = t.kind === "interface" ? "" : (VIS[f.visibility] ?? "") + (f.isStatic ? "static " : "") + (f.isReadOnly ? "final " : "");
      const init = f.defaultValue ? ` = ${f.defaultValue}` : "";
      w.line(`${mods}${typeName(f.type, f.many, "Object")} ${f.name}${init};`);
    }
    if (t.fields.length) w.line();
    for (const op of t.operations) operation(w, t, op, o);
    w.trimEnd().out().line("}");
    return { path: [...t.pkg, `${t.name}.java`].join("/"), content: w.toString() };
  });
}
