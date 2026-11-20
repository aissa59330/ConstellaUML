import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_GEN_OPTIONS, generateSql } from "../../../src/codegen";
import { importSchema } from "../../../src/codegen/reverse/build-erd";
import { parseSql } from "../../../src/codegen/reverse/sql";
import { Repository } from "../../../src/core/repository";
import { newProject, parseMdj, serializeMdj } from "../../../src/io/mdj";

const src = readFileSync("tests/fixtures/sql/library.sql", "utf8");

function imported() {
  const repo = new Repository();
  repo.load(newProject());
  const result = importSchema(repo, repo.root!, parseSql(src));
  return { repo, ...result };
}

const pythonSqlite = (() => {
  try {
    execFileSync("python3", ["-c", "import sqlite3"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe("SQL reverse engineering", () => {
  it("reads tables, keys, references and skips what it cannot parse", () => {
    const { tables } = parseSql(src);
    expect(tables.map((t) => t.name)).toEqual(["author", "book", "book_tag", "loan"]);
    const author = tables[0];
    expect(author.comment).toBe("Auteurs");
    expect(author.columns.map((c) => [c.name, c.type, c.length, c.primaryKey, c.nullable, c.unique])).toEqual([
      ["id", "INT", "", true, false, false],
      ["name", "VARCHAR", "120", false, false, false],
      ["email", "VARCHAR", "255", false, true, true],
    ]);
    expect(author.columns[1].comment).toBe("Nom complet");
    const book = tables[1];
    expect(book.columns.map((c) => c.name)).toEqual(["isbn", "title", "price", "author_id"]);
    expect(book.columns[2]).toMatchObject({ type: "DECIMAL", length: "8,2", defaultValue: "0.00" });
    expect(book.columns[3].references).toEqual({ table: "author", column: "id" });
    const bt = tables[2];
    expect(bt.columns.filter((c) => c.primaryKey).map((c) => c.name)).toEqual(["isbn", "tag"]);
    expect(bt.columns[0].references).toEqual({ table: "book", column: "isbn" });
    expect(tables[3].columns[1].references).toEqual({ table: "book", column: "isbn" });
  });

  it("builds an ERD data model with relationships (one undo step)", () => {
    const { repo, dataModel, entities, relationships } = imported();
    expect(dataModel._type).toBe("ERDDataModel");
    expect(entities.map((e) => e.name)).toEqual(["author", "book", "book_tag", "loan"]);
    const authorId = repo.deref(entities[1].columns[3].referenceTo);
    expect(authorId?.name).toBe("id");
    expect(entities[1].columns[3].foreignKey).toBe(true);
    expect(relationships).toHaveLength(3);
    const identifying = relationships.find((r) => r.identifying)!;
    expect(repo.deref(identifying.end2.reference)?.name).toBe("book_tag");
    expect(identifying.end1.cardinality).toBe("1");
    const optional = relationships.find((r) => repo.deref(r.end2.reference)?.name === "book")!;
    expect(optional.end1.cardinality).toBe("0..1");
    // Survives a save / reload.
    const again = new Repository();
    again.load(parseMdj(serializeMdj(repo.root!)));
    expect(again.get(entities[2]._id)?.columns).toHaveLength(2);
    repo.undo();
    expect(repo.root!.ownedElements.some((e: { _type: string }) => e._type === "ERDDataModel")).toBe(false);
  });

  it("generates DDL for each dialect, parents first", () => {
    const { repo, dataModel } = imported();
    const my = generateSql(repo, dataModel, { ...DEFAULT_GEN_OPTIONS, dialect: "mysql", dropTables: true });
    expect(my).toContain("DROP TABLE IF EXISTS `loan`;");
    expect(my).toContain("CREATE TABLE `author` (\n  `id` INT NOT NULL,");
    expect(my).toContain("`price` DECIMAL(8,2) DEFAULT 0.00");
    expect(my).toContain("PRIMARY KEY (`isbn`, `tag`)");
    expect(my).toContain("FOREIGN KEY (`author_id`) REFERENCES `author` (`id`)");
    expect(my.indexOf("CREATE TABLE `author`")).toBeLessThan(my.indexOf("CREATE TABLE `book`"));
    const pg = generateSql(repo, dataModel, { ...DEFAULT_GEN_OPTIONS, dialect: "postgresql" });
    expect(pg).toContain('"borrowed_at" TIMESTAMP NOT NULL');
  });

  it.runIf(pythonSqlite)("SQLite accepts the generated DDL and enforces the foreign keys", () => {
    const { repo, dataModel } = imported();
    const ddl = generateSql(repo, dataModel, { ...DEFAULT_GEN_OPTIONS, dialect: "sqlite" });
    const script = [
      "import sqlite3, sys",
      "db = sqlite3.connect(':memory:')",
      "db.execute('PRAGMA foreign_keys = ON')",
      "db.executescript(sys.stdin.read())",
      "db.execute(\"INSERT INTO author (id, name) VALUES (1, 'Herbert')\")",
      "db.execute(\"INSERT INTO book (isbn, title, author_id) VALUES ('1', 'Dune', 1)\")",
      "try:",
      "    db.execute(\"INSERT INTO book (isbn, title, author_id) VALUES ('2', 'X', 99)\")",
      "    print('fk-not-enforced')",
      "except sqlite3.IntegrityError:",
      "    print('ok')",
    ].join("\n");
    expect(execFileSync("python3", ["-c", script], { input: ddl, encoding: "utf8" }).trim()).toBe("ok");
  });
});
