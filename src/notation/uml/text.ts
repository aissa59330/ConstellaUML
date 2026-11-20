// Textual notation of UML features: formatting for display and the quick-edit
// grammars (double-click / Enter on an element).
//
//   name      ::= ['<<' stereotype '>>'] [visibility] name
//   attribute ::= ['<<' st '>>'] [vis] ['/'] name [':' type] ['[' mult ']'] ['=' default]
//   operation ::= ['<<' st '>>'] [vis] name ['(' params ')'] [':' return-type]
//   param     ::= [direction] name [':' type] ['[' mult ']'] ['=' default]
import type { Element } from "../../core/element";
import { isRef } from "../../core/element";

export type Visibility = "public" | "protected" | "private" | "package";

const VIS_TO_SYMBOL: Record<string, string> = { public: "+", protected: "#", private: "-", package: "~" };
const SYMBOL_TO_VIS: Record<string, Visibility> = { "+": "public", "#": "protected", "-": "private", "~": "package" };

export function visibilitySymbol(v: string | undefined): string {
  return VIS_TO_SYMBOL[v ?? "public"] ?? "";
}

/** Name of a typeRef value: plain string or a referenced element. */
export type Resolver = (ref: unknown) => Element | undefined;

export function typeName(t: unknown, resolve: Resolver): string {
  if (typeof t === "string") return t;
  if (isRef(t)) return resolve(t)?.name ?? "";
  return "";
}

export function stereotypeName(st: unknown, resolve: Resolver): string {
  return typeName(st, resolve);
}

export interface FeatureFormat {
  showVisibility: boolean;
  showType: boolean;
  showMultiplicity: boolean;
  showProperty: boolean;
  showOperationSignature: boolean;
}

export const DEFAULT_FORMAT: FeatureFormat = { showVisibility: true, showType: true, showMultiplicity: true, showProperty: true, showOperationSignature: true };

function props(el: Element, flags: [string, string][]): string[] {
  return flags.filter(([f]) => el[f]).map(([, label]) => label);
}

export function formatAttribute(a: Element, resolve: Resolver, f: FeatureFormat = DEFAULT_FORMAT): string {
  let s = "";
  const st = stereotypeName(a.stereotype, resolve);
  if (st) s += `«${st}» `;
  if (f.showVisibility) s += visibilitySymbol(a.visibility);
  if (a.isDerived) s += "/";
  s += a.name ?? "";
  const t = typeName(a.type, resolve);
  if (f.showType && t) s += `: ${t}`;
  if (f.showMultiplicity && a.multiplicity) s += `[${a.multiplicity}]`;
  if (a.defaultValue) s += ` = ${a.defaultValue}`;
  if (f.showProperty) {
    const p = props(a, [["isID", "id"], ["isReadOnly", "readOnly"], ["isOrdered", "ordered"], ["isUnique", "unique"]]);
    if (p.length) s += ` {${p.join(", ")}}`;
  }
  return s;
}

export function formatParameter(p: Element, resolve: Resolver, f: FeatureFormat = DEFAULT_FORMAT): string {
  let s = p.direction && p.direction !== "in" ? `${p.direction} ` : "";
  s += p.name ?? "";
  const t = typeName(p.type, resolve);
  if (f.showType && t) s += `: ${t}`;
  if (f.showMultiplicity && p.multiplicity) s += `[${p.multiplicity}]`;
  if (p.defaultValue) s += ` = ${p.defaultValue}`;
  return s;
}

export function formatOperation(o: Element, resolve: Resolver, f: FeatureFormat = DEFAULT_FORMAT): string {
  let s = "";
  const st = stereotypeName(o.stereotype, resolve);
  if (st) s += `«${st}» `;
  if (f.showVisibility) s += visibilitySymbol(o.visibility);
  s += o.name ?? "";
  const params: Element[] = o.parameters ?? [];
  const ret = params.find((p) => p.direction === "return");
  if (f.showOperationSignature) {
    s += `(${params.filter((p) => p.direction !== "return").map((p) => formatParameter(p, resolve, f)).join(", ")})`;
    const rt = ret ? typeName(ret.type, resolve) : "";
    if (rt && f.showType) s += `: ${rt}${ret?.multiplicity && f.showMultiplicity ? `[${ret.multiplicity}]` : ""}`;
  } else s += "()";
  if (f.showProperty) {
    const p = props(o, [["isQuery", "query"]]);
    if (p.length) s += ` {${p.join(", ")}}`;
  }
  return s;
}

export function formatTemplateParameter(t: Element): string {
  return `${t.name ?? ""}${t.parameterType ? `: ${t.parameterType}` : ""}${t.defaultValue ? ` = ${t.defaultValue}` : ""}`;
}

// ---- quick-edit parsing -------------------------------------------------

export interface ParsedName {
  stereotype?: string;
  visibility?: Visibility;
  name: string;
}

export interface ParsedAttribute extends ParsedName {
  isDerived?: boolean;
  type?: string;
  multiplicity?: string;
  defaultValue?: string;
}

export interface ParsedParameter {
  direction?: "in" | "out" | "inout" | "return";
  name: string;
  type?: string;
  multiplicity?: string;
  defaultValue?: string;
}

export interface ParsedOperation extends ParsedName {
  parameters?: ParsedParameter[];
  returnType?: string;
}

export class ParseError extends Error {}

function takeStereotypeAndVisibility(input: string): { rest: string; stereotype?: string; visibility?: Visibility } {
  let rest = input.trim();
  let stereotype: string | undefined;
  const st = /^(?:<<|«)\s*([^>»]*?)\s*(?:>>|»)\s*/.exec(rest);
  if (st) {
    stereotype = st[1];
    rest = rest.slice(st[0].length);
  }
  let visibility: Visibility | undefined;
  if (rest[0] && SYMBOL_TO_VIS[rest[0]]) {
    visibility = SYMBOL_TO_VIS[rest[0]];
    rest = rest.slice(1).trimStart();
  }
  return { rest, stereotype, visibility };
}

export function parseName(input: string): ParsedName {
  const { rest, stereotype, visibility } = takeStereotypeAndVisibility(input);
  return { stereotype, visibility, name: rest.trim() };
}

/** Splits on `sep` at top level (ignoring separators nested in (), [], <>, quotes). */
function splitTop(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0, quote = "", cur = "";
  for (const ch of s) {
    if (quote) {
      if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") quote = ch;
    else if ("([<{".includes(ch)) depth++;
    else if (")]>}".includes(ch)) depth--;
    else if (ch === sep && depth === 0) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function indexTop(s: string, ch: string): number {
  let depth = 0, quote = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === quote) quote = "";
    } else if (c === '"' || c === "'") quote = c;
    else if ("([<{".includes(c)) depth++;
    else if (")]>}".includes(c)) depth--;
    else if (c === ch && depth === 0) return i;
  }
  return -1;
}

const IDENT = /^[\p{L}_$][\p{L}\p{N}_$]*$/u;

function parseTypedTail(s: string): { name: string; type?: string; multiplicity?: string; defaultValue?: string } {
  let rest = s;
  let defaultValue: string | undefined;
  const eq = indexTop(rest, "=");
  if (eq >= 0) {
    defaultValue = rest.slice(eq + 1).trim();
    rest = rest.slice(0, eq);
  }
  let multiplicity: string | undefined;
  const m = /\[\s*([^\]]*?)\s*\]\s*$/.exec(rest);
  if (m) {
    multiplicity = m[1];
    rest = rest.slice(0, m.index);
  }
  let type: string | undefined;
  const colon = indexTop(rest, ":");
  if (colon >= 0) {
    type = rest.slice(colon + 1).trim();
    rest = rest.slice(0, colon);
  }
  const name = rest.trim();
  if (multiplicity !== undefined && !/^(\*|\d+)(\s*\.\.\s*(\*|\d+))?$/.test(multiplicity)) throw new ParseError(`Multiplicité invalide : [${multiplicity}]`);
  return { name, type: type || undefined, multiplicity: multiplicity?.replace(/\s+/g, ""), defaultValue: defaultValue || undefined };
}

export function parseAttribute(input: string): ParsedAttribute {
  const { rest, stereotype, visibility } = takeStereotypeAndVisibility(input);
  let r = rest;
  let isDerived: boolean | undefined;
  if (r.startsWith("/")) {
    isDerived = true;
    r = r.slice(1);
  }
  const t = parseTypedTail(r);
  if (!t.name) throw new ParseError("Nom d'attribut manquant");
  if (!IDENT.test(t.name)) throw new ParseError(`Nom d'attribut invalide : ${t.name}`);
  return { stereotype, visibility, isDerived, ...t };
}

export function parseParameter(input: string): ParsedParameter {
  let s = input.trim();
  let direction: ParsedParameter["direction"];
  const d = /^(in|out|inout)\s+/.exec(s);
  if (d) {
    direction = d[1] as ParsedParameter["direction"];
    s = s.slice(d[0].length);
  }
  const t = parseTypedTail(s);
  if (!t.name) throw new ParseError("Nom de paramètre manquant");
  return { direction, ...t };
}

export function parseOperation(input: string): ParsedOperation {
  const { rest, stereotype, visibility } = takeStereotypeAndVisibility(input);
  const open = rest.indexOf("(");
  if (open < 0) {
    const colon = indexTop(rest, ":");
    const name = (colon >= 0 ? rest.slice(0, colon) : rest).trim();
    if (!name) throw new ParseError("Nom d'opération manquant");
    return { stereotype, visibility, name, returnType: colon >= 0 ? rest.slice(colon + 1).trim() || undefined : undefined };
  }
  const name = rest.slice(0, open).trim();
  if (!name) throw new ParseError("Nom d'opération manquant");
  let depth = 0, close = -1;
  for (let i = open; i < rest.length; i++) {
    if (rest[i] === "(") depth++;
    else if (rest[i] === ")" && --depth === 0) {
      close = i;
      break;
    }
  }
  if (close < 0) throw new ParseError("Parenthèse fermante manquante");
  const inside = rest.slice(open + 1, close).trim();
  const parameters = inside ? splitTop(inside, ",").map(parseParameter) : [];
  const after = rest.slice(close + 1).trim();
  let returnType: string | undefined;
  if (after) {
    if (!after.startsWith(":")) throw new ParseError(`Texte inattendu après la signature : ${after}`);
    returnType = after.slice(1).trim() || undefined;
  }
  return { stereotype, visibility, name, parameters, returnType };
}

/** Multiplicity text for association ends: "1", "0..1", "*", "1..*"… */
export function isValidMultiplicity(m: string): boolean {
  return m === "" || /^(\*|\d+)(\.\.(\*|\d+))?$/.test(m.trim());
}
