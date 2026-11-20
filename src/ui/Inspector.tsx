// Editors panel: Properties (model), Style (views) and Documentation (Markdown).
import MarkdownIt from "markdown-it";
import { For, Match, Show, Switch, createMemo, createSignal } from "solid-js";
import type { Element } from "../core/element";
import { isRef, ref } from "../core/element";
import { type FieldDef, meta } from "../core/meta/registry";
import { type FeatureKind, addFeature, deleteFromModel, editAttribute, editOperation, moveInParent, renameElement, setField, setViewField } from "../notation/uml";
import { formatAttribute, formatOperation, formatParameter } from "../notation/uml/text";
import { resolveColor } from "../render/colors";
import { formatFont, parseFont } from "../render/graphics";
import { t } from "./i18n";
import { Icon, iconForType } from "./icons";
import * as s from "./store";

const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

const HIDDEN_FIELDS = new Set(["documentation", "name"]);

function TextInput(props: { value: string; onCommit: (v: string) => void; multiline?: boolean; placeholder?: string; list?: string }) {
  const commit = (el: HTMLInputElement | HTMLTextAreaElement) => {
    if (el.value !== props.value) {
      try {
        props.onCommit(el.value);
      } catch (e) {
        s.reportError(e);
        el.value = props.value;
      }
    }
  };
  return props.multiline ? (
    <textarea class="field-input" rows={3} value={props.value} placeholder={props.placeholder} onBlur={(e) => commit(e.currentTarget)} />
  ) : (
    <input
      class="field-input"
      value={props.value}
      placeholder={props.placeholder}
      list={props.list}
      onBlur={(e) => commit(e.currentTarget)}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit(e.currentTarget);
        if (e.key === "Escape") e.currentTarget.value = props.value;
        e.stopPropagation();
      }}
    />
  );
}

function candidatesFor(refType: string | undefined): Element[] {
  s.modelVersion();
  return [...s.repo.all()].filter((e) => !meta.isKindOf(e._type, "View") && (!refType || meta.isKindOf(e._type, refType))).sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
}

function FieldEditor(props: { el: Element; field: FieldDef }) {
  const value = () => (s.modelVersion(), props.el[props.field.name] ?? props.field.default);
  const set = (v: unknown) => setField(s.repo, props.el, props.field.name, v);
  return (
    <Switch fallback={<TextInput value={String(value() ?? "")} onCommit={set} />}>
      <Match when={props.field.kind === "boolean"}>
        <input type="checkbox" class="field-check" checked={!!value()} onChange={(e) => set(e.currentTarget.checked)} />
      </Match>
      <Match when={props.field.kind === "enum"}>
        <select class="field-input" value={String(value())} onChange={(e) => set(typeof props.field.default === "number" ? Number(e.currentTarget.value) : e.currentTarget.value)}>
          <For each={props.field.options}>{(o) => <option value={String(o)}>{String(o)}</option>}</For>
        </select>
      </Match>
      <Match when={props.field.kind === "text"}>
        <TextInput multiline value={String(value() ?? "")} onCommit={set} />
      </Match>
      <Match when={props.field.kind === "number" || props.field.kind === "integer"}>
        <input type="number" class="field-input" value={Number(value() ?? 0)} onChange={(e) => set(Number(e.currentTarget.value))} />
      </Match>
      <Match when={props.field.kind === "typeRef"}>
        <TypeRefEditor el={props.el} field={props.field} />
      </Match>
      <Match when={props.field.kind === "ref"}>
        <select class="field-input" value={isRef(value()) ? (value() as { $ref: string }).$ref : ""} onChange={(e) => set(e.currentTarget.value ? ref(e.currentTarget.value) : undefined)}>
          <option value="">—</option>
          <For each={candidatesFor(props.field.refType)}>{(c) => <option value={c._id}>{c.name || c._type}</option>}</For>
        </select>
      </Match>
    </Switch>
  );
}

/** Type: free text (stored as string) or one of the model's classifiers (stored as a reference). */
function TypeRefEditor(props: { el: Element; field: FieldDef }) {
  const listId = `types-${props.field.name}`;
  const current = () => {
    s.modelVersion();
    const v = props.el[props.field.name];
    return isRef(v) ? s.repo.deref(v)?.name ?? "" : String(v ?? "");
  };
  return (
    <>
      <TextInput
        value={current()}
        list={listId}
        onCommit={(text) => {
          const match = candidatesFor(props.field.refType).filter((c) => c.name === text.trim());
          setField(s.repo, props.el, props.field.name, match.length === 1 && props.field.refType !== "UMLStereotype" ? ref(match[0]) : text.trim());
        }}
      />
      <datalist id={listId}>
        <For each={candidatesFor(props.field.refType)}>{(c) => <option value={c.name} />}</For>
      </datalist>
    </>
  );
}

function FeatureList(props: { owner: Element; kind: FeatureKind | "parameters"; title: string }) {
  const items = () => (s.modelVersion(), (props.owner[props.kind] ?? []) as Element[]);
  const resolve = (r: unknown) => s.repo.deref(r);
  const text = (f: Element) =>
    props.kind === "attributes"
      ? formatAttribute(f, resolve, { showVisibility: true, showType: true, showMultiplicity: true, showProperty: false, showOperationSignature: true })
      : props.kind === "operations"
        ? formatOperation(f, resolve, { showVisibility: true, showType: true, showMultiplicity: true, showProperty: false, showOperationSignature: true })
        : props.kind === "parameters"
          ? formatParameter(f, resolve)
          : f.name ?? "";
  const commit = (f: Element, v: string) => {
    if (props.kind === "attributes") editAttribute(s.repo, f, v);
    else if (props.kind === "operations") editOperation(s.repo, f, v);
    else renameElement(s.repo, f, v);
  };
  return (
    <div class="feature-list">
      <div class="section-title">
        <span>{props.title}</span>
        <Show when={props.kind !== "parameters"}>
          <button class="icon-button" title={t("props.add")} aria-label={t("props.add")} onClick={() => addFeature(s.repo, props.owner, props.kind as FeatureKind)}>
            <Icon name="plus" />
          </button>
        </Show>
      </div>
      <For each={items()}>
        {(f) => (
          <div class="feature-row" classList={{ selected: s.isSelected(f._id) }}>
            <Icon name={iconForType(f._type)} />
            <TextInput value={text(f)} onCommit={(v) => commit(f, v)} />
            <button class="icon-button" aria-label={t("cmd.edit.moveUp")} onClick={() => moveInParent(s.repo, f, -1)}>
              <Icon name="up" />
            </button>
            <button class="icon-button" aria-label={t("cmd.edit.moveDown")} onClick={() => moveInParent(s.repo, f, 1)}>
              <Icon name="down" />
            </button>
            <button class="icon-button" aria-label={t("cmd.edit.deleteFromModel")} onClick={() => deleteFromModel(s.repo, [f])}>
              <Icon name="trash" />
            </button>
          </div>
        )}
      </For>
    </div>
  );
}

function PropertyGrid(props: { el: Element }) {
  const fields = createMemo(() => meta.fields(props.el._type).filter((f) => f.editable && !HIDDEN_FIELDS.has(f.name)));
  return (
    <div class="prop-grid">
      <label class="prop-label">name</label>
      <TextInput
        value={(s.modelVersion(), props.el.name ?? "")}
        onCommit={(v) => (meta.isKindOf(props.el._type, "UMLModelElement") ? renameElement(s.repo, props.el, v) : setField(s.repo, props.el, "name", v))}
      />
      <For each={fields()}>
        {(f) => (
          <>
            <label class="prop-label" title={f.name}>
              {f.name}
            </label>
            <FieldEditor el={props.el} field={f} />
          </>
        )}
      </For>
    </div>
  );
}

function Properties() {
  const target = createMemo(() => {
    const sel = s.selection();
    if (sel.length !== 1) return null;
    return s.modelOf(sel[0]) ?? (meta.isKindOf(sel[0]._type, "View") ? null : sel[0]);
  });
  return (
    <Show when={target()} fallback={<p class="empty-hint">{s.selection().length > 1 ? t("props.multiple", { n: s.selection().length }) : t("props.none")}</p>}>
      {(el) => (
        <div class="properties">
          <div class="prop-type">
            <Icon name={iconForType(el()._type)} />
            {el()._type}
          </div>
          <PropertyGrid el={el()} />
          <Show when={el()._type === "UMLAssociation"}>
            <For each={["end1", "end2"] as const}>
              {(end) => (
                <Show when={el()[end]}>
                  <div class="section-title">
                    <span>
                      {end} → {s.repo.deref(el()[end].reference)?.name ?? "?"}
                    </span>
                  </div>
                  <PropertyGrid el={el()[end]} />
                </Show>
              )}
            </For>
          </Show>
          <Show when={meta.isKindOf(el()._type, "UMLEnumeration")}>
            <FeatureList owner={el()} kind="literals" title={t("props.literals")} />
          </Show>
          <Show when={meta.isKindOf(el()._type, "UMLClassifier")}>
            <FeatureList owner={el()} kind="attributes" title={t("props.attributes")} />
            <FeatureList owner={el()} kind="operations" title={t("props.operations")} />
          </Show>
          <Show when={el()._type === "UMLOperation"}>
            <FeatureList owner={el()} kind="parameters" title={t("props.parameters")} />
          </Show>
        </div>
      )}
    </Show>
  );
}

function ColorSwatch(props: { field: "fillColor" | "lineColor" | "fontColor"; views: Element[] }) {
  const value = () => (s.modelVersion(), props.views[0]?.[props.field] ?? meta.defaultOf(props.views[0]?._type ?? "View", props.field));
  return (
    <button class="swatch-button" onClick={() => s.setDialog({ kind: "color", field: props.field })} title={String(value())}>
      <span class="swatch" style={{ background: resolveColor(String(value()), s.theme()) }} />
      <span class="ellipsis">{String(value())}</span>
    </button>
  );
}

function Style() {
  const views = createMemo(() => s.selection().filter((e) => meta.isKindOf(e._type, "View")));
  const has = (f: string) => views().some((v) => meta.field(v._type, f));
  const flag = (f: string) => views().every((v) => !!(v[f] ?? meta.defaultOf(v._type, f)));
  const font = () => (s.modelVersion(), parseFont(views()[0]?.font));
  const setFont = (patch: Partial<ReturnType<typeof parseFont>>) => setViewField(s.repo, views(), "font", formatFont({ ...font(), ...patch }), "Font");
  const flags: [string, string][] = [
    ["showShadow", "cmd.format.shadow"],
    ["autoResize", "cmd.format.autoResize"],
    ["wordWrap", "cmd.format.wordWrap"],
    ["showVisibility", "cmd.format.showVisibility"],
    ["showNamespace", "cmd.format.showNamespace"],
    ["showProperty", "cmd.format.showProperty"],
    ["showType", "cmd.format.showType"],
    ["showMultiplicity", "cmd.format.showMultiplicity"],
    ["showOperationSignature", "cmd.format.showSignature"],
    ["suppressAttributes", "cmd.format.suppressAttributes"],
    ["suppressOperations", "cmd.format.suppressOperations"],
    ["suppressLiterals", "cmd.format.suppressLiterals"],
  ];
  return (
    <Show when={views().length} fallback={<p class="empty-hint">{t("props.none")}</p>}>
      <div class="prop-grid">
        <label class="prop-label">{t("cmd.format.fillColor").replace("…", "")}</label>
        <ColorSwatch field="fillColor" views={views()} />
        <label class="prop-label">{t("cmd.format.lineColor").replace("…", "")}</label>
        <ColorSwatch field="lineColor" views={views()} />
        <label class="prop-label">{t("font.title")}</label>
        <ColorSwatch field="fontColor" views={views()} />
        <label class="prop-label">{t("font.family")}</label>
        <select class="field-input" value={font().family} onChange={(e) => setFont({ family: e.currentTarget.value })}>
          <For each={["Arial", "Helvetica", "Liberation Sans", "DejaVu Sans", "Noto Sans", "Inter", "Times New Roman", "Courier New", "JetBrains Mono"]}>{(f) => <option value={f}>{f}</option>}</For>
        </select>
        <label class="prop-label">{t("font.size")}</label>
        <div class="inline-controls">
          <input type="number" class="field-input" min="6" max="72" value={font().size} onChange={(e) => setFont({ size: Number(e.currentTarget.value) || 13 })} />
          <button class="toggle" classList={{ on: font().bold }} onClick={() => setFont({ bold: !font().bold })} aria-pressed={font().bold}>
            <b>B</b>
          </button>
          <button class="toggle" classList={{ on: font().italic }} onClick={() => setFont({ italic: !font().italic })} aria-pressed={font().italic}>
            <i>I</i>
          </button>
        </div>
        <Show when={has("lineStyle")}>
          <label class="prop-label">{t("cmd.format.lineStyle")}</label>
          <select class="field-input" value={String(views().find((v) => meta.field(v._type, "lineStyle"))?.lineStyle ?? 0)} onChange={(e) => setViewField(s.repo, views().filter((v) => meta.field(v._type, "lineStyle")), "lineStyle", Number(e.currentTarget.value))}>
            <option value="0">{t("cmd.format.lineRectilinear")}</option>
            <option value="1">{t("cmd.format.lineOblique")}</option>
            <option value="2">{t("cmd.format.lineRoundRect")}</option>
            <option value="3">{t("cmd.format.lineCurve")}</option>
          </select>
        </Show>
        <Show when={has("stereotypeDisplay")}>
          <label class="prop-label">{t("cmd.format.stereotypeDisplay")}</label>
          <select class="field-input" value={views().find((v) => meta.field(v._type, "stereotypeDisplay"))?.stereotypeDisplay ?? "label"} onChange={(e) => setViewField(s.repo, views().filter((v) => meta.field(v._type, "stereotypeDisplay")), "stereotypeDisplay", e.currentTarget.value)}>
            <For each={["none", "label", "decoration", "decoration-label", "icon", "icon-label"]}>{(o) => <option value={o}>{o}</option>}</For>
          </select>
        </Show>
      </div>
      <div class="flag-list">
        <For each={flags.filter(([f]) => has(f))}>
          {([f, label]) => (
            <label class="flag">
              <input type="checkbox" checked={(s.modelVersion(), flag(f))} onChange={(e) => setViewField(s.repo, views().filter((v) => meta.field(v._type, f)), f, e.currentTarget.checked)} />
              {t(label)}
            </label>
          )}
        </For>
      </div>
    </Show>
  );
}

function Documentation() {
  const [preview, setPreview] = createSignal(false);
  const target = createMemo(() => {
    const sel = s.selection();
    if (sel.length !== 1) return null;
    const m = s.modelOf(sel[0]);
    return m && meta.field(m._type, "documentation") ? m : null;
  });
  return (
    <Show when={target()} fallback={<p class="empty-hint">{t("props.none")}</p>}>
      {(el) => (
        <div class="documentation">
          <div class="segmented">
            <button classList={{ on: !preview() }} onClick={() => setPreview(false)}>
              {t("doc.edit")}
            </button>
            <button classList={{ on: preview() }} onClick={() => setPreview(true)}>
              {t("doc.preview")}
            </button>
          </div>
          <Show
            when={preview()}
            fallback={
              <textarea
                class="doc-editor"
                placeholder={t("doc.placeholder")}
                value={(s.modelVersion(), el().documentation ?? "")}
                onBlur={(e) => e.currentTarget.value !== (el().documentation ?? "") && setField(s.repo, el(), "documentation", e.currentTarget.value)}
                onKeyDown={(e) => e.stopPropagation()}
              />
            }
          >
            <div class="markdown" innerHTML={(s.modelVersion(), md.render(el().documentation ?? ""))} />
          </Show>
        </div>
      )}
    </Show>
  );
}

export function Inspector() {
  const [tab, setTab] = createSignal<"props" | "style" | "doc">("props");
  return (
    <section class="panel inspector">
      <div class="panel-tabs" role="tablist">
        <button role="tab" aria-selected={tab() === "props"} classList={{ on: tab() === "props" }} onClick={() => setTab("props")}>
          {t("panel.properties")}
        </button>
        <button role="tab" aria-selected={tab() === "style"} classList={{ on: tab() === "style" }} onClick={() => setTab("style")}>
          {t("panel.style")}
        </button>
        <button role="tab" aria-selected={tab() === "doc"} classList={{ on: tab() === "doc" }} onClick={() => setTab("doc")}>
          {t("panel.documentation")}
        </button>
      </div>
      <div class="panel-body scroll">
        <Switch>
          <Match when={tab() === "props"}>
            <Properties />
          </Match>
          <Match when={tab() === "style"}>
            <Style />
          </Match>
          <Match when={tab() === "doc"}>
            <Documentation />
          </Match>
        </Switch>
      </div>
    </section>
  );
}
