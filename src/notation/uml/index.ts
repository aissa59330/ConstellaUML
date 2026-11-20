import { registerUmlMeta } from "../../core/meta/uml.meta";
import { registerUml2Meta } from "../../core/meta/uml2.meta";
import "./class-views";
import "./edge-views";
import "./annotation-views";
import "./phase2-views";
import "./sequence-views";

registerUmlMeta();
registerUml2Meta();

export * from "./text";
export * from "./commands";
export * from "./toolbox";
