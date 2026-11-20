// SQL DDL → tables (CREATE TABLE, ALTER TABLE … ADD FOREIGN KEY). Statements
// that cannot be read are skipped and reported; the rest is kept.
import { Cursor, type Token, joinTokens, splitTop, tokenize } from "../../core/lexer";

export interface SqlColumn {
  name: string;
  type: string;
  length: string;
  primaryKey: boolean;
  nullable: boolean;
  unique: boolean;
  defaultValue: string;
  references?: { table: string; column: string };
  comment: string;
}

export interface SqlTable {
  name: string;
  columns: SqlColumn[];
  comment: string;
}

export interface SqlSchema {
  tables: SqlTable[];
  errors: string[];
}

const lex = (src: string) => tokenize(src, { lineComments: ["--", "#"], blockComments: true, strings: ["'"], quotedIds: ["`", '"'] });

/** Last part of a qualified name (schema.table → table). */
function qualified(c: Cursor): string {
  let name = c.next()?.v ?? "";
  while (c.is(".") && c.peek(1)) {
    c.next();
    name = c.next()!.v;
  }
  return name;
}

function names(toks: Token[]): string[] {
  return splitTop(toks).map((p) => p[0]?.v ?? "");
}

function parseColumn(toks: Token[]): SqlColumn {
  const c = new Cursor(toks);
  const name = c.next()!.v;
  const typeToks: Token[] = [];
  let length = "";
  // Type words until the first constraint keyword.
  const STOP = ["not", "null", "primary", "unique", "default", "references", "auto_increment", "autoincrement", "check", "constraint", "comment", "collate", "generated", "on", "character", "charset", "identity"];
  while (!c.done && !STOP.includes(c.peek()!.v.toLowerCase())) {
    if (c.is("(")) {
      length = joinTokens(c.group()).replace(/\s+/g, "");
      continue;
    }
    typeToks.push(c.next()!);
  }
  const col: SqlColumn = { name, type: typeToks.map((t) => t.v).join(" ").toUpperCase(), length, primaryKey: false, nullable: true, unique: false, defaultValue: "", comment: "" };
  while (!c.done) {
    if (c.eatKw("not", "null")) col.nullable = false;
    else if (c.eatKw("null")) col.nullable = true;
    else if (c.eatKw("primary", "key")) {
      col.primaryKey = true;
      col.nullable = false;
    } else if (c.eatKw("unique")) {
      c.eatKw("key");
      col.unique = true;
    } else if (c.eatKw("default")) {
      const start = c.i;
      if (c.is("(")) c.skipGroup();
      else {
        c.next();
        if (c.is("(")) c.skipGroup();
      }
      col.defaultValue = joinTokens(toks.slice(start, c.i));
    } else if (c.eatKw("references")) {
      const table = qualified(c);
      const column = c.is("(") ? names(c.group())[0] : "";
      col.references = { table, column };
    } else if (c.eatKw("comment")) col.comment = (c.next()?.v ?? "").replace(/^'|'$/g, "").replace(/''/g, "'");
    else if (c.is("(")) c.skipGroup();
    else c.next();
  }
  return col;
}

export function parseSql(src: string): SqlSchema {
  const toks = lex(src);
  const c = new Cursor(toks);
  const tables: SqlTable[] = [];
  const errors: string[] = [];
  const find = (n: string) => tables.find((t) => t.name.toLowerCase() === n.toLowerCase());
  const addFk = (table: SqlTable | undefined, cols: string[], refTable: string, refCols: string[]) => {
    cols.forEach((cn, k) => {
      const col = table?.columns.find((x) => x.name.toLowerCase() === cn.toLowerCase());
      if (col) col.references = { table: refTable, column: refCols[k] ?? refCols[0] ?? "" };
    });
  };

  while (!c.done) {
    const line = c.peek()!.line;
    try {
      if (c.eatKw("create")) {
        while (c.isKw("temporary") || c.isKw("temp") || c.isKw("unlogged") || c.isKw("or") || c.isKw("replace")) c.next();
        if (!c.eatKw("table")) {
          c.skipTo(";");
          continue;
        }
        c.eatKw("if", "not", "exists");
        const name = qualified(c);
        if (!c.is("(")) {
          c.skipTo(";");
          continue;
        }
        const table: SqlTable = { name, columns: [], comment: "" };
        const pending: [string[], string, string[]][] = [];
        for (const def of splitTop(c.group())) {
          const d = new Cursor(def);
          if (d.eatKw("constraint")) d.next();
          if (d.eatKw("primary", "key")) {
            for (const n of names(d.group())) {
              const col = table.columns.find((x) => x.name.toLowerCase() === n.toLowerCase());
              if (col) Object.assign(col, { primaryKey: true, nullable: false });
            }
          } else if (d.eatKw("foreign", "key")) {
            const cols = names(d.group());
            d.eatKw("references");
            const ref = qualified(d);
            pending.push([cols, ref, d.is("(") ? names(d.group()) : []]);
          } else if (d.isKw("unique") && (d.is("(", 1) || d.isKw("key", 1) || d.isKw("index", 1))) {
            d.next();
            if (!d.is("(")) d.next();
            if (!d.is("(")) d.next();
            const cols = names(d.group());
            if (cols.length === 1) {
              const col = table.columns.find((x) => x.name.toLowerCase() === cols[0].toLowerCase());
              if (col) col.unique = true;
            }
          } else if (d.i === 0 && !["key", "index", "check", "fulltext", "spatial", "exclude"].includes(def[0].v.toLowerCase())) {
            // Index and check definitions ("KEY idx (col)", "CHECK (…)") carry no column.
            table.columns.push(parseColumn(def));
          }
        }
        for (const [cols, ref, refCols] of pending) addFk(table, cols, ref, refCols);
        // Table options: COMMENT='…'
        while (!c.done && !c.is(";")) {
          if (c.eatKw("comment")) {
            c.eat("=");
            table.comment = (c.next()?.v ?? "").replace(/^'|'$/g, "");
          } else c.next();
        }
        c.eat(";");
        tables.push(table);
      } else if (c.eatKw("alter", "table")) {
        c.eatKw("only");
        c.eatKw("if", "exists");
        const table = find(qualified(c));
        while (!c.done && !c.is(";")) {
          if (c.eatKw("foreign", "key")) {
            const cols = names(c.group());
            c.eatKw("references");
            const ref = qualified(c);
            addFk(table, cols, ref, c.is("(") ? names(c.group()) : []);
          } else if (c.eatKw("primary", "key")) {
            for (const n of names(c.group())) {
              const col = table?.columns.find((x) => x.name.toLowerCase() === n.toLowerCase());
              if (col) Object.assign(col, { primaryKey: true, nullable: false });
            }
          } else c.next();
        }
        c.eat(";");
      } else c.skipTo(";");
    } catch (e) {
      errors.push(`ligne ${line} : ${(e as Error).message}`);
      c.skipTo(";");
    }
  }
  // Resolve REFERENCES t without a column to t's primary key.
  for (const t of tables)
    for (const col of t.columns)
      if (col.references && !col.references.column) col.references.column = find(col.references.table)?.columns.find((x) => x.primaryKey)?.name ?? "";
  return { tables, errors };
}
