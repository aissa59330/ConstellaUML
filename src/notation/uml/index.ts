import { registerUmlMeta } from "../../core/meta/uml.meta";
import { registerUml2Meta } from "../../core/meta/uml2.meta";
import "./class-views";
import "./edge-views";
import "./annotation-views";
import "./phase2-views";
import "./sequence-views";
import { registerErdMeta } from "../../core/meta/erd.meta";
import "../erd/erd-views";
import "../erd/relational-views";
import { registerRaMeta } from "../../core/meta/ra.meta";
import "../ra/ra-views";

registerUmlMeta();
registerUml2Meta();
registerErdMeta();
registerRaMeta();

export * from "./text";
export * from "./commands";
export * from "./toolbox";
export { diagramOfElements, layoutDiagram } from "./autolayout";
export * from "../erd/text";
export { buildQueryTree, parseQuery, type QNode } from "../ra/query";
