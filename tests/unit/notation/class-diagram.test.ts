import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Repository } from "../../../src/core/repository";
import { newProject, parseMdj, serializeMdj } from "../../../src/io/mdj";
import { approxMeasurer } from "../../../src/render/graphics";
import { arrangeDiagram, exportSvg, hitTest } from "../../../src/render/diagram";
import {
  addFeature,
  addViewOfModel,
  copyViews,
  createEdge,
  createNode,
  deleteFromModel,
  deleteViews,
  editAttribute,
  editOperation,
  findTool,
  moveInParent,
  moveToOwner,
  moveViews,
  pasteViews,
  renameElement,
  CommandError,
  type EdgeTool,
  type NodeTool,
} from "../../../src/notation/uml";
import { labelCenter, labelPolar, orthogonalRoute, parsePoints } from "../../../src/notation/edges";
import type { RenderCtx } from "../../../src/notation/views";

function setup() {
  const repo = new Repository();
  repo.load(newProject());
  const diagram = repo.root!.ownedElements[0].ownedElements[0];
  const ctx: RenderCtx = { repo, theme: "light", measure: approxMeasurer };
  const node = (id: string, x: number, y: number) => createNode(repo, diagram, findTool(id) as NodeTool, { x, y, w: 100, h: 60 });
  const edge = (id: string, a: any, b: any) => createEdge(repo, diagram, findTool(id) as EdgeTool, a, b);
  return { repo, diagram, ctx, node, edge };
}

describe("class diagram commands", () => {
  it("creates model + view with unique names, as one undo step", () => {
    const { repo, diagram, node } = setup();
    const v1 = node("class", 10, 10);
    const v2 = node("class", 200, 10);
    const m1 = repo.deref(v1.model)!;
    expect(m1.name).toBe("Class1");
    expect(repo.deref(v2.model)!.name).toBe("Class2");
    expect(repo.parentOf(m1)).toBe(repo.parentOf(diagram));
    repo.undo();
    expect(repo.get(v2._id)).toBeUndefined();
    expect(repo.deref(v2.model)).toBeUndefined();
  });

  it("creates relationships owned by their source", () => {
    const { repo, node, edge } = setup();
    const a = node("class", 0, 0), b = node("class", 300, 0);
    const gen = edge("generalization", a, b);
    const g = repo.deref(gen.model)!;
    expect(g.source.$ref).toBe(a.model.$ref);
    expect(g.target.$ref).toBe(b.model.$ref);
    expect(repo.parentOf(g)).toBe(repo.deref(a.model));
    const comp = repo.deref(edge("composition", a, b).model)!;
    expect(comp.end1.aggregation).toBe("composite");
    expect(comp.end1.reference.$ref).toBe(a.model.$ref);
    expect(repo.deref(edge("directedAssociation", a, b).model)!.end1.navigable).toBe(false);
  });

  it("refuses invalid connections", () => {
    const { node, edge } = setup();
    const a = node("class", 0, 0), i = node("interface", 300, 0), n = node("note", 0, 200);
    expect(() => edge("interfaceRealization", i, a)).toThrow(CommandError);
    expect(() => edge("generalization", a, a)).toThrow(/lui-même/);
    expect(() => edge("generalization", a, n)).toThrow(CommandError);
    expect(() => edge("noteLink", n, a)).not.toThrow();
  });

  it("delete removes views only; delete from model removes everything", () => {
    const { repo, diagram, node, edge } = setup();
    const a = node("class", 0, 0), b = node("class", 300, 0);
    const assoc = edge("association", a, b);
    deleteViews(repo, [a]);
    expect(repo.get(a._id)).toBeUndefined();
    expect(repo.get(assoc._id)).toBeUndefined(); // attached edge view goes too
    expect(repo.deref(a.model)).toBeDefined(); // model stays
    repo.undo();
    deleteFromModel(repo, [b]);
    expect(repo.deref(b.model)).toBeUndefined();
    expect(repo.deref(assoc.model)).toBeUndefined(); // relationship deleted
    expect(diagram.ownedViews.map((v: any) => v._id)).toEqual([a._id]);
    repo.undo();
    expect(diagram.ownedViews).toHaveLength(3);
  });

  it("quick-edit updates attributes and operations", () => {
    const { repo, node } = setup();
    const cls = repo.deref(node("class", 0, 0).model)!;
    renameElement(repo, cls, "<<entity>> Book");
    expect(cls.name).toBe("Book");
    expect(cls.stereotype).toBe("entity");
    const attr = addFeature(repo, cls, "attributes", "-isbn: String [1] = \"x\"");
    expect(attr).toMatchObject({ name: "isbn", visibility: "private", type: "String", multiplicity: "1", defaultValue: '"x"' });
    editAttribute(repo, attr, "+title: String");
    expect(attr).toMatchObject({ name: "title", visibility: "public", multiplicity: "" });
    const op = addFeature(repo, cls, "operations", "find(id: Long): Book");
    expect(op.parameters.map((p: any) => [p.name, p.type, p.direction])).toEqual([
      ["id", "Long", "in"],
      ["", "Book", "return"],
    ]);
    const firstParamId = op.parameters[0]._id;
    editOperation(repo, op, "find(key: String, all: boolean)");
    expect(op.parameters[0]._id).toBe(firstParamId); // reused, not recreated
    expect(op.parameters.map((p: any) => p.name)).toEqual(["key", "all"]);
    repo.undo();
    expect(op.parameters.map((p: any) => p.name)).toEqual(["id", ""]);
  });

  it("reorders features and re-parents elements", () => {
    const { repo, node } = setup();
    const cls = repo.deref(node("class", 0, 0).model)!;
    const a = addFeature(repo, cls, "attributes", "a");
    addFeature(repo, cls, "attributes", "b");
    expect(moveInParent(repo, a, 1)).toBe(true);
    expect(cls.attributes.map((x: any) => x.name)).toEqual(["b", "a"]);
    expect(moveInParent(repo, a, 1)).toBe(false);
    const pkg = repo.deref(node("package", 0, 200).model)!;
    moveToOwner(repo, cls, pkg);
    expect(repo.parentOf(cls)).toBe(pkg);
    expect(() => moveToOwner(repo, pkg, pkg)).toThrow(CommandError);
  });

  it("moves views and copies/pastes them across diagrams", () => {
    const { repo, diagram, node, edge } = setup();
    const a = node("class", 0, 0), b = node("class", 300, 0);
    edge("association", a, b);
    moveViews(repo, [a], 15, 5);
    expect([a.left, a.top]).toEqual([15, 5]);
    const clip = copyViews(repo, diagram.ownedViews)!;
    const other = repo.transact("d", (tx) => tx.insert(repo.root!.ownedElements[0], "ownedElements", { _type: "UMLClassDiagram", _id: "d2", ownedViews: [] }));
    const pasted = pasteViews(repo, other, clip, 20);
    expect(pasted).toHaveLength(3);
    expect(pasted[0].model.$ref).toBe(a.model.$ref); // same model, new view
    expect(pasted[2].tail.$ref).toBe(pasted[0]._id); // edge rewired to pasted views
    expect(repo.viewsOf(a.model.$ref)).toHaveLength(2);
  });

  it("drops an existing model element and its relationships onto a diagram", () => {
    const { repo, diagram, node, edge } = setup();
    const a = node("class", 0, 0), b = node("class", 300, 0);
    const gen = edge("generalization", a, b);
    deleteViews(repo, [a]);
    expect(repo.get(gen._id)).toBeUndefined();
    addViewOfModel(repo, diagram, repo.deref(a.model)!, 0, 0);
    expect(diagram.ownedViews.filter((v: any) => v._type === "UMLGeneralizationView")).toHaveLength(1);
  });
});

describe("layout & rendering", () => {
  it("builds the .mdj sub-view structure and grows boxes to fit", () => {
    const { repo, diagram, ctx, node } = setup();
    const v = node("class", 0, 0);
    const cls = repo.deref(v.model)!;
    addFeature(repo, cls, "attributes", "+aVeryLongAttributeName: SomeQuiteLongTypeName");
    addFeature(repo, cls, "operations", "+op()");
    arrangeDiagram(diagram, ctx);
    expect(v.width).toBeGreaterThan(100);
    const attrComp = repo.deref(v.attributeCompartment)!;
    expect(attrComp._type).toBe("UMLAttributeCompartmentView");
    expect(attrComp.subViews[0].text).toBe("+aVeryLongAttributeName: SomeQuiteLongTypeName");
    expect(repo.deref(repo.deref(v.nameCompartment)!.nameLabel)!.text).toBe("Class1");
    // Clicking an attribute line selects the attribute view.
    const line = attrComp.subViews[0];
    expect(hitTest(diagram, { x: line.left + 5, y: line.top + 5 }, 4, ctx)).toBe(line);
    expect(hitTest(diagram, { x: v.left + 3, y: v.top + 3 }, 4, ctx)).toBe(v);
  });

  it("routes edges and places labels like .mdj files do", () => {
    const pts = [{ x: 145, y: 64 }, { x: 356, y: 64 }];
    // Values taken from a real .mdj file: tail role label of "wrote".
    const c = labelCenter(pts, { edgePosition: 2, alpha: 0.3016189832315833, distance: 47.12748667179272 } as any);
    expect(c.x).toBeCloseTo(190, 0);
    expect(c.y).toBeCloseTo(50, 0);
    const polar = labelPolar(pts, 0, { x: 325.5, y: 49.5 });
    expect(polar.distance).toBeCloseTo(33.8, 0);
    expect(orthogonalRoute({ x: 0, y: 0, w: 100, h: 50 }, { x: 0, y: 200, w: 100, h: 50 })).toEqual([{ x: 50, y: 50 }, { x: 50, y: 200 }]);
    expect(orthogonalRoute({ x: 0, y: 0, w: 100, h: 50 }, { x: 300, y: 300, w: 100, h: 50 })).toHaveLength(4);
  });

  it("renders the fixture and exports a well-formed SVG", () => {
    const repo = new Repository();
    repo.load(parseMdj(readFileSync(new URL("../../fixtures/mdj/library.mdj", import.meta.url), "utf8")));
    const diagram = repo.get("AAAAAAFF+qBtyKM79qY=")!;
    const svg = exportSvg(diagram, { repo, measure: approxMeasurer }, { theme: "light", margin: 10, background: true }, approxMeasurer);
    expect(svg).toMatch(/^<\?xml/);
    expect(svg).toContain(">Book</text>");
    expect(svg).toContain("+ISBN: String {id}");
    expect(svg).toContain(">1..*</text>");
    expect(svg).toContain("+write(title: String): Book");
    const opens = (svg.match(/<g[ >]/g) ?? []).length, closes = (svg.match(/<\/g>/g) ?? []).length;
    expect(opens).toBe(closes);
    // Sub-views created by layout survive a save/load round trip.
    const again = parseMdj(serializeMdj(repo.root!));
    expect(JSON.stringify(again)).toContain("UMLNameCompartmentView");
    expect(parsePoints(repo.get("AAAAAAFF+qDmVaNDiKQ=")!.points).length).toBeGreaterThanOrEqual(2);
  });
});
