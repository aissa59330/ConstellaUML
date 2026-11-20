// Entity-relationship data models (ERD / physical data model). Type and field
// names follow the .mdj format for interoperability.
import { meta, type FieldDef, type TypeDef } from "./registry";

const b = (name: string, def = false): FieldDef => ({ name, kind: "boolean", default: def, editable: true });
const s = (name: string, def = ""): FieldDef => ({ name, kind: "string", default: def, editable: true });
const list = (name: string): FieldDef => ({ name, kind: "elements", default: [] });

/** Cardinalities of a relationship end, in crow's foot notation. */
export const CARDINALITIES = ["1", "0..1", "1..*", "0..*"];

export const erdTypes: TypeDef[] = [
  { name: "ERDElement", super: "ExtensibleModel", abstract: true },
  { name: "ERDDataModel", super: "ERDElement", contains: { ERDEntity: "ownedElements", Diagram: "ownedElements" } },
  { name: "ERDEntity", super: "ERDElement", fields: [list("columns")], contains: { ERDColumn: "columns", ERDRelationship: "ownedElements" } },
  {
    name: "ERDColumn",
    super: "ERDElement",
    fields: [
      s("type", "VARCHAR"),
      s("length"),
      b("primaryKey"),
      b("foreignKey"),
      { name: "referenceTo", kind: "ref", refType: "ERDColumn", editable: true },
      b("nullable"),
      b("unique"),
      s("defaultValue"),
    ],
  },
  { name: "ERDRelationship", super: "ERDElement", fields: [{ name: "end1", kind: "element" }, { name: "end2", kind: "element" }, b("identifying")] },
  {
    name: "ERDRelationshipEnd",
    super: "ERDElement",
    fields: [{ name: "reference", kind: "ref", refType: "ERDEntity" }, { name: "cardinality", kind: "enum", options: CARDINALITIES, default: "1", editable: true }],
  },
  { name: "ERDDiagram", super: "Diagram" },
  // Relational model (MLD): same entities and columns, drawn as tables with FK arrows.
  { name: "ERDRelationalDiagram", super: "Diagram", fields: [b("showColumnTypes", true)] },
];

export const erdViewTypes: TypeDef[] = [
  { name: "ERDEntityView", super: "NodeView", fields: [b("suppressColumns")] },
  { name: "ERDRelationshipView", super: "EdgeView" },
  { name: "ERDTableView", super: "NodeView" },
  { name: "ERDForeignKeyView", super: "EdgeView" },
];

let registered = false;
export function registerErdMeta(): void {
  if (registered) return;
  registered = true;
  meta.register([...erdTypes, ...erdViewTypes]);
}
