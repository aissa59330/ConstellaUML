// SQL SELECT → query tree. Clauses are applied in their logical order:
// FROM/JOIN, WHERE, GROUP BY, HAVING, SELECT, DISTINCT, ORDER BY, LIMIT;
// UNION/INTERSECT/EXCEPT combine two trees.
import { type Element, ref } from "../../core/element";
import { create, uniqueName } from "../../core/factory";
import { Cursor, type Token, joinTokens, splitTop, tokenize } from "../../core/lexer";
import type { Repository } from "../../core/repository";

export type QNode = { kind: "relation"; name: string; alias: string } | { kind: "op"; operator: string; expression: string; inputs: QNode[] };

const CLAUSES = ["from", "where", "group", "having", "order", "limit", "union", "intersect", "except", "offset"];
const JOIN_WORDS = ["join", "inner", "left", "right", "full", "cross", "natural", "outer", "on", "using"];

const lex = (sql: string) => tokenize(sql, { lineComments: ["--", "#"], blockComments: true, strings: ["'"], quotedIds: ["`", '"'], operators: ["<=", ">=", "<>", "!=", "||"] });

/** Tokens up to the next clause keyword (any of `stops`) at depth 0. */
function until(c: Cursor, stops: string[]): Token[] {
  const out: Token[] = [];
  while (!c.done && !c.is(";") && !c.is(")") && !stops.some((s) => c.isKw(s))) {
    if (c.is("(")) {
      const s = c.i;
      c.skipGroup();
      out.push(...c.toks.slice(s, c.i));
    } else out.push(c.next()!);
  }
  return out;
}

const text = (toks: Token[]) =>
  joinTokens(toks)
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s*(<=|>=|<>|!=|=|<|>)\s*/g, " $1 ");

function relation(c: Cursor): QNode {
  if (c.is("(")) {
    const inner = parseQueryTokens(c.group());
    const alias = c.eatKw("as") || c.isId() ? (c.isId() && !JOIN_WORDS.includes(c.peek()!.v.toLowerCase()) && !CLAUSES.includes(c.peek()!.v.toLowerCase()) ? c.next()!.v : "") : "";
    return alias ? { kind: "op", operator: "RENAME", expression: alias, inputs: [inner] } : inner;
  }
  let name = c.next()?.v ?? "?";
  while (c.is(".") && c.isId(1)) {
    c.next();
    name = c.next()!.v;
  }
  c.eatKw("as");
  const alias = c.isId() && !JOIN_WORDS.includes(c.peek()!.v.toLowerCase()) && !CLAUSES.includes(c.peek()!.v.toLowerCase()) ? c.next()!.v : "";
  return { kind: "relation", name, alias };
}

function fromClause(c: Cursor): QNode {
  let left = relation(c);
  for (;;) {
    if (c.eat(",")) {
      left = { kind: "op", operator: "CROSS JOIN", expression: "", inputs: [left, relation(c)] };
      continue;
    }
    let operator = "";
    if (c.eatKw("natural")) operator = "JOIN";
    if (c.eatKw("cross", "join")) operator = "CROSS JOIN";
    else if (c.eatKw("inner", "join") || c.eatKw("join")) operator ||= "JOIN";
    else {
      for (const side of ["left", "right", "full"]) {
        if (c.isKw(side)) {
          c.next();
          c.eatKw("outer");
          if (c.eatKw("join")) operator = `${side.toUpperCase()} JOIN`;
        }
      }
    }
    if (!operator) return left;
    const right = relation(c);
    let expression = "";
    if (c.eatKw("on")) expression = text(until(c, [...CLAUSES, ...JOIN_WORDS.filter((w) => w !== "on" && w !== "using")]));
    else if (c.eatKw("using")) expression = `USING ${text(c.group())}`;
    left = { kind: "op", operator, expression, inputs: [left, right] };
  }
}

function selectQuery(c: Cursor): QNode {
  if (c.is("(")) {
    const node = parseQueryTokens(c.group());
    return node;
  }
  if (!c.eatKw("select")) throw new Error("La requête doit commencer par SELECT.");
  const distinct = c.eatKw("distinct");
  c.eatKw("all");
  const projection = text(until(c, CLAUSES));
  let node: QNode = { kind: "relation", name: "DUAL", alias: "" };
  if (c.eatKw("from")) node = fromClause(c);
  const wrap = (operator: string, expression: string) => (node = { kind: "op", operator, expression, inputs: [node] });
  let orderBy = "";
  let limit = "";
  for (;;) {
    if (c.eatKw("where")) wrap("WHERE", text(until(c, CLAUSES)));
    else if (c.eatKw("group", "by")) wrap("GROUP BY", text(until(c, CLAUSES)));
    else if (c.eatKw("having")) wrap("HAVING", text(until(c, CLAUSES)));
    else if (c.eatKw("order", "by")) orderBy = text(until(c, CLAUSES));
    else if (c.eatKw("limit") || c.eatKw("offset")) limit = [limit, text(until(c, CLAUSES))].filter(Boolean).join(", ");
    else break;
  }
  wrap("SELECT", projection);
  if (distinct) wrap("DISTINCT", "");
  if (orderBy) wrap("ORDER BY", orderBy);
  if (limit) wrap("LIMIT", limit);
  return node;
}

function parseQueryTokens(toks: Token[]): QNode {
  const c = new Cursor(toks);
  let node = selectQuery(c);
  for (;;) {
    const op = ["union", "intersect", "except"].find((k) => c.isKw(k));
    if (!op) break;
    c.next();
    const all = c.eatKw("all");
    node = { kind: "op", operator: op.toUpperCase(), expression: all ? "ALL" : "", inputs: [node, selectQuery(c)] };
  }
  return node;
}

/** Parses the first SELECT statement of `sql` into a tree (root = result). */
export function parseQuery(sql: string): QNode {
  const statements = splitTop(lex(sql), ";");
  if (!statements.length) throw new Error("Requête vide.");
  return parseQueryTokens(statements[0]);
}

// ---- diagram ------------------------------------------------------------------

const V_GAP = 70;
const SLOT = 170;

/**
 * Creates a query (model + diagram) from `sql`: relations on top, the result
 * at the bottom, data flowing downwards. One undoable operation.
 */
export function buildQueryTree(repo: Repository, owner: Element, sql: string, name = "Requête"): { query: Element; diagram: Element } {
  const tree = parseQuery(sql);
  // Height of each node above the root, to put leaves on top.
  const depthOf = (n: QNode): number => (n.kind === "op" ? 1 + Math.max(0, ...n.inputs.map(depthOf)) : 0);
  const total = depthOf(tree);
  // Horizontal slots: leaves take one slot each, operators sit above their inputs' middle.
  const width = (n: QNode): number => (n.kind === "op" ? Math.max(1, n.inputs.reduce((a, i) => a + width(i), 0)) : 1);
  return repo.transact("SQL → arbre", (tx) => {
    const query = tx.insert(owner, "ownedElements", create("RAQuery", { name: uniqueName(name, owner.ownedElements), sql: sql.trim() }));
    const diagram = tx.insert(query, "ownedElements", create("RAQueryDiagram", { name: query.name }));
    const place = (n: QNode, x0: number, level: number): Element => {
      const w = width(n) * SLOT;
      const cx = x0 + w / 2;
      const y = 20 + level * V_GAP;
      let model: Element;
      let view: Element;
      if (n.kind === "relation") {
        model = tx.insert(query, "ownedElements", create("RARelation", { name: n.name, alias: n.alias }));
        view = create("RARelationView", { model: ref(model), left: Math.round(cx - 40), top: y, width: 80, height: 30 });
      } else {
        model = tx.insert(query, "ownedElements", create("RAOperator", { name: n.operator, operator: n.operator, expression: n.expression }));
        view = create("RAOperatorView", { model: ref(model), left: Math.round(cx - 35), top: y, width: 70, height: 28 });
      }
      tx.insert(diagram, "ownedViews", view);
      if (n.kind === "op") {
        let x = x0;
        for (const input of n.inputs) {
          const iw = width(input) * SLOT;
          // Inputs of a unary operator stay right above it.
          const childView = place(input, n.inputs.length === 1 ? x0 + (w - iw) / 2 : x, level - 1);
          x += iw;
          const flow = tx.insert(query, "ownedElements", create("RAFlow", { source: childView.model, target: ref(model) }));
          tx.insert(diagram, "ownedViews", create("RAFlowView", { model: ref(flow), tail: ref(childView), head: ref(view), lineStyle: 1 }));
        }
      }
      return view;
    };
    place(tree, 20, total);
    return { query, diagram };
  });
}
