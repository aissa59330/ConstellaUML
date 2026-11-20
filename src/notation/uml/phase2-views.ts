// Views of the phase-2 UML diagrams built on the declarative shapes.
import type { Element } from "../../core/element";
import { isRef } from "../../core/element";
import { registerShapeView } from "../shapes";
import { type RenderCtx, registerViewKind, viewKind } from "../views";
import { generalLabels, makeEdgeKind } from "./edge-views";
import { typeName } from "./text";

const resolver = (ctx: RenderCtx) => (r: unknown) => ctx.repo.deref(r);

/** "name : Type" (objects, parts, instances…). */
function typedName(m: Element | undefined, ctx: RenderCtx, typeField = "classifier"): string {
  if (!m) return "";
  const tn = typeName(m[typeField], resolver(ctx));
  return tn ? `${m.name ?? ""} : ${tn}` : m.name ?? "";
}

// ---- use cases ------------------------------------------------------------
registerShapeView("UMLActorView", { shape: "actor", name: "below", min: [36, 64], fixed: (v) => [Math.max(36, v.width ?? 36), Math.max(60, v.height ?? 64)] });
registerShapeView("UMLUseCaseView", {
  shape: "ellipse",
  bold: false,
  compartments: [(m) => ((m?.extensionPoints ?? []) as Element[]).map((x) => x.name)],
  min: [110, 50],
});
registerShapeView("UMLUseCaseSubjectView", { shape: "rect", name: "top", container: true, min: [200, 240] });

// ---- components, deployment, objects ---------------------------------------
registerShapeView("UMLComponentView", { shape: "component", min: [130, 50] });
registerShapeView("UMLArtifactView", { shape: "artifact", keyword: "artifact", min: [120, 50] });
registerShapeView("UMLNodeView", { shape: "node3d", name: "top", container: true, min: [140, 80] });
registerShapeView("UMLObjectView", {
  shape: "rect",
  underline: true,
  nameText: (m, _v, ctx) => typedName(m, ctx),
  compartments: [(m, _v, ctx) => ((m?.slots ?? []) as Element[]).map((sl) => `${ctx.repo.deref(sl.definingFeature)?.name ?? sl.name ?? ""} = ${sl.value ?? ""}`)],
  min: [110, 50],
});
for (const [view, shape] of [
  ["UMLNodeInstanceView", "node3d"],
  ["UMLComponentInstanceView", "component"],
  ["UMLArtifactInstanceView", "artifact"],
] as const)
  registerShapeView(view, { shape, underline: true, nameText: (m, _v, ctx) => typedName(m, ctx), min: [120, 60], container: view === "UMLNodeInstanceView" });
registerShapeView("UMLPortView", { shape: "pin", name: "below", fixed: [14, 14] });
registerShapeView("UMLPartView", { shape: "rect", bold: false, nameText: (m, _v, ctx) => typedName(m, ctx, "type") + (m?.multiplicity ? ` [${m.multiplicity}]` : ""), min: [100, 40] });
registerShapeView("UMLCollaborationView", { shape: "dashedEllipse", name: "center", min: [140, 70], container: true });
registerShapeView("UMLCollaborationUseView", { shape: "dashedEllipse", bold: false, nameText: (m, _v, ctx) => typedName(m, ctx, "type"), min: [120, 50] });
registerShapeView("UMLInformationItemView", { shape: "infoItem", keyword: "information", min: [120, 50] });
// Class-like views reuse the classifier layout.
for (const vt of ["UMLStereotypeView", "UMLMetaClassView", "UMLStateMachineView", "UMLInteractionView", "UMLActivityView"]) {
  const k = viewKind("UMLClassView");
  if (k) registerViewKind(vt, k);
}

// ---- activities --------------------------------------------------------------
registerShapeView("UMLActionView", {
  shape: (m) => (m?.kind === "sendSignal" ? "sendSignal" : m?.kind === "acceptSignal" || m?.kind === "acceptEvent" ? "acceptSignal" : m?.kind === "timeEvent" ? "hourglass" : "roundRect"),
  bold: false,
  min: [90, 40],
});
registerShapeView("UMLInitialNodeView", { shape: "dot", name: "none", fixed: [20, 20] });
registerShapeView("UMLActivityFinalNodeView", { shape: "bullseye", name: "none", fixed: [26, 26] });
registerShapeView("UMLFlowFinalNodeView", { shape: "circleX", name: "none", fixed: [24, 24] });
for (const vt of ["UMLForkNodeView", "UMLJoinNodeView"]) registerShapeView(vt, { shape: "bar", name: "none", fixed: [80, 6] });
for (const vt of ["UMLMergeNodeView", "UMLDecisionNodeView"]) registerShapeView(vt, { shape: "diamond", name: "none", fixed: [30, 30] });
registerShapeView("UMLObjectNodeView", { shape: "rect", bold: false, nameText: (m, _v, ctx) => typedName(m, ctx, "type"), min: [100, 40] });
registerShapeView("UMLCentralBufferNodeView", { shape: "rect", keyword: "centralBuffer", bold: false, min: [110, 50] });
registerShapeView("UMLDataStoreNodeView", { shape: "rect", keyword: "datastore", bold: false, min: [110, 50] });
registerShapeView("UMLActivityParameterNodeView", { shape: "rect", bold: false, min: [100, 36] });
for (const vt of ["UMLInputPinView", "UMLOutputPinView", "UMLExpansionNodeView"]) registerShapeView(vt, { shape: "pin", name: "below", fixed: [14, 14] });
registerShapeView("UMLInterruptibleActivityRegionView", { shape: "dashedRoundRect", name: "none", container: true, min: [160, 100] });
registerShapeView("UMLStructuredActivityNodeView", { shape: "dashedRoundRect", keyword: "structured", name: "top", container: true, min: [180, 110] });
registerShapeView("UMLExpansionRegionView", { shape: "dashedRoundRect", keyword: (m) => m?.mode ?? "iterative", name: "top", container: true, min: [180, 110] });
registerShapeView("UMLSwimlaneView", { shape: "rect", name: "top", container: true, min: [160, 300] });

// ---- state machines -------------------------------------------------------------
function activityLines(m: Element | undefined): string[] {
  if (!m) return [];
  const out: string[] = [];
  for (const [field, label] of [
    ["entryActivities", "entry"],
    ["doActivities", "do"],
    ["exitActivities", "exit"],
  ] as const)
    for (const a of (m[field] ?? []) as Element[]) out.push(`${label} / ${a.name ?? ""}`);
  return out;
}
registerShapeView("UMLStateView", {
  shape: "roundRect",
  compartments: [(m) => activityLines(m)],
  container: true,
  min: [110, 50],
});
registerShapeView("UMLFinalStateView", { shape: "bullseye", name: "none", fixed: [26, 26] });
const PSEUDO: Record<string, { shape: "dot" | "diamond" | "bar" | "history" | "deepHistory" | "entryPoint" | "exitPoint" | "terminate"; size: [number, number] }> = {
  initial: { shape: "dot", size: [20, 20] },
  choice: { shape: "diamond", size: [28, 28] },
  junction: { shape: "dot", size: [14, 14] },
  fork: { shape: "bar", size: [80, 6] },
  join: { shape: "bar", size: [80, 6] },
  shallowHistory: { shape: "history", size: [26, 26] },
  deepHistory: { shape: "deepHistory", size: [26, 26] },
  entryPoint: { shape: "entryPoint", size: [20, 20] },
  exitPoint: { shape: "exitPoint", size: [20, 20] },
  terminate: { shape: "terminate", size: [20, 20] },
};
registerShapeView("UMLPseudostateView", {
  shape: (m) => PSEUDO[m?.kind ?? "initial"]?.shape ?? "dot",
  name: "below",
  nameText: (m) => (m?.kind === "entryPoint" || m?.kind === "exitPoint" ? m?.name ?? "" : ""),
  fixed: (_v, m) => PSEUDO[m?.kind ?? "initial"]?.size ?? [20, 20],
});
registerShapeView("UMLConnectionPointReferenceView", { shape: "circleX", name: "below", fixed: [20, 20] });

// ---- frames & interaction overview ------------------------------------------------
registerShapeView("UMLFrameView", { shape: "frame", container: true, min: [200, 140], nameText: (m, v) => (m ? `${frameKind(m._type)} ${m.name ?? ""}` : v.text ?? "") });
registerShapeView("UMLInteractionUseView", {
  shape: "frame",
  min: [160, 60],
  nameText: () => "ref",
});

function frameKind(type: string): string {
  if (/Sequence|Interaction|Communication|Timing/.test(type)) return "sd";
  if (/Activity/.test(type)) return "act";
  if (/Statechart|StateMachine/.test(type)) return "stm";
  if (/UseCase/.test(type)) return "uc";
  if (/Package|Model/.test(type)) return "pkg";
  if (/Component/.test(type)) return "cmp";
  if (/Deployment/.test(type)) return "dep";
  return "class";
}

// ---- edges ----------------------------------------------------------------------------
const kwEdge = (keyword: string, dashed: boolean, head: "open" | "triangle" | "filledTriangle" | "none") =>
  makeEdgeKind(
    () => ({ dashed, head, tail: "none" }),
    (e, ctx) => generalLabels(e, ctx, keyword),
  );

registerViewKind("UMLIncludeView", kwEdge("include", true, "open"));
registerViewKind("UMLExtendView", kwEdge("extend", true, "open"));
registerViewKind("UMLComponentRealizationView", kwEdge("", true, "triangle"));
registerViewKind("UMLDeploymentView", kwEdge("deploy", true, "open"));
registerViewKind("UMLRoleBindingView", kwEdge("", true, "none"));
registerViewKind("UMLExtensionView", kwEdge("", false, "filledTriangle"));
registerViewKind(
  "UMLInformationFlowView",
  makeEdgeKind(
    () => ({ dashed: true, head: "open", tail: "none" }),
    (e, ctx) => {
      const m = ctx.repo.deref(e.model);
      const conveyed = ((m?.conveyed ?? []) as unknown[]).map((r) => (isRef(r) ? ctx.repo.deref(r)?.name : "")).filter(Boolean);
      const label = [...conveyed, m?.conveyedText].filter(Boolean).join(", ");
      return generalLabels(e, ctx, "flow", label || m?.name || "");
    },
  ),
);
registerViewKind("UMLCommunicationPathView", viewKind("UMLAssociationView")!);
registerViewKind("UMLLinkView", makeEdgeKind(() => ({ dashed: false, head: "none", tail: "none" })));
registerViewKind("UMLContainmentView", makeEdgeKind(() => ({ dashed: false, head: "none", tail: "circlePlus" }), () => []));

/** "[guard] name" for activity edges. */
function flowLabel(m: Element | undefined): string {
  if (!m) return "";
  return [m.guard ? `[${m.guard}]` : "", m.name ?? "", m.weight ? `{weight=${m.weight}}` : ""].filter(Boolean).join(" ");
}
for (const vt of ["UMLControlFlowView", "UMLObjectFlowView", "UMLExceptionHandlerView", "UMLActivityInterruptView"])
  registerViewKind(
    vt,
    makeEdgeKind(
      () => ({ dashed: false, head: "open", tail: "none" }),
      (e, ctx) => generalLabels(e, ctx, vt === "UMLActivityInterruptView" ? "interrupt" : undefined, flowLabel(ctx.repo.deref(e.model))),
    ),
  );

/** "trigger1, trigger2 [guard] / effect" for transitions. */
export function transitionLabel(m: Element | undefined): string {
  if (!m) return "";
  const trig = ((m.triggers ?? []) as Element[]).map((x) => x.name).filter(Boolean).join(", ");
  const eff = ((m.effects ?? []) as Element[]).map((x) => x.name).filter(Boolean).join("; ");
  return `${trig}${m.guard ? ` [${m.guard}]` : ""}${eff ? ` / ${eff}` : ""}`.trim();
}
registerViewKind(
  "UMLTransitionView",
  makeEdgeKind(
    () => ({ dashed: false, head: "open", tail: "none" }),
    (e, ctx) => generalLabels(e, ctx, undefined, transitionLabel(ctx.repo.deref(e.model))),
  ),
);
