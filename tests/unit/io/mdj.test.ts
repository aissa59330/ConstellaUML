import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseMdj, serializeMdj, newProject, exportFragment, MdjError } from "../../../src/io/mdj";
import { Repository } from "../../../src/core/repository";

const fixture = readFileSync(new URL("../../fixtures/mdj/library.mdj", import.meta.url), "utf8");

describe(".mdj", () => {
  it("round-trips without loss (including unknown types and fields)", () => {
    const a = parseMdj(fixture);
    const b = parseMdj(serializeMdj(a));
    expect(b).toEqual(a);
    expect(JSON.parse(fixture)).toEqual(JSON.parse(serializeMdj(a)));
  });

  it("is deterministic and diff-friendly", () => {
    const text = serializeMdj(parseMdj(fixture));
    expect(serializeMdj(parseMdj(text))).toBe(text);
    expect(text.endsWith("}\n")).toBe(true);
    expect(text).toContain('"_parent": { "$ref": "AAAAAAFF+h6SjaM2Hec=" }');
    // _type, _id, _parent, name first, then alphabetical
    const at = text.indexOf('"_type": "UMLClass"');
    const firstClass = text.slice(text.lastIndexOf("\n", at) + 1);
    const keys = [...firstClass.slice(0, firstClass.indexOf("attributes") + 20).matchAll(/^\s{10}"(\w+)":/gm)].map((m) => m[1]);
    expect(keys.slice(0, 4)).toEqual(["_type", "_id", "_parent", "name"]);
  });

  it("keeps field order when sorting is disabled", () => {
    const text = serializeMdj(parseMdj(fixture), { sorted: false });
    expect(text.indexOf('"left"')).toBeLessThan(text.indexOf('"lineColor"'));
  });

  it("indexes every element in the repository", () => {
    const repo = new Repository();
    repo.load(parseMdj(fixture));
    expect(repo.get("AAAAAAFF+qDmVaNEAB8=")?.name).toBe("authors");
    expect(repo.viewsOf("AAAAAAFF+qCa1aNCCEI=")).toHaveLength(1);
    expect(repo.relationshipsOf("AAAAAAFF+qCAJ6NCdXg=").map((r) => r.name)).toEqual(["wrote"]);
  });

  it("repairs missing _parent links", () => {
    const root = parseMdj('{"_type":"Project","_id":"p","ownedElements":[{"_type":"UMLModel","_id":"m"}]}');
    expect(root.ownedElements[0]._parent).toEqual({ $ref: "p" });
  });

  it("rejects invalid documents with a readable error", () => {
    expect(() => parseMdj("{oops")).toThrow(MdjError);
    expect(() => parseMdj("[1,2]")).toThrow(/racine/);
  });

  it("creates a new project and exports fragments", () => {
    const p = newProject();
    expect(p.ownedElements[0].ownedElements[0]._type).toBe("UMLClassDiagram");
    const frag = parseMdj(exportFragment(p.ownedElements[0]));
    expect(frag._type).toBe("UMLModel");
    expect(frag._parent).toBeUndefined();
  });
});
