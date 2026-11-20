// A small but complete model used by the code generator tests: packages,
// abstract class, interface, enum, generalization, realization, association,
// static and default values, cross-package references.
import { type Element, ref } from "../../src/core/element";
import { create } from "../../src/core/factory";
import { Repository } from "../../src/core/repository";
import { newProject } from "../../src/io/mdj";

export function shopModel() {
  const repo = new Repository();
  repo.load(newProject());
  const model = repo.root!.ownedElements[0] as Element;
  const els: Record<string, Element> = {};
  repo.transact("fixture", (tx) => {
    const shop = tx.insert(model, "ownedElements", create("UMLPackage", { name: "shop" }));
    const domain = tx.insert(shop, "ownedElements", create("UMLPackage", { name: "domain" }));
    const service = tx.insert(shop, "ownedElements", create("UMLPackage", { name: "service" }));
    const attr = (owner: Element, name: string, type: unknown, extra: Record<string, unknown> = {}) => tx.insert(owner, "attributes", create("UMLAttribute", { name, type, ...extra }));
    const op = (owner: Element, name: string, params: [string, unknown, string?][], extra: Record<string, unknown> = {}) => {
      const o = tx.insert(owner, "operations", create("UMLOperation", { name, ...extra }));
      for (const [n, t, dir] of params) tx.insert(o, "parameters", create("UMLParameter", { name: n, type: t, direction: dir ?? "in" }));
      return o;
    };
    const product = (els.Product = tx.insert(domain, "ownedElements", create("UMLClass", { name: "Product", isAbstract: true, documentation: "Something we sell." })));
    attr(product, "id", "Integer", { visibility: "protected" });
    attr(product, "name", "String", { visibility: "private" });
    attr(product, "price", "Real", { defaultValue: "0" });
    attr(product, "count", "Integer", { isStatic: true, defaultValue: "0" });
    op(product, "describe", [["", "String", "return"]], { isAbstract: true });
    const printable = (els.Printable = tx.insert(domain, "ownedElements", create("UMLInterface", { name: "Printable" })));
    op(printable, "print", [["copies", "Integer"]]);
    const category = (els.Category = tx.insert(domain, "ownedElements", create("UMLEnumeration", { name: "Category" })));
    for (const l of ["BOOK", "FOOD"]) tx.insert(category, "literals", create("UMLEnumerationLiteral", { name: l }));
    const book = (els.Book = tx.insert(domain, "ownedElements", create("UMLClass", { name: "Book" })));
    attr(book, "isbn", "String");
    attr(book, "category", ref(category));
    op(book, "describe", [["", "String", "return"]]);
    op(book, "print", [["copies", "Integer"]]);
    tx.insert(book, "ownedElements", create("UMLGeneralization", { source: ref(book), target: ref(product) }));
    tx.insert(book, "ownedElements", create("UMLInterfaceRealization", { source: ref(book), target: ref(printable) }));
    const order = (els.Order = tx.insert(domain, "ownedElements", create("UMLClass", { name: "Order" })));
    op(order, "total", [["", "Real", "return"]]);
    const assoc = create("UMLAssociation", { name: "contains" });
    assoc.end1 = create("UMLAssociationEnd", { _parent: ref(assoc), reference: ref(order), navigable: false });
    assoc.end2 = create("UMLAssociationEnd", { _parent: ref(assoc), reference: ref(product), name: "items", multiplicity: "0..*" });
    tx.insert(order, "ownedElements", assoc);
    const svc = (els.OrderService = tx.insert(service, "ownedElements", create("UMLClass", { name: "OrderService" })));
    op(svc, "place", [["order", ref(order)], ["", "Boolean", "return"]]);
  });
  return { repo, model, els };
}
