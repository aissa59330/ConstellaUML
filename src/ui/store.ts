// Application state shared by the UI. The repository is the single source of
// truth for the model; Solid signals mirror what panels need to re-render.
import { batch, createSignal } from "solid-js";
import type { Element } from "../core/element";
import { meta } from "../core/meta/registry";
import { Repository } from "../core/repository";
import { newProject, parseMdj, serializeMdj } from "../io/mdj";
import "../notation/uml";
import type { Theme } from "../render/colors";
import { t } from "./i18n";
import * as platform from "./platform";

export const repo = new Repository();

const [version, setVersion] = createSignal(0);
/** Read inside components/effects to re-run on any model change. */
export const modelVersion = version;
// Several operations in one task (a command, a script, an import) refresh the UI once.
let versionQueued = false;
repo.subscribe(() => {
  if (versionQueued) return;
  versionQueued = true;
  queueMicrotask(() => {
    versionQueued = false;
    setVersion(repo.version);
  });
});

// ---- documents & diagrams ----------------------------------------------------

export const [filePath, setFilePath] = createSignal<string | null>(null);
export const [openDiagrams, setOpenDiagrams] = createSignal<string[]>([]);
export const [activeDiagramId, setActiveDiagramId] = createSignal<string | null>(null);

export function activeDiagram(): Element | undefined {
  version();
  const id = activeDiagramId();
  return id ? repo.get(id) : undefined;
}

export function isDiagram(el: Element | undefined): boolean {
  return !!el && meta.isKindOf(el._type, "Diagram");
}

export function openDiagram(id: string): void {
  if (!repo.get(id)) return;
  batch(() => {
    if (!openDiagrams().includes(id)) setOpenDiagrams([...openDiagrams(), id]);
    setActiveDiagramId(id);
    setTool(null);
  });
}

export function closeDiagram(id: string): void {
  const list = openDiagrams();
  const i = list.indexOf(id);
  if (i < 0) return;
  const next = list.filter((d) => d !== id);
  batch(() => {
    setOpenDiagrams(next);
    if (activeDiagramId() === id) setActiveDiagramId(next[Math.min(i, next.length - 1)] ?? null);
  });
}

/** Drops tabs whose diagram no longer exists (after delete / undo). */
export function pruneDiagrams(): void {
  const alive = openDiagrams().filter((id) => repo.get(id));
  if (alive.length !== openDiagrams().length) {
    batch(() => {
      setOpenDiagrams(alive);
      if (!alive.includes(activeDiagramId() ?? "")) setActiveDiagramId(alive[alive.length - 1] ?? null);
    });
  }
}
repo.subscribe(() => queueMicrotask(pruneDiagrams));

// ---- selection ------------------------------------------------------------------

const [selectionIds, setSelectionIds] = createSignal<string[]>([]);

export function selection(): Element[] {
  version();
  return selectionIds()
    .map((id) => repo.get(id))
    .filter((e): e is Element => !!e);
}

export function select(els: Element[] | Element | null): void {
  const list = els === null ? [] : Array.isArray(els) ? els : [els];
  setSelectionIds(list.map((e) => e._id));
}

export function isSelected(id: string): boolean {
  return selectionIds().includes(id);
}

/** Model element behind a selected item (views resolve to their model). */
export function modelOf(el: Element): Element | undefined {
  if (meta.isKindOf(el._type, "View")) return repo.deref(el.model);
  return el;
}

// ---- tools, preferences ----------------------------------------------------------

export const [tool, setTool] = createSignal<string | null>(null);
export const [toolSticky, setToolSticky] = createSignal(false);

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem("constella." + key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}

function persisted<T>(key: string, fallback: T) {
  const [get, set] = createSignal<T>(load(key, fallback));
  const setter = (v: T) => {
    set(() => v);
    try {
      localStorage.setItem("constella." + key, JSON.stringify(v));
    } catch {
      /* ignore */
    }
  };
  return [get, setter] as const;
}

const prefersDark = typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches;
export const [theme, setThemeRaw] = persisted<Theme>("theme", prefersDark ? "dark" : "light");
export function setTheme(th: Theme): void {
  setThemeRaw(th);
  document.documentElement.dataset.theme = th;
}

export const [showGrid, setShowGrid] = persisted("grid", true);
export const [snapToGrid, setSnapToGrid] = persisted("snap", true);
export const GRID = 10;

export interface Panels {
  sidebar: boolean;
  navigator: boolean;
  toolbar: boolean;
  statusbar: boolean;
  toolbox: boolean;
  editors: boolean;
  minimap: boolean;
  bottom: boolean;
}
export const [panels, setPanels] = persisted<Panels>("panels", {
  sidebar: true,
  navigator: true,
  toolbar: true,
  statusbar: true,
  toolbox: true,
  editors: true,
  minimap: true,
  bottom: false,
});
export function togglePanel(k: keyof Panels): void {
  setPanels({ ...panels(), [k]: !panels()[k] });
}

export const [sidebarWidth, setSidebarWidth] = persisted("sidebarWidth", 220);
export const [navigatorWidth, setNavigatorWidth] = persisted("navigatorWidth", 300);
export const [explorerRatio, setExplorerRatio] = persisted("explorerRatio", 0.5);
export const [explorerSort, setExplorerSort] = persisted<"added" | "name">("explorerSort", "added");
export const [explorerShowStereotype, setExplorerShowStereotype] = persisted("explorerStereotype", true);

// ---- toasts ------------------------------------------------------------------------

export interface Toast {
  id: number;
  text: string;
  kind: "info" | "error";
}
export const [toasts, setToasts] = createSignal<Toast[]>([]);
let toastId = 0;
export function toast(text: string, kind: Toast["kind"] = "info"): void {
  const id = ++toastId;
  setToasts([...toasts(), { id, text, kind }]);
  setTimeout(() => setToasts(toasts().filter((x) => x.id !== id)), kind === "error" ? 6000 : 2500);
}
export function reportError(e: unknown): void {
  console.error(e);
  toast(t("toast.error", { msg: e instanceof Error ? e.message : String(e) }), "error");
}

// ---- dialogs ------------------------------------------------------------------------

export type DialogState =
  | { kind: "export" }
  | { kind: "color"; field: "fillColor" | "lineColor" | "fontColor" }
  | { kind: "font" }
  | { kind: "palette" }
  | { kind: "quickFind" }
  | { kind: "find" }
  | { kind: "about" }
  | { kind: "shortcuts" }
  | { kind: "codegen" }
  | { kind: "reverse" }
  | { kind: "sqlImport" }
  | { kind: "queryTree" }
  | { kind: "confirm"; message: string; buttons: { label: string; value: string; primary?: boolean }[]; resolve: (v: string) => void };
export const [dialog, setDialog] = createSignal<DialogState | null>(null);

export function ask(message: string, buttons: { label: string; value: string; primary?: boolean }[]): Promise<string> {
  return new Promise((resolve) => setDialog({ kind: "confirm", message, buttons, resolve: (v) => (setDialog(null), resolve(v)) }));
}

// ---- find results ---------------------------------------------------------------------

export const [findResults, setFindResults] = createSignal<Element[]>([]);

// ---- project lifecycle ----------------------------------------------------------------

export const [recentFiles, setRecentFiles] = persisted<string[]>("recent", []);

function addRecent(path: string): void {
  setRecentFiles([path, ...recentFiles().filter((p) => p !== path)].slice(0, 10));
}

export function projectName(): string {
  version();
  const p = filePath();
  return p ? platform.basename(p) : repo.root?.name || t("app.untitled");
}

/** Set by the explorer: which nodes start expanded after loading a project. */
let expandTopLevel: ((root: Element) => void) | undefined;
/** Builds the reverse reference index while idle, so the first drag does not pay for it. */
function warmIndexes(): void {
  const run = () => repo.referrers("");
  if ("requestIdleCallback" in window) (window as unknown as { requestIdleCallback: (f: () => void) => void }).requestIdleCallback(run);
  else setTimeout(run, 200);
}

export function onProjectLoaded(fn: (root: Element) => void): void {
  expandTopLevel = fn;
}

function loadRoot(root: Element, path: string | null): void {
  batch(() => {
    repo.load(root);
    setFilePath(path);
    select(null);
    setOpenDiagrams([]);
    setActiveDiagramId(null);
    // Open the default diagram, else the first one.
    let first: Element | undefined;
    for (const el of repo.all()) {
      if (!meta.isKindOf(el._type, "Diagram")) continue;
      if (el.defaultDiagram) {
        first = el;
        break;
      }
      first ??= el;
    }
    if (first) openDiagram(first._id);
    expandTopLevel?.(root);
    setVersion(repo.version);
    warmIndexes();
  });
}

export function newDocument(): void {
  loadRoot(newProject(), null);
}

/** Fixed black/white colors from older files → theme variables (FILE-007). */
function usesFixedColors(root: Element): boolean {
  for (const el of repo.all()) if (el !== root && (el.fillColor === "#ffffff" || el.lineColor === "#000000")) return true;
  return false;
}

function convertFixedColors(): void {
  const map: Record<string, string> = { "#ffffff": "$background", "#000000": "$foreground" };
  for (const el of repo.all()) {
    for (const f of ["fillColor", "lineColor", "fontColor"]) {
      const v = typeof el[f] === "string" ? el[f].toLowerCase() : undefined;
      if (v && map[v]) el[f] = map[v];
    }
  }
}

export async function openDocument(path: string): Promise<void> {
  const text = await platform.readText(path);
  const root = parseMdj(text);
  loadRoot(root, path);
  addRecent(path);
  if (usesFixedColors(root)) {
    const answer = await ask(t("dialog.convertColors"), [
      { label: t("dialog.keepColors"), value: "keep" },
      { label: t("dialog.convert"), value: "convert", primary: true },
    ]);
    if (answer === "convert") {
      convertFixedColors();
      repo.markUnsaved();
      repo.bump();
    }
  }
}

export async function saveDocument(as = false): Promise<boolean> {
  if (!repo.root) return false;
  let path = filePath();
  if (!path || as) {
    path = await platform.pickSavePath(path ?? `${repo.root.name || "projet"}.mdj`, [platform.MDJ_FILTER]);
    if (!path) return false;
    if (!/\.mdj$/i.test(path)) path += ".mdj";
  }
  await platform.writeText(path, serializeMdj(repo.root));
  repo.markSaved();
  setFilePath(path);
  addRecent(path);
  await platform.autosaveClear();
  repo.bump();
  toast(t("toast.saved"));
  return true;
}

/** Asks to save pending changes; false if the user cancelled. */
export async function confirmDiscard(): Promise<boolean> {
  if (!repo.dirty) return true;
  const answer = await ask(t("dialog.unsaved", { name: projectName() }), [
    { label: t("dialog.cancel"), value: "cancel" },
    { label: t("dialog.dontSave"), value: "discard" },
    { label: t("dialog.save"), value: "save", primary: true },
  ]);
  if (answer === "cancel") return false;
  if (answer === "save") return saveDocument();
  return true;
}

let autosaveTimer: number | undefined;
export function startAutosave(): void {
  clearInterval(autosaveTimer);
  autosaveTimer = window.setInterval(() => {
    if (repo.root && repo.dirty) platform.autosaveWrite(JSON.stringify({ path: filePath(), content: serializeMdj(repo.root) })).catch(console.error);
  }, 30_000);
}

export async function recoverAutosave(): Promise<boolean> {
  const saved = await platform.autosaveRead();
  if (!saved) return false;
  try {
    const { path, content } = JSON.parse(saved) as { path: string | null; content: string };
    const answer = await ask(t("dialog.recover"), [
      { label: t("dialog.cancel"), value: "no" },
      { label: t("dialog.ok"), value: "yes", primary: true },
    ]);
    await platform.autosaveClear();
    if (answer !== "yes") return false;
    loadRoot(parseMdj(content), path);
    // Restored content differs from disk: keep it marked as modified.
    repo.markUnsaved();
    repo.bump();
    return true;
  } catch (e) {
    reportError(e);
    return false;
  }
}
