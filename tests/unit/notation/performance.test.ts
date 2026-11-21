import { describe, expect, it } from "vitest";
import type { Element } from "../../../src/core/element";
import { Repository } from "../../../src/core/repository";
import { newProject } from "../../../src/io/mdj";
import { routeOf } from "../../../src/notation/edges";
import {
  addDiagram,
  addFeature,
  addLinkedClassifier,
  addableTypes,
  createEdge,
  createNode,
  findTool,
  moveViews,
  renameElement,
  type EdgeTool,
  type NodeTool,
} from "../../../src/notation/uml";
import { arrangeDiagram } from "../../../src/render/diagram";
import { approxMeasurer } from "../../../src/render/graphics";

function grid(n: number) {
  const repo = new Repository();
  repo.load(newProject());
  const model = repo.root!.ownedElements[0] as Element;
  const d = addDiagram(repo, model, "UMLClassDiagram");
  const views: Element[] = [];
  for (let i = 0; i < n; i++) {
    const v = createNode(repo, d, findTool("class") as NodeTool, { x: (i % 10) * 180, y: Math.floor(i / 10) * 150, w: 140, h: 80 });
    addFeature(repo, repo.deref(v.model)!, "attributes", `-a${i}: String`);
    views.push(v);
  }
  for (let i = 0; i < n; i++) createEdge(repo, d, findTool("association") as EdgeTool, views[i], views[(i + 1) % n]);
  if (n > 7) for (let i = 0; i < n; i += 3) createEdge(repo, d, findTool("generalization") as EdgeTool, views[i], views[(i + 7) % n]);
  return { repo, model, d, views, ctx: { repo, theme: "light" as const, measure: approxMeasurer } };
}

/** Every reference held by every element, rebuilt from scratch. */
function referrersFromScratch(repo: Repository, id: string): Element[] {
  const out: Element[] = [];
  for (const el of repo.all())
    for (const key in el) {
      if (key === "_parent") continue;
      const v = el[key];
      const hits = (x: unknown) => typeof x === "object" && x !== null && (x as { $ref?: string }).$ref === id;
      if (hits(v)) out.push(el);
      else if (Array.isArray(v)) for (const x of v) if (hits(x)) out.push(el);
    }
  return out;
}

const routes = (d: Element, ctx: Parameters<typeof routeOf>[1]) =>
  (d.ownedViews as Element[]).filter((v) => v.tail).map((e) => routeOf(e, ctx).map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(" "));

describe("incremental layout", () => {
  it("gives the same routes after a drag as a full layout", () => {
    const { repo, d, views, ctx } = grid(40);
    arrangeDiagram(d, ctx);
    moveViews(repo, [views[3], views[4]], 37, -55, "drag");
    moveViews(repo, [views[3], views[4]], 12, 90, "drag");
    arrangeDiagram(d, ctx); // incremental: only the moved views and their edges
    const incremental = routes(d, ctx);
    renameElement(repo, repo.deref(views[0].model)!, "Renamed"); // content change → full layout
    arrangeDiagram(d, ctx);
    expect(incremental).toEqual(routes(d, ctx));
  });

  it("keeps the reverse reference index exact through edits, undo and redo", () => {
    const { repo, d, views } = grid(12);
    repo.referrers(""); // build the index
    moveViews(repo, [views[1]], 5, 5);
    addLinkedClassifier(repo, d, views[2], "subclass");
    addLinkedClassifier(repo, d, views[5], "composition");
    repo.undo();
    repo.redo();
    repo.undo();
    for (const el of [...repo.all()].slice(0, 400)) {
      const a = repo.referrers(el._id).map((x) => x._id).sort();
      const b = referrersFromScratch(repo, el._id).map((x) => x._id).sort();
      expect(a, el._type).toEqual(b);
    }
  });

  it("lays out a drag on 500 classes in a few milliseconds", () => {
    const { repo, d, views, ctx } = grid(500);
    arrangeDiagram(d, ctx);
    repo.referrers("");
    const times: number[] = [];
    for (let i = 0; i < 15; i++) {
      moveViews(repo, [views[i]], 4, 3, "drag");
      const t = performance.now();
      arrangeDiagram(d, ctx);
      times.push(performance.now() - t);
    }
    times.sort((x, y) => x - y);
    // Measured around 0.4 ms; a generous bound keeps slow CI machines green.
    expect(times[7]).toBeLessThan(8);
  });
});

describe("quick-edit actions", () => {
  it("creates linked classifiers with the right relationship and direction", () => {
    const { repo, d, views } = grid(1);
    const base = repo.deref(views[0].model)!;
    const kinds = ["superclass", "subclass", "providedInterface", "requiredInterface", "association", "aggregation", "composition"] as const;
    const made = kinds.map((k) => repo.deref(addLinkedClassifier(repo, d, views[0], k).model)!);
    const rel = (other: Element) => repo.relationshipsOf(other._id).find((r) => r._id && (r.source?.$ref === base._id || r.target?.$ref === base._id || r.end1?.reference?.$ref === base._id))!;
    expect(rel(made[0])).toMatchObject({ _type: "UMLGeneralization", source: { $ref: base._id } });
    expect(rel(made[1])).toMatchObject({ _type: "UMLGeneralization", target: { $ref: base._id } });
    expect([made[2]._type, rel(made[2])._type]).toEqual(["UMLInterface", "UMLInterfaceRealization"]);
    expect([made[3]._type, rel(made[3])._type]).toEqual(["UMLInterface", "UMLDependency"]);
    expect(rel(made[5]).end1.aggregation).toBe("shared");
    expect(rel(made[6]).end1.aggregation).toBe("composite");
    // New views never overlap each other or the source.
    const nodes = (d.ownedViews as Element[]).filter((v) => v.left !== undefined && !v.tail);
    for (const a of nodes)
      for (const b of nodes)
        if (a !== b) expect(a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top, `${a._id}/${b._id}`).toBe(false);
    // Each creation is one undo step: undo removes the composition only.
    const associations = () => repo.relationshipsOf(base._id).filter((r) => r._type === "UMLAssociation").length;
    const before = associations();
    repo.undo();
    expect(associations()).toBe(before - 1);
    expect(repo.get(made[6]._id)).toBeUndefined();
    expect(repo.get(made[5]._id)).toBeDefined();
  });

  it("offers the Add menu entries for a class", () => {
    const { repo, views } = grid(1);
    const types = addableTypes(repo.deref(views[0].model)!);
    expect(types.slice(0, 5)).toEqual(["UMLTemplateParameter", "UMLAttribute", "UMLPort", "UMLOperation", "UMLReception"]);
    expect(types).toContain("UMLStateMachine");
  });
});
