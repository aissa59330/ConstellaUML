// PHP declarations: namespaces, classes, interfaces, traits (as classes),
// enums, typed properties, constants, methods and promoted constructor parameters.
import { type RField, type RParam, type RType, type ReverseResult, newType } from "./ir";
import { Cursor, type Token, joinTokens, splitTop, tokenize } from "../../core/lexer";

const MODIFIERS = new Set(["public", "protected", "private", "static", "final", "abstract", "readonly", "var"]);

const shortName = (s: string) => s.replace(/^\\/, "").split("\\").pop()!.trim();

function readMods(c: Cursor): { set: Set<string>; doc: string; varType: string } {
  const set = new Set<string>();
  let doc = "";
  let varType = "";
  for (;;) {
    const t = c.peek();
    if (!t) break;
    if (t.k === "doc") {
      doc = t.v;
      varType = /@var\s+([^\s*]+)/.exec(t.raw ?? "")?.[1] ?? "";
      c.next();
    } else if (t.v === "#" && c.is("[", 1)) {
      c.next();
      c.skipGroup(); // #[Attribute]
    } else if (t.k === "id" && MODIFIERS.has(t.v.toLowerCase())) {
      set.add(t.v.toLowerCase());
      c.next();
    } else break;
  }
  return { set, doc, varType };
}

const vis = (m: Set<string>) => (m.has("private") ? "private" : m.has("protected") ? "protected" : "public");

/** Type tokens until the variable or the end ("?int", "A|B", "\\Foo\\Bar"). */
function readType(c: Cursor, stops: string[]): string {
  const toks: Token[] = [];
  while (!c.done && !c.peek()!.v.startsWith("$") && !stops.includes(c.peek()!.v) && !c.is("...") && !c.is("&")) toks.push(c.next()!);
  return joinTokens(toks).replace(/\s*\\\s*/g, "\\").replace(/^\\/, "");
}

function value(c: Cursor, stops: string[]): string {
  const s = c.i;
  while (!c.done && !stops.includes(c.peek()!.v)) {
    if (c.is("(") || c.is("[") || c.is("{")) c.skipGroup();
    else c.next();
  }
  return joinTokens(c.toks.slice(s, c.i));
}

function parseParams(toks: Token[], promoted?: RField[]): RParam[] {
  return splitTop(toks).map((p) => {
    const c = new Cursor(p);
    const mods = readMods(c);
    const type = readType(c, ["=", ")"]);
    c.eat("&");
    c.eat("...");
    const name = (c.next()?.v ?? "$arg").replace(/^\$/, "");
    const defaultValue = c.eat("=") ? joinTokens(p.slice(c.i)) : "";
    if (promoted && (mods.set.has("public") || mods.set.has("protected") || mods.set.has("private") || mods.set.has("readonly")))
      promoted.push({ name, type, visibility: vis(mods.set), isStatic: false, isReadOnly: mods.set.has("readonly"), defaultValue, doc: "" });
    return { name, type, defaultValue };
  });
}

class PhpParser {
  types: RType[] = [];
  errors: string[] = [];
  ns: string[] = [];
  constructor(private file: string) {}

  parse(src: string): void {
    const c = new Cursor(tokenize(src, { lineComments: ["//", "#"], blockComments: true, strings: ['"', "'"], idChars: "$", operators: ["?->", "===", "!==", "==", "!=", "<=", ">=", "&&", "||", "??", "<?php", "?>"] }));
    while (!c.done) {
      const line = c.peek()!.line;
      try {
        if (c.eatKw("namespace")) {
          const parts: string[] = [];
          while (!c.done && !c.is(";") && !c.is("{")) {
            const t = c.next()!;
            if (t.k === "id") parts.push(t.v);
          }
          c.eat(";");
          this.ns = parts;
          if (c.is("{")) c.next(); // braced namespace: its declarations follow
        } else if (c.isKw("use")) c.skipTo(";");
        else if (!this.typeDecl(c)) {
          if (c.is("{")) c.skipGroup();
          else c.next();
        }
      } catch (e) {
        this.errors.push(`${this.file}:${line}: ${(e as Error).message}`);
        c.skipTo(";");
      }
    }
  }

  typeDecl(c: Cursor): boolean {
    const start = c.i;
    const mods = readMods(c);
    let kind: RType["kind"] | undefined;
    if (c.eatKw("class") || c.eatKw("trait")) kind = "class";
    else if (c.eatKw("interface")) kind = "interface";
    else if (c.eatKw("enum")) kind = "enum";
    if (!kind || !c.isId()) {
      c.i = start;
      return false;
    }
    const t = newType(kind, c.next()!.v, this.ns);
    t.isAbstract = mods.set.has("abstract") || kind === "interface";
    t.isFinal = mods.set.has("final");
    t.doc = mods.doc;
    if (c.eat(":")) readType(c, ["{", "implements"]); // backed enum type
    const list = () => {
      const toks: Token[] = [];
      while (!c.done && !c.is("{") && !c.isKw("implements") && !c.isKw("extends")) toks.push(c.next()!);
      return splitTop(toks).map((p) => shortName(joinTokens(p).replace(/\s+/g, "")));
    };
    while (!c.done && !c.is("{")) {
      if (c.eatKw("extends")) t.supers.push(...list());
      else if (c.eatKw("implements")) t.interfaces.push(...list());
      else c.next();
    }
    this.types.push(t);
    if (!c.is("{")) return true;
    c.next();
    while (!c.done && !c.is("}")) {
      const line = c.peek()!.line;
      try {
        this.member(c, t);
      } catch (e) {
        this.errors.push(`${this.file}:${line}: ${(e as Error).message}`);
        c.skipTo(";");
      }
    }
    c.eat("}");
    return true;
  }

  member(c: Cursor, t: RType): void {
    if (c.eat(";")) return;
    if (c.isKw("use")) return void c.skipTo(";"); // traits
    if (c.eatKw("case")) {
      t.literals.push(c.next()?.v ?? "CASE");
      c.skipTo(";");
      return;
    }
    const mods = readMods(c);
    if (c.eatKw("const")) {
      // const [TYPE] NAME = value;
      const toks: Token[] = [];
      while (!c.done && !c.is("=") && !c.is(";")) toks.push(c.next()!);
      const name = toks[toks.length - 1]?.v ?? "CONST";
      const defaultValue = c.eat("=") ? value(c, [";", ","]) : "";
      c.skipTo(";");
      t.fields.push({ name, type: toks.length > 1 ? joinTokens(toks.slice(0, -1)) : "", visibility: vis(mods.set), isStatic: true, isReadOnly: true, defaultValue, doc: mods.doc });
      return;
    }
    if (c.eatKw("function")) {
      c.eat("&");
      const name = c.next()?.v ?? "method";
      const promoted: RField[] = [];
      const params = c.is("(") ? parseParams(c.paramGroup(), name === "__construct" ? promoted : undefined) : [];
      t.fields.push(...promoted);
      const returnType = c.eat(":") ? readType(c, ["{", ";"]) : "";
      const hasBody = c.is("{");
      if (hasBody) c.skipGroup();
      else c.eat(";");
      t.methods.push({
        name,
        params,
        returnType,
        visibility: vis(mods.set),
        isStatic: mods.set.has("static"),
        isAbstract: mods.set.has("abstract") || (t.kind === "interface" && !hasBody),
        doc: mods.doc,
      });
      return;
    }
    // Property: [type] $a [= v], $b; "array" is refined by a "@var Item[]" doc tag.
    const declared = readType(c, [";", "=", "}"]);
    const type = mods.varType && (!declared || /^\??array$/i.test(declared)) ? mods.varType.replace(/^\\/, "") : declared;
    for (;;) {
      const tok = c.next();
      if (!tok?.v.startsWith("$")) {
        c.skipTo(";");
        return;
      }
      const defaultValue = c.eat("=") ? value(c, [";", ","]) : "";
      t.fields.push({ name: tok.v.slice(1), type, visibility: vis(mods.set), isStatic: mods.set.has("static"), isReadOnly: mods.set.has("readonly"), defaultValue, doc: mods.doc });
      if (!c.eat(",")) break;
    }
    c.eat(";");
  }
}

export function reversePhp(files: { path: string; content: string }[]): ReverseResult {
  const types: RType[] = [];
  const errors: string[] = [];
  for (const f of files) {
    const p = new PhpParser(f.path);
    p.parse(f.content);
    types.push(...p.types);
    errors.push(...p.errors);
  }
  return { types, errors };
}
