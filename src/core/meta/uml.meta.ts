// UML 2.x subset needed for structure diagrams, written from the OMG UML 2.5
// specification. Type and field names follow the .mdj file format for interop.
import { meta, type FieldDef, type TypeDef } from "./registry";

const VISIBILITY = ["public", "protected", "private", "package"];
const AGGREGATION = ["none", "shared", "composite"];
const DIRECTION = ["in", "inout", "out", "return"];
const CONCURRENCY = ["sequential", "guarded", "concurrent"];

const b = (name: string, def = false): FieldDef => ({ name, kind: "boolean", default: def, editable: true });
const s = (name: string, def = ""): FieldDef => ({ name, kind: "string", default: def, editable: true });
const e = (name: string, options: (string | number)[], def: string | number): FieldDef => ({ name, kind: "enum", options, default: def, editable: true });
const list = (name: string): FieldDef => ({ name, kind: "elements", default: [] });

export const coreTypes: TypeDef[] = [
  { name: "Element", abstract: true },
  {
    name: "Model",
    super: "Element",
    abstract: true,
    fields: [s("name"), list("ownedElements")],
  },
  {
    name: "Tag",
    super: "Model",
    fields: [
      e("kind", ["string", "reference", "boolean", "number", "hidden"], "string"),
      s("value"),
      { name: "reference", kind: "ref", refType: "Model", editable: true },
      b("checked"),
      { name: "number", kind: "number", default: 0, editable: true },
    ],
  },
  {
    name: "ExtensibleModel",
    super: "Model",
    abstract: true,
    fields: [{ name: "documentation", kind: "text", default: "" }, list("tags")],
    contains: { Tag: "tags", Model: "ownedElements" },
  },
  { name: "Project", super: "ExtensibleModel", fields: [s("author"), s("company"), s("copyright"), s("version")] },
  { name: "Diagram", super: "ExtensibleModel", abstract: true, fields: [b("visible", true), b("defaultDiagram"), list("ownedViews")] },
];

export const umlTypes: TypeDef[] = [
  {
    name: "UMLModelElement",
    super: "ExtensibleModel",
    abstract: true,
    fields: [{ name: "stereotype", kind: "typeRef", refType: "UMLStereotype", editable: true }, e("visibility", VISIBILITY, "public")],
  },
  { name: "UMLConstraint", super: "UMLModelElement", fields: [{ name: "specification", kind: "text", default: "", editable: true }, { name: "constrainedElements", kind: "refs", default: [] }] },
  { name: "UMLPackage", super: "UMLModelElement", contains: { UMLModelElement: "ownedElements", Diagram: "ownedElements" } },
  { name: "UMLModel", super: "UMLPackage", fields: [s("viewpoint")] },
  { name: "UMLSubsystem", super: "UMLPackage" },
  { name: "UMLProfile", super: "UMLPackage" },
  { name: "UMLStereotype", super: "UMLClass" },
  {
    name: "UMLClassifier",
    super: "UMLModelElement",
    abstract: true,
    fields: [list("attributes"), list("operations"), list("receptions"), list("templateParameters"), b("isAbstract"), b("isFinalSpecialization"), b("isLeaf")],
    contains: {
      UMLAttribute: "attributes",
      UMLOperation: "operations",
      UMLReception: "receptions",
      UMLTemplateParameter: "templateParameters",
      UMLModelElement: "ownedElements",
      Diagram: "ownedElements",
    },
  },
  { name: "UMLClass", super: "UMLClassifier", fields: [b("isActive")] },
  { name: "UMLInterface", super: "UMLClassifier" },
  { name: "UMLDataType", super: "UMLClassifier" },
  { name: "UMLPrimitiveType", super: "UMLDataType" },
  { name: "UMLEnumeration", super: "UMLDataType", fields: [list("literals")], contains: { UMLEnumerationLiteral: "literals" } },
  { name: "UMLSignal", super: "UMLClassifier" },
  { name: "UMLEnumerationLiteral", super: "UMLModelElement" },
  { name: "UMLFeature", super: "UMLModelElement", abstract: true, fields: [b("isStatic"), b("isLeaf")] },
  {
    name: "UMLStructuralFeature",
    super: "UMLFeature",
    abstract: true,
    fields: [
      { name: "type", kind: "typeRef", default: "", refType: "UMLClassifier", editable: true },
      s("multiplicity"),
      b("isReadOnly"),
      b("isOrdered"),
      b("isUnique"),
      s("defaultValue"),
    ],
  },
  { name: "UMLAttribute", super: "UMLStructuralFeature", fields: [b("isDerived"), e("aggregation", AGGREGATION, "none"), b("isID")] },
  {
    name: "UMLBehavioralFeature",
    super: "UMLFeature",
    abstract: true,
    fields: [list("parameters"), { name: "raisedExceptions", kind: "refs", default: [] }, e("concurrency", CONCURRENCY, "sequential")],
    contains: { UMLParameter: "parameters" },
  },
  { name: "UMLOperation", super: "UMLBehavioralFeature", fields: [b("isQuery"), b("isAbstract"), { name: "specification", kind: "text", default: "", editable: true }] },
  { name: "UMLReception", super: "UMLBehavioralFeature", fields: [{ name: "signal", kind: "ref", refType: "UMLSignal", editable: true }] },
  {
    name: "UMLParameter",
    super: "UMLModelElement",
    fields: [
      { name: "type", kind: "typeRef", default: "", refType: "UMLClassifier", editable: true },
      s("multiplicity"),
      s("defaultValue"),
      e("direction", DIRECTION, "in"),
      b("isReadOnly"),
      b("isOrdered"),
      b("isUnique"),
    ],
  },
  { name: "UMLTemplateParameter", super: "UMLModelElement", fields: [s("parameterType"), s("defaultValue")] },
  { name: "UMLRelationship", super: "UMLModelElement", abstract: true },
  {
    name: "UMLDirectedRelationship",
    super: "UMLRelationship",
    abstract: true,
    fields: [
      { name: "source", kind: "ref", refType: "UMLModelElement" },
      { name: "target", kind: "ref", refType: "UMLModelElement" },
    ],
  },
  { name: "UMLGeneralization", super: "UMLDirectedRelationship", fields: [s("discriminator")] },
  { name: "UMLDependency", super: "UMLDirectedRelationship", fields: [s("mapping")] },
  { name: "UMLAbstraction", super: "UMLDependency" },
  { name: "UMLRealization", super: "UMLAbstraction" },
  { name: "UMLInterfaceRealization", super: "UMLRealization" },
  { name: "UMLUndirectedRelationship", super: "UMLRelationship", abstract: true },
  {
    name: "UMLAssociation",
    super: "UMLUndirectedRelationship",
    fields: [{ name: "end1", kind: "element" }, { name: "end2", kind: "element" }, b("isDerived")],
  },
  {
    name: "UMLAssociationEnd",
    super: "UMLModelElement",
    fields: [
      { name: "reference", kind: "ref", refType: "UMLClassifier" },
      b("navigable", true),
      e("aggregation", AGGREGATION, "none"),
      s("multiplicity"),
      s("defaultValue"),
      b("isReadOnly"),
      b("isOrdered"),
      b("isUnique"),
      b("isDerived"),
      b("isID"),
    ],
  },
  { name: "UMLAssociationClassLink", super: "UMLModelElement", fields: [{ name: "classSide", kind: "ref" }, { name: "associationSide", kind: "ref" }] },
  { name: "UMLDiagram", super: "Diagram", abstract: true },
  { name: "UMLClassDiagram", super: "UMLDiagram" },
];

const LINE_STYLES = [0, 1, 2, 3]; // rectilinear, oblique, roundrect, curve
const STEREOTYPE_DISPLAY = ["none", "label", "decoration", "decoration-label", "icon", "icon-label"];

export const viewTypes: TypeDef[] = [
  {
    name: "View",
    super: "Element",
    abstract: true,
    fields: [
      { name: "model", kind: "ref" },
      list("subViews"),
      { name: "containerView", kind: "ref" },
      { name: "containedViews", kind: "refs", default: [] },
      b("visible", true),
      b("enabled", true),
      { name: "lineColor", kind: "color", default: "$foreground", editable: true },
      { name: "fillColor", kind: "color", default: "$background", editable: true },
      { name: "fontColor", kind: "color", default: "$foreground", editable: true },
      { name: "font", kind: "font", default: "Arial;13;0", editable: true },
      b("parentStyle"),
      b("showShadow", true),
      b("containerChangeable"),
      b("containerExtending", true),
    ],
  },
  {
    name: "NodeView",
    super: "View",
    abstract: true,
    fields: [
      { name: "left", kind: "integer", default: 0 },
      { name: "top", kind: "integer", default: 0 },
      { name: "width", kind: "integer", default: 0 },
      { name: "height", kind: "integer", default: 0 },
      b("autoResize"),
    ],
  },
  {
    name: "EdgeView",
    super: "View",
    abstract: true,
    fields: [
      { name: "head", kind: "ref" },
      { name: "tail", kind: "ref" },
      { name: "lineStyle", kind: "enum", options: LINE_STYLES, default: 0, editable: true },
      { name: "points", kind: "points", default: "" },
    ],
  },
  {
    name: "LabelView",
    super: "NodeView",
    fields: [s("text"), b("underline"), { name: "horizontalAlignment", kind: "integer", default: 2 }, { name: "verticalAlignment", kind: "integer", default: 5 }, b("wordWrap")],
  },
  {
    name: "EdgeLabelView",
    super: "LabelView",
    fields: [
      { name: "hostEdge", kind: "ref" },
      { name: "edgePosition", kind: "integer", default: 1 },
      { name: "distance", kind: "number", default: 15 },
      { name: "alpha", kind: "number", default: Math.PI / 2 },
    ],
  },
  {
    name: "UMLNameCompartmentView",
    super: "NodeView",
    fields: ["stereotypeLabel", "nameLabel", "namespaceLabel", "propertyLabel"].map((n) => ({ name: n, kind: "ref" as const })),
  },
  { name: "UMLListCompartmentView", super: "NodeView", abstract: true },
  { name: "UMLAttributeCompartmentView", super: "UMLListCompartmentView" },
  { name: "UMLOperationCompartmentView", super: "UMLListCompartmentView" },
  { name: "UMLReceptionCompartmentView", super: "UMLListCompartmentView" },
  { name: "UMLTemplateParameterCompartmentView", super: "UMLListCompartmentView" },
  { name: "UMLEnumerationLiteralCompartmentView", super: "UMLListCompartmentView" },
  { name: "UMLQualifierCompartmentView", super: "UMLListCompartmentView" },
  { name: "UMLFeatureView", super: "LabelView", abstract: true },
  { name: "UMLAttributeView", super: "UMLFeatureView" },
  { name: "UMLOperationView", super: "UMLFeatureView" },
  { name: "UMLReceptionView", super: "UMLFeatureView" },
  { name: "UMLTemplateParameterView", super: "UMLFeatureView" },
  { name: "UMLEnumerationLiteralView", super: "UMLFeatureView" },
  {
    name: "UMLGeneralNodeView",
    super: "NodeView",
    abstract: true,
    fields: [
      e("stereotypeDisplay", STEREOTYPE_DISPLAY, "label"),
      b("showVisibility", true),
      b("showNamespace"),
      b("showProperty", true),
      b("showType", true),
      { name: "nameCompartment", kind: "ref" },
      b("wordWrap"),
    ],
  },
  {
    name: "UMLClassifierView",
    super: "UMLGeneralNodeView",
    abstract: true,
    fields: [
      b("suppressAttributes"),
      b("suppressOperations"),
      b("suppressReceptions", true),
      b("showMultiplicity", true),
      b("showOperationSignature", true),
      ...["attributeCompartment", "operationCompartment", "receptionCompartment", "templateParameterCompartment"].map((n) => ({ name: n, kind: "ref" as const })),
    ],
  },
  { name: "UMLClassView", super: "UMLClassifierView" },
  { name: "UMLInterfaceView", super: "UMLClassifierView" },
  { name: "UMLSignalView", super: "UMLClassifierView" },
  { name: "UMLDataTypeView", super: "UMLClassifierView" },
  { name: "UMLPrimitiveTypeView", super: "UMLClassifierView" },
  { name: "UMLEnumerationView", super: "UMLClassifierView", fields: [b("suppressLiterals"), { name: "enumerationLiteralCompartment", kind: "ref" }] },
  { name: "UMLPackageView", super: "UMLGeneralNodeView" },
  { name: "UMLModelView", super: "UMLPackageView" },
  { name: "UMLSubsystemView", super: "UMLPackageView" },
  {
    name: "UMLGeneralEdgeView",
    super: "EdgeView",
    abstract: true,
    fields: [
      e("stereotypeDisplay", STEREOTYPE_DISPLAY, "label"),
      b("showVisibility", true),
      b("showProperty", true),
      ...["nameLabel", "stereotypeLabel", "propertyLabel"].map((n) => ({ name: n, kind: "ref" as const })),
    ],
  },
  { name: "UMLGeneralizationView", super: "UMLGeneralEdgeView" },
  { name: "UMLDependencyView", super: "UMLGeneralEdgeView" },
  { name: "UMLRealizationView", super: "UMLGeneralEdgeView" },
  { name: "UMLInterfaceRealizationView", super: "UMLGeneralEdgeView" },
  {
    name: "UMLAssociationView",
    super: "UMLGeneralEdgeView",
    fields: [
      b("showMultiplicity", true),
      ...[
        "tailRoleNameLabel",
        "tailPropertyLabel",
        "tailMultiplicityLabel",
        "headRoleNameLabel",
        "headPropertyLabel",
        "headMultiplicityLabel",
        "tailQualifiersCompartment",
        "headQualifiersCompartment",
      ].map((n) => ({ name: n, kind: "ref" as const })),
    ],
  },
  // Annotations
  { name: "UMLTextView", super: "NodeView", fields: [{ name: "text", kind: "text", default: "", editable: true }, b("wordWrap", true)] },
  { name: "UMLNoteView", super: "NodeView", fields: [{ name: "text", kind: "text", default: "", editable: true }, b("wordWrap", true)] },
  { name: "UMLNoteLinkView", super: "EdgeView" },
  { name: "ShapeView", super: "NodeView", abstract: true, fields: [{ name: "text", kind: "text", default: "", editable: true }] },
  { name: "RectangleView", super: "ShapeView" },
  { name: "RoundRectView", super: "ShapeView" },
  { name: "EllipseView", super: "ShapeView" },
  { name: "HyperlinkView", super: "NodeView", fields: [s("url"), { name: "reference", kind: "ref", editable: true }, b("showName")] },
  { name: "FreelineEdgeView", super: "EdgeView" },
];

let registered = false;
export function registerUmlMeta(): void {
  if (registered) return;
  registered = true;
  meta.register([...coreTypes, ...umlTypes, ...viewTypes]);
}
