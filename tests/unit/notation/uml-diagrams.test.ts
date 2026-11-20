import { describe, expect, it } from "vitest";
import { Repository } from "../../../src/core/repository";
import { meta } from "../../../src/core/meta/registry";
import { walk } from "../../../src/core/element";
import { newProject, parseMdj, serializeMdj } from "../../../src/io/mdj";
import { approxMeasurer } from "../../../src/render/graphics";
import { exportSvg } from "../../../src/render/diagram";
import { buildAllDemos, DEMOS } from "../../../src/dev/demos";
import { DIAGRAM_TYPES, parseFlow, parseMessage, parseTransition, CommandError, createEdge, findTool, type EdgeTool } from "../../../src/notation/uml";

function setup() {
  const repo = new Repository();
  repo.load(newProject());
  const model = repo.root!.ownedElements[0];
  const diagrams = buildAllDemos(repo, model);
  return { repo, model, diagrams };
}

const svgOf = (repo: Repository, d: any) => exportSvg(d, { repo, measure: approxMeasurer }, { theme: "light", margin: 8, background: true }, approxMeasurer);

describe("UML diagrams (phase 2)", () => {
  it("offers every UML diagram type with a demo", () => {
    for (const { type } of DIAGRAM_TYPES) if (type !== "UMLClassDiagram") expect(DEMOS[type], type).toBeDefined();
  });

  it("exports SVG viewable outside browsers, with names drawn outside shapes", () => {
    const { repo, diagrams } = setup();
    const uc = svgOf(repo, diagrams.UMLUseCaseDiagram);
    // No filters: librsvg / LibreOffice drop filtered shapes entirely.
    expect(uc).not.toContain("filter=");
    expect(uc).toContain('fill-opacity="0.12"');
    // The actor name below the figure fits inside the exported canvas.
    const width = Number(/<svg[^>]* width="([\d.]+)"/.exec(uc)![1]);
    const actor = diagrams.UMLUseCaseDiagram.ownedViews.find((v: any) => repo.deref(v.model)?.name === "Bibliothécaire");
    const nameW = approxMeasurer.width("Bibliothécaire", { family: "Arial", size: 13, bold: true, italic: false });
    const left = Math.min(...diagrams.UMLUseCaseDiagram.ownedViews.filter((v: any) => v.left !== undefined).map((v: any) => v.left));
    expect(width).toBeGreaterThanOrEqual(actor.left + actor.width / 2 + nameW / 2 - left);
    // Communication message labels are part of the exported area too.
    expect(svgOf(repo, diagrams.UMLCommunicationDiagram)).toContain("2: trouver(isbn)");
  });

  it("puts behavior diagrams inside their behavior", () => {
    const { repo, diagrams } = setup();
    expect(repo.parentOf(diagrams.UMLSequenceDiagram)!._type).toBe("UMLInteraction");
    expect(repo.parentOf(diagrams.UMLActivityDiagram)!._type).toBe("UMLActivity");
    const sm = repo.parentOf(diagrams.UMLStatechartDiagram)!;
    expect(sm._type).toBe("UMLStateMachine");
    expect(sm.regions[0].vertices.length).toBeGreaterThan(4);
    expect(sm.regions[0].transitions.length).toBe(6);
  });

  it("stores messages, fragments and flows in their dedicated lists", () => {
    const { repo, diagrams } = setup();
    const inter = repo.parentOf(diagrams.UMLSequenceDiagram)!;
    expect(inter.participants.map((l: any) => l.name)).toEqual(["client", "service", "dao"]);
    expect(inter.messages.map((m: any) => m.messageSort)).toEqual(["synchCall", "synchCall", "reply", "asynchCall", "asynchCall", "reply"]);
    expect(inter.messages[1]).toMatchObject({ name: "trouver", arguments: "isbn", assignmentTarget: "livre" });
    expect(inter.fragments[0].operands.map((o: any) => o.guard)).toEqual(["disponible", "else"]);
    const act = repo.parentOf(diagrams.UMLActivityDiagram)!;
    expect(act.edges.length).toBe(9);
    expect(act.edges.find((x: any) => x.guard === "disponible")).toBeDefined();
  });

  it("nests views in containers and moves them together", () => {
    const { repo, diagrams } = setup();
    const views = diagrams.UMLUseCaseDiagram.ownedViews;
    const subject = views.find((v: any) => v._type === "UMLUseCaseSubjectView");
    expect(subject.containedViews).toHaveLength(3);
    const uc = repo.deref(subject.containedViews[0])!;
    expect(repo.parentOf(repo.deref(uc.model)!)!._type).toBe("UMLUseCaseSubject");
  });

  it("renders every diagram type to SVG with its notation", () => {
    const { repo, diagrams } = setup();
    const expectations: Record<string, string[]> = {
      UMLUseCaseDiagram: ["Emprunter un livre", "«include»", "«extend»", "Adhérent"],
      UMLComponentDiagram: ["Frontend", "API REST", "«artifact»"],
      UMLDeploymentDiagram: ["Serveur Linux", "constella-api.jar"],
      UMLObjectDiagram: ["livre1", 'titre = "Dune"'],
      UMLCompositeStructureDiagram: ["moteur", "roues [4]"],
      UMLPackageDiagram: ["core", "«import»"],
      UMLSequenceDiagram: ["1: emprunter(isbn)", "2: livre = trouver(isbn)", ">alt<", "[disponible]", "[else]"],
      UMLCommunicationDiagram: ["1: emprunter(isbn)", "2: trouver(isbn)"],
      UMLTimingDiagram: ["Feu", "Orange"],
      UMLInteractionOverviewDiagram: [">ref<", "[valide]"],
      UMLActivityDiagram: ["Demander un livre", "[disponible]", "Adhérent"],
      UMLStatechartDiagram: ["Disponible", "emprunter [adhérent valide] / enregistrer", "do / compterJours", "[abîmé] / facturer"],
      UMLProfileDiagram: ["«stereotype»", "«metaclass»"],
      UMLInformationFlowDiagram: ["«flow»", "Virement"],
    };
    for (const [type, words] of Object.entries(expectations)) {
      const svg = svgOf(repo, diagrams[type]);
      for (const w of words) expect(svg, `${type} shows ${w}`).toContain(w.replace(/"/g, "&quot;").replace(/'/g, "'"));
    }
  });

  it("round-trips all phase 2 diagrams through .mdj and undoes everything", () => {
    const { repo } = setup();
    const text = serializeMdj(repo.root!);
    expect(parseMdj(text)).toEqual(JSON.parse(text));
    let steps = 0;
    while (repo.canUndo()) {
      repo.undo();
      steps++;
    }
    expect(steps).toBeGreaterThan(100);
    expect([...walk(repo.root!)].filter((e) => meta.isKindOf(e._type, "Diagram"))).toHaveLength(1);
  });

  it("refuses connections that make no sense", () => {
    const { repo, diagrams } = setup();
    const d = diagrams.UMLStatechartDiagram;
    const states = d.ownedViews.filter((v: any) => v._type === "UMLStateView");
    const uc = diagrams.UMLUseCaseDiagram.ownedViews.find((v: any) => v._type === "UMLActorView");
    expect(() => createEdge(repo, d, findTool("include") as EdgeTool, states[0], states[1])).toThrow(CommandError);
    expect(() => createEdge(repo, d, findTool("transition") as EdgeTool, states[0], uc)).toThrow(CommandError);
  });

  it("parses behavior quick-edit expressions", () => {
    expect(parseTransition("evt1, evt2 [x > 0] / a(); b()")).toEqual({ triggers: ["evt1", "evt2"], guard: "x > 0", effects: ["a()", "b()"] });
    expect(parseTransition("[ok]")).toEqual({ triggers: [], guard: "ok", effects: [] });
    expect(parseMessage("3: [n>0] total = calculer(a, b)")).toEqual({ guard: "n>0", assignmentTarget: "total", name: "calculer", arguments: "a, b" });
    expect(parseMessage("ok")).toEqual({ guard: "", assignmentTarget: "", name: "ok", arguments: "" });
    expect(() => parseMessage("f(a")).toThrow();
    expect(parseFlow("[sinon] retour")).toEqual({ guard: "sinon", name: "retour" });
  });
});
