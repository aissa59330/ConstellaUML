// Shared shapes of the code generators and reverse engineerers.

/** A generated file, relative to the output folder ("com/acme/Book.java"). */
export interface VirtualFile {
  path: string;
  content: string;
}

export interface GenOptions {
  /** Indentation unit: number of spaces, or 0 for a tab. */
  indent: number;
  /** Emit documentation comments from element documentation. */
  docComments: boolean;
  /** Turn navigable association ends into fields. */
  associationFields: boolean;
  /** SQL only. */
  dialect?: SqlDialect;
  /** SQL only: emit DROP TABLE IF EXISTS first. */
  dropTables?: boolean;
}

export type SqlDialect = "mysql" | "postgresql" | "sqlite";

export const DEFAULT_GEN_OPTIONS: GenOptions = { indent: 4, docComments: true, associationFields: true, dialect: "mysql", dropTables: false };

export type Language = "java" | "csharp" | "cpp" | "python" | "typescript" | "php" | "sql";

export const LANGUAGES: { id: Language; label: string; reverse: boolean; extensions: string[] }[] = [
  { id: "java", label: "Java", reverse: true, extensions: [".java"] },
  { id: "csharp", label: "C#", reverse: false, extensions: [".cs"] },
  { id: "cpp", label: "C++", reverse: false, extensions: [".h", ".cpp"] },
  { id: "python", label: "Python", reverse: true, extensions: [".py"] },
  { id: "typescript", label: "TypeScript", reverse: true, extensions: [".ts", ".tsx"] },
  { id: "php", label: "PHP", reverse: true, extensions: [".php"] },
  { id: "sql", label: "SQL (DDL)", reverse: true, extensions: [".sql"] },
];

export const indentUnit = (o: GenOptions) => (o.indent > 0 ? " ".repeat(o.indent) : "\t");

/** Line-based writer with indentation. */
export class Writer {
  private lines: string[] = [];
  private level = 0;
  constructor(private unit: string) {}
  line(s = ""): this {
    this.lines.push(s ? this.unit.repeat(this.level) + s : "");
    return this;
  }
  lines_(ss: string[]): this {
    for (const s of ss) this.line(s);
    return this;
  }
  in(): this {
    this.level++;
    return this;
  }
  out(): this {
    this.level = Math.max(0, this.level - 1);
    return this;
  }
  /** Removes trailing blank lines (before a closing brace). */
  trimEnd(): this {
    while (this.lines.length && this.lines[this.lines.length - 1] === "") this.lines.pop();
    return this;
  }
  toString(): string {
    return this.lines.join("\n").replace(/\n{3,}/g, "\n\n") + "\n";
  }
}
