import type { CgOperation, CgType, CgTypeRef } from "../model";
import { type GenOptions, type VirtualFile, Writer, indentUnit } from "../types";
import { capitalize, primitiveMap, referencedTypes, usesMany } from "./common";

const prim = primitiveMap({ Integer: "int", Boolean: "bool", Real: "double", String: "string", UnlimitedNatural: "long" });
const VIS: Record<string, string> = { public: "public ", protected: "protected ", private: "private ", package: "internal " };

function typeName(r: CgTypeRef | null, many: boolean, fallback: string): string {
  const base = r ? prim(r.name) ?? r.name : fallback;
  return many ? `List<${base === "void" ? "object" : base}>` : base;
}

function doc(w: Writer, text: string, o: GenOptions) {
  if (!o.docComments || !text.trim()) return;
  w.line("/// <summary>");
  for (const l of text.trim().split(/\r?\n/)) w.line(`/// ${l}`.trimEnd());
  w.line("/// </summary>");
}

/** Whether a superclass (transitively) declares an operation with the same name and arity. */
function overrides(t: CgType, op: CgOperation, seen = new Set<CgType>()): boolean {
  for (const s of t.supers) {
    const st = s.target;
    if (!st || seen.has(st)) continue;
    seen.add(st);
    if (st.operations.some((x) => x.name === op.name && x.params.length === op.params.length && !x.isStatic) || overrides(st, op, seen)) return true;
  }
  return false;
}

function operation(w: Writer, t: CgType, op: CgOperation, o: GenOptions) {
  doc(w, op.doc, o);
  const params = op.params.map((p) => `${typeName(p.type, p.many, "object")} ${p.name}${p.defaultValue ? ` = ${p.defaultValue}` : ""}`).join(", ");
  const ret = typeName(op.returns, op.returnsMany, "void");
  if (t.kind === "interface") return void w.line(`${ret} ${capitalize(op.name)}(${params});`).line();
  const abstract = op.isAbstract && !op.isStatic;
  // Instance methods are virtual unless the class is sealed, so subclasses can override them.
  const inherit = op.isStatic ? "static " : overrides(t, op) ? (abstract ? "abstract override " : "override ") : abstract ? "abstract " : t.isFinal || op.visibility === "private" ? "" : "virtual ";
  const mods = (VIS[op.visibility] ?? "public ") + inherit;
  const sig = `${mods}${ret} ${capitalize(op.name)}(${params})`;
  if (abstract) return void w.line(`${sig};`).line();
  w.line(sig).line("{").in();
  w.lines_(op.body ? op.body.split(/\r?\n/) : ["throw new NotImplementedException();"]);
  w.out().line("}").line();
}

export function generateCSharp(types: CgType[], o: GenOptions): VirtualFile[] {
  return types.map((t) => {
    const w = new Writer(indentUnit(o));
    const usings = new Set<string>(["System"]);
    if (usesMany(t)) usings.add("System.Collections.Generic");
    for (const r of referencedTypes(t)) if (r.pkg.length && r.pkg.join(".") !== t.pkg.join(".")) usings.add(r.pkg.join("."));
    w.lines_([...usings].sort().map((u) => `using ${u};`)).line();
    const ns = t.pkg.join(".");
    if (ns) w.line(`namespace ${ns}`).line("{").in();
    doc(w, t.doc, o);
    const vis = VIS[t.visibility] ?? "public ";
    const tp = t.typeParams.length ? `<${t.typeParams.join(", ")}>` : "";
    if (t.kind === "enum") {
      w.line(`${vis}enum ${t.name}`).line("{").in();
      t.literals.forEach((l, i) => {
        doc(w, l.doc, o);
        w.line(`${l.name}${i < t.literals.length - 1 ? "," : ""}`);
      });
    } else {
      const bases = [...t.supers.slice(0, t.kind === "interface" ? undefined : 1), ...t.interfaces].map((r) => r.name);
      const mods = t.kind === "interface" ? "" : (t.isAbstract ? "abstract " : "") + (t.isFinal ? "sealed " : "");
      w.line(`${vis}${mods}${t.kind === "interface" ? "interface" : "class"} ${t.name}${tp}${bases.length ? ` : ${bases.join(", ")}` : ""}`).line("{").in();
      for (const f of t.fields) {
        doc(w, f.doc, o);
        const type = typeName(f.type, f.many, "object");
        if (t.kind === "interface") w.line(`${type} ${capitalize(f.name)} { get;${f.isReadOnly ? "" : " set;"} }`);
        else {
          const mods = (VIS[f.visibility] ?? "") + (f.isStatic ? "static " : "") + (f.isReadOnly ? "readonly " : "");
          w.line(`${mods}${type} ${f.name}${f.defaultValue ? ` = ${f.defaultValue}` : ""};`);
        }
      }
      if (t.fields.length) w.line();
      for (const op of t.operations) operation(w, t, op, o);
    }
    w.trimEnd().out().line("}");
    if (ns) w.out().line("}");
    return { path: [...t.pkg, `${t.name}.cs`].join("/"), content: w.toString() };
  });
}
