// Icons drawn for Constella (16×16 grid, stroke = currentColor).
import type { JSX } from "solid-js";

const P: Record<string, () => JSX.Element> = {
  select: () => <path d="M3 2l9 5-4 1.2L6.5 13z" />,
  class: () => (
    <>
      <rect x="2" y="2.5" width="12" height="11" rx="1" />
      <path d="M2 6h12M2 10h12" />
    </>
  ),
  interface: () => (
    <>
      <circle cx="8" cy="5" r="3" />
      <path d="M8 8v6" />
    </>
  ),
  signal: () => (
    <>
      <path d="M2 3h9l3 5-3 5H2z" />
    </>
  ),
  dataType: () => (
    <>
      <rect x="2" y="3" width="12" height="10" rx="1" />
      <path d="M5 7h6M5 10h4" />
    </>
  ),
  primitiveType: () => (
    <>
      <rect x="2" y="4" width="12" height="8" rx="1" />
      <path d="M5 8h6" />
    </>
  ),
  enumeration: () => (
    <>
      <rect x="2" y="2.5" width="12" height="11" rx="1" />
      <path d="M2 6h12M5 8.5h1M8 8.5h3M5 11h1M8 11h3" />
    </>
  ),
  association: () => <path d="M2 14L14 2" />,
  directedAssociation: () => <path d="M2 14L14 2M9 2h5v5" />,
  aggregation: () => <path d="M2 14l6.5-6.5M8.5 7.5l1-3.5 3.5-1-1 3.5z" />,
  composition: () => (
    <>
      <path d="M2 14l6.5-6.5" />
      <path d="M8.5 7.5l1-3.5 3.5-1-1 3.5z" fill="currentColor" />
    </>
  ),
  generalization: () => <path d="M2 14l7.5-7.5M7 4l6-1-1 6z" />,
  dependency: () => <path d="M2 14L14 2M9 2h5v5" stroke-dasharray="2 2" />,
  interfaceRealization: () => <path d="M2 14l7.5-7.5M7 4l6-1-1 6z" stroke-dasharray="2 1.6" />,
  realization: () => <path d="M2 14l7.5-7.5M7 4l6-1-1 6z" stroke-dasharray="1.2 1.6" />,
  package: () => (
    <>
      <path d="M2 5V3h5v2" />
      <rect x="2" y="5" width="12" height="9" rx="0.5" />
    </>
  ),
  model: () => (
    <>
      <path d="M2 5V3h5v2" />
      <rect x="2" y="5" width="12" height="9" rx="0.5" />
      <path d="M9 12l2-3.5 2 3.5z" />
    </>
  ),
  subsystem: () => (
    <>
      <path d="M2 5V3h5v2" />
      <rect x="2" y="5" width="12" height="9" rx="0.5" />
      <path d="M10 8v2M8.5 12v-2h3v2" />
    </>
  ),
  text: () => <path d="M3 4V3h10v1M8 3v10M6 13h4" />,
  note: () => (
    <>
      <path d="M2.5 2.5h8l3 3v8h-11z" />
      <path d="M10.5 2.5v3h3" />
    </>
  ),
  noteLink: () => <path d="M2 14L14 2" stroke-dasharray="2.5 2" />,
  rectangle: () => <rect x="2" y="4" width="12" height="8" />,
  roundRect: () => <rect x="2" y="4" width="12" height="8" rx="3" />,
  ellipse: () => <ellipse cx="8" cy="8" rx="6" ry="4.5" />,
  hyperlink: () => <path d="M6.5 9.5l3-3M7 4.5l1.5-1.5a2.8 2.8 0 014 4L11 8.5M9 11.5L7.5 13a2.8 2.8 0 01-4-4L5 7.5" />,
  freeline: () => <path d="M2 12c3-8 5 2 8-4s3-3 4-4" />,
  diagram: () => (
    <>
      <rect x="2" y="2" width="12" height="12" rx="1.5" />
      <rect x="4" y="4.5" width="3.5" height="3" />
      <rect x="8.5" y="8.5" width="3.5" height="3" />
      <path d="M7.5 6h2.5v2.5" />
    </>
  ),
  project: () => <path d="M2 4.5h4.5L8 6h6v7.5H2z" />,
  attribute: () => <rect x="5" y="5" width="6" height="6" rx="1" />,
  operation: () => <circle cx="8" cy="8" r="3.2" />,
  parameter: () => <path d="M5 8h6M8 5v6" />,
  literal: () => <path d="M5 5h6v6H5z" />,
  tag: () => <path d="M2.5 2.5h6l5 5-6 6-5-5z" />,
  constraint: () => <path d="M6 3c-2 0-2 1-2 2.5S3 8 3 8s1 0 1 2.5S4 13 6 13M10 3c2 0 2 1 2 2.5S13 8 13 8s-1 0-1 2.5S12 13 10 13" />,
  element: () => <circle cx="8" cy="8" r="5" />,
  new: () => <path d="M4 2h5l3 3v9H4zM9 2v3h3" />,
  open: () => <path d="M2 4h4l1.5 1.5H14v7.5H2z" />,
  save: () => (
    <>
      <path d="M3 2h8l2 2v10H3z" />
      <path d="M5 2v4h5V2M5 14v-4h6v4" />
    </>
  ),
  undo: () => <path d="M5 4L2 7l3 3M2 7h7.5a3.5 3.5 0 010 7H7" />,
  redo: () => <path d="M11 4l3 3-3 3M14 7H6.5a3.5 3.5 0 000 7H9" />,
  zoomIn: () => <path d="M7 3.5v7M3.5 7h7M11 11l3 3M7 12A5 5 0 107 2a5 5 0 000 10z" />,
  zoomOut: () => <path d="M3.5 7h7M11 11l3 3M7 12A5 5 0 107 2a5 5 0 000 10z" />,
  fit: () => <path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" />,
  grid: () => <path d="M2 2h12v12H2zM6 2v12M10 2v12M2 6h12M2 10h12" />,
  sun: () => <path d="M8 11a3 3 0 100-6 3 3 0 000 6zM8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3 3l1 1M12 12l1 1M3 13l1-1M12 4l1-1" />,
  moon: () => <path d="M13.5 9.5A6 6 0 016.5 2.5a6 6 0 107 7z" />,
  search: () => <path d="M7 12A5 5 0 107 2a5 5 0 000 10zM11 11l3 3" />,
  close: () => <path d="M4 4l8 8M12 4l-8 8" />,
  chevronRight: () => <path d="M6 3l5 5-5 5" />,
  chevronDown: () => <path d="M3 6l5 5 5-5" />,
  more: () => <path d="M3 8h.01M8 8h.01M13 8h.01" stroke-width="2.5" />,
  sidebar: () => <path d="M2 2h12v12H2zM6 2v12" />,
  panelRight: () => <path d="M2 2h12v12H2zM10 2v12" />,
  painter: () => <path d="M3 2h9v4H3zM12 4h2v4H8v2M7 10h2v4H7z" />,
  command: () => <path d="M5 2a2 2 0 100 4h6a2 2 0 100-4v12a2 2 0 100-4H5a2 2 0 100 4z" />,
  plus: () => <path d="M8 3v10M3 8h10" />,
  trash: () => <path d="M3 4h10M6 4V2.5h4V4M4.5 4l.7 9.5h5.6l.7-9.5" />,
  up: () => <path d="M8 13V3M4 7l4-4 4 4" />,
  down: () => <path d="M8 3v10M4 9l4 4 4-4" />,
  check: () => <path d="M3 8.5l3 3 7-7" />,
};

export function Icon(props: { name: string; size?: number; class?: string; title?: string }) {
  return (
    <svg
      class={`icon ${props.class ?? ""}`}
      width={props.size ?? 16}
      height={props.size ?? 16}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.3"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden={props.title ? undefined : "true"}
    >
      {props.title && <title>{props.title}</title>}
      {(P[props.name] ?? P.element)()}
    </svg>
  );
}

/** Explorer icon for a model element type. */
export function iconForType(type: string): string {
  const map: Record<string, string> = {
    Project: "project",
    UMLModel: "model",
    UMLPackage: "package",
    UMLSubsystem: "subsystem",
    UMLProfile: "package",
    UMLClass: "class",
    UMLInterface: "interface",
    UMLSignal: "signal",
    UMLDataType: "dataType",
    UMLPrimitiveType: "primitiveType",
    UMLEnumeration: "enumeration",
    UMLAttribute: "attribute",
    UMLOperation: "operation",
    UMLReception: "operation",
    UMLParameter: "parameter",
    UMLEnumerationLiteral: "literal",
    UMLAssociation: "association",
    UMLAssociationEnd: "parameter",
    UMLGeneralization: "generalization",
    UMLDependency: "dependency",
    UMLRealization: "realization",
    UMLInterfaceRealization: "interfaceRealization",
    UMLConstraint: "constraint",
    Tag: "tag",
  };
  if (map[type]) return map[type];
  if (type.endsWith("Diagram")) return "diagram";
  return "element";
}
