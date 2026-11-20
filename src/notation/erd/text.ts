// Textual form of ERD columns, shared by the entity view and the quick-edit.
import type { Element } from "../../core/element";

/** "VARCHAR(255)" from a column's type and length. */
export function columnType(c: Element): string {
  const t = String(c.type ?? "").trim();
  const len = String(c.length ?? "").trim();
  return len && !t.includes("(") ? `${t}(${len})` : t;
}

/** Key marker shown in the entity's left gutter. */
export function keyMarker(c: Element): string {
  return c.primaryKey && c.foreignKey ? "PF" : c.primaryKey ? "PK" : c.foreignKey ? "FK" : "";
}

/** "name: TYPE(len) [flags]" as typed in the quick-edit. */
export function formatColumn(c: Element): string {
  const flags = [c.primaryKey && "PK", c.foreignKey && "FK", c.nullable && "NULL", c.unique && "UNIQUE"].filter(Boolean).join(" ");
  const t = columnType(c);
  return `${c.name ?? ""}${t ? `: ${t}` : ""}${flags ? ` ${flags}` : ""}${c.defaultValue ? ` = ${c.defaultValue}` : ""}`;
}

export interface ParsedColumn {
  name: string;
  type?: string;
  length?: string;
  primaryKey: boolean;
  foreignKey: boolean;
  nullable: boolean;
  unique: boolean;
  defaultValue?: string;
}

/**
 * `name[: TYPE[(length)]] [PK] [FK] [NULL | NOT NULL] [UNIQUE] [= default]`
 * (flags in any order, case-insensitive).
 */
export function parseColumn(text: string): ParsedColumn {
  let rest = text.trim();
  let defaultValue: string | undefined;
  const eq = rest.indexOf("=");
  if (eq >= 0) {
    defaultValue = rest.slice(eq + 1).trim() || undefined;
    rest = rest.slice(0, eq).trim();
  }
  const m = /^([^\s:]+)\s*(?::\s*([A-Za-z_][\w ]*?)\s*(?:\(([^)]*)\))?)?((?:\s+\S+)*)\s*$/.exec(rest);
  if (!m) throw new Error(`Colonne invalide : ${text}`);
  let type = m[2]?.trim();
  let flags = (m[4] ?? "").trim().toUpperCase().split(/\s+/).filter(Boolean);
  // "INT PK" may have been read as a two-word type: give known flags back.
  const FLAGS = ["PK", "FK", "NULL", "NOT", "UNIQUE", "UQ", "NN"];
  if (type) {
    const words = type.split(/\s+/);
    while (words.length > 1 && FLAGS.includes(words[words.length - 1].toUpperCase())) flags = [words.pop()!.toUpperCase(), ...flags];
    type = words.join(" ");
  }
  const has = (f: string) => flags.includes(f);
  const notNull = flags.some((f, i) => (f === "NOT" && flags[i + 1] === "NULL") || f === "NN");
  return {
    name: m[1],
    type: type ? type.toUpperCase() : undefined,
    length: m[3]?.trim() || undefined,
    primaryKey: has("PK"),
    foreignKey: has("FK"),
    nullable: !notNull && flags.some((f, i) => f === "NULL" && flags[i - 1] !== "NOT"),
    unique: has("UNIQUE") || has("UQ"),
    defaultValue,
  };
}
