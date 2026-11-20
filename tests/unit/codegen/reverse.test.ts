import { describe, expect, it } from "vitest";
import { DEFAULT_GEN_OPTIONS, type Language, generate } from "../../../src/codegen";
import { type RType, buildUmlModel, reverse } from "../../../src/codegen/reverse";
import type { Element } from "../../../src/core/element";
import { Repository } from "../../../src/core/repository";
import { newProject } from "../../../src/io/mdj";
import { diagramOfElements } from "../../../src/notation/uml";
import { approxMeasurer } from "../../../src/render/graphics";
import { shopModel } from "../../fixtures/codegen-model";

/** Generates the shop model in `lang`, then reads the files back. */
function roundTrip(lang: Language) {
  const { repo, model } = shopModel();
  const files = generate(repo, model, lang, DEFAULT_GEN_OPTIONS);
  return reverse(lang, files);
}

const byName = (types: RType[], name: string) => {
  const t = types.find((x) => x.name === name);
  if (!t) throw new Error(`${name} not in ${types.map((x) => x.name).join(", ")}`);
  return t;
};

describe("reverse engineering: generated code reads back", () => {
  for (const lang of ["java", "typescript", "php", "python"] as Language[]) {
    it(lang, () => {
      const { types, errors } = roundTrip(lang);
      expect(errors).toEqual([]);
      expect(types.map((t) => t.name).sort()).toEqual(["Book", "Category", "Order", "OrderService", "Printable", "Product"]);
      const book = byName(types, "Book");
      expect(book.pkg.join("/")).toBe("shop/domain");
      // Python has no "implements": interfaces are base classes too.
      if (lang === "python") expect(book.supers).toEqual(["Product", "Printable"]);
      else {
        expect(book.supers).toEqual(["Product"]);
        expect(book.interfaces).toEqual(["Printable"]);
      }
      expect(book.fields.map((f) => f.name)).toEqual(expect.arrayContaining(["isbn", "category"]));
      expect(book.methods.map((m) => m.name)).toEqual(expect.arrayContaining(["describe", "print"]));
      const print = book.methods.find((m) => m.name === "print")!;
      expect(print.params.map((p) => p.name)).toEqual(["copies"]);
      expect(byName(types, "Category").kind).toBe("enum");
      expect(byName(types, "Category").literals).toEqual(["BOOK", "FOOD"]);
      expect(byName(types, "Product").isAbstract).toBe(true);
      const order = byName(types, "Order");
      expect(order.fields.find((f) => f.name === "items")?.type).toMatch(/Product/);
    });
  }
});

describe("reverse engineering: robustness", () => {
  it("Java: keeps the rest of a file after a syntax error, reads records and generics", () => {
    const src = `
      package com.acme;
      import java.util.*;
      /** A shelf. */
      public class Shelf<T extends Book> extends Base implements Comparable<Shelf<T>>, Serializable {
        private final Map<String, List<T>> byAuthor = new HashMap<>();
        @Deprecated protected static int count, total = 3;
        public Shelf(int size) { this.size = size; if (x) { y(); } }
        void broken( { %%% }
        public <R> List<R> map(Function<T, R> fn, String... names) throws IOException { return null; }
        abstract int size();
        enum Kind { WOOD("w"), METAL("m") { void f() {} }; Kind(String s) {} }
      }
      record Point(int x, int y) { static Point origin() { return new Point(0, 0); } }
      interface Named extends Comparable<Named> { String name(); default String upper() { return name(); } }
    `;
    const { types } = reverse("java", [{ path: "Shelf.java", content: src }]);
    const shelf = byName(types, "Shelf");
    expect(shelf.doc).toBe("A shelf.");
    expect(shelf.typeParams).toEqual(["T"]);
    expect(shelf.supers).toEqual(["Base"]);
    expect(shelf.interfaces).toEqual(["Comparable", "Serializable"]);
    expect(shelf.fields.map((f) => [f.name, f.type, f.isStatic])).toEqual([
      ["byAuthor", "Map<String, List<T>>", false],
      ["count", "int", true],
      ["total", "int", true],
    ]);
    expect(shelf.methods.map((m) => m.name)).toEqual(expect.arrayContaining(["Shelf", "map", "size"]));
    expect(shelf.methods.find((m) => m.name === "map")!.params.map((p) => p.type)).toEqual(["Function<T, R>", "String[]"]);
    expect(byName(types, "Kind").literals).toEqual(["WOOD", "METAL"]);
    expect(byName(types, "Point").fields.map((f) => f.name)).toEqual(["x", "y"]);
    expect(byName(types, "Named").methods.find((m) => m.name === "name")!.isAbstract).toBe(true);
    expect(byName(types, "Named").methods.find((m) => m.name === "upper")!.isAbstract).toBe(false);
  });

  it("TypeScript: no semicolons, parameter properties, accessors, overloads", () => {
    const src = `
      import { X } from "./x"
      export const helper = () => { return 1 }
      export abstract class Repo<T> extends Base<T> implements Store {
        private items: Map<string, T> = new Map()
        static readonly VERSION = "1"
        #secret = 3
        constructor(private readonly db: Db, public name = "repo") { super() }
        get size(): number { return this.items.size }
        find(id: string): T | undefined
        find(id: string): T | undefined { return this.items.get(id) }
        abstract save(item: T): Promise<void>
        handler = (e: Event) => { console.log(e) }
      }
      export interface Store { readonly count: number; load(): void }
      export enum Color { Red = "r", Green = "g" }
      function oops( {
      export class After {}
    `;
    const { types } = reverse("typescript", [{ path: "src/repo.ts", content: src }]);
    const repo = byName(types, "Repo");
    expect(repo.pkg).toEqual(["src"]);
    expect(repo.isAbstract).toBe(true);
    expect(repo.supers).toEqual(["Base"]);
    expect(repo.fields.map((f) => f.name)).toEqual(["items", "VERSION", "secret", "db", "name", "size", "handler"]);
    expect(repo.fields.find((f) => f.name === "db")).toMatchObject({ visibility: "private", isReadOnly: true, type: "Db" });
    expect(repo.methods.map((m) => m.name)).toEqual(["Repo", "find", "save"]);
    expect(byName(types, "Store").fields[0]).toMatchObject({ name: "count", type: "number" });
    expect(byName(types, "Color").literals).toEqual(["Red", "Green"]);
    expect(types.map((t) => t.name)).toContain("After");
  });

  it("PHP: namespaces, promoted constructor, constants, enums, traits", () => {
    const src = `<?php
      namespace App\\Model;
      use App\\Base\\Entity;
      /** Un client. */
      final class Customer extends Entity implements \\JsonSerializable {
        use Timestamps;
        public const MAX = 10;
        private ?string $email = null;
        protected array $orders = [];
        public function __construct(private readonly int $id, public string $name = "x") {}
        public static function create(string $name): static { return new static(1, $name); }
        abstract protected function check(): bool;
      }
      enum Status: string { case Active = 'a'; case Gone = 'g'; }
      interface Repo { public function find(int $id): ?Customer; }
    `;
    const { types } = reverse("php", [{ path: "Customer.php", content: src }]);
    const c = byName(types, "Customer");
    expect(c.pkg).toEqual(["App", "Model"]);
    expect(c.isFinal).toBe(true);
    expect(c.doc).toBe("Un client.");
    expect(c.supers).toEqual(["Entity"]);
    expect(c.interfaces).toEqual(["JsonSerializable"]);
    expect(c.fields.map((f) => [f.name, f.type])).toEqual([
      ["MAX", ""],
      ["email", "?string"],
      ["orders", "array"],
      ["id", "int"],
      ["name", "string"],
    ]);
    expect(c.methods.map((m) => [m.name, m.isStatic])).toEqual([
      ["__construct", false],
      ["create", true],
      ["check", false],
    ]);
    expect(byName(types, "Status").literals).toEqual(["Active", "Gone"]);
    expect(byName(types, "Repo").methods[0].isAbstract).toBe(true);
  });

  it("Python: dataclasses, properties, enums, __init__ attributes", () => {
    const src = [
      "from dataclasses import dataclass",
      "from enum import Enum",
      "",
      "class Color(Enum):",
      "    RED = 1",
      "    GREEN = 2",
      "",
      "@dataclass",
      "class Point:",
      '    """A point."""',
      "    x: float",
      "    y: float = 0.0",
      "    ORIGIN = None",
      "",
      "class Shape(ABC):",
      "    def __init__(self, name: str, points: list[Point]):",
      "        self.name = name",
      "        self._points: list[Point] = points",
      "        self.__id = 0",
      "",
      "    @property",
      "    def size(self) -> int:",
      "        return len(self._points)",
      "",
      "    @abstractmethod",
      "    def area(self) -> float: ...",
      "",
      "    @staticmethod",
      "    def unit(",
      "        scale: float = 1.0,",
      "    ) -> 'Shape':",
      "        pass",
      "",
      "class Square(Shape):",
      "    pass",
    ].join("\n");
    const { types } = reverse("python", [{ path: "geo/shapes.py", content: src }]);
    expect(types.map((t) => t.name)).toEqual(["Color", "Point", "Shape", "Square"]);
    expect(byName(types, "Color")).toMatchObject({ kind: "enum", literals: ["RED", "GREEN"] });
    const p = byName(types, "Point");
    expect(p.doc).toBe("A point.");
    expect(p.fields.map((f) => [f.name, f.type, f.isStatic])).toEqual([
      ["x", "float", false],
      ["y", "float", false],
      ["ORIGIN", "", true],
    ]);
    const s = byName(types, "Shape");
    expect(s.pkg).toEqual(["geo"]);
    expect(s.isAbstract).toBe(true);
    expect(s.fields.map((f) => [f.name, f.type, f.visibility])).toEqual([
      ["name", "str", "public"],
      ["points", "list[Point]", "protected"],
      ["id", "", "private"],
      ["size", "int", "public"],
    ]);
    expect(s.methods.map((m) => [m.name, m.isStatic, m.isAbstract])).toEqual([
      ["Shape", false, false],
      ["area", false, true],
      ["unit", true, false],
    ]);
    expect(byName(types, "Square").supers).toEqual(["Shape"]);
  });
});

describe("reverse engineering: model and diagrams", () => {
  it("builds packages, classes, associations and a laid-out diagram (one undo step)", () => {
    const { types } = roundTrip("java");
    const repo = new Repository();
    repo.load(newProject());
    const model = repo.root!.ownedElements[0] as Element;
    const key = "reverse-test";
    const { packages, classifiers } = buildUmlModel(repo, model, types, { associations: true }, key);
    expect([...packages.keys()].sort()).toEqual(["", "shop", "shop/domain", "shop/service"]);
    const book = classifiers.find((c) => c.name === "Book")!;
    const rels = repo.relationshipsOf(book._id).map((r) => r._type).sort();
    expect(rels).toEqual(["UMLAssociation", "UMLGeneralization", "UMLInterfaceRealization"]);
    const order = classifiers.find((c) => c.name === "Order")!;
    const assoc = repo.relationshipsOf(order._id).find((r) => r._type === "UMLAssociation")!;
    expect(assoc.end2).toMatchObject({ name: "items", multiplicity: "0..*" });
    const domain = packages.get("shop/domain")!;
    const d = diagramOfElements(repo, domain, "UMLClassDiagram", "domain", classifiers.filter((c) => repo.parentOf(c) === domain), approxMeasurer, "light", key);
    const views = d.ownedViews as Element[];
    const viewOf = (name: string) => views.find((v) => repo.deref(v.model)?.name === name)!;
    expect(viewOf("Product").top).toBeLessThan(viewOf("Book").top);
    expect(views.some((v) => v._type === "UMLGeneralizationView")).toBe(true);
    repo.undo();
    expect(model.ownedElements.some((e: Element) => e.name === "shop")).toBe(false);
  });
});
