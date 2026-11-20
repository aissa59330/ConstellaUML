import { beforeAll, describe, expect, it } from "vitest";
import { Repository } from "../../../src/core/repository";
import { create } from "../../../src/core/factory";
import { cloneWithNewIds, ref, walk } from "../../../src/core/element";
import { registerUmlMeta } from "../../../src/core/meta/uml.meta";
import { meta } from "../../../src/core/meta/registry";

beforeAll(registerUmlMeta);

function setup() {
  const repo = new Repository();
  const project = create("Project", { name: "P" });
  const model = create("UMLModel", { name: "Model", _parent: ref(project) });
  project.ownedElements = [model];
  repo.load(project);
  return { repo, project, model };
}

const snapshot = (repo: Repository) => JSON.stringify(repo.root);

describe("metamodel", () => {
  it("resolves inheritance and defaults", () => {
    expect(meta.isKindOf("UMLClass", "UMLClassifier")).toBe(true);
    expect(meta.isKindOf("UMLClass", "View")).toBe(false);
    expect(meta.defaultOf("UMLClass", "visibility")).toBe("public");
    expect(meta.containerField("UMLClass", "UMLAttribute")).toBe("attributes");
    expect(meta.containerField("UMLEnumeration", "UMLEnumerationLiteral")).toBe("literals");
    expect(meta.containerField("UMLModel", "UMLClass")).toBe("ownedElements");
  });

  it("creates elements with defaults and unique ids", () => {
    const a = create("UMLClass", { name: "A" });
    const b = create("UMLClass");
    expect(a.isAbstract).toBe(false);
    expect(a.attributes).toEqual([]);
    expect(a._id).not.toBe(b._id);
    expect(a._id).toHaveLength(20);
  });
});

describe("operations", () => {
  it("insert / set / remove are undoable and redoable", () => {
    const { repo, model } = setup();
    const s0 = snapshot(repo);
    const cls = create("UMLClass", { name: "A" });
    repo.transact("add", (tx) => tx.insert(model, "ownedElements", cls));
    const s1 = snapshot(repo);
    expect(repo.get(cls._id)).toBe(cls);
    expect(cls._parent).toEqual(ref(model));

    repo.transact("rename", (tx) => tx.set(cls, "name", "B"));
    const s2 = snapshot(repo);
    repo.transact("delete", (tx) => tx.remove(cls));
    expect(repo.get(cls._id)).toBeUndefined();

    repo.undo();
    expect(snapshot(repo)).toBe(s2);
    repo.undo();
    expect(snapshot(repo)).toBe(s1);
    repo.undo();
    expect(snapshot(repo)).toBe(s0);
    expect(repo.canUndo()).toBe(false);
    repo.redo();
    repo.redo();
    repo.redo();
    expect(repo.get(cls._id)).toBeUndefined();
    repo.undo();
    expect(repo.get(cls._id)?.name).toBe("B");
  });

  it("indexes nested children and single-valued containment", () => {
    const { repo, model } = setup();
    const assoc = create("UMLAssociation");
    assoc.end1 = create("UMLAssociationEnd", { _parent: ref(assoc) });
    repo.transact("add", (tx) => tx.insert(model, "ownedElements", assoc));
    expect(repo.get(assoc.end1._id)).toBe(assoc.end1);
    const end2 = create("UMLAssociationEnd");
    repo.transact("end2", (tx) => tx.set(assoc, "end2", end2));
    expect(repo.get(end2._id)).toBe(end2);
    repo.transact("rm", (tx) => tx.remove(end2));
    expect(assoc.end2).toBeUndefined();
    expect(repo.get(end2._id)).toBeUndefined();
    repo.undo();
    expect(assoc.end2).toBe(end2);
  });

  it("rolls back a failing transaction", () => {
    const { repo, model } = setup();
    const s0 = snapshot(repo);
    expect(() =>
      repo.transact("bad", (tx) => {
        tx.insert(model, "ownedElements", create("UMLClass"));
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(snapshot(repo)).toBe(s0);
    expect(repo.canUndo()).toBe(false);
  });

  it("merges consecutive operations with the same key (drag)", () => {
    const { repo, model } = setup();
    const cls = create("UMLClass", { name: "A" });
    repo.transact("add", (tx) => tx.insert(model, "ownedElements", cls));
    for (const n of ["B", "C", "D"]) repo.transact("rename", (tx) => tx.set(cls, "name", n), "drag-1");
    repo.undo();
    expect(cls.name).toBe("A");
  });

  it("supports deep undo stacks (unlimited)", () => {
    const { repo, model } = setup();
    const cls = create("UMLClass", { name: "0" });
    repo.transact("add", (tx) => tx.insert(model, "ownedElements", cls));
    for (let i = 1; i <= 5000; i++) repo.transact("n", (tx) => tx.set(cls, "name", String(i)));
    for (let i = 0; i < 5000; i++) repo.undo();
    expect(cls.name).toBe("0");
  });

  it("tracks dirty state against the saved point", () => {
    const { repo, model } = setup();
    expect(repo.dirty).toBe(false);
    repo.transact("add", (tx) => tx.insert(model, "ownedElements", create("UMLClass")));
    expect(repo.dirty).toBe(true);
    repo.markSaved();
    expect(repo.dirty).toBe(false);
    repo.undo();
    expect(repo.dirty).toBe(true);
    repo.redo();
    expect(repo.dirty).toBe(false);
  });

  it("finds referrers, views and relationships", () => {
    const { repo, model } = setup();
    const a = create("UMLClass", { name: "A" });
    const b = create("UMLClass", { name: "B" });
    const gen = create("UMLGeneralization", { source: ref(a), target: ref(b) });
    repo.transact("add", (tx) => {
      tx.insert(model, "ownedElements", a);
      tx.insert(model, "ownedElements", b);
      tx.insert(a, "ownedElements", gen);
    });
    expect(repo.relationshipsOf(b._id)).toEqual([gen]);
  });
});

describe("cloneWithNewIds", () => {
  it("remaps internal references only", () => {
    const a = create("UMLClass", { name: "A" });
    const ext = create("UMLClass", { name: "X" });
    const attr = create("UMLAttribute", { _parent: ref(a), type: ref(ext) });
    a.attributes = [attr];
    const c = cloneWithNewIds(a);
    const ids = [...walk(c)].map((e) => e._id);
    expect(ids).not.toContain(a._id);
    expect(c.attributes[0]._parent.$ref).toBe(c._id);
    expect(c.attributes[0].type.$ref).toBe(ext._id);
  });
});
