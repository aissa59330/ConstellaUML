// Python 3.10+: one module per type (snake_case file name) inside package
// folders with __init__.py; type hints, ABC for abstract types and interfaces.
import type { CgOperation, CgType, CgTypeRef } from "../model";
import { type GenOptions, type VirtualFile, Writer, indentUnit } from "../types";
import { primitiveMap, referencedTypes, snake } from "./common";

const prim = primitiveMap({ Integer: "int", Boolean: "bool", Real: "float", String: "str", UnlimitedNatural: "int", double: "float", long: "int", boolean: "bool", string: "str" });

function typeName(r: CgTypeRef | null, many: boolean): string {
  const base = r ? prim(r.name) ?? r.name : "object";
  return many ? `list[${base}]` : base;
}

const pyName = (name: string, visibility: string) => (visibility === "private" || visibility === "protected" ? `_${name}` : name);

function pyValue(v: string): string {
  const s = v.trim();
  if (/^true$/i.test(s)) return "True";
  if (/^false$/i.test(s)) return "False";
  if (/^null$/i.test(s)) return "None";
  return s;
}

const modulePath = (t: CgType) => [...t.pkg, snake(t.name)];

function docstring(w: Writer, text: string, o: GenOptions) {
  if (!o.docComments || !text.trim()) return;
  const lines = text.trim().split(/\r?\n/);
  if (lines.length === 1) w.line(`"""${lines[0]}"""`);
  else w.line(`"""${lines[0]}`).lines_(lines.slice(1)).line('"""');
}

function operation(w: Writer, t: CgType, op: CgOperation, o: GenOptions) {
  const abstract = (op.isAbstract || t.kind === "interface") && !op.isStatic;
  if (op.isStatic) w.line("@staticmethod");
  if (abstract) w.line("@abstractmethod");
  const params = [...(op.isStatic ? [] : ["self"]), ...op.params.map((p) => `${p.name}: ${typeName(p.type, p.many)}${p.defaultValue ? ` = ${pyValue(p.defaultValue)}` : ""}`)];
  const ret = op.returns ? typeName(op.returns, op.returnsMany) : "None";
  w.line(`def ${pyName(op.name, op.visibility)}(${params.join(", ")}) -> ${ret}:`).in();
  docstring(w, op.doc, o);
  if (op.body) w.lines_(op.body.split(/\r?\n/));
  else w.line(abstract ? "..." : "raise NotImplementedError");
  w.out().line();
}

export function generatePython(types: CgType[], o: GenOptions): VirtualFile[] {
  const files: VirtualFile[] = [];
  const packages = new Set<string>();
  for (const t of types) for (let i = 1; i <= t.pkg.length; i++) packages.add(t.pkg.slice(0, i).join("/"));
  for (const p of [...packages].sort()) files.push({ path: `${p}/__init__.py`, content: "" });

  for (const t of types) {
    const w = new Writer(indentUnit(o));
    w.line("from __future__ import annotations").line();
    const std: string[] = [];
    const isAbc = t.kind === "interface" || t.isAbstract || t.operations.some((op) => op.isAbstract);
    if (t.kind === "enum") std.push("from enum import Enum");
    else if (isAbc) std.push("from abc import ABC, abstractmethod");
    const bases = [...t.supers, ...t.interfaces];
    const runtime = new Set(bases.map((b) => b.target).filter(Boolean) as CgType[]);
    const typing = referencedTypes(t).filter((r) => !runtime.has(r));
    if (typing.length) std.push("from typing import TYPE_CHECKING");
    if (std.length) w.lines_(std).line();
    const imp = (r: CgType) => `from ${modulePath(r).join(".")} import ${r.name}`;
    if (runtime.size) w.lines_([...runtime].map(imp)).line();
    if (typing.length) w.line("if TYPE_CHECKING:").in().lines_(typing.map(imp)).out().line();
    w.line();

    const baseNames = bases.map((b) => b.name);
    if (t.kind === "enum") baseNames.unshift("Enum");
    else if (isAbc && !bases.some((b) => b.target)) baseNames.push("ABC");
    w.line(`class ${t.name}${baseNames.length ? `(${baseNames.join(", ")})` : ""}:`).in();
    docstring(w, t.doc, o);
    let empty = true;
    if (t.kind === "enum") {
      t.literals.forEach((l, i) => w.line(`${l.name} = ${i + 1}`));
      empty = !t.literals.length;
    }
    const statics = t.fields.filter((f) => f.isStatic);
    const members = t.fields.filter((f) => !f.isStatic);
    for (const f of statics) {
      const value = f.defaultValue ? pyValue(f.defaultValue) : "None";
      w.line(`${pyName(f.name, f.visibility)}: ${typeName(f.type, f.many)}${value === "None" ? " | None" : ""} = ${value}`);
    }
    if (statics.length) {
      w.line();
      empty = false;
    }
    if (members.length && t.kind !== "enum") {
      w.line("def __init__(self) -> None:").in();
      if (t.supers.some((s) => s.target)) w.line("super().__init__()");
      for (const f of members) {
        const value = f.defaultValue ? pyValue(f.defaultValue) : f.many ? "[]" : "None";
        w.line(`self.${pyName(f.name, f.visibility)}: ${typeName(f.type, f.many)}${value === "None" ? " | None" : ""} = ${value}`);
      }
      w.out().line();
      empty = false;
    }
    for (const op of t.operations) {
      operation(w, t, op, o);
      empty = false;
    }
    if (empty && !(o.docComments && t.doc.trim())) w.line("pass");
    w.trimEnd().out();
    files.push({ path: modulePath(t).join("/") + ".py", content: w.toString() });
  }
  return files;
}
