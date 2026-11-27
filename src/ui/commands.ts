// Command registry shared by the menu bar, keyboard shortcuts, context menus
// and the command palette. Default shortcuts follow docs/keymap.md.
import { createSignal } from "solid-js";
import type { Element } from "../core/element";
import { meta } from "../core/meta/registry";
import type { DiagramEditor } from "../editor/DiagramEditor";
import { exportFragment, parseMdj } from "../io/mdj";
import {
  addDiagram,
  convertDiagram,
  DIAGRAM_TYPES,
  addViewOfModel,
  copyModel,
  copyViews,
  deleteFromModel,
  deleteViews,
  moveInParent,
  pasteModel,
  pasteViews,
  setViewField,
  type ModelClipboard,
  type ViewClipboard,
} from "../notation/uml";
import { boundsOf, isEdgeView } from "../notation/views";
import { t, lang, setLang } from "./i18n";
import * as platform from "./platform";
import * as s from "./store";
import { checkForUpdates } from "./updater";

export interface Command {
  id: string;
  label: string; // i18n key
  keys?: string[];
  run: () => unknown;
  enabled?: () => boolean;
  checked?: () => boolean;
}

const registry = new Map<string, Command>();

export function register(...cmds: Command[]): void {
  for (const c of cmds) registry.set(c.id, c);
}

export function command(id: string): Command | undefined {
  return registry.get(id);
}

export function allCommands(): Command[] {
  return [...registry.values()];
}

export async function execute(id: string): Promise<void> {
  const c = registry.get(id);
  if (!c || (c.enabled && !c.enabled())) return;
  try {
    await c.run();
  } catch (e) {
    s.reportError(e);
  }
}

// ---- editor access ----------------------------------------------------------

export const [activeEditor, setActiveEditor] = createSignal<DiagramEditor | null>(null);

function editor(): DiagramEditor | null {
  return activeEditor();
}

const sel = () => s.selection();
const selectedViews = () => sel().filter((e) => meta.isKindOf(e._type, "View"));
const selectedNodes = () => selectedViews().filter((v) => meta.isKindOf(v._type, "NodeView") && s.activeDiagram()?.ownedViews?.includes(v));
const selectedEdges = () => selectedViews().filter(isEdgeView);
const hasSel = () => sel().length > 0;
const hasViews = () => selectedViews().length > 0;
const hasDiagram = () => !!s.activeDiagram();
const hasProject = () => !!s.repo.root;

// ---- clipboard ---------------------------------------------------------------------

let clipboard: ViewClipboard | ModelClipboard | null = null;
let pasteCount = 0;

function copy(): boolean {
  const views = selectedViews();
  if (views.length) {
    clipboard = copyViews(s.repo, views);
    pasteCount = 0;
    return !!clipboard;
  }
  const m = sel()[0];
  if (m && m !== s.repo.root) {
    clipboard = copyModel(m);
    return true;
  }
  return false;
}

function paste(): void {
  if (!clipboard) return;
  if (clipboard.kind === "views") {
    const d = s.activeDiagram();
    if (!d) return;
    pasteCount++;
    s.select(pasteViews(s.repo, d, clipboard, 20 * pasteCount));
  } else {
    const owner = sel()[0] ?? s.repo.root!;
    const target = meta.isKindOf(owner._type, "View") ? s.repo.deref(owner.model) ?? s.repo.root! : owner;
    s.select(pasteModel(s.repo, target, clipboard));
  }
}

// ---- formatting helpers ---------------------------------------------------------------

function toggleViewFlag(field: string, types?: string): Command["run"] {
  return () => {
    const vs = selectedViews().filter((v) => !types || meta.fields(v._type).some((f) => f.name === field));
    if (!vs.length) return;
    const value = !vs.every((v) => !!(v[field] ?? meta.defaultOf(v._type, field)));
    setViewField(s.repo, vs, field, value);
  };
}

function flagChecked(field: string): () => boolean {
  return () => {
    const vs = selectedViews().filter((v) => meta.field(v._type, field));
    return vs.length > 0 && vs.every((v) => !!(v[field] ?? meta.defaultOf(v._type, field)));
  };
}

function align(kind: "left" | "right" | "center" | "top" | "bottom" | "middle"): void {
  const nodes = selectedNodes();
  if (nodes.length < 2) return;
  const rs = nodes.map(boundsOf);
  const minX = Math.min(...rs.map((r) => r.x)), maxX = Math.max(...rs.map((r) => r.x + r.w));
  const minY = Math.min(...rs.map((r) => r.y)), maxY = Math.max(...rs.map((r) => r.y + r.h));
  s.repo.transact("Align", (tx) => {
    nodes.forEach((n, i) => {
      const r = rs[i];
      if (kind === "left") tx.set(n, "left", minX);
      if (kind === "right") tx.set(n, "left", maxX - r.w);
      if (kind === "center") tx.set(n, "left", Math.round((minX + maxX) / 2 - r.w / 2));
      if (kind === "top") tx.set(n, "top", minY);
      if (kind === "bottom") tx.set(n, "top", maxY - r.h);
      if (kind === "middle") tx.set(n, "top", Math.round((minY + maxY) / 2 - r.h / 2));
    });
  });
}

function distribute(axis: "h" | "v"): void {
  const nodes = selectedNodes();
  if (nodes.length < 3) return;
  const pos = axis === "h" ? "left" : "top", size = axis === "h" ? "width" : "height";
  const sorted = [...nodes].sort((a, b) => a[pos] - b[pos]);
  const first = sorted[0], last = sorted[sorted.length - 1];
  const total = sorted.reduce((acc, n) => acc + n[size], 0);
  const gap = (last[pos] + last[size] - first[pos] - total) / (sorted.length - 1);
  s.repo.transact("Distribute", (tx) => {
    let cur = first[pos];
    for (const n of sorted) {
      tx.set(n, pos, Math.round(cur));
      cur += n[size] + gap;
    }
  });
}

function sameSize(w: boolean, h: boolean): void {
  const nodes = selectedNodes();
  if (nodes.length < 2) return;
  const ref = nodes[0];
  s.repo.transact("Same size", (tx) => {
    for (const n of nodes.slice(1)) {
      if (w) tx.set(n, "width", ref.width);
      if (h) tx.set(n, "height", ref.height);
    }
  });
}

/** ER diagram ⇄ relational model, opened next to the source. */
function convertActive(target: "ERDDiagram" | "ERDRelationalDiagram"): void {
  const d = s.activeDiagram();
  if (!d) return;
  const out = convertDiagram(s.repo, d, target);
  s.openDiagram(out._id);
  s.select([out]);
}

function reorderViews(front: boolean): void {
  const d = s.activeDiagram();
  const vs = selectedViews().filter((v) => d?.ownedViews?.includes(v));
  if (!d || !vs.length) return;
  s.repo.transact(front ? "Bring to front" : "Send to back", (tx) => {
    for (const v of front ? vs : [...vs].reverse()) tx.move(v, d, "ownedViews", front ? d.ownedViews.length : 0);
  });
}

/** Format painter: copies style fields of the selected view onto the next clicked one. */
export const [painterSource, setPainterSource] = createSignal<Element | null>(null);
const STYLE_FIELDS = ["fillColor", "lineColor", "fontColor", "font", "showShadow", "lineStyle", "stereotypeDisplay", "showVisibility", "showType", "showMultiplicity", "showProperty", "showOperationSignature", "suppressAttributes", "suppressOperations", "wordWrap"];

export function applyPainter(target: Element): boolean {
  const src = painterSource();
  if (!src) return false;
  setPainterSource(null);
  if (src === target) return true;
  s.repo.transact("Format painter", (tx) => {
    for (const f of STYLE_FIELDS) if (src[f] !== undefined && meta.field(target._type, f)) tx.set(target, f, src[f]);
  });
  return true;
}

async function exportFragmentCmd(): Promise<void> {
  const el = sel()[0];
  const target = el && meta.isKindOf(el._type, "View") ? s.repo.deref(el.model) : el;
  if (!target || target === s.repo.root) throw new Error(t("props.none"));
  const path = await platform.pickSavePath(`${target.name || "fragment"}.mfj`, [platform.MFJ_FILTER]);
  if (path) await platform.writeText(path, exportFragment(target));
}

async function importFragmentCmd(): Promise<void> {
  const path = await platform.pickOpenPath([platform.MFJ_FILTER]);
  if (!path) return;
  const frag = parseMdj(await platform.readText(path));
  s.select(pasteModel(s.repo, s.repo.root!, { kind: "model", element: frag }));
}

// ---- registration ---------------------------------------------------------------------

register(
  { id: "file:new", label: "cmd.file.new", keys: ["Ctrl+N"], run: async () => (await s.confirmDiscard()) && s.newDocument() },
  {
    id: "file:open",
    label: "cmd.file.open",
    keys: ["Ctrl+O"],
    run: async () => {
      if (!(await s.confirmDiscard())) return;
      const p = await platform.pickOpenPath([platform.MDJ_FILTER]);
      if (p) await s.openDocument(p);
    },
  },
  { id: "file:save", label: "cmd.file.save", keys: ["Ctrl+S"], run: () => s.saveDocument(), enabled: hasProject },
  { id: "file:save-as", label: "cmd.file.saveAs", keys: ["Ctrl+Shift+S"], run: () => s.saveDocument(true), enabled: hasProject },
  { id: "file:close", label: "cmd.file.close", run: async () => (await s.confirmDiscard()) && s.newDocument() },
  { id: "file:export-image", label: "cmd.file.exportImage", keys: ["Ctrl+Shift+E"], run: () => s.setDialog({ kind: "export" }), enabled: hasDiagram },
  { id: "file:export-fragment", label: "cmd.file.exportFragment", run: exportFragmentCmd, enabled: hasSel },
  { id: "file:import-fragment", label: "cmd.file.importFragment", run: importFragmentCmd, enabled: hasProject },
  { id: "app:quit", label: "cmd.app.quit", keys: ["Ctrl+Q"], run: async () => (await s.confirmDiscard()) && platform.quit() },

  { id: "edit:undo", label: "cmd.edit.undo", keys: ["Ctrl+Z"], run: () => s.repo.undo(), enabled: () => (s.modelVersion(), s.repo.canUndo()) },
  { id: "edit:redo", label: "cmd.edit.redo", keys: ["Ctrl+Y", "Ctrl+Shift+Z"], run: () => s.repo.redo(), enabled: () => (s.modelVersion(), s.repo.canRedo()) },
  {
    id: "edit:cut",
    label: "cmd.edit.cut",
    keys: ["Ctrl+X"],
    run: () => {
      if (!copy()) return;
      if (selectedViews().length) deleteViews(s.repo, selectedViews());
      else deleteFromModel(s.repo, sel());
    },
    enabled: hasSel,
  },
  { id: "edit:copy", label: "cmd.edit.copy", keys: ["Ctrl+C"], run: () => copy() && s.toast(t("toast.copied")), enabled: hasSel },
  { id: "edit:paste", label: "cmd.edit.paste", keys: ["Ctrl+V"], run: paste },
  { id: "edit:copy-diagram-image", label: "cmd.edit.copyDiagramImage", keys: ["Ctrl+Shift+C"], run: () => import("./exporting").then((m) => m.copyDiagramImage()), enabled: hasDiagram },
  { id: "edit:delete", label: "cmd.edit.delete", keys: ["Delete"], run: () => (selectedViews().length ? deleteViews(s.repo, selectedViews()) : deleteFromModel(s.repo, sel())), enabled: hasSel },
  { id: "edit:delete-from-model", label: "cmd.edit.deleteFromModel", keys: ["Ctrl+Delete"], run: () => deleteFromModel(s.repo, sel()), enabled: hasSel },
  { id: "edit:move-up", label: "cmd.edit.moveUp", keys: ["Ctrl+Shift+ArrowUp"], run: () => sel()[0] && moveInParent(s.repo, s.modelOf(sel()[0]) ?? sel()[0], -1), enabled: hasSel },
  { id: "edit:move-down", label: "cmd.edit.moveDown", keys: ["Ctrl+Shift+ArrowDown"], run: () => sel()[0] && moveInParent(s.repo, s.modelOf(sel()[0]) ?? sel()[0], 1), enabled: hasSel },
  { id: "edit:select-all", label: "cmd.edit.selectAll", keys: ["Ctrl+A"], run: () => s.select(s.activeDiagram()?.ownedViews ?? []), enabled: hasDiagram },
  {
    id: "edit:select-in-explorer",
    label: "cmd.edit.selectInExplorer",
    keys: ["Ctrl+E"],
    run: () => {
      const m = sel().map((e) => s.modelOf(e)).filter((x): x is Element => !!x);
      if (m.length) s.select(m);
    },
    enabled: hasViews,
  },
  {
    id: "edit:select-in-diagram",
    label: "cmd.edit.selectInDiagram",
    keys: ["Ctrl+D"],
    run: () => {
      const m = sel()[0];
      if (!m) return;
      const views = s.repo.viewsOf(m._id).filter((v) => s.repo.diagramOf(v)?.ownedViews?.includes(v));
      const v = views.find((x) => s.repo.diagramOf(x)?._id === s.activeDiagramId()) ?? views[0];
      if (!v) return;
      s.openDiagram(s.repo.diagramOf(v)!._id);
      s.select([v]);
      queueMicrotask(() => editor()?.reveal(boundsOf(v)));
    },
    enabled: hasSel,
  },

  { id: "format:font", label: "cmd.format.font", keys: ["Ctrl+Shift+F"], run: () => s.setDialog({ kind: "font" }), enabled: hasViews },
  { id: "format:fill-color", label: "cmd.format.fillColor", keys: ["Ctrl+Shift+I"], run: () => s.setDialog({ kind: "color", field: "fillColor" }), enabled: hasViews },
  { id: "format:line-color", label: "cmd.format.lineColor", keys: ["Ctrl+Shift+L"], run: () => s.setDialog({ kind: "color", field: "lineColor" }), enabled: hasViews },
  ...(
    [
      ["rectilinear", "cmd.format.lineRectilinear", "Ctrl+L", 0],
      ["oblique", "cmd.format.lineOblique", "Ctrl+B", 1],
      ["roundrect", "cmd.format.lineRoundRect", "Ctrl+Alt+L", 2],
      ["curve", "cmd.format.lineCurve", "Ctrl+Alt+B", 3],
    ] as const
  ).map(([id, label, key, value]) => ({
    id: `format:line-${id}`,
    label,
    keys: [key],
    run: () => setViewField(s.repo, selectedEdges(), "lineStyle", value, "Line style"),
    enabled: () => selectedEdges().length > 0,
    checked: () => selectedEdges().length > 0 && selectedEdges().every((e) => (e.lineStyle ?? 0) === value),
  })),
  { id: "format:auto-resize", label: "cmd.format.autoResize", keys: ["Ctrl+Shift+R"], run: toggleViewFlag("autoResize"), checked: flagChecked("autoResize"), enabled: hasViews },
  { id: "format:shadow", label: "cmd.format.shadow", keys: ["Ctrl+Shift+H"], run: toggleViewFlag("showShadow"), checked: flagChecked("showShadow"), enabled: hasViews },
  { id: "format:inherit-style", label: "cmd.format.inheritStyle", keys: ["Ctrl+Shift+K"], run: toggleViewFlag("parentStyle"), checked: flagChecked("parentStyle"), enabled: hasViews },
  { id: "format:word-wrap", label: "cmd.format.wordWrap", keys: ["Ctrl+Shift+W"], run: toggleViewFlag("wordWrap", "x"), checked: flagChecked("wordWrap"), enabled: hasViews },
  ...(["none", "label", "decoration", "decoration-label", "icon", "icon-label"] as const).map((v, i) => ({
    id: `format:stereotype-${i}`,
    label: `cmd.format.st.${["none", "label", "decoration", "decorationLabel", "icon", "iconLabel"][i]}`,
    keys: [`Ctrl+Shift+${i}`],
    run: () => setViewField(s.repo, selectedViews().filter((x) => meta.field(x._type, "stereotypeDisplay")), "stereotypeDisplay", v),
    checked: () => selectedViews().some((x) => x.stereotypeDisplay === v),
    enabled: hasViews,
  })),
  ...(
    [
      ["show-visibility", "cmd.format.showVisibility", "Ctrl+Shift+V", "showVisibility"],
      ["show-namespace", "cmd.format.showNamespace", "Ctrl+Shift+N", "showNamespace"],
      ["show-property", "cmd.format.showProperty", "Ctrl+Shift+B", "showProperty"],
      ["show-type", "cmd.format.showType", "Ctrl+Shift+Y", "showType"],
      ["show-multiplicity", "cmd.format.showMultiplicity", "Ctrl+Shift+M", "showMultiplicity"],
      ["show-signature", "cmd.format.showSignature", "Ctrl+Shift+J", "showOperationSignature"],
      ["suppress-attributes", "cmd.format.suppressAttributes", "Ctrl+Shift+A", "suppressAttributes"],
      ["suppress-operations", "cmd.format.suppressOperations", "Ctrl+Shift+O", "suppressOperations"],
      ["suppress-receptions", "cmd.format.suppressReceptions", "Ctrl+Shift+X", "suppressReceptions"],
      ["suppress-literals", "cmd.format.suppressLiterals", "Ctrl+Shift+T", "suppressLiterals"],
    ] as const
  ).map(([id, label, key, field]) => ({
    id: `format:${id}`,
    label,
    keys: [key],
    run: toggleViewFlag(field, "x"),
    checked: flagChecked(field),
    enabled: () => selectedViews().some((v) => meta.field(v._type, field)),
  })),
  ...(["left", "right", "center", "top", "bottom", "middle"] as const).map((k) => ({
    id: `format:align-${k}`,
    label: `cmd.format.align${k[0].toUpperCase()}${k.slice(1)}`,
    run: () => align(k),
    enabled: () => selectedNodes().length > 1,
  })),
  { id: "format:distribute-h", label: "cmd.format.distributeH", run: () => distribute("h"), enabled: () => selectedNodes().length > 2 },
  { id: "format:distribute-v", label: "cmd.format.distributeV", run: () => distribute("v"), enabled: () => selectedNodes().length > 2 },
  { id: "format:same-width", label: "cmd.format.sameWidth", run: () => sameSize(true, false), enabled: () => selectedNodes().length > 1 },
  { id: "format:same-height", label: "cmd.format.sameHeight", run: () => sameSize(false, true), enabled: () => selectedNodes().length > 1 },
  { id: "format:same-size", label: "cmd.format.sameSize", run: () => sameSize(true, true), enabled: () => selectedNodes().length > 1 },
  { id: "format:bring-to-front", label: "cmd.format.bringToFront", run: () => reorderViews(true), enabled: hasViews },
  { id: "format:send-to-back", label: "cmd.format.sendToBack", run: () => reorderViews(false), enabled: hasViews },
  { id: "format:painter", label: "cmd.format.painter", run: () => setPainterSource(selectedViews()[0] ?? null), enabled: () => selectedViews().length === 1, checked: () => !!painterSource() },

  ...DIAGRAM_TYPES.map(({ type }) => ({
    id: `model:add-diagram-${type}`,
    label: `diagram.${type}`,
    run: () => {
      let owner = s.modelOf(sel()[0] ?? s.repo.root!) ?? s.repo.root!;
      if (meta.isKindOf(owner._type, "Diagram")) owner = s.repo.parentOf(owner) ?? s.repo.root!;
      // Diagrams go into packages / classifiers; anything else adds to its owner.
      const behavior = DIAGRAM_TYPES.find((x) => x.type === type)?.owner;
      while (owner !== s.repo.root && owner._type !== behavior && !meta.isKindOf(owner._type, "UMLPackage") && !meta.isKindOf(owner._type, "UMLClassifier")) owner = s.repo.parentOf(owner) ?? s.repo.root!;
      if (owner === s.repo.root) owner = (s.repo.root!.ownedElements ?? []).find((e: Element) => meta.isKindOf(e._type, "UMLPackage")) ?? s.repo.root!;
      const d = addDiagram(s.repo, owner, type);
      s.openDiagram(d._id);
      s.select([d]);
    },
    enabled: hasProject,
  })),
  { id: "model:find", label: "cmd.model.find", keys: ["Ctrl+F"], run: () => s.setDialog({ kind: "find" }), enabled: hasProject },
  {
    id: "model:to-relational",
    label: "cmd.model.toRelational",
    run: () => convertActive("ERDRelationalDiagram"),
    enabled: () => s.activeDiagram()?._type === "ERDDiagram",
  },
  { id: "model:to-erd", label: "cmd.model.toErd", run: () => convertActive("ERDDiagram"), enabled: () => s.activeDiagram()?._type === "ERDRelationalDiagram" },
  {
    id: "model:algebra-notation",
    label: "cmd.model.algebraNotation",
    run: () => {
      const d = s.activeDiagram()!;
      s.repo.transact("Notation", (tx) => tx.set(d, "notation", d.notation === "algebra" ? "sql" : "algebra"));
    },
    enabled: () => s.activeDiagram()?._type === "RAQueryDiagram",
    checked: () => s.activeDiagram()?.notation === "algebra",
  },
  { id: "tools:generate-code", label: "cmd.tools.generateCode", run: () => s.setDialog({ kind: "codegen" }), enabled: hasProject },
  { id: "tools:reverse", label: "cmd.tools.reverse", run: () => s.setDialog({ kind: "reverse" }), enabled: hasProject },
  { id: "tools:import-sql", label: "cmd.tools.importSql", run: () => s.setDialog({ kind: "sqlImport" }), enabled: hasProject },
  { id: "tools:query-tree", label: "cmd.tools.queryTree", run: () => s.setDialog({ kind: "queryTree" }), enabled: hasProject },
  { id: "tools:claude", label: "cmd.tools.claude", run: () => s.setDialog({ kind: "claude" }) },

  { id: "view:quick-find", label: "cmd.view.quickFind", keys: ["Ctrl+P"], run: () => s.setDialog({ kind: "quickFind" }) },
  { id: "view:command-palette", label: "cmd.view.commandPalette", keys: ["Ctrl+Shift+P"], run: () => s.setDialog({ kind: "palette" }) },
  { id: "view:close-diagram", label: "cmd.view.closeDiagram", keys: ["F4"], run: () => s.activeDiagramId() && s.closeDiagram(s.activeDiagramId()!), enabled: hasDiagram },
  { id: "view:close-others", label: "cmd.view.closeOthers", keys: ["Ctrl+F4"], run: () => s.setOpenDiagrams(s.openDiagrams().filter((d) => d === s.activeDiagramId())), enabled: hasDiagram },
  { id: "view:close-all", label: "cmd.view.closeAll", keys: ["Shift+F4"], run: () => (s.setOpenDiagrams([]), s.setActiveDiagramId(null)), enabled: hasDiagram },
  { id: "view:next-diagram", label: "cmd.view.nextDiagram", keys: ["Ctrl+Shift+]"], run: () => cycleDiagram(1), enabled: hasDiagram },
  { id: "view:previous-diagram", label: "cmd.view.previousDiagram", keys: ["Ctrl+Shift+["], run: () => cycleDiagram(-1), enabled: hasDiagram },
  { id: "view:zoom-in", label: "cmd.view.zoomIn", keys: ["Ctrl+=", "Ctrl++", "Ctrl+Shift++"], run: () => editor()?.zoomBy(1.2), enabled: hasDiagram },
  { id: "view:zoom-out", label: "cmd.view.zoomOut", keys: ["Ctrl+-"], run: () => editor()?.zoomBy(1 / 1.2), enabled: hasDiagram },
  { id: "view:actual-size", label: "cmd.view.actualSize", keys: ["Ctrl+0"], run: () => editor()?.setZoom(1), enabled: hasDiagram },
  { id: "view:fit", label: "cmd.view.fit", keys: ["Ctrl+9"], run: () => editor()?.fit(), enabled: hasDiagram },
  { id: "view:show-grid", label: "cmd.view.showGrid", keys: ["Ctrl+G"], run: () => s.setShowGrid(!s.showGrid()), checked: s.showGrid },
  { id: "view:snap-to-grid", label: "cmd.view.snapToGrid", keys: ["Ctrl+Shift+G"], run: () => s.setSnapToGrid(!s.snapToGrid()), checked: s.snapToGrid },
  ...(
    [
      ["sidebar", "Ctrl+1"],
      ["navigator", "Ctrl+2"],
      ["toolbar", "Ctrl+3"],
      ["statusbar", "Ctrl+4"],
      ["toolbox", "Ctrl+5"],
      ["editors", "Ctrl+6"],
      ["minimap", "Ctrl+Alt+M"],
    ] as const
  ).map(([k, key]) => ({
    id: `view:${k}`,
    label: `cmd.view.${k}`,
    keys: [key],
    run: () => s.togglePanel(k),
    checked: () => s.panels()[k],
  })),
  { id: "view:toggle-theme", label: "cmd.view.toggleTheme", run: () => s.setTheme(s.theme() === "dark" ? "light" : "dark") },
  { id: "view:language", label: "cmd.view.language", run: () => setLang(lang() === "fr" ? "en" : "fr") },
  { id: "help:about", label: "cmd.help.about", run: () => s.setDialog({ kind: "about" }) },
  { id: "help:shortcuts", label: "cmd.help.shortcuts", run: () => s.setDialog({ kind: "shortcuts" }) },
  { id: "help:updates", label: "cmd.help.updates", run: () => void checkForUpdates(true) },
);

function cycleDiagram(delta: number): void {
  const list = s.openDiagrams();
  if (list.length < 2) return;
  const i = list.indexOf(s.activeDiagramId() ?? "");
  s.setActiveDiagramId(list[(i + delta + list.length) % list.length]);
}

export function dropModelOnDiagram(modelId: string, x: number, y: number): void {
  const d = s.activeDiagram();
  const m = s.repo.get(modelId);
  if (!d || !m) return;
  if (meta.isKindOf(m._type, "Diagram")) return s.openDiagram(m._id);
  const v = addViewOfModel(s.repo, d, m, x, y);
  if (v) s.select([v]);
}

// ---- keyboard -----------------------------------------------------------------------

/** Normalized chord for an event: "Ctrl+Shift+P", "Delete", "Ctrl+Alt+L"… */
export function chord(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  let k = e.key;
  if (/^Digit\d$/.test(e.code)) k = e.code.slice(5);
  else if (e.code === "BracketLeft") k = "[";
  else if (e.code === "BracketRight") k = "]";
  else if (e.code === "Minus" || e.code === "NumpadSubtract") k = "-";
  else if (e.code === "Equal") k = e.shiftKey ? "+" : "=";
  else if (e.code === "NumpadAdd") k = "+";
  else if (/^Key[A-Z]$/.test(e.code)) k = e.code.slice(3);
  else if (k.length === 1) k = k.toUpperCase();
  parts.push(k);
  return parts.join("+");
}

let keymap: Map<string, string> | null = null;
function buildKeymap(): Map<string, string> {
  const m = new Map<string, string>();
  for (const c of registry.values()) for (const k of c.keys ?? []) m.set(k, c.id);
  return m;
}

/** Returns true if the event triggered a command. */
export function handleShortcut(e: KeyboardEvent): boolean {
  keymap ??= buildKeymap();
  const id = keymap.get(chord(e));
  if (!id) return false;
  e.preventDefault();
  execute(id);
  return true;
}

export function shortcutLabel(id: string): string {
  return registry.get(id)?.keys?.[0]?.replace("ArrowUp", "↑").replace("ArrowDown", "↓").replace("Delete", "Suppr") ?? "";
}

// ---- menus --------------------------------------------------------------------------

export type MenuItem = { cmd: string } | { label: string; children: MenuItem[] } | { sep: true } | { recent: true };

export const MAIN_MENU: { label: string; items: MenuItem[] }[] = [
  {
    label: "menu.file",
    items: [
      { cmd: "file:new" },
      { cmd: "file:open" },
      { recent: true },
      { sep: true },
      { cmd: "file:save" },
      { cmd: "file:save-as" },
      { sep: true },
      { cmd: "file:import-fragment" },
      { cmd: "file:export-fragment" },
      { cmd: "file:export-image" },
      { sep: true },
      { cmd: "file:close" },
      { cmd: "app:quit" },
    ],
  },
  {
    label: "menu.edit",
    items: [
      { cmd: "edit:undo" },
      { cmd: "edit:redo" },
      { sep: true },
      { cmd: "edit:cut" },
      { cmd: "edit:copy" },
      { cmd: "edit:paste" },
      { cmd: "edit:copy-diagram-image" },
      { sep: true },
      { cmd: "edit:delete" },
      { cmd: "edit:delete-from-model" },
      { sep: true },
      { cmd: "edit:move-up" },
      { cmd: "edit:move-down" },
      { sep: true },
      { cmd: "edit:select-all" },
      { cmd: "edit:select-in-explorer" },
      { cmd: "edit:select-in-diagram" },
    ],
  },
  {
    label: "menu.format",
    items: [
      { cmd: "format:font" },
      { cmd: "format:fill-color" },
      { cmd: "format:line-color" },
      { label: "cmd.format.lineStyle", children: [{ cmd: "format:line-rectilinear" }, { cmd: "format:line-oblique" }, { cmd: "format:line-roundrect" }, { cmd: "format:line-curve" }] },
      { sep: true },
      { cmd: "format:auto-resize" },
      { cmd: "format:shadow" },
      { cmd: "format:inherit-style" },
      { cmd: "format:word-wrap" },
      { label: "cmd.format.stereotypeDisplay", children: [0, 1, 2, 3, 4, 5].map((i) => ({ cmd: `format:stereotype-${i}` })) },
      { sep: true },
      { cmd: "format:show-visibility" },
      { cmd: "format:show-namespace" },
      { cmd: "format:show-property" },
      { cmd: "format:show-type" },
      { cmd: "format:show-multiplicity" },
      { cmd: "format:show-signature" },
      { sep: true },
      { cmd: "format:suppress-attributes" },
      { cmd: "format:suppress-operations" },
      { cmd: "format:suppress-receptions" },
      { cmd: "format:suppress-literals" },
      { sep: true },
      {
        label: "cmd.format.alignment",
        children: [
          { cmd: "format:align-left" },
          { cmd: "format:align-center" },
          { cmd: "format:align-right" },
          { sep: true },
          { cmd: "format:align-top" },
          { cmd: "format:align-middle" },
          { cmd: "format:align-bottom" },
          { sep: true },
          { cmd: "format:distribute-h" },
          { cmd: "format:distribute-v" },
          { sep: true },
          { cmd: "format:same-width" },
          { cmd: "format:same-height" },
          { cmd: "format:same-size" },
          { sep: true },
          { cmd: "format:bring-to-front" },
          { cmd: "format:send-to-back" },
        ],
      },
      { cmd: "format:painter" },
    ],
  },
  {
    label: "menu.model",
    items: [
      { label: "cmd.model.addDiagram", children: DIAGRAM_TYPES.map(({ type }) => ({ cmd: `model:add-diagram-${type}` })) },
      { sep: true },
      { cmd: "model:to-relational" },
      { cmd: "model:to-erd" },
      { cmd: "model:algebra-notation" },
      { sep: true },
      { cmd: "model:find" },
    ],
  },
  {
    label: "menu.tools",
    items: [
      { cmd: "tools:generate-code" },
      { cmd: "tools:reverse" },
      { sep: true },
      { cmd: "tools:import-sql" },
      { cmd: "tools:query-tree" },
      { sep: true },
      { cmd: "tools:claude" },
      { sep: true },
      { cmd: "view:command-palette" },
    ],
  },
  {
    label: "menu.view",
    items: [
      { cmd: "view:quick-find" },
      { cmd: "view:command-palette" },
      { sep: true },
      { cmd: "view:close-diagram" },
      { cmd: "view:close-others" },
      { cmd: "view:close-all" },
      { cmd: "view:next-diagram" },
      { cmd: "view:previous-diagram" },
      { sep: true },
      { cmd: "view:zoom-in" },
      { cmd: "view:zoom-out" },
      { cmd: "view:actual-size" },
      { cmd: "view:fit" },
      { sep: true },
      { cmd: "view:show-grid" },
      { cmd: "view:snap-to-grid" },
      { sep: true },
      { cmd: "view:sidebar" },
      { cmd: "view:navigator" },
      { cmd: "view:toolbar" },
      { cmd: "view:statusbar" },
      { cmd: "view:toolbox" },
      { cmd: "view:editors" },
      { cmd: "view:minimap" },
      { sep: true },
      { cmd: "view:toggle-theme" },
      { cmd: "view:language" },
    ],
  },
  { label: "menu.help", items: [{ cmd: "help:shortcuts" }, { cmd: "help:updates" }, { cmd: "help:about" }] },
];

export const DIAGRAM_CONTEXT_MENU: MenuItem[] = [
  { cmd: "edit:cut" },
  { cmd: "edit:copy" },
  { cmd: "edit:paste" },
  { sep: true },
  { cmd: "edit:delete" },
  { cmd: "edit:delete-from-model" },
  { sep: true },
  { cmd: "edit:select-in-explorer" },
  { cmd: "edit:select-all" },
  { sep: true },
  { cmd: "format:font" },
  { cmd: "format:fill-color" },
  { cmd: "format:line-color" },
  { label: "cmd.format.lineStyle", children: [{ cmd: "format:line-rectilinear" }, { cmd: "format:line-oblique" }, { cmd: "format:line-roundrect" }, { cmd: "format:line-curve" }] },
  { label: "cmd.format.alignment", children: (MAIN_MENU[2].items.find((i) => "children" in i && i.label === "cmd.format.alignment") as { children: MenuItem[] }).children },
  { cmd: "format:painter" },
];

export { t };
