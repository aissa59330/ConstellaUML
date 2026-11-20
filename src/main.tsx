import { render } from "solid-js/web";
import "./ui/styles.css";
import { App } from "./ui/App";
import * as store from "./ui/store";
import * as uml from "./notation/uml";
import { activeEditor } from "./ui/commands";

// Test hook for end-to-end tests and demos (dev server only).
if (import.meta.env.DEV) (window as unknown as { __constella: unknown }).__constella = { store, uml, editor: activeEditor, demos: () => import("./dev/demos") };

render(() => <App />, document.getElementById("root")!);
