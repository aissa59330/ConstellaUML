// Python classes (indentation-based): bases, Enum/ABC/Protocol, class
// attributes, annotated attributes and `self.x` assignments in __init__,
// methods with type hints, @staticmethod / @classmethod / @abstractmethod.
import { type RMethod, type RParam, type RType, type ReverseResult, newType } from "./ir";

interface Line {
  indent: number;
  text: string;
  no: number;
}

/** Logical lines: comments removed, bracketed continuations and strings joined. */
function logicalLines(src: string): Line[] {
  const out: Line[] = [];
  const raw = src.replace(/\r\n?/g, "\n").split("\n");
  let buf = "";
  let start = 0;
  let indent = 0;
  let depth = 0;
  let inTriple: string | null = null;
  for (let i = 0; i < raw.length; i++) {
    const line = raw[i];
    let text = "";
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      if (inTriple) {
        if (line.startsWith(inTriple, j)) {
          text += inTriple;
          j += 2;
          inTriple = null;
        } else text += ch;
        continue;
      }
      if (line.startsWith('"""', j) || line.startsWith("'''", j)) {
        inTriple = line.slice(j, j + 3);
        text += inTriple;
        j += 2;
        continue;
      }
      if (ch === "#") break;
      if (ch === '"' || ch === "'") {
        let k = j + 1;
        while (k < line.length && line[k] !== ch) k += line[k] === "\\" ? 2 : 1;
        text += line.slice(j, k + 1);
        j = k;
        continue;
      }
      if ("([{".includes(ch)) depth++;
      if (")]}".includes(ch)) depth = Math.max(0, depth - 1);
      text += ch;
    }
    if (!buf) {
      start = i + 1;
      indent = line.length - line.trimStart().length;
    }
    buf += (buf ? " " : "") + text.trim();
    if (inTriple) {
      buf += "\n";
      continue;
    }
    if (depth > 0 || text.trimEnd().endsWith("\\")) {
      buf = buf.replace(/\\$/, "");
      continue;
    }
    if (buf.trim()) out.push({ indent, text: buf.trim(), no: start });
    buf = "";
  }
  if (buf.trim()) out.push({ indent, text: buf.trim(), no: start });
  return out;
}

/** Splits on top-level commas. */
function splitArgs(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  let quote = "";
  for (const ch of s) {
    if (quote) {
      if (ch === quote) quote = "";
      cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    if ("([{".includes(ch)) depth++;
    if (")]}".includes(ch)) depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

const visOf = (name: string) => (name.startsWith("__") && !name.endsWith("__") ? "private" : name.startsWith("_") && !name.endsWith("__") ? "protected" : "public");
const bare = (name: string) => (name.endsWith("__") ? name : name.replace(/^_+/, ""));

function docOf(lines: Line[], i: number, bodyIndent: number): string {
  const l = lines[i];
  if (!l || l.indent < bodyIndent) return "";
  const m = /^[rRuU]?("""|''')([\s\S]*?)\1$/.exec(l.text) ?? /^[rRuU]?(["'])(.*)\1$/.exec(l.text);
  return m ? m[2].split("\n").map((x) => x.trim()).join("\n").trim() : "";
}

function parseParams(s: string): RParam[] {
  return splitArgs(s)
    .filter((p) => p !== "/" && p !== "*" && !/^(self|cls)$/.test(p.split(/[:=]/)[0].trim()))
    .map((p) => {
      const eq = p.indexOf("=", p.indexOf(":") >= 0 ? p.indexOf(":") : 0);
      const [head, defaultValue] = eq >= 0 && p[eq + 1] !== "=" ? [p.slice(0, eq), p.slice(eq + 1).trim()] : [p, ""];
      const [name, type = ""] = head.split(":").map((x) => x.trim());
      return { name: name.replace(/^\*+/, ""), type, defaultValue };
    });
}

export function reversePython(files: { path: string; content: string }[]): ReverseResult {
  const types: RType[] = [];
  const errors: string[] = [];
  for (const f of files) {
    const segments = f.path.replace(/\.py$/, "").split("/").filter((s) => s && s !== ".");
    // A module's package is its folder (an __init__.py module belongs to the package itself).
    const pkg = segments.slice(0, -1);
    const lines = logicalLines(f.content);
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const cm = /^class\s+(\w+)\s*(?:\[(.*?)\])?\s*(?:\((.*)\))?\s*:/.exec(l.text);
      if (!cm || l.indent !== 0) continue;
      try {
        const bases = splitArgs(cm[3] ?? "").filter((b) => !b.includes("="));
        const kind: RType["kind"] = bases.some((b) => /\b(Enum|IntEnum|StrEnum|Flag)$/.test(b)) ? "enum" : bases.some((b) => /\bProtocol\b/.test(b)) ? "interface" : "class";
        const t = newType(kind, cm[1], pkg);
        t.typeParams = cm[2] ? splitArgs(cm[2]) : [];
        t.supers = bases.filter((b) => !/^(object|ABC|ABCMeta|Enum|IntEnum|StrEnum|Flag|Protocol|Generic\[.*\]|metaclass)$/.test(b)).map((b) => b.replace(/\[.*$/, "").split(".").pop()!);
        t.isAbstract = bases.some((b) => /^(ABC|Protocol)$/.test(b));
        // Class body: lines indented more than the class line.
        let j = i + 1;
        const bodyIndent = lines[j]?.indent ?? 4;
        t.doc = docOf(lines, j, bodyIndent);
        let decorators: string[] = [];
        while (j < lines.length && lines[j].indent > l.indent) {
          const b = lines[j];
          if (b.indent !== bodyIndent) {
            j++;
            continue;
          }
          if (b.text.startsWith("@")) {
            decorators.push(b.text.slice(1).split("(")[0]);
            j++;
            continue;
          }
          const fm = /^(?:async\s+)?def\s+(\w+)\s*\((.*)\)\s*(?:->\s*(.+?))?\s*:/.exec(b.text);
          if (fm) {
            const name = fm[1];
            const isStatic = decorators.includes("staticmethod") || decorators.includes("classmethod");
            const method: RMethod = {
              name: bare(name),
              params: parseParams(fm[2]),
              returnType: (fm[3] ?? "").replace(/^None$/, ""),
              visibility: visOf(name),
              isStatic,
              isAbstract: decorators.some((d) => d.endsWith("abstractmethod")),
              doc: docOf(lines, j + 1, b.indent + 1),
            };
            if (method.isAbstract) t.isAbstract = true;
            const isProperty = decorators.includes("property");
            // __init__: collect self.x attributes.
            let k = j + 1;
            while (k < lines.length && lines[k].indent > b.indent) {
              const sm = /^self\.(\w+)\s*(?::\s*([^=]+?))?\s*=\s*(.+)$/.exec(lines[k].text);
              if (name === "__init__" && sm && !t.fields.some((x) => x.name === bare(sm[1]))) {
                const param = method.params.find((p) => p.name === sm[3].trim());
                t.fields.push({ name: bare(sm[1]), type: (sm[2] ?? param?.type ?? "").trim(), visibility: visOf(sm[1]), isStatic: false, isReadOnly: false, defaultValue: param ? "" : sm[3].trim(), doc: "" });
              }
              k++;
            }
            if (isProperty) t.fields.push({ name: bare(name), type: method.returnType, visibility: visOf(name), isStatic: false, isReadOnly: true, defaultValue: "", doc: method.doc });
            else if (!decorators.some((d) => d.endsWith(".setter") || d.endsWith(".deleter")) && name !== "__init__") t.methods.push(method);
            else if (name === "__init__" && method.params.length) t.methods.push({ ...method, name: t.name });
            decorators = [];
            j = k;
            continue;
          }
          decorators = [];
          // Class attributes: NAME: type = value | NAME = value
          const am = /^(\w+)\s*(?::\s*([^=]+?))?\s*(?:=\s*(.+))?$/.exec(b.text);
          if (am && (am[2] || am[3]) && !/^(pass|return|raise)$/.test(am[1])) {
            if (kind === "enum") t.literals.push(am[1]);
            else {
              const classVar = /^ClassVar\[(.*)\]$/.exec(am[2]?.trim() ?? "");
              // Dataclass-style annotations are instance fields; plain assignments are class (static) attributes.
              t.fields.push({ name: bare(am[1]), type: (classVar ? classVar[1] : am[2] ?? "").trim(), visibility: visOf(am[1]), isStatic: !!classVar || !am[2], isReadOnly: /^[A-Z][A-Z0-9_]*$/.test(am[1]), defaultValue: (am[3] ?? "").trim(), doc: "" });
            }
          }
          j++;
        }
        types.push(t);
        i = j - 1;
      } catch (e) {
        errors.push(`${f.path}:${l.no}: ${(e as Error).message}`);
      }
    }
  }
  return { types, errors };
}
