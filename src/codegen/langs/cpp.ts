// C++17: one header and one source file per class. Model classes used as
// fields or parameters are held by pointer and forward-declared, so mutual
// references compile; superclasses and enums are #included.
import type { CgOperation, CgType, CgTypeRef } from "../model";
import { type GenOptions, type VirtualFile, Writer, indentUnit } from "../types";
import { blockDoc, primitiveMap, referencedTypes } from "./common";

const prim = primitiveMap({ Integer: "int", Boolean: "bool", Real: "double", String: "std::string", UnlimitedNatural: "unsigned long", string: "std::string" });

function typeName(r: CgTypeRef | null, many: boolean, fallback: string): string {
  let base = fallback;
  if (r) base = prim(r.name) ?? (r.target && r.target.kind !== "enum" ? `${r.name}*` : r.name);
  return many ? `std::vector<${base === "void" ? "void*" : base}>` : base;
}

const headerPath = (t: CgType) => [...t.pkg, `${t.name}.h`].join("/");

function doc(w: Writer, text: string, o: GenOptions) {
  if (o.docComments) w.lines_(blockDoc(text, "/**", " * ", " */"));
}

const isPure = (t: CgType, op: CgOperation) => !op.isStatic && (op.isAbstract || t.kind === "interface");
const virtualClass = (t: CgType) => t.kind === "interface" || t.isAbstract || t.operations.some((op) => op.isAbstract);

function signature(op: CgOperation, withDefaults: boolean): string {
  return op.params.map((p) => `${typeName(p.type, p.many, "void*")} ${p.name}${withDefaults && p.defaultValue ? ` = ${p.defaultValue}` : ""}`).join(", ");
}

function defaultBody(op: CgOperation): string[] {
  if (op.body) return op.body.split(/\r?\n/);
  const ret = typeName(op.returns, op.returnsMany, "void");
  return ret === "void" ? ["// TODO"] : ["// TODO", `return ${ret}{};`];
}

export function generateCpp(types: CgType[], o: GenOptions): VirtualFile[] {
  const files: VirtualFile[] = [];
  for (const t of types) {
    const unit = indentUnit(o);
    const h = new Writer(unit);
    const guard = [...t.pkg, t.name, "H"].join("_").toUpperCase().replace(/\W/g, "_");
    h.line(`#ifndef ${guard}`).line(`#define ${guard}`).line();
    const std = new Set<string>();
    const all = [...t.fields.map((f) => [f.type, f.many] as const), ...t.operations.flatMap((op) => [[op.returns, op.returnsMany] as const, ...op.params.map((p) => [p.type, p.many] as const)])];
    for (const [r, many] of all) {
      if (many) std.add("vector");
      if (r && /string/i.test(r.name) && !r.target) std.add("string");
    }
    const includes = new Set<string>();
    const forwards = new Set<string>();
    for (const r of referencedTypes(t)) {
      const inherited = [...t.supers, ...t.interfaces].some((s) => s.target === r);
      if (inherited || r.kind === "enum") includes.add(headerPath(r));
      else forwards.add(r.name);
    }
    for (const s of [...std].sort()) h.line(`#include <${s}>`);
    for (const i of [...includes].sort()) h.line(`#include "${i}"`);
    if (std.size || includes.size) h.line();
    const ns = t.pkg.join("::");
    if (ns) h.line(`namespace ${ns} {`).line();
    for (const f of [...forwards].sort()) h.line(`class ${f};`);
    if (forwards.size) h.line();
    doc(h, t.doc, o);
    if (t.kind === "enum") {
      h.line(`enum class ${t.name} {`).in();
      t.literals.forEach((l, i) => h.line(`${l.name}${i < t.literals.length - 1 ? "," : ""}`));
      h.out().line("};");
    } else {
      const tmpl = t.typeParams.length ? `template <${t.typeParams.map((p) => `typename ${p}`).join(", ")}>` : "";
      if (tmpl) h.line(tmpl);
      const bases = [...t.supers, ...t.interfaces].map((r) => `public ${r.name}`);
      h.line(`class ${t.name}${t.isFinal ? " final" : ""}${bases.length ? ` : ${bases.join(", ")}` : ""} {`);
      for (const vis of ["public", "protected", "private"]) {
        const fields = t.fields.filter((f) => (f.visibility === "package" ? "public" : f.visibility) === vis);
        const ops = t.operations.filter((op) => (op.visibility === "package" ? "public" : op.visibility) === vis);
        const dtor = vis === "public" && virtualClass(t);
        if (!fields.length && !ops.length && !dtor) continue;
        h.line(`${vis}:`).in();
        if (dtor) h.line(`virtual ~${t.name}() = default;`);
        for (const f of fields) {
          doc(h, f.doc, o);
          const mods = (f.isStatic ? "static " : "") + (f.isReadOnly && f.defaultValue ? "const " : "");
          h.line(`${mods}${typeName(f.type, f.many, "void*")} ${f.name}${f.defaultValue && !f.isStatic ? ` = ${f.defaultValue}` : ""};`);
        }
        for (const op of ops) {
          doc(h, op.doc, o);
          const ret = typeName(op.returns, op.returnsMany, "void");
          const virt = op.isStatic ? "static " : virtualClass(t) ? "virtual " : "";
          const pure = isPure(t, op) ? " = 0" : "";
          if (tmpl && !pure) {
            h.line(`${virt}${ret} ${op.name}(${signature(op, true)}) {`).in().lines_(defaultBody(op)).out().line("}");
          } else h.line(`${virt}${ret} ${op.name}(${signature(op, true)})${pure};`);
        }
        h.out();
      }
      h.line("};");
    }
    if (ns) h.line().line(`} // namespace ${ns}`);
    h.line().line(`#endif // ${guard}`);
    files.push({ path: headerPath(t), content: h.toString() });

    const impl = t.kind !== "enum" && !t.typeParams.length ? t.operations.filter((op) => !isPure(t, op)) : [];
    if (!impl.length) continue;
    const c = new Writer(unit);
    c.line(`#include "${headerPath(t)}"`).line();
    if (ns) c.line(`namespace ${ns} {`).line();
    for (const op of impl) {
      c.line(`${typeName(op.returns, op.returnsMany, "void")} ${t.name}::${op.name}(${signature(op, false)}) {`).in();
      c.lines_(defaultBody(op)).out().line("}").line();
    }
    c.trimEnd();
    if (ns) c.line().line(`} // namespace ${ns}`);
    files.push({ path: [...t.pkg, `${t.name}.cpp`].join("/"), content: c.toString() });
  }
  return files;
}
