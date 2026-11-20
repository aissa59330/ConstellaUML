import { describe, expect, it } from "vitest";
import {
  formatAttribute,
  formatOperation,
  parseAttribute,
  parseName,
  parseOperation,
  ParseError,
  isValidMultiplicity,
} from "../../../src/notation/uml/text";
import { create } from "../../../src/core/factory";

const none = () => undefined;

describe("quick-edit: names", () => {
  it("parses stereotype, visibility and name", () => {
    expect(parseName("<<entity>> -Customer")).toEqual({ stereotype: "entity", visibility: "private", name: "Customer" });
    expect(parseName("«boundary» Form")).toEqual({ stereotype: "boundary", visibility: undefined, name: "Form" });
    expect(parseName("  Book ")).toEqual({ stereotype: undefined, visibility: undefined, name: "Book" });
  });
});

describe("quick-edit: attributes", () => {
  it("parses the full grammar", () => {
    expect(parseAttribute("+nom: String")).toMatchObject({ visibility: "public", name: "nom", type: "String" });
    expect(parseAttribute('-tags: List<String>[0..*] = "a, b"')).toMatchObject({
      visibility: "private",
      name: "tags",
      type: "List<String>",
      multiplicity: "0..*",
      defaultValue: '"a, b"',
    });
    expect(parseAttribute("#/total: double")).toMatchObject({ visibility: "protected", isDerived: true, name: "total" });
    expect(parseAttribute("<<id>> ~code")).toMatchObject({ stereotype: "id", visibility: "package", name: "code" });
    expect(parseAttribute("count = 0")).toMatchObject({ name: "count", defaultValue: "0", type: undefined });
    expect(parseAttribute("x [1]")).toMatchObject({ name: "x", multiplicity: "1" });
  });

  it("rejects invalid input", () => {
    expect(() => parseAttribute("+: String")).toThrow(ParseError);
    expect(() => parseAttribute("1abc")).toThrow(ParseError);
    expect(() => parseAttribute("x[a..b]")).toThrow(/Multiplicité/);
  });
});

describe("quick-edit: operations", () => {
  it("parses parameters, directions and return type", () => {
    const op = parseOperation("+find(id: Long, out found: boolean, opts: Map<String, Object> = null): Book[0..1]");
    expect(op.name).toBe("find");
    expect(op.parameters).toHaveLength(3);
    expect(op.parameters![1]).toMatchObject({ direction: "out", name: "found", type: "boolean" });
    expect(op.parameters![2]).toMatchObject({ name: "opts", type: "Map<String, Object>", defaultValue: "null" });
    expect(op.returnType).toBe("Book[0..1]");
    expect(parseOperation("-run()")).toMatchObject({ visibility: "private", name: "run", parameters: [] });
    expect(parseOperation("size: int")).toMatchObject({ name: "size", returnType: "int" });
  });

  it("rejects invalid input", () => {
    expect(() => parseOperation("(x)")).toThrow(ParseError);
    expect(() => parseOperation("f(x")).toThrow(/fermante/);
    expect(() => parseOperation("f(x) int")).toThrow(ParseError);
  });
});

describe("formatting", () => {
  it("formats attributes like the quick-edit syntax", () => {
    const a = create("UMLAttribute", { name: "ISBN", type: "String", isID: true });
    expect(formatAttribute(a, none)).toBe("+ISBN: String {id}");
    a.multiplicity = "1";
    a.visibility = "private";
    a.defaultValue = '""';
    expect(formatAttribute(a, none)).toBe('-ISBN: String[1] = "" {id}');
    expect(formatAttribute(a, none, { showVisibility: false, showType: false, showMultiplicity: false, showProperty: false, showOperationSignature: true })).toBe('ISBN = ""');
  });

  it("formats operations with signature", () => {
    const op = create("UMLOperation", {
      name: "write",
      parameters: [create("UMLParameter", { name: "title", type: "String" }), create("UMLParameter", { type: "Book", direction: "return" })],
    });
    expect(formatOperation(op, none)).toBe("+write(title: String): Book");
    expect(formatOperation(op, none, { showVisibility: true, showType: true, showMultiplicity: true, showProperty: true, showOperationSignature: false })).toBe("+write()");
  });

  it("validates multiplicities", () => {
    for (const m of ["", "1", "*", "0..1", "1..*", "2..5"]) expect(isValidMultiplicity(m)).toBe(true);
    for (const m of ["a", "1..", "..2", "-1"]) expect(isValidMultiplicity(m)).toBe(false);
  });
});
