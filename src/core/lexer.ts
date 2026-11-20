// Tolerant tokenizer shared by the reverse engineerers. It never throws: an
// unterminated string or comment simply runs to the end of the input.

export type TokKind = "id" | "num" | "str" | "punct" | "doc";

export interface Token {
  k: TokKind;
  v: string;
  line: number;
  /** Doc comments: the comment as written (tags included). */
  raw?: string;
}

export interface LexOptions {
  lineComments: string[];
  /** `/* *\/` comments; `/** *\/` ones become "doc" tokens. */
  blockComments: boolean;
  /** Quote characters of string literals. */
  strings: string[];
  /** Quote characters of quoted identifiers (SQL `x`, "x"). */
  quotedIds?: string[];
  /** Extra characters allowed in identifiers (e.g. "$"). */
  idChars?: string;
  /** Multi-character operators to keep together. */
  operators?: string[];
}

export function tokenize(src: string, o: LexOptions): Token[] {
  const out: Token[] = [];
  const idExtra = o.idChars ?? "";
  const ops = [...(o.operators ?? []), "::", "=>", "->", "..."].sort((a, b) => b.length - a.length);
  let i = 0;
  let line = 1;
  const n = src.length;
  const isIdStart = (c: string) => /[A-Za-z_À-￿]/.test(c) || idExtra.includes(c);
  const isId = (c: string) => /[\wÀ-￿]/.test(c) || idExtra.includes(c);
  const countLines = (s: string) => {
    for (const c of s) if (c === "\n") line++;
  };
  while (i < n) {
    const c = src[i];
    if (c === "\n") {
      line++;
      i++;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r" || c === "\f") {
      i++;
      continue;
    }
    const lc = o.lineComments.find((p) => src.startsWith(p, i));
    if (lc) {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (o.blockComments && src.startsWith("/*", i)) {
      const end = src.indexOf("*/", i + 2);
      const stop = end < 0 ? n : end + 2;
      const text = src.slice(i, stop);
      if (text.startsWith("/**") && text !== "/**/") out.push({ k: "doc", v: cleanDoc(text), line, raw: text });
      countLines(text);
      i = stop;
      continue;
    }
    if (o.strings.includes(c) || o.quotedIds?.includes(c)) {
      // Java/Python text blocks.
      const triple = c + c + c;
      const isTriple = src.startsWith(triple, i);
      const close = isTriple ? triple : c;
      let j = i + close.length;
      while (j < n && !src.startsWith(close, j)) {
        if (src[j] === "\\" && !o.quotedIds?.includes(c)) j++;
        else if (!isTriple && src[j] === "\n" && c !== "`") break;
        j++;
      }
      const stop = Math.min(n, j + close.length);
      const text = src.slice(i, stop);
      const inner = src.slice(i + close.length, Math.min(j, n));
      if (o.quotedIds?.includes(c)) out.push({ k: "id", v: inner, line });
      else out.push({ k: "str", v: text, line });
      countLines(text);
      i = stop;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      let j = i + 1;
      while (j < n && /[\w.]/.test(src[j])) j++;
      out.push({ k: "num", v: src.slice(i, j), line });
      i = j;
      continue;
    }
    if (isIdStart(c)) {
      let j = i + 1;
      while (j < n && isId(src[j])) j++;
      out.push({ k: "id", v: src.slice(i, j), line });
      i = j;
      continue;
    }
    const op = ops.find((p) => src.startsWith(p, i));
    if (op) {
      out.push({ k: "punct", v: op, line });
      i += op.length;
      continue;
    }
    out.push({ k: "punct", v: c, line });
    i++;
  }
  return out;
}

/** Text of a /** doc comment without the stars, @tags dropped. */
export function cleanDoc(text: string): string {
  const body = text.replace(/^\/\*\*+/, "").replace(/\*+\/$/, "");
  const lines = body.split(/\r?\n/).map((l) => l.replace(/^\s*\*\s?/, "").trimEnd());
  const kept: string[] = [];
  for (const l of lines) {
    if (/^\s*@/.test(l)) break;
    kept.push(l);
  }
  return kept.join("\n").trim();
}

/** Cursor over tokens with bracket-aware skipping. */
export class Cursor {
  i = 0;
  constructor(public toks: Token[]) {}
  get done(): boolean {
    return this.i >= this.toks.length;
  }
  peek(o = 0): Token | undefined {
    return this.toks[this.i + o];
  }
  is(v: string, o = 0): boolean {
    return this.toks[this.i + o]?.v === v;
  }
  isId(o = 0): boolean {
    return this.toks[this.i + o]?.k === "id";
  }
  /** Case-insensitive keyword test (SQL). */
  isKw(v: string, o = 0): boolean {
    const t = this.toks[this.i + o];
    return !!t && t.k === "id" && t.v.toLowerCase() === v.toLowerCase();
  }
  next(): Token | undefined {
    return this.toks[this.i++];
  }
  eat(v: string): boolean {
    if (this.is(v)) {
      this.i++;
      return true;
    }
    return false;
  }
  eatKw(...vs: string[]): boolean {
    if (vs.every((v, k) => this.isKw(v, k))) {
      this.i += vs.length;
      return true;
    }
    return false;
  }
  /** Skips a balanced (...), [...], {...} or <...> group starting at the current token. */
  skipGroup(): void {
    const open = this.peek()?.v;
    const close = open === "(" ? ")" : open === "[" ? "]" : open === "{" ? "}" : open === "<" ? ">" : undefined;
    if (!close) {
      this.i++;
      return;
    }
    const start = this.i;
    let depth = 0;
    while (!this.done) {
      const v = this.next()!.v;
      if (v === open) depth++;
      else if (v === close && --depth === 0) return;
      // Generic angle brackets never span statements: stop at a brace or semicolon.
      else if (open === "<" && (v === ";" || v === "{" || v === "}")) {
        this.i--;
        return;
      }
    }
    // Never closed (syntax error): skip the opening bracket only, keep the rest readable.
    this.i = start + 1;
  }
  /**
   * Tokens of a parameter list "( … )". Declarations never contain "{" or ";"
   * there, so an unclosed list stops before them instead of swallowing the body.
   */
  paramGroup(): Token[] {
    const start = ++this.i;
    let depth = 1;
    while (!this.done) {
      const v = this.peek()!.v;
      if (depth === 1 && (v === "{" || v === ";")) return this.toks.slice(start, this.i);
      this.i++;
      if (v === "(") depth++;
      else if (v === ")" && --depth === 0) return this.toks.slice(start, this.i - 1);
    }
    return this.toks.slice(start, this.i);
  }
  /** Tokens of a balanced group, without the outer brackets. */
  group(): Token[] {
    const start = this.i;
    this.skipGroup();
    return this.toks.slice(start + 1, this.i - 1);
  }
  /** Advances to just after the next `stop` token at depth 0 (or before a closing brace). */
  skipTo(...stops: string[]): void {
    while (!this.done) {
      const t = this.peek()!;
      if (stops.includes(t.v)) {
        this.i++;
        return;
      }
      if (t.v === "}") return;
      if (t.v === "(" || t.v === "[" || t.v === "{") this.skipGroup();
      else this.i++;
    }
  }
}

/** Joins tokens back into source-like text (types, default values). */
export function joinTokens(toks: Token[]): string {
  let s = "";
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    const prev = toks[k - 1];
    const glue = !prev || /^[<>()[\],.?:]$/.test(t.v) || /^[<(.[?]$/.test(prev.v) || t.v === "::" || prev.v === "::" || prev.v === "\\" || t.v === "\\";
    s += (glue ? "" : " ") + t.v;
  }
  return s.replace(/,(?=\S)/g, ", ");
}

/** Splits tokens on top-level commas. */
export function splitTop(toks: Token[], sep = ","): Token[][] {
  const parts: Token[][] = [[]];
  let depth = 0;
  for (const t of toks) {
    if (t.v === "(" || t.v === "[" || t.v === "{" || t.v === "<") depth++;
    else if (t.v === ")" || t.v === "]" || t.v === "}" || t.v === ">") depth--;
    if (t.v === sep && depth === 0) parts.push([]);
    else parts[parts.length - 1].push(t);
  }
  return parts.filter((p) => p.length);
}
