// Tools offered to Claude (or any MCP client) through the `constella --mcp`
// bridge. They act on the project on screen; every write tool runs as one
// operation named "Claude : …", so Ctrl+Z undoes it like a user action.
import { type Element, children, isElement, isRef, ref } from "../core/element";
import { meta } from "../core/meta/registry";
import type { Repository } from "../core/repository";
import {
  CommandError,
  DIAGRAM_TYPES,
  type EdgeTool,
  type FeatureKind,
  type NodeTool,
  type Tool,
  addDiagram,
  addFeature,
  addViewOfModel,
  createEdge,
  createNode,
  deleteFromModel,
  deleteViews,
  editAttribute,
  editEntity,
  editFlow,
  editMessage,
  editOperation,
  editTransition,
  entityText,
  formatAttribute,
  formatOperation,
  layoutDiagram,
  renameElement,
  toolGroupsFor,
} from "../notation/uml";
import { boundsOf, isEdgeView } from "../notation/views";
import type { Theme } from "../render/colors";
import { arrangeDiagram } from "../render/diagram";
import { type Rect, type TextMeasurer, union } from "../render/graphics";

export interface ToolEnv {
  repo: Repository;
  measure: TextMeasurer;
  theme: Theme;
  readOnly: boolean;
  activeDiagram(): Element | undefined;
  selection(): Element[];
  openDiagram(id: string): void;
  select(els: Element[]): void;
  /** PNG of a diagram, base64-encoded (needs a canvas, so supplied by the UI). */
  renderPng?(diagram: Element): Promise<string>;
}

export type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** Changes the project (refused in read-only mode). */
  write?: boolean;
  run(args: any, env: ToolEnv): unknown;
}

export class ToolError extends Error {}

/** Marks a tool result made of MCP content blocks rather than JSON data. */
export class ContentResult {
  constructor(readonly content: Content[]) {}
}

// ---- helpers ---------------------------------------------------------------------

const str = (description: string) => ({ type: "string", description });
const strings = (description: string) => ({ type: "array", items: { type: "string" }, description });
const num = (description: string) => ({ type: "number", description });
const schema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });

const isView = (el: Element) => meta.isKindOf(el._type, "View");
const isDiagram = (el: Element) => meta.isKindOf(el._type, "Diagram");

function summary(el: Element | undefined): { id: string; type: string; name?: string } | null {
  if (!el) return null;
  return { id: el._id, type: el._type, ...(typeof el.name === "string" ? { name: el.name } : {}) };
}

function element(env: ToolEnv, id: unknown, what = "élément"): Element {
  if (typeof id !== "string" || !id) throw new ToolError(`Identifiant d'${what} manquant.`);
  const el = env.repo.get(id);
  if (!el) throw new ToolError(`Aucun ${what} d'identifiant « ${id} ». Utilise get_project_outline ou get_diagram pour retrouver les identifiants.`);
  return el;
}

/** A diagram by id, or the active one when `id` is omitted. */
function diagramArg(env: ToolEnv, id: unknown): Element {
  const d = id === undefined || id === "" ? env.activeDiagram() : element(env, id, "diagramme");
  if (!d) throw new ToolError("Aucun diagramme ouvert : précise diagram_id ou crée-en un avec create_diagram.");
  if (!isDiagram(d)) throw new ToolError(`« ${d._id} » (${d._type}) n'est pas un diagramme.`);
  return d;
}

/** Model element behind a view id, or the element itself. */
function modelArg(env: ToolEnv, id: unknown): Element {
  const el = element(env, id);
  return isView(el) ? env.repo.deref(el.model) ?? el : el;
}

function toolsOf(diagramType: string): Tool[] {
  return toolGroupsFor(diagramType).flatMap((g) => g.tools);
}

function toolArg<K extends Tool["kind"]>(diagram: Element, id: unknown, kind: K): Extract<Tool, { kind: K }> {
  const tool = toolsOf(diagram._type).find((t) => t.id === id);
  if (!tool || tool.kind !== kind) {
    const valid = toolsOf(diagram._type).filter((t) => t.kind === kind).map((t) => t.id);
    throw new ToolError(`Outil « ${String(id)} » inconnu pour ${diagram._type}. Outils ${kind === "node" ? "de nœud" : "de lien"} possibles : ${valid.join(", ")}.`);
  }
  return tool as Extract<Tool, { kind: K }>;
}

function arrange(env: ToolEnv, diagram: Element): void {
  arrangeDiagram(diagram, { repo: env.repo, theme: env.theme, measure: env.measure });
}

/** Free spot for a new node: right of the existing ones, or on a new row. */
function freeSpot(env: ToolEnv, diagram: Element, w: number, h: number): Rect {
  arrange(env, diagram);
  const nodes = ((diagram.ownedViews ?? []) as Element[]).filter((v) => !isEdgeView(v) && !v.containerView);
  const b = union(nodes.map(boundsOf));
  if (!b) return { x: 40, y: 40, w, h };
  const lastRowTop = Math.max(...nodes.map((v) => boundsOf(v).y));
  return b.x + b.w + 40 + w <= 1200 ? { x: b.x + b.w + 40, y: lastRowTop, w, h } : { x: b.x, y: b.y + b.h + 60, w, h };
}

/** Node view of `id` in `diagram`: the view itself, a view of that model, or a new one. */
function nodeIn(env: ToolEnv, diagram: Element, id: unknown): Element {
  const el = element(env, id);
  if (isView(el)) {
    if (env.repo.diagramOf(el) !== diagram) throw new ToolError(`La vue « ${el._id} » n'appartient pas au diagramme « ${diagram.name} ».`);
    return el;
  }
  const existing = ((diagram.ownedViews ?? []) as Element[]).find((v) => v.model?.$ref === el._id && !isEdgeView(v));
  if (existing) return existing;
  const r = freeSpot(env, diagram, 120, 60);
  const view = addViewOfModel(env.repo, diagram, el, r.x, r.y);
  if (!view) throw new ToolError(`${el._type} ne peut pas apparaître dans un ${diagram._type}.`);
  return view;
}

function claude<T>(env: ToolEnv, name: string, fn: () => T): T {
  return env.repo.transact(`Claude : ${name}`, fn);
}

const resolve = (env: ToolEnv) => (r: unknown) => env.repo.deref(r);

function nameOf(env: ToolEnv, r: unknown): string {
  const el = env.repo.deref(r);
  return el ? el.name || el._type : "?";
}

function describe(env: ToolEnv, el: Element): string {
  const id = ` [${el._id}]`;
  if (el._type === "UMLAttribute") return `attribut ${formatAttribute(el, resolve(env))}${id}`;
  if (el._type === "UMLOperation") return `opération ${formatOperation(el, resolve(env))}${id}`;
  if (el._type === "ERDColumn") return `colonne ${el.name}: ${el.type ?? ""}${el.primaryKey ? " PK" : ""}${el.foreignKey ? " FK" : ""}${id}`;
  if (isElement(el.end1) && isElement(el.end2)) {
    const end = (e: Element) => `${nameOf(env, e.reference)}${e.multiplicity || e.cardinality ? `(${e.multiplicity || e.cardinality})` : ""}${e.aggregation && e.aggregation !== "none" ? ` ◆${e.aggregation}` : ""}`;
    return `${el._type}${el.name ? ` "${el.name}"` : ""} ${end(el.end1)} - ${end(el.end2)}${id}`;
  }
  if (isRef(el.source) && isRef(el.target)) return `${el._type}${el.name ? ` "${el.name}"` : ""} ${nameOf(env, el.source)} → ${nameOf(env, el.target)}${id}`;
  const stereotype = typeof el.stereotype === "string" && el.stereotype ? `«${el.stereotype}» ` : "";
  return `${el._type} ${stereotype}"${el.name ?? ""}"${id}`;
}

const MAX_LINES = 1500;

function outline(env: ToolEnv, el: Element, depth: number, out: string[]): void {
  if (out.length >= MAX_LINES) return;
  out.push("  ".repeat(depth) + describe(env, el));
  if (isDiagram(el) || el._type === "UMLAttribute" || el._type === "UMLOperation") return;
  for (const [field, , child] of children(el)) {
    if (field === "end1" || field === "end2" || isView(child)) continue;
    outline(env, child, depth + 1, out);
  }
}

/** JSON view of an element: references show the target's name, nested lists of owned elements are summarized. */
function plain(env: ToolEnv, el: Element, depth: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const value = (v: unknown, d: number): unknown => {
    if (isRef(v)) return { $ref: v.$ref, name: nameOf(env, v) };
    if (isElement(v)) return d > 0 ? plain(env, v, d - 1) : summary(v);
    if (Array.isArray(v)) return v.map((x) => value(x, d));
    return v;
  };
  for (const [k, v] of Object.entries(el)) {
    if (k === "_parent") continue;
    out[k] = k === "ownedElements" || k === "ownedViews" ? (v as Element[]).map((x) => summary(x)) : value(v, depth);
  }
  return out;
}

const FEATURE_KINDS = ["attributes", "operations", "literals", "receptions", "templateParameters"] as const;

function addFeatures(env: ToolEnv, model: Element, kind: FeatureKind, items: unknown): Element[] {
  if (items === undefined) return [];
  if (!Array.isArray(items)) throw new ToolError(`${kind} doit être une liste de chaînes.`);
  if (!meta.field(model._type, kind)) throw new ToolError(`${model._type} n'a pas de ${kind}.`);
  return items.map((x) => addFeature(env.repo, model, kind, String(x)));
}

/** Writes an expression the way the quick editor would for this kind of element. */
function rename(env: ToolEnv, el: Element, expression: string): void {
  const r = env.repo;
  if (el._type === "UMLAttribute") editAttribute(r, el, expression);
  else if (el._type === "UMLOperation") editOperation(r, el, expression);
  else if (el._type === "UMLMessage") editMessage(r, el, expression);
  else if (el._type === "UMLTransition") editTransition(r, el, expression);
  else if (el._type === "UMLControlFlow" || el._type === "UMLObjectFlow") editFlow(r, el, expression);
  else if (el.end1 || isRef(el.source)) r.transact("Rename", (tx) => tx.set(el, "name", expression));
  else renameElement(r, el, expression);
}

/** Converts a JSON value for `field` of `el`, checking it against the metamodel. */
function fieldValue(env: ToolEnv, el: Element, field: string, value: unknown): unknown {
  const f = meta.field(el._type, field);
  if (!f || field.startsWith("_")) {
    const known = meta.fields(el._type).filter((x) => x.editable !== false && !["element", "elements"].includes(x.kind)).map((x) => x.name);
    throw new ToolError(`${el._type} n'a pas de champ « ${field} ». Champs modifiables : ${known.join(", ")}.`);
  }
  const target = (id: unknown) => {
    const t = element(env, typeof id === "object" && id && "$ref" in id ? (id as { $ref: string }).$ref : id);
    return ref(t);
  };
  switch (f.kind) {
    case "element":
    case "elements":
      throw new ToolError(`« ${field} » contient des éléments : utilise add_members ou add_element.`);
    case "ref":
      return value === null ? undefined : target(value);
    case "refs":
      if (!Array.isArray(value)) throw new ToolError(`« ${field} » attend une liste d'identifiants.`);
      return value.map(target);
    case "typeRef":
      // A known classifier id becomes a reference, any other text stays a type name.
      return typeof value === "string" && env.repo.get(value) ? ref(value) : value;
    case "boolean":
      if (typeof value !== "boolean") throw new ToolError(`« ${field} » attend true ou false.`);
      return value;
    case "integer":
    case "number":
      if (typeof value !== "number") throw new ToolError(`« ${field} » attend un nombre.`);
      return value;
    case "enum":
      if (f.options && !f.options.includes(value as string)) throw new ToolError(`« ${field} » attend l'une des valeurs : ${f.options.join(", ")}.`);
      return value;
    default:
      if (typeof value !== "string") throw new ToolError(`« ${field} » attend du texte.`);
      return value;
  }
}

// ---- tools -------------------------------------------------------------------------

const QUICK_EDIT = "Syntaxe de l'éditeur rapide : visibilité (+ - # ~), nom, « : type », multiplicité [0..*], valeur par défaut « = 0 » ; opérations « + nom(param: Type): Retour ».";

export const TOOLS: ToolDef[] = [
  {
    name: "get_context",
    title: "Contexte",
    description: "Projet ouvert, diagramme affiché et éléments sélectionnés par l'utilisateur. À appeler en premier.",
    inputSchema: schema({}),
    run: (_, env) => {
      const d = env.activeDiagram();
      return {
        project: summary(env.repo.root ?? undefined),
        activeDiagram: summary(d),
        selection: env.selection().map((el) => (isView(el) ? { viewId: el._id, model: summary(env.repo.deref(el.model)) } : summary(el))),
        readOnly: env.readOnly,
        diagramTypes: DIAGRAM_TYPES.map((t) => t.type),
      };
    },
  },
  {
    name: "get_project_outline",
    title: "Arborescence du projet",
    description: "Arbre du modèle (paquetages, classes, attributs, opérations, relations, diagrammes) avec les identifiants entre crochets.",
    inputSchema: schema({ root_id: str("Sous-arbre à afficher (tout le projet par défaut).") }),
    run: (a, env) => {
      const root = a.root_id ? element(env, a.root_id) : env.repo.root;
      if (!root) throw new ToolError("Aucun projet ouvert.");
      const out: string[] = [];
      outline(env, root, 0, out);
      if (out.length >= MAX_LINES) out.push(`… (tronqué à ${MAX_LINES} lignes : utilise root_id pour un sous-arbre)`);
      return out.join("\n");
    },
  },
  {
    name: "get_element",
    title: "Détails d'un élément",
    description: "Tous les champs d'un élément du modèle ou d'une vue (les références indiquent le nom de leur cible).",
    inputSchema: schema({ id: str("Identifiant de l'élément ou de la vue.") }, ["id"]),
    run: (a, env) => plain(env, element(env, a.id), 2),
  },
  {
    name: "get_diagram",
    title: "Contenu d'un diagramme",
    description: "Vues d'un diagramme : nœuds (position, taille, élément représenté) et liens (vues reliées).",
    inputSchema: schema({ diagram_id: str("Diagramme (le diagramme affiché par défaut).") }),
    run: (a, env) => {
      const d = diagramArg(env, a.diagram_id);
      arrange(env, d);
      const views = (d.ownedViews ?? []) as Element[];
      return {
        diagram: summary(d),
        nodes: views
          .filter((v) => !isEdgeView(v))
          .map((v) => {
            const b = boundsOf(v);
            return { viewId: v._id, viewType: v._type, model: summary(env.repo.deref(v.model)), ...(v.text ? { text: v.text } : {}), x: b.x, y: b.y, width: b.w, height: b.h, ...(v.containerView ? { insideViewId: v.containerView.$ref } : {}) };
          }),
        edges: views.filter(isEdgeView).map((v) => ({ viewId: v._id, viewType: v._type, model: summary(env.repo.deref(v.model)), fromViewId: v.tail?.$ref, toViewId: v.head?.$ref })),
      };
    },
  },
  {
    name: "list_diagram_tools",
    title: "Outils d'un type de diagramme",
    description: "Outils de nœud et de lien utilisables avec add_element et add_relationship pour un type de diagramme.",
    inputSchema: schema({ diagram_type: { type: "string", enum: DIAGRAM_TYPES.map((t) => t.type), description: "Type de diagramme (celui du diagramme affiché par défaut)." } }),
    run: (a, env) => {
      const type = a.diagram_type ?? env.activeDiagram()?._type;
      if (!type) throw new ToolError("Précise diagram_type.");
      const tools = toolsOf(type);
      return {
        diagramType: type,
        nodeTools: tools.filter((t): t is NodeTool => t.kind === "node").map((t) => ({ tool: t.id, creates: t.modelType ?? t.viewType })),
        edgeTools: tools.filter((t): t is EdgeTool => t.kind === "edge").map((t) => ({ tool: t.id, creates: t.modelType ?? t.viewType, ...(t.variant ? { variant: t.variant } : {}) })),
      };
    },
  },
  {
    name: "create_diagram",
    title: "Créer un diagramme",
    description: "Crée un diagramme et l'ouvre. Les diagrammes de séquence, d'activité, d'états et ERD créent aussi leur conteneur (interaction, activité, machine à états, modèle de données).",
    write: true,
    inputSchema: schema(
      {
        type: { type: "string", enum: DIAGRAM_TYPES.map((t) => t.type), description: "Type de diagramme." },
        name: str("Nom du diagramme."),
        owner_id: str("Paquetage ou modèle qui le contient (le premier modèle du projet par défaut)."),
      },
      ["type"],
    ),
    run: (a, env) => {
      if (!DIAGRAM_TYPES.some((t) => t.type === a.type)) throw new ToolError(`Type de diagramme inconnu : ${a.type}.`);
      const root = env.repo.root;
      if (!root) throw new ToolError("Aucun projet ouvert.");
      const owner = a.owner_id ? modelArg(env, a.owner_id) : ((root.ownedElements ?? []) as Element[]).find((e) => e._type === "UMLModel") ?? root;
      const d = claude(env, "diagramme", () => {
        const d = addDiagram(env.repo, owner, a.type);
        if (a.name) env.repo.transact("Rename", (tx) => tx.set(d, "name", String(a.name)));
        return d;
      });
      env.openDiagram(d._id);
      return { diagram: summary(d), owner: summary(env.repo.parentOf(d)) };
    },
  },
  {
    name: "add_element",
    title: "Ajouter un élément",
    description: `Crée un élément et sa vue dans un diagramme (classe, interface, acteur, cas d'utilisation, état, ligne de vie, entité, note…). Sans x/y, il est placé à côté des autres ; appelle auto_layout à la fin. ${QUICK_EDIT}`,
    write: true,
    inputSchema: schema(
      {
        diagram_id: str("Diagramme (le diagramme affiché par défaut)."),
        tool: str("Outil de nœud, voir list_diagram_tools (ex. class, interface, enumeration, actor, useCase, entity, note)."),
        name: str("Nom, éventuellement avec stéréotype (« «entity» Livre »). Pour une note : son texte."),
        attributes: strings("Attributs, un par ligne de l'éditeur rapide (« - titre: String »)."),
        operations: strings("Opérations (« + emprunter(date: Date): Boolean »)."),
        literals: strings("Littéraux d'une énumération."),
        columns: strings("Colonnes d'une entité ERD (« id: INT PK », « titre: VARCHAR(100) »)."),
        x: num("Abscisse."),
        y: num("Ordonnée."),
        width: num("Largeur."),
        height: num("Hauteur."),
        inside_view_id: str("Vue conteneur (paquetage, sujet de cas d'utilisation, état composite…)."),
      },
      ["tool"],
    ),
    run: (a, env) => {
      const d = diagramArg(env, a.diagram_id);
      const tool = toolArg(d, a.tool, "node");
      const container = a.inside_view_id ? element(env, a.inside_view_id, "vue") : undefined;
      const [w, h] = [a.width ?? tool.size[0], a.height ?? tool.size[1]];
      const rect = a.x !== undefined && a.y !== undefined ? { x: a.x, y: a.y, w, h } : container ? { ...boundsOf(container), w, h } : freeSpot(env, d, w, h);
      const result = claude(env, tool.id, () => {
        const view = createNode(env.repo, d, tool, rect, container);
        const model = env.repo.deref(view.model);
        if (a.name !== undefined) {
          if (model) rename(env, model, String(a.name));
          else env.repo.transact("Text", (tx) => tx.set(view, "text", String(a.name)));
        }
        if (model) {
          for (const kind of ["attributes", "operations", "literals"] as const) addFeatures(env, model, kind, a[kind]);
          if (a.columns) {
            if (model._type !== "ERDEntity") throw new ToolError("columns ne s'applique qu'aux entités ERD.");
            editEntity(env.repo, model, [entityText(model), ...(a.columns as string[])].join("\n"));
          }
        }
        return { view, model };
      });
      env.openDiagram(d._id);
      env.select([result.view]);
      const lines: string[] = [];
      if (result.model) outline(env, result.model, 0, lines);
      return { viewId: result.view._id, model: summary(result.model), outline: lines };
    },
  },
  {
    name: "add_relationship",
    title: "Ajouter un lien",
    description:
      "Relie deux éléments d'un diagramme (association, généralisation, réalisation, dépendance, message, transition, flot, relation ERD…). from/to acceptent une vue ou un élément du modèle ; un élément absent du diagramme y est ajouté.",
    write: true,
    inputSchema: schema(
      {
        diagram_id: str("Diagramme (le diagramme affiché par défaut)."),
        tool: str("Outil de lien, voir list_diagram_tools (ex. association, composition, generalization, interfaceRealization, dependency, syncMessage, transition, controlFlow)."),
        from: str("Source : identifiant de vue ou d'élément. Pour une généralisation, la sous-classe ; pour une composition, le tout."),
        to: str("Cible : identifiant de vue ou d'élément."),
        name: str("Nom du lien ; pour un message « opération(args) », pour une transition « événement [garde] / effet »."),
        source_end: schema({ name: str("Rôle."), multiplicity: str("Multiplicité (1, 0..1, *, 1..*).") }),
        target_end: schema({ name: str("Rôle."), multiplicity: str("Multiplicité.") }),
      },
      ["tool", "from", "to"],
    ),
    run: (a, env) => {
      const d = diagramArg(env, a.diagram_id);
      const tool = toolArg(d, a.tool, "edge");
      const result = claude(env, tool.id, () => {
        const tail = nodeIn(env, d, a.from);
        const head = nodeIn(env, d, a.to);
        const view = createEdge(env.repo, d, tool, tail, head);
        const model = env.repo.deref(view.model);
        if (model && a.name) rename(env, model, String(a.name));
        if (model?.end1 && model.end2)
          for (const [end, spec] of [
            [model.end1, a.source_end],
            [model.end2, a.target_end],
          ] as [Element, Record<string, string> | undefined][]) {
            if (!spec) continue;
            env.repo.transact("End", (tx) => {
              if (spec.name !== undefined) tx.set(end, "name", spec.name);
              if (spec.multiplicity !== undefined) tx.set(end, meta.field(end._type, "cardinality") ? "cardinality" : "multiplicity", spec.multiplicity);
            });
          }
        return { view, model };
      });
      env.openDiagram(d._id);
      env.select([result.view]);
      return { viewId: result.view._id, model: result.model ? describe(env, result.model) : null };
    },
  },
  {
    name: "add_members",
    title: "Ajouter des attributs ou opérations",
    description: `Ajoute des attributs, opérations, littéraux, réceptions ou paramètres de modèle à un classificateur (élément ou vue). ${QUICK_EDIT}`,
    write: true,
    inputSchema: schema(
      {
        element_id: str("Classe, interface, énumération… (ou sa vue)."),
        kind: { type: "string", enum: FEATURE_KINDS, description: "Type de membres." },
        items: strings("Membres, un par ligne de l'éditeur rapide."),
      },
      ["element_id", "kind", "items"],
    ),
    run: (a, env) => {
      const model = modelArg(env, a.element_id);
      if (!FEATURE_KINDS.includes(a.kind)) throw new ToolError(`kind doit valoir ${FEATURE_KINDS.join(", ")}.`);
      const added = claude(env, a.kind, () => addFeatures(env, model, a.kind, a.items));
      return { added: added.map((f) => describe(env, f)) };
    },
  },
  {
    name: "update_element",
    title: "Modifier un élément",
    description:
      "Renomme un élément avec la syntaxe de l'éditeur rapide (attribut, opération, message, transition…) et/ou change des champs (documentation, isAbstract, visibility, type, fillColor d'une vue…). Les champs références attendent des identifiants.",
    write: true,
    inputSchema: schema(
      {
        id: str("Élément ou vue."),
        expression: str("Nouveau texte, comme dans l'éditeur rapide (« - titre: String [1] », « «entity» Livre »)."),
        fields: { type: "object", description: "Champs à modifier, ex. {\"documentation\": \"…\", \"isAbstract\": true}.", additionalProperties: true },
      },
      ["id"],
    ),
    run: (a, env) => {
      const el = element(env, a.id);
      const model = modelArg(env, a.id);
      claude(env, "modification", () => {
        if (a.expression !== undefined) rename(env, model, String(a.expression));
        // Given a view, style fields go to the view and the others to its model.
        const fields = Object.entries((a.fields ?? {}) as Record<string, unknown>).map(([k, v]) => {
          const target = meta.field(el._type, k) ? el : model;
          return [target, k, fieldValue(env, target, k, v)] as const;
        });
        if (fields.length) env.repo.transact("Set", (tx) => fields.forEach(([t, k, v]) => tx.set(t, k, v)));
      });
      return describe(env, model);
    },
  },
  {
    name: "delete_elements",
    title: "Supprimer",
    description: "Supprime des éléments. mode « model » (par défaut) les retire du modèle avec leurs relations et toutes leurs vues ; mode « view » retire seulement les vues du diagramme.",
    write: true,
    inputSchema: schema({ ids: strings("Éléments ou vues."), mode: { type: "string", enum: ["model", "view"] } }, ["ids"]),
    run: (a, env) => {
      const els = ((a.ids ?? []) as string[]).map((id) => element(env, id));
      if (els.includes(env.repo.root!)) throw new ToolError("Impossible de supprimer le projet.");
      const before = env.repo.size();
      claude(env, "suppression", () => (a.mode === "view" ? deleteViews(env.repo, els) : deleteFromModel(env.repo, els)));
      return { removed: before - env.repo.size() };
    },
  },
  {
    name: "auto_layout",
    title: "Disposition automatique",
    description: "Dispose automatiquement les nœuds d'un diagramme (les supertypes au-dessus de leurs sous-types).",
    write: true,
    inputSchema: schema({ diagram_id: str("Diagramme (le diagramme affiché par défaut).") }),
    run: (a, env) => {
      const d = diagramArg(env, a.diagram_id);
      claude(env, "disposition", () => layoutDiagram(env.repo, d, env.measure, env.theme));
      env.openDiagram(d._id);
      return "Diagramme disposé.";
    },
  },
  {
    name: "render_diagram",
    title: "Aperçu d'un diagramme",
    description: "Image PNG du diagramme, pour vérifier le résultat.",
    inputSchema: schema({ diagram_id: str("Diagramme (le diagramme affiché par défaut).") }),
    run: async (a, env) => {
      if (!env.renderPng) throw new ToolError("Rendu d'image indisponible.");
      const d = diagramArg(env, a.diagram_id);
      return new ContentResult([{ type: "image", data: await env.renderPng(d), mimeType: "image/png" }]);
    },
  },
  {
    name: "undo_last_change",
    title: "Annuler",
    description: "Annule la dernière modification faite par Claude (refusé si la dernière modification vient de l'utilisateur).",
    write: true,
    inputSchema: schema({}),
    run: (_, env) => {
      const name = env.repo.undoName();
      if (!name?.startsWith("Claude")) throw new ToolError("La dernière modification n'a pas été faite par Claude : rien n'a été annulé.");
      env.repo.undo();
      return `Annulé : ${name}.`;
    },
  },
];

export { CommandError };
