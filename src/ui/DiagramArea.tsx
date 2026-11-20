// Center area: diagram tabs, the canvas editor, quick-edit overlay and minimap.
import { For, Show, createEffect, createSignal, on, onCleanup, onMount } from "solid-js";
import type { Element } from "../core/element";
import { meta } from "../core/meta/registry";
import { DiagramEditor } from "../editor/DiagramEditor";
import {
  type FeatureKind,
  addFeature,
  deleteFromModel,
  editAttribute,
  editFlow,
  editMessage,
  editOperation,
  editTransition,
  formatAttribute,
  formatOperation,
  moveInParent,
  renameElement,
  setField,
} from "../notation/uml";
import type { Rect } from "../render/graphics";
import { transitionLabel } from "../notation/uml/phase2-views";
import { setZoomTick, zoomTick } from "./Chrome";
import { DIAGRAM_CONTEXT_MENU, applyPainter, dropModelOnDiagram, setActiveEditor } from "./commands";
import { t } from "./i18n";
import { Icon } from "./icons";
import { ContextMenu } from "./Menu";
import * as s from "./store";

interface QuickEditState {
  view: Element;
  rect: Rect;
  text: string;
  multiline: boolean;
}

const isFeatureView = (v: Element) => meta.isKindOf(v._type, "UMLFeatureView");

/** What a quick edit on `view` edits, and its current text. */
function quickEditTarget(view: Element): { text: string; multiline: boolean } | null {
  const repo = s.repo;
  const model = repo.deref(view.model);
  const resolve = (r: unknown) => repo.deref(r);
  const nameExpr = (m: Element) => `${typeof m.stereotype === "string" && m.stereotype ? `<<${m.stereotype}>> ` : ""}${m.name ?? ""}`;
  if (["UMLNoteView", "UMLTextView", "RectangleView", "RoundRectView", "EllipseView"].includes(view._type)) return { text: view.text ?? "", multiline: true };
  if (view._type === "HyperlinkView") return { text: view.url ?? "", multiline: false };
  if (view._type === "EdgeLabelView") {
    const m = repo.deref(view.model);
    if (!m) return null;
    if (m._type === "UMLAssociationEnd") {
      const host = repo.deref(view.hostEdge);
      const isMult = host && (host.tailMultiplicityLabel?.$ref === view._id || host.headMultiplicityLabel?.$ref === view._id);
      return { text: isMult ? m.multiplicity ?? "" : m.name ?? "", multiline: false };
    }
    return { text: m.name ?? "", multiline: false };
  }
  if (!model) return null;
  if (view._type === "UMLTransitionView") return { text: transitionLabel(model), multiline: false };
  if (view._type === "UMLSeqMessageView") return { text: `${model.guard ? `[${model.guard}] ` : ""}${model.assignmentTarget ? `${model.assignmentTarget} = ` : ""}${model.name ?? ""}${model.arguments ? `(${model.arguments})` : ""}`, multiline: false };
  if (meta.isKindOf(model._type, "UMLActivityEdge")) return { text: `${model.guard ? `[${model.guard}] ` : ""}${model.name ?? ""}`, multiline: false };
  if (view._type === "UMLInteractionOperandView") return { text: model.guard ?? "", multiline: false };
  if (view._type === "UMLStateInvariantView") return { text: model.invariant ?? "", multiline: false };
  if (view._type === "UMLAttributeView") return { text: formatAttribute(model, resolve, { showVisibility: true, showType: true, showMultiplicity: true, showProperty: false, showOperationSignature: true }), multiline: false };
  if (view._type === "UMLOperationView") return { text: formatOperation(model, resolve, { showVisibility: true, showType: true, showMultiplicity: true, showProperty: false, showOperationSignature: true }), multiline: false };
  return { text: nameExpr(model), multiline: false };
}

function applyQuickEdit(view: Element, text: string): void {
  const repo = s.repo;
  const model = repo.deref(view.model);
  if (["UMLNoteView", "UMLTextView", "RectangleView", "RoundRectView", "EllipseView"].includes(view._type)) return setField(repo, view, "text", text);
  if (view._type === "HyperlinkView") return setField(repo, view, "url", text.trim());
  if (view._type === "EdgeLabelView") {
    const host = repo.deref(view.hostEdge);
    if (model?._type === "UMLAssociationEnd" && host && (host.tailMultiplicityLabel?.$ref === view._id || host.headMultiplicityLabel?.$ref === view._id)) return setField(repo, model, "multiplicity", text.trim());
    if (model) return setField(repo, model, "name", text.trim());
    return;
  }
  if (!model) return;
  if (view._type === "UMLTransitionView") return editTransition(repo, model, text);
  if (view._type === "UMLSeqMessageView") return editMessage(repo, model, text);
  if (meta.isKindOf(model._type, "UMLActivityEdge")) return editFlow(repo, model, text);
  if (view._type === "UMLInteractionOperandView") return setField(repo, model, "guard", text.trim());
  if (view._type === "UMLStateInvariantView") return setField(repo, model, "invariant", text.trim());
  if (view._type === "UMLAttributeView") return editAttribute(repo, model, text);
  if (view._type === "UMLOperationView") return editOperation(repo, model, text);
  if (meta.isKindOf(view._type, "EdgeView")) return setField(repo, model, "name", text.trim());
  if (text.trim()) renameElement(repo, model, text);
}

export function DiagramArea() {
  let container!: HTMLDivElement;
  let canvas!: HTMLCanvasElement;
  let minimap!: HTMLCanvasElement;
  let editor: DiagramEditor;
  const [qe, setQe] = createSignal<QuickEditState | null>(null);
  const [qeError, setQeError] = createSignal<string | null>(null);
  const [menu, setMenu] = createSignal<{ x: number; y: number } | null>(null);
  const viewports = new Map<string, { zoom: number; scroll: { x: number; y: number } }>();

  onMount(() => {
    editor = new DiagramEditor(canvas, {
      repo: s.repo,
      diagram: () => s.activeDiagram(),
      theme: s.theme,
      selection: s.selection,
      select: (els) => s.select(els),
      tool: s.tool,
      setTool: s.setTool,
      toolSticky: s.toolSticky,
      showGrid: s.showGrid,
      snapToGrid: s.snapToGrid,
      grid: s.GRID,
      onError: s.reportError,
      onQuickEdit: (view, _target, rect) => {
        const target = quickEditTarget(view);
        if (!target) return;
        setQeError(null);
        setQe({ view, rect, ...target });
      },
      onContextMenu: (x, y) => setMenu({ x, y }),
      onViewportChange: () => setZoomTick(zoomTick() + 1),
      onFormatPainter: applyPainter,
    });
    setActiveEditor(editor);
    onCleanup(() => {
      editor.dispose();
      setActiveEditor(null);
    });
  });

  // Redraw on any change the canvas depends on.
  createEffect(() => {
    s.modelVersion();
    s.selection();
    s.theme();
    s.showGrid();
    s.tool();
    editor?.requestRender();
    if (s.panels().minimap) queueMicrotask(() => minimap && editor?.thumbnail(minimap));
  });
  createEffect(() => {
    zoomTick();
    if (s.panels().minimap && minimap) editor?.thumbnail(minimap);
  });

  // Keep one viewport per diagram tab.
  createEffect(
    on(s.activeDiagramId, (id, prev) => {
      if (!editor) return;
      if (prev) viewports.set(prev, { zoom: editor.zoom, scroll: { ...editor.scroll } });
      const vp = id ? viewports.get(id) : undefined;
      editor.zoom = vp?.zoom ?? 1;
      editor.scroll = vp?.scroll ?? { x: -40, y: -40 };
      setQe(null);
      editor.requestRender();
      setZoomTick(zoomTick() + 1);
    }),
  );

  const commit = (keepOpen?: FeatureKind) => {
    const state = qe();
    if (!state) return;
    const value = (document.getElementById("quick-edit-input") as HTMLTextAreaElement | null)?.value ?? state.text;
    try {
      if (value !== state.text) applyQuickEdit(state.view, value);
      setQe(null);
      if (keepOpen) addAndEdit(state.view, keepOpen);
      canvas.focus();
    } catch (e) {
      setQeError(e instanceof Error ? e.message : String(e));
    }
  };

  /** Ctrl+Enter / Ctrl+Shift+Enter: add a feature and edit it right away. */
  const addAndEdit = (fromView: Element, kind: FeatureKind) => {
    const repo = s.repo;
    let owner: Element | undefined;
    let after: number | undefined;
    if (isFeatureView(fromView)) {
      const feature = repo.deref(fromView.model);
      owner = feature && repo.parentOf(feature);
      if (feature && owner) {
        if (feature._type === "UMLOperation" && kind !== "operations") after = undefined;
        else after = (owner[kind] ?? []).indexOf(feature);
      }
    } else owner = repo.deref(fromView.model);
    if (!owner || !meta.isKindOf(owner._type, "UMLClassifier")) return;
    if (kind === "attributes" && owner._type === "UMLEnumeration" && fromView._type !== "UMLAttributeView") kind = "literals";
    const el = addFeature(repo, owner, kind, undefined, after !== undefined && after >= 0 ? after : undefined);
    editor.render();
    const fv = repo.viewsOf(el._id).find((v) => isFeatureView(v) && repo.diagramOf(v)?._id === s.activeDiagramId());
    if (fv) {
      s.select([fv]);
      editor.startQuickEdit(fv);
    }
  };

  const onQeKey = (e: KeyboardEvent) => {
    const state = qe();
    if (!state) return;
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      setQe(null);
      canvas.focus();
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      commit(e.shiftKey ? "operations" : "attributes");
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      commit();
    } else if (isFeatureView(state.view) && (e.ctrlKey || e.metaKey) && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      commit();
      const f = s.repo.deref(state.view.model);
      if (f) moveInParent(s.repo, f, e.key === "ArrowUp" ? -1 : 1);
    } else if (isFeatureView(state.view) && (e.ctrlKey || e.metaKey) && e.key === "Delete") {
      e.preventDefault();
      setQe(null);
      const f = s.repo.deref(state.view.model);
      if (f) deleteFromModel(s.repo, [f]);
      canvas.focus();
    }
  };

  const onCanvasKey = (e: KeyboardEvent) => {
    if (qe()) return;
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[e.key] && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      editor.nudge(arrows[e.key][0], arrows[e.key][1], e.shiftKey);
    } else if (e.key === "Enter" && !e.ctrlKey) {
      const v = s.selection()[0];
      if (v && meta.isKindOf(v._type, "View")) {
        e.preventDefault();
        editor.startQuickEdit(v);
      }
    } else if (e.key === "Escape") {
      s.setTool(null);
      s.select([]);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const id = e.dataTransfer?.getData("application/x-constella-element");
    if (!id) return;
    const p = editor.toDiagram(e.clientX, e.clientY);
    try {
      dropModelOnDiagram(id, Math.round(p.x), Math.round(p.y));
    } catch (err) {
      s.reportError(err);
    }
  };

  const onMinimap = (e: PointerEvent) => {
    const r = minimap.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      const p = editor.minimapToDiagram(minimap, ev.clientX - r.left, ev.clientY - r.top);
      if (p) editor.scrollTo(p);
    };
    move(e);
    minimap.setPointerCapture(e.pointerId);
    minimap.onpointermove = move;
    minimap.onpointerup = () => (minimap.onpointermove = null);
  };

  return (
    <div class="diagram-area">
      <div class="tabs" role="tablist">
        <For each={s.openDiagrams()}>
          {(id) => {
            const d = () => (s.modelVersion(), s.repo.get(id));
            return (
              <Show when={d()}>
                <div
                  class="tab"
                  role="tab"
                  aria-selected={s.activeDiagramId() === id}
                  classList={{ active: s.activeDiagramId() === id }}
                  onClick={() => s.setActiveDiagramId(id)}
                  onAuxClick={(e) => e.button === 1 && s.closeDiagram(id)}
                  title={d()!.name}
                >
                  <Icon name="diagram" />
                  <span class="ellipsis">{d()!.name}</span>
                  <button
                    class="tab-close"
                    aria-label={t("cmd.view.closeDiagram")}
                    onClick={(e) => {
                      e.stopPropagation();
                      s.closeDiagram(id);
                    }}
                  >
                    <Icon name="close" size={12} />
                  </button>
                </div>
              </Show>
            );
          }}
        </For>
      </div>
      <div class="canvas-host" ref={container} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
        <canvas ref={canvas} tabIndex={0} class="diagram-canvas" onKeyDown={onCanvasKey} aria-label={s.activeDiagram()?.name ?? ""} />
        <Show when={!s.activeDiagram()}>
          <div class="empty-state">
            <img src="/logo.svg" width="72" height="72" alt="" />
            <p>{t("app.name")}</p>
            <small>Aïssa Ouameur</small>
            <small>Ctrl+N · Ctrl+O · Ctrl+Shift+P</small>
          </div>
        </Show>
        <Show when={qe()}>
          {(state) => (
            <div
              class="quick-edit"
              style={{
                left: `${Math.max(0, state().rect.x)}px`,
                top: `${Math.max(0, state().rect.y)}px`,
                width: `${Math.max(220, state().rect.w)}px`,
              }}
            >
              <textarea
                id="quick-edit-input"
                ref={(el) =>
                  queueMicrotask(() => {
                    el.focus();
                    el.select();
                  })
                }
                rows={state().multiline ? Math.max(3, state().text.split("\n").length) : 1}
                classList={{ error: !!qeError() }}
                value={state().text}
                spellcheck={false}
                onKeyDown={onQeKey}
                onInput={() => setQeError(null)}
                onBlur={() => qe() && !qeError() && commit()}
              />
              <div class="quick-edit-hint">{qeError() ?? t("quickedit.hint")}</div>
            </div>
          )}
        </Show>
        <Show when={s.panels().minimap && s.activeDiagram()}>
          <canvas ref={minimap} class="minimap" onPointerDown={onMinimap} aria-label={t("cmd.view.minimap")} />
        </Show>
      </div>
      <Show when={menu()}>{(m) => <ContextMenu x={m().x} y={m().y} items={DIAGRAM_CONTEXT_MENU} onClose={() => setMenu(null)} />}</Show>
    </div>
  );
}
