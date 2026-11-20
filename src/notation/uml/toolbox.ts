// Toolbox entries of the class diagram (and the annotation group shared by all
// diagrams). Labels are i18n keys.

export interface NodeTool {
  id: string;
  kind: "node";
  label: string;
  icon: string;
  viewType: string;
  modelType?: string;
  baseName?: string;
  size: [number, number];
  init?: Record<string, unknown>;
  viewInit?: Record<string, unknown>;
}

export interface EdgeTool {
  id: string;
  kind: "edge";
  label: string;
  icon: string;
  viewType: string;
  modelType?: string;
  variant?: "plain" | "directed" | "aggregation" | "composition";
}

export type Tool = NodeTool | EdgeTool;

export interface ToolGroup {
  id: string;
  label: string;
  tools: Tool[];
}

const node = (id: string, viewType: string, modelType: string | undefined, size: [number, number], extra: Partial<NodeTool> = {}): NodeTool => ({
  id,
  kind: "node",
  label: `tool.${id}`,
  icon: id,
  viewType,
  modelType,
  baseName: modelType?.replace(/^UML/, ""),
  size,
  ...extra,
});

const edge = (id: string, viewType: string, modelType: string | undefined, extra: Partial<EdgeTool> = {}): EdgeTool => ({
  id,
  kind: "edge",
  label: `tool.${id}`,
  icon: id,
  viewType,
  modelType,
  ...extra,
});

export const annotationGroup: ToolGroup = {
  id: "annotations",
  label: "toolbox.annotations",
  tools: [
    node("text", "UMLTextView", undefined, [120, 25], { viewInit: { text: "Text" } }),
    node("note", "UMLNoteView", undefined, [140, 50], { viewInit: { text: "Note" } }),
    edge("noteLink", "UMLNoteLinkView", undefined),
    node("rectangle", "RectangleView", undefined, [100, 60]),
    node("roundRect", "RoundRectView", undefined, [100, 60]),
    node("ellipse", "EllipseView", undefined, [100, 60]),
    node("hyperlink", "HyperlinkView", undefined, [120, 25], { viewInit: { url: "https://" } }),
    edge("freeline", "FreelineEdgeView", undefined),
  ],
};

export const classDiagramGroups: ToolGroup[] = [
  {
    id: "class",
    label: "toolbox.class",
    tools: [
      node("class", "UMLClassView", "UMLClass", [120, 70]),
      node("interface", "UMLInterfaceView", "UMLInterface", [120, 60]),
      node("signal", "UMLSignalView", "UMLSignal", [120, 60]),
      node("dataType", "UMLDataTypeView", "UMLDataType", [120, 60]),
      node("primitiveType", "UMLPrimitiveTypeView", "UMLPrimitiveType", [120, 50]),
      node("enumeration", "UMLEnumerationView", "UMLEnumeration", [120, 70]),
      edge("association", "UMLAssociationView", "UMLAssociation", { variant: "plain" }),
      edge("directedAssociation", "UMLAssociationView", "UMLAssociation", { variant: "directed" }),
      edge("aggregation", "UMLAssociationView", "UMLAssociation", { variant: "aggregation" }),
      edge("composition", "UMLAssociationView", "UMLAssociation", { variant: "composition" }),
      edge("generalization", "UMLGeneralizationView", "UMLGeneralization"),
      edge("dependency", "UMLDependencyView", "UMLDependency"),
      edge("interfaceRealization", "UMLInterfaceRealizationView", "UMLInterfaceRealization"),
      edge("realization", "UMLRealizationView", "UMLRealization"),
      node("package", "UMLPackageView", "UMLPackage", [140, 90]),
      node("model", "UMLModelView", "UMLModel", [140, 90]),
      node("subsystem", "UMLSubsystemView", "UMLSubsystem", [140, 90]),
    ],
  },
  annotationGroup,
];

export function toolGroupsFor(diagramType: string): ToolGroup[] {
  switch (diagramType) {
    case "UMLClassDiagram":
      return classDiagramGroups;
    default:
      return [annotationGroup];
  }
}

export function findTool(id: string): Tool | undefined {
  for (const g of classDiagramGroups) for (const t of g.tools) if (t.id === id) return t;
  return undefined;
}

/** View type used when dropping a model element from the explorer. */
export const VIEW_FOR_MODEL: Record<string, string> = {
  UMLClass: "UMLClassView",
  UMLInterface: "UMLInterfaceView",
  UMLSignal: "UMLSignalView",
  UMLDataType: "UMLDataTypeView",
  UMLPrimitiveType: "UMLPrimitiveTypeView",
  UMLEnumeration: "UMLEnumerationView",
  UMLPackage: "UMLPackageView",
  UMLModel: "UMLModelView",
  UMLSubsystem: "UMLSubsystemView",
  UMLGeneralization: "UMLGeneralizationView",
  UMLDependency: "UMLDependencyView",
  UMLRealization: "UMLRealizationView",
  UMLInterfaceRealization: "UMLInterfaceRealizationView",
  UMLAssociation: "UMLAssociationView",
};
