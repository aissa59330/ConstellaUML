// Example diagrams of every UML type, built through the same commands as the
// UI. Used by the rendering tests and to produce screenshots.
import type { Element } from "../core/element";
import { ref } from "../core/element";
import type { Repository } from "../core/repository";
import {
  addDiagram,
  addFeature,
  createEdge,
  createNode,
  editFlow,
  editMessage,
  editTransition,
  findTool,
  renameElement,
  type EdgeTool,
  type NodeTool,
} from "../notation/uml";

type Builder = (repo: Repository, d: Element) => void;

function kit(repo: Repository, d: Element) {
  const n = (tool: string, x: number, y: number, name?: string, w?: number, h?: number, container?: Element) => {
    const t = findTool(tool) as NodeTool;
    const v = createNode(repo, d, t, { x, y, w: w ?? t.size[0], h: h ?? t.size[1] }, container);
    const m = repo.deref(v.model);
    if (name && m) renameElement(repo, m, name);
    return v;
  };
  const e = (tool: string, a: Element, b: Element, label?: string, y?: number) => {
    const pts = y !== undefined ? `0:${y};0:${y}` : undefined;
    const v = createEdge(repo, d, findTool(tool) as EdgeTool, a, b, pts);
    // Communication messages ride on a connector: label the message itself.
    const m = tool === "commMessage" ? repo.parentOf(d)?.messages?.at(-1) : repo.deref(v.model);
    if (label && m) {
      if (m._type === "UMLTransition") editTransition(repo, m, label);
      else if (m._type === "UMLMessage") editMessage(repo, m, label);
      else if (m._type.endsWith("Flow")) editFlow(repo, m, label);
      else repo.transact("name", (tx) => tx.set(m, "name", label));
    }
    return v;
  };
  const set = (v: Element, field: string, value: unknown) => {
    const m = repo.deref(v.model) ?? v;
    repo.transact("set", (tx) => tx.set(m, field, value));
  };
  return { n, e, set };
}

export const DEMOS: Record<string, Builder> = {
  UMLUseCaseDiagram(repo, d) {
    const { n, e } = kit(repo, d);
    const sys = n("subject", 180, 30, "Bibliothèque", 480, 330);
    const client = n("actor", 60, 110, "Adhérent");
    const biblio = n("actor", 740, 110, "Bibliothécaire");
    const emprunter = n("useCase", 330, 90, "Emprunter un livre", 180, 56, sys);
    const ident = n("useCase", 210, 250, "S'identifier", 170, 56, sys);
    const retard = n("useCase", 460, 250, "Payer une pénalité", 180, 56, sys);
    e("association", client, emprunter);
    e("association", biblio, emprunter);
    for (const v of [e("include", emprunter, ident), e("extend", retard, emprunter)]) repo.transact("style", (tx) => tx.set(v, "lineStyle", 1));
  },
  UMLComponentDiagram(repo, d) {
    const { n, e } = kit(repo, d);
    const web = n("component", 60, 80, "Frontend", 160, 60);
    const api = n("component", 360, 80, "API REST", 160, 60);
    const db = n("component", 360, 240, "Base de données", 170, 60);
    const itf = n("interface", 60, 200, "ICatalogue");
    e("dependency", web, api);
    e("interfaceRealization", api, itf);
    e("dependency", api, db);
    n("artifact", 620, 80, "app.jar");
  },
  UMLDeploymentDiagram(repo, d) {
    const { n, e } = kit(repo, d);
    const srv = n("node", 60, 60, "Serveur Linux", 260, 170);
    const art = n("artifact", 90, 120, "constella-api.jar", 190, 56, srv);
    const dbn = n("node", 420, 60, "MariaDB", 200, 120);
    e("communicationPath", srv, dbn, "TCP/3306");
    void art;
  },
  UMLObjectDiagram(repo, d) {
    const { n, e } = kit(repo, d);
    const a = n("object", 60, 60, "livre1", 170, 70);
    const b = n("object", 360, 60, "auteur1", 170, 70);
    const cls = repo.deref(a.model)!;
    repo.transact("slots", (tx) => {
      tx.insert(cls, "slots", { _type: "UMLSlot", _id: "slot-demo-1", name: "titre", value: '"Dune"' });
      tx.insert(cls, "slots", { _type: "UMLSlot", _id: "slot-demo-2", name: "isbn", value: '"978-2"' });
    });
    e("link", a, b, "ecrit");
  },
  UMLCompositeStructureDiagram(repo, d) {
    const { n, e } = kit(repo, d);
    const car = n("class", 60, 40, "Voiture", 380, 170);
    repo.transact("parts", (tx) => {
      tx.set(car, "suppressAttributes", true);
      tx.set(car, "suppressOperations", true);
    });
    const mot = n("part", 90, 100, "moteur", 130, 44, car);
    const roue = n("part", 280, 100, "roues", 130, 44, car);
    const repoAttr = repo.deref(roue.model)!;
    repo.transact("m", (tx) => tx.set(repoAttr, "multiplicity", "4"));
    e("connector", mot, roue);
    n("collaboration", 500, 70, "Observateur", 180, 90);
  },
  UMLPackageDiagram(repo, d) {
    const { n, e } = kit(repo, d);
    const ui = n("package", 60, 60, "ui", 160, 100);
    const core = n("package", 340, 60, "core", 160, 100);
    const io = n("package", 340, 240, "io", 160, 100);
    e("dependency", ui, core);
    e("import", io, core);
  },
  UMLSequenceDiagram(repo, d) {
    const { n, e } = kit(repo, d);
    const u = n("lifeline", 40, 30, "client", 110, 360);
    const s = n("lifeline", 260, 30, "service", 110, 360);
    const db = n("lifeline", 480, 30, "dao", 110, 360);
    e("syncMessage", u, s, "emprunter(isbn)", 110);
    e("syncMessage", s, db, "livre = trouver(isbn)", 140);
    e("replyMessage", db, s, "livre", 175);
    const frag = n("combinedFragment", 230, 200, undefined, 400, 120);
    const fm = repo.deref(frag.model)!;
    repo.transact("alt", (tx) => {
      tx.set(fm.operands[0], "guard", "disponible");
      tx.insert(fm, "operands", { _type: "UMLInteractionOperand", _id: "op-demo-2", guard: "else" });
    });
    e("asyncMessage", s, db, "reserver(livre)", 240);
    e("asyncMessage", s, u, "notifierIndisponible()", 290);
    e("replyMessage", s, u, "ok", 345);
  },
  UMLCommunicationDiagram(repo, d) {
    const { n, e } = kit(repo, d);
    const a = n("commLifeline", 60, 80, "client", 130, 44);
    const b = n("commLifeline", 360, 80, "service", 130, 44);
    const c = n("commLifeline", 360, 280, "dao", 130, 44);
    e("commMessage", a, b, "emprunter(isbn)");
    e("commMessage", b, c, "trouver(isbn)");
  },
  UMLTimingDiagram(repo, d) {
    const { n, set } = kit(repo, d);
    const l = n("timingLifeline", 40, 40, "Feu", 520, 130);
    set(l, "timingStates", "Vert, Orange, Rouge");
    set(l, "timeline", "Rouge@0; Vert@30; Orange@60; Rouge@65; Vert@95");
  },
  UMLInteractionOverviewDiagram(repo, d) {
    const { n, e } = kit(repo, d);
    const i = n("initial", 200, 20);
    const r1 = n("interactionUse", 120, 80, "S'identifier", 180, 50);
    const dec = n("decision", 195, 170);
    const r2 = n("interactionUse", 30, 240, "Emprunter", 160, 50);
    const r3 = n("interactionUse", 250, 240, "Refuser", 160, 50);
    e("controlFlow", i, r1);
    e("controlFlow", r1, dec);
    e("controlFlow", dec, r2, "[valide]");
    e("controlFlow", dec, r3, "[sinon]");
  },
  UMLActivityDiagram(repo, d) {
    const { n, e } = kit(repo, d);
    const lane1 = n("swimlane", 20, 20, "Adhérent", 240, 470);
    const lane2 = n("swimlane", 260, 20, "Bibliothèque", 260, 470);
    const i = n("initial", 130, 70, undefined, 20, 20, lane1);
    const a1 = n("action", 80, 120, "Demander un livre", 130, 44, lane1);
    const dec = n("decision", 375, 125, undefined, 30, 30, lane2);
    const a2 = n("action", 320, 200, "Enregistrer l'emprunt", 150, 44, lane2);
    const f = n("fork", 350, 280, undefined, 90, 6, lane2);
    const a3 = n("action", 280, 320, "Mettre à jour le stock", 160, 44, lane2);
    const a4 = n("sendSignal", 70, 320, "Envoyer reçu", 140, 44, lane1);
    const j = n("join", 220, 400, undefined, 120, 6);
    const end = n("activityFinal", 268, 440);
    e("controlFlow", i, a1);
    e("controlFlow", a1, dec);
    e("controlFlow", dec, a2, "[disponible]");
    e("controlFlow", a2, f);
    e("controlFlow", f, a3);
    e("controlFlow", f, a4);
    e("controlFlow", a3, j);
    e("controlFlow", a4, j);
    e("controlFlow", j, end);
  },
  UMLStatechartDiagram(repo, d) {
    const { n, e } = kit(repo, d);
    const i = n("initialState", 40, 110);
    const dispo = n("state", 120, 90, "Disponible", 130, 60);
    const emp = n("state", 470, 90, "Emprunté", 150, 70);
    const st = repo.deref(emp.model)!;
    repo.transact("do", (tx) => tx.insert(st, "doActivities", { _type: "UMLOpaqueBehavior", _id: "do-demo", name: "compterJours" }));
    const ch = n("choice", 531, 250);
    const perdu = n("state", 700, 239, "Perdu", 110, 50);
    const fin = n("finalState", 880, 251);
    e("transition", i, dispo);
    e("transition", dispo, emp, "emprunter [adhérent valide] / enregistrer");
    e("transition", emp, ch, "rendre");
    e("transition", ch, dispo, "[bon état]");
    e("transition", ch, perdu, "[abîmé] / facturer");
    e("transition", perdu, fin);
  },
  UMLProfileDiagram(repo, d) {
    const { n, e } = kit(repo, d);
    const st = n("stereotype", 60, 60, "Entity", 150, 70);
    const mc = n("metaClass", 360, 60, "Class", 150, 50);
    e("extension", st, mc);
    addFeature(repo, repo.deref(st.model)!, "attributes", "table: String");
  },
  UMLInformationFlowDiagram(repo, d) {
    const { n, e } = kit(repo, d);
    const a = n("actor", 60, 80, "Client");
    const c = n("class", 320, 80, "Banque", 140, 60);
    const item = n("informationItem", 180, 240, "Virement", 140, 56);
    const flow = e("informationFlow", a, c);
    const fm = repo.deref(flow.model)!;
    repo.transact("conveyed", (tx) => tx.set(fm, "conveyed", [ref(repo.deref(item.model)!)]));
  },
};

/** Builds every demo diagram under `owner`; returns the created diagrams by type. */
export function buildAllDemos(repo: Repository, owner: Element): Record<string, Element> {
  const out: Record<string, Element> = {};
  for (const [type, build] of Object.entries(DEMOS)) {
    const d = addDiagram(repo, owner, type);
    build(repo, d);
    out[type] = d;
  }
  return out;
}
