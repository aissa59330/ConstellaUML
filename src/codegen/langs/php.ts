// PHP 8.1+: one file per type (PSR-4 layout), typed properties, native enums.
import type { CgOperation, CgType, CgTypeRef } from "../model";
import { type GenOptions, type VirtualFile, Writer, indentUnit } from "../types";
import { blockDoc, primitiveMap, referencedTypes } from "./common";

const prim = primitiveMap({ Integer: "int", Real: "float", double: "float", Boolean: "bool", boolean: "bool", String: "string", UnlimitedNatural: "int", long: "int" });
const VIS: Record<string, string> = { public: "public", protected: "protected", private: "private", package: "public" };

function typeName(r: CgTypeRef | null, many: boolean, fallback: string): string {
  if (many) return "array";
  return r ? prim(r.name) ?? r.name : fallback;
}

function doc(w: Writer, text: string, o: GenOptions) {
  if (o.docComments) w.lines_(blockDoc(text, "/**", " * ", " */"));
}

function params(op: CgOperation): string {
  return op.params.map((p) => `${typeName(p.type, p.many, "mixed")} $${p.name}${p.defaultValue ? ` = ${p.defaultValue}` : ""}`).join(", ");
}

export function generatePhp(types: CgType[], o: GenOptions): VirtualFile[] {
  return types.map((t) => {
    const w = new Writer(indentUnit(o));
    w.line("<?php").line().line("declare(strict_types=1);").line();
    const ns = t.pkg.join("\\");
    if (ns) w.line(`namespace ${ns};`).line();
    const uses = referencedTypes(t)
      .filter((r) => r.pkg.join("\\") !== ns && r.pkg.length)
      .map((r) => `use ${[...r.pkg, r.name].join("\\")};`);
    if (uses.length) w.lines_(uses.sort()).line();
    doc(w, t.doc, o);
    if (t.kind === "enum") {
      w.line(`enum ${t.name}`).line("{").in();
      for (const l of t.literals) w.line(`case ${l.name};`);
    } else {
      const isInterface = t.kind === "interface";
      let head: string;
      if (isInterface) {
        const ext = [...t.supers, ...t.interfaces].map((r) => r.name);
        head = `interface ${t.name}${ext.length ? ` extends ${ext.join(", ")}` : ""}`;
      } else {
        const mods = (t.isAbstract ? "abstract " : "") + (t.isFinal ? "final " : "");
        head = `${mods}class ${t.name}${t.supers[0] ? ` extends ${t.supers[0].name}` : ""}${t.interfaces.length ? ` implements ${t.interfaces.map((r) => r.name).join(", ")}` : ""}`;
      }
      w.line(head).line("{").in();
      for (const f of isInterface ? [] : t.fields) {
        // Arrays lose their element type in PHP: keep it in a @var tag (read back by the reverse).
        if (f.many && f.type) w.lines_(blockDoc([f.doc.trim(), `@var ${typeName(f.type, false, "mixed")}[]`].filter(Boolean).join("\n"), "/**", " * ", " */"));
        else doc(w, f.doc, o);
        const vis = VIS[f.visibility] ?? "public";
        if (f.isReadOnly && f.defaultValue) {
          w.line(`${vis} const ${f.name.toUpperCase()} = ${f.defaultValue};`);
          continue;
        }
        const type = typeName(f.type, f.many, "mixed");
        const init = f.defaultValue ? ` = ${f.defaultValue}` : f.many ? " = []" : "";
        w.line(`${vis} ${f.isStatic ? "static " : ""}${f.isReadOnly ? "readonly " : ""}${type} $${f.name}${init};`);
      }
      if (!isInterface && t.fields.length) w.line();
      for (const op of t.operations) {
        doc(w, op.doc, o);
        const abstract = (op.isAbstract || isInterface) && !op.isStatic;
        const mods = `${!isInterface && abstract ? "abstract " : ""}${VIS[op.visibility] ?? "public"} ${op.isStatic ? "static " : ""}`;
        const sig = `${mods}function ${op.name}(${params(op)}): ${op.returnsMany ? "array" : typeName(op.returns, false, "void")}`;
        if (abstract) w.line(`${sig};`).line();
        else {
          w.line(sig).line("{").in();
          w.lines_(op.body ? op.body.split(/\r?\n/) : [`throw new \\LogicException('Not implemented: ${op.name}');`]);
          w.out().line("}").line();
        }
      }
    }
    w.trimEnd().out().line("}");
    return { path: [...t.pkg, `${t.name}.php`].join("/"), content: w.toString() };
  });
}
