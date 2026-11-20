// TypeScript declarations: classes, interfaces, enums, their members and
// constructor parameter properties. The folder of each file is its package.
import { type RField, type RMethod, type RParam, type RType, type ReverseResult, newType } from "./ir";
import { Cursor, type Token, joinTokens, splitTop, tokenize } from "../../core/lexer";

const MODIFIERS = new Set(["public", "protected", "private", "static", "readonly", "abstract", "override", "declare", "async", "accessor", "export", "default"]);
// A type continues on the next line after these tokens.
const CONTINUES = new Set(["|", "&", "=>", ":", ",", "<", "(", "[", "?", "extends", "keyof", "typeof", "=", "."]);
const TOP_KEYWORDS = new Set(["export", "class", "interface", "enum", "abstract", "declare", "import", "function", "const", "let", "var", "type", "namespace", "module"]);

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
    } else if (t.v === "@") {
      c.next();
      c.next();
      while (c.is(".") && c.isId(1)) c.i += 2;
      if (c.is("(")) c.skipGroup();
      // A modifier is followed by the member name, not by ( : ? = ; — "readonly(" is a method.
    } else if (t.k === "id" && MODIFIERS.has(t.v) && (c.isId(1) || c.is("[", 1) || c.is("{", 1) || c.is("*", 1) || c.peek(1)?.k === "str")) {
      set.add(t.v);
      c.next();
    } else break;
  }
  return { set, doc };
}

const vis = (m: Set<string>, name = "") => (m.has("private") || name.startsWith("#") ? "private" : m.has("protected") ? "protected" : "public");

/** Reads a type annotation up to the end of the member. */
function readType(c: Cursor): string {
  const toks: Token[] = [];
  let depth = 0;
  while (!c.done) {
    const t = c.peek()!;
    const prev = toks[toks.length - 1];
    if (depth === 0) {
      if ([";", ",", "=", ")", "}", "]"].includes(t.v)) break;
      if (t.v === "{" && prev && !CONTINUES.has(prev.v)) break;
      if (prev && t.line > prev.line && !CONTINUES.has(prev.v) && t.v !== "|" && t.v !== "&") break;
    }
    if (t.v === "(" || t.v === "[" || t.v === "{" || t.v === "<") depth++;
    else if (t.v === ")" || t.v === "]" || t.v === "}" || t.v === ">") {
      if (depth === 0) break;
      depth--;
    }
    toks.push(c.next()!);
  }
  return joinTokens(toks);
}

/** Skips an initializer / statement up to its end (semicolon or line break at depth 0). */
function skipValue(c: Cursor): string {
  const start = c.i;
  let last: Token | undefined;
  while (!c.done) {
    const t = c.peek()!;
    if (t.v === ";" || t.v === "," || t.v === "}" || t.v === ")") break;
    if (last && t.line > last.line && !CONTINUES.has(last.v) && !["?", ":", ".", "+", "-", "*", "/", "&&", "||", "??", "=>", "|", "&"].includes(t.v)) break;
    if (t.v === "(" || t.v === "[" || t.v === "{" || t.v === "<") {
      const s = c.i;
      if (t.v === "<" && !c.isId(1)) c.next();
      else c.skipGroup();
      last = c.toks[c.i - 1] ?? c.toks[s];
    } else last = c.next();
  }
  return joinTokens(c.toks.slice(start, c.i));
}

function parseParams(toks: Token[], fields?: RField[]): RParam[] {
  return splitTop(toks).map((p) => {
    const c = new Cursor(p);
    const mods = readMods(c);
    c.eat("...");
    const name = c.next()?.v ?? "arg";
    c.eat("?");
    const type = c.eat(":") ? readType(c) : "";
    const defaultValue = c.eat("=") ? joinTokens(p.slice(c.i)) : "";
    // Parameter properties: constructor(private readonly repo: Repo)
    if (fields && ["public", "protected", "private", "readonly"].some((m) => mods.set.has(m)))
      fields.push({ name, type, visibility: vis(mods.set), isStatic: false, isReadOnly: mods.set.has("readonly"), defaultValue, doc: "" });
    return { name, type, defaultValue };
  });
}

class TsParser {
  types: RType[] = [];
  errors: string[] = [];
  constructor(
    private file: string,
    private pkg: string[],
  ) {}

  parse(src: string): void {
    const c = new Cursor(
      tokenize(src, { lineComments: ["//"], blockComments: true, strings: ['"', "'", "`"], idChars: "$#", operators: ["===", "!==", "&&", "||", "??", "==", "!=", "<=", ">=", "?.", "**"] }),
    );
    while (!c.done) {
      const line = c.peek()!.line;
      try {
        if (!this.typeDecl(c)) this.skipStatement(c);
      } catch (e) {
        this.errors.push(`${this.file}:${line}: ${(e as Error).message}`);
        this.skipStatement(c);
      }
    }
  }

  skipStatement(c: Cursor): void {
    const first = c.next();
    let last = first;
    while (!c.done) {
      const t = c.peek()!;
      if (t.v === ";") {
        c.next();
        return;
      }
      if (last && t.line > last.line && TOP_KEYWORDS.has(t.v) && !CONTINUES.has(last.v)) return;
      if (t.v === "(" || t.v === "[" || t.v === "{") {
        c.skipGroup();
        last = c.toks[c.i - 1];
        if (t.v === "{" && !c.is(")") && !c.is(".") && !c.is(",")) return; // end of a function / block
      } else if (t.v === "}") {
        c.next();
        return;
      } else last = c.next();
    }
  }

  typeDecl(c: Cursor): boolean {
    const start = c.i;
    const mods = readMods(c);
    while (c.isKw("export") || c.isKw("default") || c.isKw("declare") || c.isKw("abstract") || c.isKw("const")) {
      mods.set.add(c.next()!.v);
    }
    let kind: RType["kind"] | undefined;
    if (c.eatKw("class")) kind = "class";
    else if (c.eatKw("interface")) kind = "interface";
    else if (c.eatKw("enum")) kind = "enum";
    if (!kind || !c.isId()) {
      c.i = start;
      return false;
    }
    const t = newType(kind, c.next()!.v, this.pkg);
    t.isAbstract = mods.set.has("abstract") || kind === "interface";
    t.doc = mods.doc;
    t.visibility = mods.set.has("export") ? "public" : "package";
    if (c.is("<")) t.typeParams = splitTop(c.group()).map((p) => p[0].v);
    const list = () => {
      const toks: Token[] = [];
      while (!c.done && !c.is("{") && !c.isKw("implements") && !c.isKw("extends")) toks.push(c.next()!);
      return splitTop(toks).map((p) => joinTokens(p).replace(/<.*$/, "").split(".").pop()!.trim());
    };
    while (!c.done && !c.is("{")) {
      if (c.eatKw("extends")) t.supers.push(...list());
      else if (c.eatKw("implements")) t.interfaces.push(...list());
      else c.next();
    }
    this.types.push(t);
    if (!c.is("{")) return true;
    if (kind === "enum") {
      for (const part of splitTop(c.group())) {
        const id = part.find((x) => x.k === "id" || x.k === "str");
        if (id) t.literals.push(id.v.replace(/^['"]|['"]$/g, ""));
      }
      return true;
    }
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
    if (c.eat(";") || c.eat(",")) return;
    const mods = readMods(c);
    // Accessors: get x() / set x(v)
    let accessor = "";
    if ((c.isKw("get") || c.isKw("set")) && (c.isId(1) || c.peek(1)?.k === "str")) accessor = c.next()!.v;
    if (c.is("[")) {
      // Index signature or computed name: skip.
      c.skipGroup();
      if (c.eat("?")) {
        /* optional */
      }
      if (c.eat(":")) readType(c);
      if (c.is("(")) c.skipGroup();
      if (c.is("{")) c.skipGroup();
      c.eat(";");
      return;
    }
    const nameTok = c.next();
    if (!nameTok || (nameTok.k !== "id" && nameTok.k !== "str")) {
      if (nameTok?.v === "{") c.i--, c.skipGroup();
      return;
    }
    const name = nameTok.v.replace(/^['"]|['"]$/g, "");
    c.eat("?");
    c.eat("!");
    if (c.is("<") || c.is("(")) {
      if (c.is("<")) c.skipGroup();
      const fields: RField[] = [];
      const params = parseParams(c.group(), name === "constructor" ? fields : undefined);
      t.fields.push(...fields);
      const returnType = c.eat(":") ? readType(c) : "";
      const hasBody = c.is("{");
      if (hasBody) c.skipGroup();
      else c.eat(";");
      if (accessor === "set") return;
      if (name === "constructor") {
        t.methods.push({ name: t.name, params, returnType: "", visibility: vis(mods.set), isStatic: false, isAbstract: false, doc: mods.doc });
        return;
      }
      // Overload signatures (no body, not abstract) repeat the implementation.
      if (!hasBody && t.kind === "class" && !mods.set.has("abstract")) return;
      const m: RMethod = { name, params, returnType, visibility: vis(mods.set, name), isStatic: mods.set.has("static"), isAbstract: mods.set.has("abstract") || t.kind === "interface", doc: mods.doc };
      if (accessor === "get") t.fields.push({ name, type: returnType, visibility: m.visibility, isStatic: m.isStatic, isReadOnly: true, defaultValue: "", doc: mods.doc });
      else t.methods.push(m);
      return;
    }
    const type = c.eat(":") ? readType(c) : "";
    let defaultValue = "";
    if (c.eat("=")) {
      defaultValue = skipValue(c);
      // Arrow function properties are methods in disguise; keep them as fields without the body.
      if (defaultValue.includes("=>")) defaultValue = "";
    }
    c.eat(";") || c.eat(",");
    t.fields.push({ name: name.replace(/^#/, ""), type, visibility: vis(mods.set, name), isStatic: mods.set.has("static"), isReadOnly: mods.set.has("readonly"), defaultValue, doc: mods.doc });
  }
}

export function reverseTypeScript(files: { path: string; content: string }[]): ReverseResult {
  const types: RType[] = [];
  const errors: string[] = [];
  for (const f of files) {
    if (f.path.endsWith(".d.ts") && f.content.length > 500_000) continue;
    const pkg = f.path.split("/").slice(0, -1).filter((s) => s && s !== ".");
    const p = new TsParser(f.path, pkg);
    p.parse(f.content);
    types.push(...p.types);
    errors.push(...p.errors);
  }
  return { types, errors };
}
