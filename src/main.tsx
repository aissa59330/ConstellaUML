import { render } from "solid-js/web";
import "./ui/styles.css";
import { App } from "./ui/App";
import * as store from "./ui/store";
import * as uml from "./notation/uml";

// Test hook for end-to-end tests and demos (dev server only).
if (import.meta.env.DEV) (window as unknown as { __constella: unknown }).__constella = { store, uml, demos: () => import("./dev/demos") };

render(() => <App />, document.getElementById("root")!);
