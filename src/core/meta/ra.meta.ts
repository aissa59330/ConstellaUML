// Query trees (relational algebra): relations at the leaves, operators above,
// data flowing along the edges towards the result.
import { meta, type FieldDef, type TypeDef } from "./registry";

/** Operators, in SQL spelling; their algebra symbol is in RA_SYMBOLS. */
export const RA_OPERATORS = ["SELECT", "WHERE", "JOIN", "LEFT JOIN", "RIGHT JOIN", "FULL JOIN", "CROSS JOIN", "GROUP BY", "HAVING", "DISTINCT", "ORDER BY", "LIMIT", "UNION", "INTERSECT", "EXCEPT", "RENAME"];

export const RA_SYMBOLS: Record<string, string> = {
  SELECT: "π",
  WHERE: "σ",
  JOIN: "⋈",
  "LEFT JOIN": "⟕",
  "RIGHT JOIN": "⟖",
  "FULL JOIN": "⟗",
  "CROSS JOIN": "×",
  "GROUP BY": "γ",
  HAVING: "σ",
  DISTINCT: "δ",
  "ORDER BY": "τ",
  LIMIT: "λ",
  UNION: "∪",
  INTERSECT: "∩",
  EXCEPT: "−",
  RENAME: "ρ",
};

const s = (name: string, def = ""): FieldDef => ({ name, kind: "string", default: def, editable: true });

export const raTypes: TypeDef[] = [
  { name: "RAElement", super: "ExtensibleModel", abstract: true },
  { name: "RAQuery", super: "RAElement", fields: [{ name: "sql", kind: "text", default: "", editable: true }], contains: { RAElement: "ownedElements", Diagram: "ownedElements" } },
  { name: "RARelation", super: "RAElement", fields: [s("alias")] },
  { name: "RAOperator", super: "RAElement", fields: [{ name: "operator", kind: "enum", options: RA_OPERATORS, default: "WHERE", editable: true }, s("expression")] },
  { name: "RAFlow", super: "RAElement", fields: [{ name: "source", kind: "ref", refType: "RAElement" }, { name: "target", kind: "ref", refType: "RAElement" }] },
  { name: "RAQueryDiagram", super: "Diagram", fields: [{ name: "notation", kind: "enum", options: ["sql", "algebra"], default: "sql", editable: true }] },
];

export const raViewTypes: TypeDef[] = [
  { name: "RARelationView", super: "NodeView" },
  { name: "RAOperatorView", super: "NodeView" },
  { name: "RAFlowView", super: "EdgeView" },
];

let registered = false;
export function registerRaMeta(): void {
  if (registered) return;
  registered = true;
  meta.register([...raTypes, ...raViewTypes]);
}
