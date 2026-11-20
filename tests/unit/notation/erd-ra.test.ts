import { describe, expect, it } from "vitest";
import type { Element } from "../../../src/core/element";
import { Repository } from "../../../src/core/repository";
import { newProject, parseMdj, serializeMdj } from "../../../src/io/mdj";
import { exportSvg } from "../../../src/render/diagram";
import { approxMeasurer } from "../../../src/render/graphics";
import { addDiagram, buildQueryTree, convertDiagram, createEdge, createNode, findTool, formatColumn, parseColumn, parseQuery, type EdgeTool, type NodeTool } from "../../../src/notation/uml";
import { create } from "../../../src/core/factory";

const svgOf = (repo: Repository, d: Element) => exportSvg(d, { repo, measure: approxMeasurer }, { theme: "light", margin: 8, background: true }, approxMeasurer);

function project() {
  const repo = new Repository();
  repo.load(newProject());
  return repo;
}

describe("ERD and relational model", () => {
  it("parses and formats columns", () => {
    expect(parseColumn("id: INT PK")).toMatchObject({ name: "id", type: "INT", primaryKey: true, nullable: false });
    expect(parseColumn("email: varchar(255) UNIQUE NULL")).toMatchObject({ type: "VARCHAR", length: "255", unique: true, nullable: true });
    expect(parseColumn("n: INT NOT NULL = 0")).toMatchObject({ nullable: false, defaultValue: "0" });
    expect(formatColumn({ _type: "ERDColumn", _id: "x", name: "id", type: "INT", primaryKey: true } as Element)).toBe("id: INT PK");
  });

  it("draws a foreign key from table to table and adds the FK column", () => {
    const repo = project();
    const d = addDiagram(repo, repo.root!, "ERDRelationalDiagram");
    expect(repo.parentOf(d)!._type).toBe("ERDDataModel");
    const artist = createNode(repo, d, findTool("table") as NodeTool, { x: 0, y: 0, w: 100, h: 40 });
    const album = createNode(repo, d, findTool("table") as NodeTool, { x: 0, y: 150, w: 100, h: 40 });
    const artistEnt = repo.deref(artist.model)!;
    repo.transact("pk", (tx) => tx.insert(artistEnt, "columns", create("ERDColumn", { name: "idArtiste", type: "INT", primaryKey: true })));
    const fk = createEdge(repo, d, findTool("foreignKey") as EdgeTool, album, artist);
    const albumEnt = repo.deref(album.model)!;
    expect(albumEnt.columns.map((c: Element) => [c.name, c.foreignKey])).toEqual([["idArtiste", true]]);
    expect(repo.deref(albumEnt.columns[0].referenceTo)?.name).toBe("idArtiste");
    expect(repo.deref(repo.deref(fk.model)!.end1.reference)).toBe(artistEnt);
    const svg = svgOf(repo, d);
    expect(svg).toContain("FK(idArtiste)");
    expect(svg).toContain("idArtiste*");
    repo.undo();
    expect(albumEnt.columns ?? []).toHaveLength(0);
  });

  it("converts an ER diagram into a relational model and back, keeping positions", () => {
    const repo = project();
    const erd = addDiagram(repo, repo.root!, "ERDDiagram");
    const a = createNode(repo, erd, findTool("entity") as NodeTool, { x: 10, y: 20, w: 120, h: 60 });
    const b = createNode(repo, erd, findTool("entity") as NodeTool, { x: 300, y: 20, w: 120, h: 60 });
    createEdge(repo, erd, findTool("relOneToMany") as EdgeTool, a, b);
    const mld = convertDiagram(repo, erd, "ERDRelationalDiagram");
    const views = mld.ownedViews as Element[];
    expect(views.map((v) => v._type).sort()).toEqual(["ERDForeignKeyView", "ERDTableView", "ERDTableView"]);
    const fkView = views.find((v) => v._type === "ERDForeignKeyView")!;
    // The arrow goes from the many side (b) to the referenced entity (a).
    expect(repo.deref(repo.deref(fkView.tail)!.model)).toBe(repo.deref(b.model));
    expect(views.find((v) => v.model?.$ref === a.model.$ref)?.left).toBe(10);
    const back = convertDiagram(repo, mld, "ERDDiagram");
    expect((back.ownedViews as Element[]).filter((v) => v._type === "ERDRelationshipView")).toHaveLength(1);
    // Both notations survive a save / reload.
    const again = new Repository();
    again.load(parseMdj(serializeMdj(repo.root!)));
    expect(again.get(mld._id)?.ownedViews).toHaveLength(3);
  });
});

describe("query trees", () => {
  it("orders clauses logically: FROM, WHERE, SELECT, ORDER BY", () => {
    const t = parseQuery("SELECT * FROM Album WHERE idAlbum = 156 ORDER BY titre;");
    const chain: string[] = [];
    let n = t;
    while (n.kind === "op") {
      chain.push(`${n.operator}:${n.expression}`);
      n = n.inputs[0];
    }
    expect(chain).toEqual(["ORDER BY:titre", "SELECT:*", "WHERE:idAlbum = 156"]);
    expect(n).toEqual({ kind: "relation", name: "Album", alias: "" });
  });

  it("reads joins, aliases, grouping and set operations", () => {
    const t = parseQuery(
      "SELECT DISTINCT a.nom, COUNT(*) FROM Artiste AS a LEFT JOIN Album b ON a.idArtiste = b.idArtiste GROUP BY a.nom HAVING COUNT(*) > 1 UNION SELECT nom, 0 FROM Invite",
    );
    expect(t.kind === "op" && t.operator).toBe("UNION");
    const left = t.kind === "op" ? t.inputs[0] : t;
    const ops: string[] = [];
    let n = left;
    while (n.kind === "op") {
      ops.push(n.operator);
      if (n.operator === "LEFT JOIN") {
        expect(n.expression).toBe("a.idArtiste = b.idArtiste");
        expect(n.inputs.map((i) => (i.kind === "relation" ? `${i.name} ${i.alias}` : ""))).toEqual(["Artiste a", "Album b"]);
      }
      n = n.inputs[0];
    }
    expect(ops).toEqual(["DISTINCT", "SELECT", "HAVING", "GROUP BY", "LEFT JOIN"]);
  });

  it("builds an undoable diagram with the result at the bottom", () => {
    const repo = project();
    const { query, diagram } = buildQueryTree(repo, repo.root!, "SELECT * FROM Album WHERE idAlbum = 156");
    const views = diagram.ownedViews as Element[];
    const top = (type: string) => views.find((v) => v._type === type && repo.deref(v.model)?.operator !== "SELECT")!.top;
    const select = views.find((v) => repo.deref(v.model)?.operator === "SELECT")!;
    expect(top("RARelationView")).toBeLessThan(top("RAOperatorView"));
    expect(top("RAOperatorView")).toBeLessThan(select.top);
    expect(views.filter((v) => v._type === "RAFlowView")).toHaveLength(2);
    expect(svgOf(repo, diagram)).toContain("idAlbum = 156");
    repo.transact("algebra", (tx) => tx.set(diagram, "notation", "algebra"));
    expect(svgOf(repo, diagram)).toContain("σ");
    repo.undo();
    repo.undo();
    expect(repo.get(query._id)).toBeUndefined();
  });

  it("reports a query that is not a SELECT", () => {
    expect(() => parseQuery("DELETE FROM x")).toThrow(/SELECT/);
  });
});

describe("quick-edit of ERD and query tree elements", () => {
  it("edits an entity as text: rename, update, add and remove columns (one undo step)", async () => {
    const { editEntity, entityText } = await import("../../../src/notation/uml");
    const repo = project();
    const d = addDiagram(repo, repo.root!, "ERDDiagram");
    const v = createNode(repo, d, findTool("entity") as NodeTool, { x: 0, y: 0, w: 100, h: 50 });
    const ent = repo.deref(v.model)!;
    editEntity(repo, ent, "Album\nidAlbum: INT PK\ntitre: VARCHAR(200)\nnote: INT NULL");
    expect(entityText(ent)).toBe("Album\nidAlbum: INT PK\ntitre: VARCHAR(200)\nnote: INT NULL");
    editEntity(repo, ent, "Album\nidAlbum: INT PK\ntitre: TEXT");
    expect(ent.columns.map((c: Element) => `${c.name}:${c.type}`)).toEqual(["idAlbum:INT", "titre:TEXT"]);
    repo.undo();
    expect(ent.columns).toHaveLength(3);
  });

  it("edits operators with SQL keywords or algebra symbols, and relations with aliases", async () => {
    const { editOperator, editRelation } = await import("../../../src/notation/uml");
    const repo = project();
    const { query } = buildQueryTree(repo, repo.root!, "SELECT * FROM Album WHERE x = 1");
    const ops = (query.ownedElements as Element[]).filter((e) => e._type === "RAOperator");
    const where = ops.find((o) => o.operator === "WHERE")!;
    editOperator(repo, where, "GROUP BY artiste");
    expect([where.operator, where.expression]).toEqual(["GROUP BY", "artiste"]);
    editOperator(repo, where, "σ année > 2000");
    expect([where.operator, where.expression]).toEqual(["WHERE", "année > 2000"]);
    const rel = (query.ownedElements as Element[]).find((e) => e._type === "RARelation")!;
    editRelation(repo, rel, "Album AS a");
    expect([rel.name, rel.alias]).toEqual(["Album", "a"]);
  });
});
