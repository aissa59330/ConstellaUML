// Model Explorer: containment tree with search, sort, inline rename, keyboard
// navigation, context menu and drag & drop (re-parenting, drop on a diagram).
import { For, Show, createMemo, createSignal } from "solid-js";
import type { Element } from "../core/element";
import { meta } from "../core/meta/registry";
import { DIAGRAM_TYPES, addDiagram, addModelElement, moveToOwner, renameElement } from "../notation/uml";
import { stereotypeName } from "../notation/uml/text";
import { type MenuItem, register } from "./commands";
import { t } from "./i18n";
import { Icon, iconForType } from "./icons";
import { ContextMenu } from "./Menu";
import * as s from "./store";

const CHILD_FIELDS = [
  "ownedElements", "attributes", "operations", "receptions", "literals", "parameters", "templateParameters",
  "participants", "messages", "fragments", "operands", "nodes", "edges", "groups", "subpartitions", "inputs", "outputs",
  "regions", "vertices", "transitions", "connections", "triggers", "effects", "entryActivities", "doActivities", "exitActivities",
  "extensionPoints", "slots", "tags",
];

function childrenOf(el: Element): Element[] {
  const out: Element[] = [];
  for (const f of CHILD_FIELDS) {
    const v = el[f];
    if (Array.isArray(v)) for (const c of v) if (c && typeof c === "object" && c._type && !meta.isKindOf(c._type, "View")) out.push(c);
  }
  return out;
}

function label(el: Element, showSt: boolean): string {
  const name = el.name || (el._type === "UMLParameter" && el.direction === "return" ? "(return)" : "") || `(${el._type.replace(/^UML/, "")})`;
  const st = showSt ? stereotypeName(el.stereotype, (r) => s.repo.deref(r)) : "";
  return st ? `«${st}» ${name}` : name;
}

const ADDABLE: [string, string[]][] = [
  ["Project", ["UMLModel", "UMLPackage", "UMLProfile"]],
  [
    "UMLPackage",
    ["UMLPackage", "UMLModel", "UMLSubsystem", "UMLClass", "UMLInterface", "UMLEnumeration", "UMLDataType", "UMLPrimitiveType", "UMLSignal", "UMLActor", "UMLUseCase", "UMLComponent", "UMLArtifact", "UMLNode", "UMLObject", "UMLCollaboration", "UMLInteraction", "UMLActivity", "UMLStateMachine", "UMLInformationItem", "UMLStereotype", "UMLConstraint"],
  ],
  ["UMLEnumeration", ["UMLEnumerationLiteral", "UMLAttribute", "UMLOperation", "UMLConstraint"]],
  ["UMLInteraction", ["UMLLifeline", "UMLMessage", "UMLCombinedFragment", "UMLInteractionUse", "UMLStateInvariant"]],
  ["UMLActivity", ["UMLAction", "UMLObjectNode", "UMLActivityPartition"]],
  ["UMLStateMachine", ["UMLRegion"]],
  ["UMLUseCase", ["UMLExtensionPoint", "UMLAttribute", "UMLOperation"]],
  ["UMLClassifier", ["UMLAttribute", "UMLOperation", "UMLReception", "UMLTemplateParameter", "UMLPort", "UMLClass", "UMLInteraction", "UMLActivity", "UMLStateMachine", "UMLConstraint"]],
  ["UMLRegion", ["UMLState", "UMLPseudostate", "UMLFinalState"]],
  ["UMLState", ["UMLRegion"]],
  ["UMLCombinedFragment", ["UMLInteractionOperand"]],
  ["UMLInstance", ["UMLSlot"]],
  ["UMLAction", ["UMLInputPin", "UMLOutputPin"]],
  ["UMLOperation", ["UMLParameter"]],
];

function addableTypes(el: Element): string[] {
  const out = new Set<string>();
  for (const [base, types] of ADDABLE) if (meta.isKindOf(el._type, base)) for (const x of types) out.add(x);
  if (meta.isKindOf(el._type, "ExtensibleModel")) out.add("Tag");
  return [...out];
}

export const [expanded, setExpanded] = createSignal<Set<string>>(new Set());
// New / opened projects show their top-level packages expanded.
s.onProjectLoaded((root) => setExpanded(new Set([root._id, ...childrenOf(root).map((c) => c._id)])));
const [renaming, setRenaming] = createSignal<string | null>(null);

function setOpen(id: string, open: boolean): void {
  const next = new Set(expanded());
  if (open) next.add(id);
  else next.delete(id);
  setExpanded(next);
}

/** Expands all ancestors so that `el` becomes visible. */
export function revealInExplorer(el: Element): void {
  const next = new Set(expanded());
  let p = s.repo.parentOf(el);
  while (p) {
    next.add(p._id);
    p = s.repo.parentOf(p);
  }
  setExpanded(next);
  queueMicrotask(() => document.querySelector(`[data-explorer-id="${CSS.escape(el._id)}"]`)?.scrollIntoView({ block: "nearest" }));
}

interface Row {
  el: Element;
  depth: number;
  hasChildren: boolean;
}

export function Explorer() {
  const [query, setQuery] = createSignal("");
  const [menu, setMenu] = createSignal<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [optionsOpen, setOptionsOpen] = createSignal(false);
  const [dropTarget, setDropTarget] = createSignal<string | null>(null);
  let list!: HTMLDivElement;

  const rows = createMemo<Row[]>(() => {
    s.modelVersion();
    const root = s.repo.root;
    if (!root) return [];
    const q = query().trim().toLowerCase();
    const showSt = s.explorerShowStereotype();
    const byName = s.explorerSort() === "name";
    const sortKids = (kids: Element[]) => (byName ? [...kids].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "")) : kids);
    const out: Row[] = [];
    if (q) {
      // Flat list of matches with their path depth.
      const visit = (el: Element, depth: number) => {
        for (const c of sortKids(childrenOf(el))) {
          if (label(c, showSt).toLowerCase().includes(q)) out.push({ el: c, depth: 0, hasChildren: false });
          visit(c, depth + 1);
        }
      };
      visit(root, 0);
      return out;
    }
    const open = expanded();
    const visit = (el: Element, depth: number) => {
      const kids = childrenOf(el);
      out.push({ el, depth, hasChildren: kids.length > 0 });
      if (open.has(el._id) || depth === 0) for (const c of sortKids(kids)) visit(c, depth + 1);
    };
    visit(root, 0);
    return out;
  });

  const selectedIds = createMemo(() => new Set(s.selection().map((e) => e._id)));

  const activate = (el: Element) => {
    if (meta.isKindOf(el._type, "Diagram")) s.openDiagram(el._id);
  };

  const contextItems = (el: Element): MenuItem[] => {
    const types = addableTypes(el);
    const regs: MenuItem[] = [];
    if (types.length) {
      regs.push({
        label: "cmd.model.add",
        children: types.map((type) => {
          const id = `explorer:add-${type}`;
          register({
            id,
            label: type.replace(/^UML/, ""),
            run: () => {
              const target = s.selection()[0] ?? s.repo.root!;
              const created = addModelElement(s.repo, target, type);
              setOpen(target._id, true);
              s.select(created);
              setRenaming(created._id);
            },
          });
          return { cmd: id };
        }),
      });
    }
    if (meta.containerField(el._type, "UMLClassDiagram") || el._type === "Project") {
      regs.push({
        label: "cmd.model.addDiagram",
        children: DIAGRAM_TYPES.map(({ type }) => {
          const id = `explorer:add-diagram-${type}`;
          register({
            id,
            label: `diagram.${type}`,
            run: () => {
              const target = s.selection()[0] ?? s.repo.root!;
              const d = addDiagram(s.repo, target, type);
              setOpen(target._id, true);
              revealInExplorer(d);
              s.select(d);
              s.openDiagram(d._id);
            },
          });
          return { cmd: id };
        }),
      });
    }
    register({ id: "explorer:rename", label: "explorer.rename", run: () => setRenaming(s.selection()[0]?._id ?? null) });
    return [
      ...regs,
      { sep: true },
      { cmd: "explorer:rename" },
      { cmd: "edit:cut" },
      { cmd: "edit:copy" },
      { cmd: "edit:paste" },
      { cmd: "edit:delete-from-model" },
      { sep: true },
      { cmd: "edit:move-up" },
      { cmd: "edit:move-down" },
      { cmd: "edit:select-in-diagram" },
      { cmd: "file:export-fragment" },
    ];
  };

  const onKey = (e: KeyboardEvent) => {
    if (renaming()) return;
    const list = rows();
    const cur = s.selection()[0];
    const i = cur ? list.findIndex((r) => r.el === cur) : -1;
    const go = (j: number) => {
      const r = list[Math.max(0, Math.min(list.length - 1, j))];
      if (r) {
        s.select(r.el);
        queueMicrotask(() => document.querySelector(`[data-explorer-id="${CSS.escape(r.el._id)}"]`)?.scrollIntoView({ block: "nearest" }));
      }
    };
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i - 1);
    else if (e.key === "ArrowRight" && cur) {
      if (!expanded().has(cur._id) && childrenOf(cur).length) setOpen(cur._id, true);
      else go(i + 1);
    } else if (e.key === "ArrowLeft" && cur) {
      if (expanded().has(cur._id)) setOpen(cur._id, false);
      else {
        const p = s.repo.parentOf(cur);
        if (p) s.select(p);
      }
    } else if ((e.key === "Enter" || e.key === "F2") && cur && cur !== s.repo.root) {
      if (e.key === "Enter" && meta.isKindOf(cur._type, "Diagram") && e.ctrlKey) activate(cur);
      else setRenaming(cur._id);
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const commitRename = (el: Element, value: string) => {
    setRenaming(null);
    if (value === el.name || !value.trim()) return;
    try {
      if (meta.isKindOf(el._type, "UMLModelElement")) renameElement(s.repo, el, value);
      else s.repo.transact("Rename", (tx) => tx.set(el, "name", value.trim()));
    } catch (err) {
      s.reportError(err);
    }
    list.focus();
  };

  return (
    <section class="panel explorer">
      <header class="panel-header">
        <span>{t("panel.explorer")}</span>
        <div class="panel-header-actions">
          <button class="icon-button" aria-label="Options" onClick={() => setOptionsOpen(!optionsOpen())}>
            <Icon name="more" />
          </button>
          <Show when={optionsOpen()}>
            <div class="dropdown right" onMouseLeave={() => setOptionsOpen(false)}>
              <div class="menu">
                <button class="menu-item" onClick={() => (s.setExplorerSort("added"), setOptionsOpen(false))}>
                  <span class="menu-check">{s.explorerSort() === "added" && <Icon name="check" size={12} />}</span>
                  <span class="menu-label">{t("explorer.sortAdded")}</span>
                </button>
                <button class="menu-item" onClick={() => (s.setExplorerSort("name"), setOptionsOpen(false))}>
                  <span class="menu-check">{s.explorerSort() === "name" && <Icon name="check" size={12} />}</span>
                  <span class="menu-label">{t("explorer.sortName")}</span>
                </button>
                <div class="menu-sep" />
                <button class="menu-item" onClick={() => (s.setExplorerShowStereotype(!s.explorerShowStereotype()), setOptionsOpen(false))}>
                  <span class="menu-check">{s.explorerShowStereotype() && <Icon name="check" size={12} />}</span>
                  <span class="menu-label">{t("explorer.showStereotype")}</span>
                </button>
                <div class="menu-sep" />
                <button
                  class="menu-item"
                  onClick={() => {
                    setExpanded(new Set([...s.repo.all()].filter((e) => childrenOf(e).length).map((e) => e._id)));
                    setOptionsOpen(false);
                  }}
                >
                  <span class="menu-check" />
                  <span class="menu-label">{t("explorer.expandAll")}</span>
                </button>
                <button class="menu-item" onClick={() => (setExpanded(new Set<string>()), setOptionsOpen(false))}>
                  <span class="menu-check" />
                  <span class="menu-label">{t("explorer.collapseAll")}</span>
                </button>
              </div>
            </div>
          </Show>
        </div>
      </header>
      <div class="search-box">
        <Icon name="search" />
        <input type="search" placeholder={t("explorer.search")} value={query()} onInput={(e) => setQuery(e.currentTarget.value)} />
      </div>
      <div class="panel-body tree" ref={list} tabIndex={0} role="tree" onKeyDown={onKey}>
        <For each={rows()}>
          {(row) => (
            <div
              class="tree-row"
              role="treeitem"
              data-explorer-id={row.el._id}
              aria-selected={selectedIds().has(row.el._id)}
              aria-expanded={row.hasChildren ? expanded().has(row.el._id) || row.depth === 0 : undefined}
              classList={{ selected: selectedIds().has(row.el._id), "drop-target": dropTarget() === row.el._id }}
              style={{ "padding-left": `${6 + row.depth * 14}px` }}
              draggable={row.el !== s.repo.root}
              onClick={(e) => {
                list.focus();
                if (e.shiftKey || e.ctrlKey) {
                  const cur = s.selection().filter((x) => !meta.isKindOf(x._type, "View"));
                  s.select(cur.includes(row.el) ? cur.filter((x) => x !== row.el) : [...cur, row.el]);
                } else s.select(row.el);
              }}
              onDblClick={() => (meta.isKindOf(row.el._type, "Diagram") ? activate(row.el) : setOpen(row.el._id, !expanded().has(row.el._id)))}
              onContextMenu={(e) => {
                e.preventDefault();
                if (!selectedIds().has(row.el._id)) s.select(row.el);
                setMenu({ x: e.clientX, y: e.clientY, items: contextItems(row.el) });
              }}
              onDragStart={(e) => {
                e.dataTransfer!.setData("application/x-constella-element", row.el._id);
                e.dataTransfer!.effectAllowed = "copyMove";
              }}
              onDragOver={(e) => {
                if (e.dataTransfer?.types.includes("application/x-constella-element")) {
                  e.preventDefault();
                  setDropTarget(row.el._id);
                }
              }}
              onDragLeave={() => dropTarget() === row.el._id && setDropTarget(null)}
              onDrop={(e) => {
                e.preventDefault();
                setDropTarget(null);
                const id = e.dataTransfer?.getData("application/x-constella-element");
                const el = id ? s.repo.get(id) : undefined;
                if (!el || el === row.el) return;
                try {
                  moveToOwner(s.repo, el, row.el);
                  setOpen(row.el._id, true);
                } catch (err) {
                  s.reportError(err);
                }
              }}
            >
              <span
                class="tree-twisty"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(row.el._id, !expanded().has(row.el._id));
                }}
              >
                <Show when={row.hasChildren && row.depth > 0}>
                  <Icon name={expanded().has(row.el._id) ? "chevronDown" : "chevronRight"} size={12} />
                </Show>
              </span>
              <Icon name={iconForType(row.el._type)} />
              <Show when={renaming() === row.el._id} fallback={<span class="ellipsis">{label(row.el, s.explorerShowStereotype())}</span>}>
                <input
                  class="rename-input"
                  value={row.el.name ?? ""}
                  ref={(el) => queueMicrotask(() => (el.focus(), el.select()))}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") commitRename(row.el, e.currentTarget.value);
                    if (e.key === "Escape") (setRenaming(null), list.focus());
                  }}
                  onBlur={(e) => renaming() === row.el._id && commitRename(row.el, e.currentTarget.value)}
                  onClick={(e) => e.stopPropagation()}
                />
              </Show>
            </div>
          )}
        </For>
      </div>
      <Show when={menu()}>{(m) => <ContextMenu x={m().x} y={m().y} items={m().items} onClose={() => setMenu(null)} />}</Show>
    </section>
  );
}
