import { For, Match, Show, Switch, createMemo, createSignal } from "solid-js";
import type { Element } from "../core/element";
import { meta } from "../core/meta/registry";
import { setViewField } from "../notation/uml";
import { boundsOf } from "../notation/views";
import { paletteRows, resolveColor } from "../render/colors";
import { formatFont, parseFont } from "../render/graphics";
import { activeEditor, allCommands, execute, shortcutLabel } from "./commands";
import { type ImageFormat, type ImageOptions, copyDiagramImage, exportAll, exportCurrent } from "./exporting";
import { revealInExplorer } from "./Explorer";
import { t } from "./i18n";
import { Icon, iconForType } from "./icons";
import * as s from "./store";
import { Modal } from "./Modal";
import { CodeGenDialog, QueryTreeDialog, ReverseDialog, SqlImportDialog } from "./CodeDialogs";
import { ClaudeDialog } from "./ClaudeDialog";

const close = () => s.setDialog(null);
const selectedViews = () => s.selection().filter((e) => meta.isKindOf(e._type, "View"));

function ExportDialog() {
  const saved = (() => {
    try {
      return JSON.parse(localStorage.getItem("constella.exportOptions") ?? "null") as Partial<ImageOptions> | null;
    } catch {
      return null;
    }
  })();
  const [range, setRange] = createSignal<"current" | "all">("current");
  const [opts, setOpts] = createSignal<ImageOptions>({ format: "png", background: true, scale: 1, margin: 10, theme: s.theme(), ...saved });
  const patch = (p: Partial<ImageOptions>) => {
    const next = { ...opts(), ...p };
    setOpts(next);
    try {
      localStorage.setItem("constella.exportOptions", JSON.stringify({ ...next, theme: undefined }));
    } catch {
      /* ignore */
    }
  };
  const [busy, setBusy] = createSignal(false);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      s.reportError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={t("export.title")} onClose={close}>
      <div class="form-grid">
        <label>{t("export.range")}</label>
        <select value={range()} onChange={(e) => setRange(e.currentTarget.value as "current" | "all")}>
          <option value="current">{t("export.current")}</option>
          <option value="all">{t("export.all")}</option>
        </select>
        <label>{t("export.format")}</label>
        <div class="segmented">
          <For each={["png", "jpeg", "svg"] as ImageFormat[]}>
            {(f) => (
              <button classList={{ on: opts().format === f }} onClick={() => patch({ format: f })}>
                {f.toUpperCase()}
              </button>
            )}
          </For>
        </div>
        <label>{t("export.scale")}</label>
        <div class="segmented">
          <For each={[1, 2] as const}>
            {(sc) => (
              <button classList={{ on: opts().scale === sc }} disabled={opts().format === "svg"} onClick={() => patch({ scale: sc })}>
                {sc}x
              </button>
            )}
          </For>
        </div>
        <label>{t("export.margin")}</label>
        <div class="inline-controls">
          <input type="range" min="0" max="32" value={opts().margin} onInput={(e) => patch({ margin: Number(e.currentTarget.value) })} />
          <span class="mono">{opts().margin}px</span>
        </div>
        <label>{t("export.theme")}</label>
        <div class="segmented">
          <button classList={{ on: opts().theme === "light" }} onClick={() => patch({ theme: "light" })}>
            <Icon name="sun" />
          </button>
          <button classList={{ on: opts().theme === "dark" }} onClick={() => patch({ theme: "dark" })}>
            <Icon name="moon" />
          </button>
        </div>
        <span />
        <label class="flag">
          <input type="checkbox" checked={opts().background || opts().format === "jpeg"} disabled={opts().format === "jpeg"} onChange={(e) => patch({ background: e.currentTarget.checked })} />
          {t("export.background")}
        </label>
      </div>
      <footer class="modal-footer">
        <button class="button" disabled={busy() || opts().format === "svg"} onClick={() => run(() => copyDiagramImage(opts()))}>
          {t("export.copy")}
        </button>
        <span class="spacer" />
        <button class="button" onClick={close}>
          {t("dialog.close")}
        </button>
        <Show
          when={range() === "all"}
          fallback={
            <button class="button primary" disabled={busy()} onClick={() => run(() => exportCurrent(opts()))}>
              {t("export.export")}
            </button>
          }
        >
          <button class="button primary" disabled={busy()} onClick={() => run(() => exportAll(opts()))}>
            {t("export.exportAll")}
          </button>
        </Show>
      </footer>
    </Modal>
  );
}

function ColorDialog(props: { field: "fillColor" | "lineColor" | "fontColor" }) {
  const views = selectedViews();
  const [value, setValue] = createSignal<string>(views[0]?.[props.field] ?? (props.field === "fillColor" ? "$background" : "$foreground"));
  const apply = (v: string) => {
    if (!/^(\$[a-z]+\d*|#[0-9a-fA-F]{6})$/.test(v)) return s.toast(`${t("color.title")} ?`, "error");
    setViewField(s.repo, views, props.field, v, "Color");
    close();
  };
  return (
    <Modal title={t("color.title")} onClose={close} width={420}>
      <div class="palette">
        <For each={paletteRows()}>
          {(row) => (
            <div class="palette-row">
              <For each={row}>
                {(c) => (
                  <button
                    class="palette-cell"
                    classList={{ on: value() === c, transparent: c === "$transparent" }}
                    style={{ background: c === "$transparent" ? undefined : resolveColor(c, s.theme()) }}
                    title={c}
                    aria-label={c}
                    onClick={() => setValue(c)}
                    onDblClick={() => apply(c)}
                  />
                )}
              </For>
            </div>
          )}
        </For>
      </div>
      <div class="inline-controls">
        <span class="swatch large" style={{ background: resolveColor(value(), s.theme()) }} />
        <input class="field-input mono" value={value()} onInput={(e) => setValue(e.currentTarget.value.trim())} onKeyDown={(e) => e.key === "Enter" && apply(value())} />
        <input type="color" value={resolveColor(value(), "light").startsWith("#") ? resolveColor(value(), "light").slice(0, 7) : "#000000"} onInput={(e) => setValue(e.currentTarget.value)} />
      </div>
      <footer class="modal-footer">
        <span class="spacer" />
        <button class="button" onClick={close}>
          {t("dialog.cancel")}
        </button>
        <button class="button primary" onClick={() => apply(value())}>
          {t("dialog.ok")}
        </button>
      </footer>
    </Modal>
  );
}

function FontDialog() {
  const views = selectedViews();
  const [font, setFont] = createSignal(parseFont(views[0]?.font));
  const [color, setColor] = createSignal<string>(views[0]?.fontColor ?? "$foreground");
  return (
    <Modal title={t("font.title")} onClose={close} width={380}>
      <div class="form-grid">
        <label>{t("font.family")}</label>
        <input class="field-input" value={font().family} onInput={(e) => setFont({ ...font(), family: e.currentTarget.value })} list="font-families" />
        <datalist id="font-families">
          <For each={["Arial", "Helvetica", "Liberation Sans", "DejaVu Sans", "Noto Sans", "Inter", "Times New Roman", "Courier New", "JetBrains Mono"]}>{(f) => <option value={f} />}</For>
        </datalist>
        <label>{t("font.size")}</label>
        <input class="field-input" type="number" min="6" max="72" value={font().size} onInput={(e) => setFont({ ...font(), size: Number(e.currentTarget.value) || 13 })} />
        <span />
        <div class="inline-controls">
          <label class="flag">
            <input type="checkbox" checked={font().bold} onChange={(e) => setFont({ ...font(), bold: e.currentTarget.checked })} />
            {t("font.bold")}
          </label>
          <label class="flag">
            <input type="checkbox" checked={font().italic} onChange={(e) => setFont({ ...font(), italic: e.currentTarget.checked })} />
            {t("font.italic")}
          </label>
        </div>
        <label>{t("color.title")}</label>
        <input class="field-input mono" value={color()} onInput={(e) => setColor(e.currentTarget.value.trim())} />
      </div>
      <p class="font-preview" style={{ "font-family": font().family, "font-size": `${font().size}px`, "font-weight": font().bold ? 700 : 400, "font-style": font().italic ? "italic" : "normal", color: resolveColor(color(), s.theme()) }}>
        Customer + name: String
      </p>
      <footer class="modal-footer">
        <span class="spacer" />
        <button class="button" onClick={close}>
          {t("dialog.cancel")}
        </button>
        <button
          class="button primary"
          onClick={() => {
            s.repo.transact("Font", (tx) => {
              for (const v of views) {
                tx.set(v, "font", formatFont(font()));
                tx.set(v, "fontColor", color());
              }
            });
            close();
          }}
        >
          {t("dialog.ok")}
        </button>
      </footer>
    </Modal>
  );
}

/** Generic filtered list used by the command palette and quick find. */
function Picker<T>(props: { placeholder: string; items: () => T[]; label: (x: T) => string; detail?: (x: T) => string; icon?: (x: T) => string; onPick: (x: T) => void }) {
  const [q, setQ] = createSignal("");
  const [index, setIndex] = createSignal(0);
  const results = createMemo(() => {
    const query = q().trim().toLowerCase();
    const all = props.items();
    if (!query) return all.slice(0, 200);
    const scored: [number, T][] = [];
    for (const x of all) {
      const l = props.label(x).toLowerCase();
      const i = l.indexOf(query);
      if (i >= 0) scored.push([i === 0 ? 0 : 1, x]);
      else if (fuzzy(l, query)) scored.push([2, x]);
    }
    return scored.sort((a, b) => a[0] - b[0]).slice(0, 200).map(([, x]) => x);
  });
  const pick = (x: T | undefined) => {
    if (x === undefined) return;
    close();
    props.onPick(x);
  };
  return (
    <div class="modal-backdrop top" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div class="picker" role="dialog" aria-modal="true">
        <div class="search-box large">
          <Icon name="search" />
          <input
            ref={(el) => queueMicrotask(() => el.focus())}
            placeholder={props.placeholder}
            value={q()}
            onInput={(e) => {
              setQ(e.currentTarget.value);
              setIndex(0);
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "ArrowDown") (e.preventDefault(), setIndex(Math.min(results().length - 1, index() + 1)));
              else if (e.key === "ArrowUp") (e.preventDefault(), setIndex(Math.max(0, index() - 1)));
              else if (e.key === "Enter") pick(results()[index()]);
              else if (e.key === "Escape") close();
            }}
          />
        </div>
        <div class="picker-list" role="listbox">
          <For each={results()}>
            {(x, i) => (
              <div class="picker-row" role="option" aria-selected={i() === index()} classList={{ on: i() === index() }} onMouseMove={() => setIndex(i())} onClick={() => pick(x)}>
                <Show when={props.icon}>
                  <Icon name={props.icon!(x)} />
                </Show>
                <span class="ellipsis">{props.label(x)}</span>
                <Show when={props.detail}>
                  <span class="picker-detail">{props.detail!(x)}</span>
                </Show>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}

function fuzzy(text: string, q: string): boolean {
  let i = 0;
  for (const ch of text) if (ch === q[i]) i++;
  return i === q.length;
}

function goTo(el: Element): void {
  if (meta.isKindOf(el._type, "Diagram")) return s.openDiagram(el._id);
  s.select(el);
  revealInExplorer(el);
  const v = s.repo.viewsOf(el._id).find((x) => s.repo.diagramOf(x)?.ownedViews?.includes(x));
  if (v) {
    s.openDiagram(s.repo.diagramOf(v)!._id);
    s.select([v]);
    queueMicrotask(() => activeEditor()?.reveal(boundsOf(v)));
  }
}

function modelElements(): Element[] {
  s.modelVersion();
  return [...s.repo.all()].filter((e) => !meta.isKindOf(e._type, "View") && e.name);
}

function pathOf(el: Element): string {
  const parts: string[] = [];
  let p = s.repo.parentOf(el);
  while (p && p !== s.repo.root) {
    parts.unshift(p.name ?? "");
    p = s.repo.parentOf(p);
  }
  return parts.join("::");
}

function FindDialog() {
  const [q, setQ] = createSignal("");
  const [cs, setCs] = createSignal(false);
  const [inDoc, setInDoc] = createSignal(false);
  const run = () => {
    const query = cs() ? q() : q().toLowerCase();
    if (!query) return;
    const norm = (x: string) => (cs() ? x : x.toLowerCase());
    const res = modelElements().filter((e) => norm(e.name ?? "").includes(query) || (inDoc() && norm(e.documentation ?? "").includes(query)));
    s.setFindResults(res);
    s.setPanels({ ...s.panels(), bottom: true });
    close();
  };
  return (
    <Modal title={t("find.title")} onClose={close} width={420}>
      <input class="field-input" ref={(el) => queueMicrotask(() => el.focus())} value={q()} onInput={(e) => setQ(e.currentTarget.value)} onKeyDown={(e) => (e.stopPropagation(), e.key === "Enter" && run())} />
      <div class="inline-controls spaced">
        <label class="flag">
          <input type="checkbox" checked={cs()} onChange={(e) => setCs(e.currentTarget.checked)} />
          {t("find.caseSensitive")}
        </label>
        <label class="flag">
          <input type="checkbox" checked={inDoc()} onChange={(e) => setInDoc(e.currentTarget.checked)} />
          {t("find.inDoc")}
        </label>
      </div>
      <footer class="modal-footer">
        <span class="spacer" />
        <button class="button" onClick={close}>
          {t("dialog.cancel")}
        </button>
        <button class="button primary" onClick={run}>
          {t("cmd.model.find").replace("…", "")}
        </button>
      </footer>
    </Modal>
  );
}

export function FindResults() {
  return (
    <section class="panel bottom-panel">
      <header class="panel-header">
        <span>
          {t("panel.find")} · {t("find.results", { n: s.findResults().length })}
        </span>
        <button class="icon-button" aria-label={t("dialog.close")} onClick={() => s.setPanels({ ...s.panels(), bottom: false })}>
          <Icon name="close" />
        </button>
      </header>
      <div class="panel-body list">
        <For each={s.findResults()}>
          {(el) => (
            <div class="list-row" onClick={() => goTo(el)}>
              <Icon name={iconForType(el._type)} />
              <span class="ellipsis">{el.name}</span>
              <span class="picker-detail">{pathOf(el)}</span>
            </div>
          )}
        </For>
      </div>
    </section>
  );
}

function ConfirmDialog(props: { message: string; buttons: { label: string; value: string; primary?: boolean }[]; resolve: (v: string) => void }) {
  return (
    <Modal title="ConstellaUML" onClose={() => props.resolve(props.buttons[0].value)} width={460}>
      <p class="confirm-text">{props.message}</p>
      <footer class="modal-footer">
        <span class="spacer" />
        <For each={props.buttons}>
          {(b) => (
            <button class="button" classList={{ primary: b.primary }} ref={(el) => b.primary && queueMicrotask(() => el.focus())} onClick={() => props.resolve(b.value)}>
              {b.label}
            </button>
          )}
        </For>
      </footer>
    </Modal>
  );
}

function ShortcutsDialog() {
  const cmds = () => allCommands().filter((c) => c.keys?.length);
  return (
    <Modal title={t("cmd.help.shortcuts")} onClose={close} width={560}>
      <div class="shortcut-list">
        <For each={cmds()}>
          {(c) => (
            <div class="shortcut-row">
              <span>{t(c.label)}</span>
              <kbd>{shortcutLabel(c.id)}</kbd>
            </div>
          )}
        </For>
      </div>
    </Modal>
  );
}

export function Dialogs() {
  return (
    <Show when={s.dialog()}>
      {(d) => (
        <Switch>
          <Match when={d().kind === "export"}>
            <ExportDialog />
          </Match>
          <Match when={d().kind === "color"}>
            <ColorDialog field={(d() as { field: "fillColor" }).field} />
          </Match>
          <Match when={d().kind === "font"}>
            <FontDialog />
          </Match>
          <Match when={d().kind === "find"}>
            <FindDialog />
          </Match>
          <Match when={d().kind === "palette"}>
            <Picker
              placeholder={t("palette.placeholder")}
              items={() => allCommands().filter((c) => !c.id.startsWith("explorer:") && (!c.enabled || c.enabled()))}
              label={(c) => t(c.label)}
              detail={(c) => shortcutLabel(c.id)}
              onPick={(c) => execute(c.id)}
            />
          </Match>
          <Match when={d().kind === "quickFind"}>
            <Picker placeholder={t("quickfind.placeholder")} items={modelElements} label={(e) => e.name} detail={pathOf} icon={(e) => iconForType(e._type)} onPick={goTo} />
          </Match>
          <Match when={d().kind === "about"}>
            <Modal title={t("cmd.help.about")} onClose={close} width={380}>
              <div class="about">
                <img src="/logo.svg" width="72" height="72" alt="" />
                <p style={{ "white-space": "pre-line" }}>{t("about.text", { version: __APP_VERSION__ })}</p>
              </div>
            </Modal>
          </Match>
          <Match when={d().kind === "codegen"}>
            <CodeGenDialog />
          </Match>
          <Match when={d().kind === "reverse"}>
            <ReverseDialog />
          </Match>
          <Match when={d().kind === "sqlImport"}>
            <SqlImportDialog />
          </Match>
          <Match when={d().kind === "queryTree"}>
            <QueryTreeDialog />
          </Match>
          <Match when={d().kind === "claude"}>
            <ClaudeDialog />
          </Match>
          <Match when={d().kind === "shortcuts"}>
            <ShortcutsDialog />
          </Match>
          <Match when={d().kind === "confirm"}>
            <ConfirmDialog {...(d() as Extract<s.DialogState, { kind: "confirm" }>)} />
          </Match>
        </Switch>
      )}
    </Show>
  );
}
