// Java declarations (packages, classes, interfaces, enums, records, fields,
// methods, constructors). Method bodies are skipped, never parsed.
import { type RMethod, type RType, type ReverseResult, newType } from "./ir";
import { Cursor, type Token, joinTokens, splitTop, tokenize } from "../../core/lexer";

const MODIFIERS = new Set(["public", "protected", "private", "static", "final", "abstract", "native", "synchronized", "transient", "volatile", "strictfp", "default", "sealed", "non-sealed"]);

interface Mods {
  set: Set<string>;
  doc: string;
}

function readMods(c: Cursor): Mods {
  const set = new Set<string>();
  let doc = "";
  for (;;) {
    const t = c.peek();
    if (!t) break;
    if (t.k === "doc") {
      doc = t.v;
      c.next();
    } else if (t.v === "@" && !c.isKw("interface", 1)) {
      c.next();
      c.next();
      while (c.is(".") && c.isId(1)) c.i += 2;
      if (c.is("(")) c.skipGroup();
    } else if (t.k === "id" && (MODIFIERS.has(t.v) || (t.v === "non" && c.is("-", 1)))) {
      if (t.v === "non") c.i += 2;
      set.add(t.v);
      c.next();
    } else break;
  }
  return { set, doc };
}

const vis = (m: Set<string>, dflt = "package") => (m.has("public") ? "public" : m.has("protected") ? "protected" : m.has("private") ? "private" : dflt);

/** `extends A<B>, C` → ["A", "C"] (type arguments dropped). */
function typeList(c: Cursor, stops: string[]): string[] {
  const toks: Token[] = [];
  while (!c.done && !c.is("{") && !stops.some((s) => c.isKw(s))) toks.push(c.next()!);
  return splitTop(toks).map((p) => joinTokens(p).replace(/<.*$/, "").split(".").pop()!.trim());
}

function parseParams(toks: Token[]): RMethod["params"] {
  return splitTop(toks).map((p) => {
    const c = new Cursor(p);
    readMods(c);
    const rest = p.slice(c.i).filter((t) => t.v !== "final");
    const name = rest[rest.length - 1]?.v ?? "arg";
    let type = joinTokens(rest.slice(0, -1));
    if (type.endsWith("...")) type = `${type.slice(0, -3).trim()}[]`;
    return { name, type, defaultValue: "" };
  });
}

class JavaParser {
  types: RType[] = [];
  errors: string[] = [];
  pkg: string[] = [];
  constructor(private file: string) {}

  parse(src: string): void {
    const c = new Cursor(tokenize(src, { lineComments: ["//"], blockComments: true, strings: ['"', "'"], operators: ["&&", "||", "==", "!=", "<=", ">=", "->"] }));
    while (!c.done) {
      const line = c.peek()!.line;
      try {
        if (c.isKw("package")) {
          c.next();
          const parts: string[] = [];
          while (!c.done && !c.is(";")) {
            const t = c.next()!;
            if (t.k === "id") parts.push(t.v);
          }
          c.eat(";");
          this.pkg = parts;
        } else if (c.isKw("import")) c.skipTo(";");
        else if (!this.typeDecl(c)) {
          this.errors.push(`${this.file}:${line}: déclaration ignorée (« ${c.peek()?.v} »)`);
          c.skipTo(";", "}");
          if (c.is("}")) c.next();
        }
      } catch (e) {
        this.errors.push(`${this.file}:${line}: ${(e as Error).message}`);
        c.skipTo(";");
      }
    }
  }

  /** Parses a type declaration at the cursor; false if there is none. */
  typeDecl(c: Cursor): boolean {
    const start = c.i;
    const mods = readMods(c);
    let kind: RType["kind"] | "record" | undefined;
    if (c.eatKw("class")) kind = "class";
    else if (c.eatKw("interface")) kind = "interface";
    else if (c.eatKw("enum")) kind = "enum";
    else if (c.isKw("record") && c.isId(1)) {
      c.next();
      kind = "record";
    } else if (c.is("@") && c.isKw("interface", 1)) {
      c.i += 2;
      kind = "interface";
    }
    if (!kind) {
      c.i = start;
      return false;
    }
    const name = c.next()?.v ?? "Unnamed";
    const t = newType(kind === "record" ? "class" : kind, name, this.pkg);
    t.visibility = vis(mods.set);
    t.isAbstract = mods.set.has("abstract") || kind === "interface";
    t.isFinal = mods.set.has("final") || kind === "record";
    t.doc = mods.doc;
    if (c.is("<")) t.typeParams = splitTop(c.group()).map((p) => p[0].v);
    if (kind === "record" && c.is("(")) {
      for (const p of parseParams(c.group())) t.fields.push({ name: p.name, type: p.type, visibility: "private", isStatic: false, isReadOnly: true, defaultValue: "", doc: "" });
    }
    while (!c.done && !c.is("{")) {
      if (c.eatKw("extends")) t.supers.push(...typeList(c, ["implements", "permits"]));
      else if (c.eatKw("implements")) t.interfaces.push(...typeList(c, ["permits"]));
      else if (c.eatKw("permits")) typeList(c, []);
      else c.next();
    }
    this.types.push(t);
    if (!c.is("{")) return true;
    this.body(c, t);
    return true;
  }

  body(c: Cursor, t: RType): void {
    c.next(); // {
    if (t.kind === "enum") {
      // Constants up to ";" or "}".
      while (!c.done && !c.is(";") && !c.is("}")) {
        readMods(c);
        const id = c.next();
        if (id?.k === "id") t.literals.push(id.v);
        if (c.is("(")) c.skipGroup();
        if (c.is("{")) c.skipGroup();
        c.eat(",");
      }
      c.eat(";");
    }
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
  }

  member(c: Cursor, t: RType): void {
    if (c.eat(";")) return;
    if (c.is("{") || (c.isKw("static") && c.is("{", 1))) {
      if (c.isKw("static")) c.next();
      c.skipGroup();
      return;
    }
    const save = c.i;
    if (this.typeDecl(c)) return;
    c.i = save;
    const mods = readMods(c);
    if (c.is("<")) c.skipGroup(); // generic method type parameters
    const head: Token[] = [];
    while (!c.done && !c.is("(") && !c.is("=") && !c.is(";") && !c.is(",") && !c.is("}") && !c.is("{")) {
      if (c.is("<")) {
        const s = c.i;
        c.skipGroup();
        head.push(...c.toks.slice(s, c.i));
      } else head.push(c.next()!);
    }
    if (c.is("{") || c.is("}") || !head.length) {
      if (c.is("{")) c.skipGroup();
      if (!head.length && !c.is("}")) c.next();
      return;
    }
    const inInterface = t.kind === "interface";
    if (c.is("(")) {
      const name = head[head.length - 1].v;
      const isCtor = head.length === 1 && name === t.name;
      const params = parseParams(c.paramGroup());
      while (!c.done && !c.is("{") && !c.is(";") && !c.is("}")) c.next(); // throws …, default value
      const hasBody = c.is("{");
      if (hasBody) c.skipGroup();
      else c.eat(";");
      t.methods.push({
        name,
        params,
        returnType: isCtor ? "" : joinTokens(head.slice(0, -1)),
        visibility: vis(mods.set, inInterface ? "public" : "package"),
        isStatic: mods.set.has("static"),
        isAbstract: mods.set.has("abstract") || (inInterface && !hasBody && !mods.set.has("static")),
        doc: mods.doc,
      });
      return;
    }
    // Field(s): Type a = 1, b[];
    const type = joinTokens(head.slice(0, -1));
    let name = head[head.length - 1].v;
    for (;;) {
      let arr = "";
      while (c.is("[") && c.is("]", 1)) {
        c.i += 2;
        arr += "[]";
      }
      let defaultValue = "";
      if (c.eat("=")) {
        const s = c.i;
        while (!c.done && !c.is(",") && !c.is(";") && !c.is("}")) {
          if (c.is("(") || c.is("{") || c.is("[")) c.skipGroup();
          else c.next();
        }
        defaultValue = joinTokens(c.toks.slice(s, c.i));
      }
      t.fields.push({
        name,
        type: type + arr,
        visibility: vis(mods.set, inInterface ? "public" : "package"),
        isStatic: mods.set.has("static") || inInterface,
        isReadOnly: mods.set.has("final") || inInterface,
        defaultValue,
        doc: mods.doc,
      });
      if (!c.eat(",")) break;
      name = c.next()?.v ?? "field";
    }
    c.eat(";");
  }
}

export function reverseJava(files: { path: string; content: string }[]): ReverseResult {
  const types: RType[] = [];
  const errors: string[] = [];
  for (const f of files) {
    const p = new JavaParser(f.path);
    p.parse(f.content);
    types.push(...p.types);
    errors.push(...p.errors);
  }
  return { types, errors };
}
