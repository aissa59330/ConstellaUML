// Parsed SQL schema → ERD data model (entities, columns, relationships), as
// one undoable operation.
import { type Element, ref } from "../../core/element";
import { create, uniqueName } from "../../core/factory";
import type { Repository } from "../../core/repository";
import type { SqlSchema } from "./sql";

export function importSchema(repo: Repository, owner: Element, schema: SqlSchema, name = "DataModel"): { dataModel: Element; entities: Element[]; relationships: Element[] } {
  return repo.transact("Import SQL", (tx) => {
    const dataModel = tx.insert(owner, "ownedElements", create("ERDDataModel", { name: ((owner.ownedElements ?? []) as Element[]).some((e) => e.name === name) ? uniqueName(name, owner.ownedElements) : name }));
    const entities = new Map<string, Element>();
    const columns = new Map<string, Element>();
    const key = (t: string, c: string) => `${t.toLowerCase()}.${c.toLowerCase()}`;
    for (const t of schema.tables) {
      const entity = tx.insert(dataModel, "ownedElements", create("ERDEntity", { name: t.name, documentation: t.comment }));
      entities.set(t.name.toLowerCase(), entity);
      for (const c of t.columns) {
        const col = tx.insert(
          entity,
          "columns",
          create("ERDColumn", {
            name: c.name,
            type: c.type,
            length: c.length,
            primaryKey: c.primaryKey,
            nullable: c.nullable && !c.primaryKey,
            unique: c.unique,
            defaultValue: c.defaultValue,
            foreignKey: !!c.references,
            documentation: c.comment,
          }),
        );
        columns.set(key(t.name, c.name), col);
      }
    }
    const relationships: Element[] = [];
    for (const t of schema.tables) {
      const child = entities.get(t.name.toLowerCase())!;
      for (const c of t.columns) {
        if (!c.references) continue;
        const target = columns.get(key(c.references.table, c.references.column));
        const parent = entities.get(c.references.table.toLowerCase());
        const col = columns.get(key(t.name, c.name))!;
        if (target) tx.set(col, "referenceTo", ref(target));
        if (!parent) continue;
        // Parent side: exactly one (optional when the FK may be NULL); child side: many (or one when unique).
        const rel = create("ERDRelationship", { name: "", identifying: c.primaryKey });
        rel.end1 = create("ERDRelationshipEnd", { _parent: ref(rel), reference: ref(parent), cardinality: c.nullable && !c.primaryKey ? "0..1" : "1" });
        rel.end2 = create("ERDRelationshipEnd", { _parent: ref(rel), reference: ref(child), cardinality: c.unique ? "0..1" : "0..*" });
        relationships.push(tx.insert(parent, "ownedElements", rel));
      }
    }
    return { dataModel, entities: [...entities.values()], relationships };
  });
}
