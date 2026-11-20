// Window chrome: menu bar, toolbar and status bar.
import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { meta } from "../core/meta/registry";
import { MAIN_MENU, activeEditor, command, execute, painterSource, shortcutLabel } from "./commands";
import { lang, t } from "./i18n";
import { Icon } from "./icons";
import { MenuList } from "./Menu";
import * as s from "./store";

export const [windowWidth, setWindowWidth] = createSignal(typeof window !== "undefined" ? window.innerWidth : 1440);
if (typeof window !== "undefined") window.addEventListener("resize", () => setWindowWidth(window.innerWidth));

export function MenuBar() {
  const [open, setOpen] = createSignal<number | null>(null);
  let bar!: HTMLDivElement;
  const compact = () => windowWidth() < 760;
  const close = () => setOpen(null);
  const onDown = (e: MouseEvent) => {
    if (!bar.contains(e.target as Node)) close();
  };
  onMount(() => document.addEventListener("mousedown", onDown));
  onCleanup(() => document.removeEventListener("mousedown", onDown));
  return (
    <div class="menubar" ref={bar} role="menubar">
      <img class="menubar-logo" src="/logo.svg" alt="" width="18" height="18" />
      <Show
        when={!compact()}
        fallback={
          <div class="menubar-entry">
            <button class="menubar-button" classList={{ open: open() === 0 }} onClick={() => setOpen(open() === 0 ? null : 0)} aria-label="Menu">
              <Icon name="more" />
            </button>
            <Show when={open() === 0}>
              <div class="dropdown">
                <MenuList items={MAIN_MENU.map((m) => ({ label: m.label, children: m.items }))} onDone={close} />
              </div>
            </Show>
          </div>
        }
      >
        <For each={MAIN_MENU}>
          {(m, i) => (
            <div class="menubar-entry">
              <button
                class="menubar-button"
                classList={{ open: open() === i() }}
                onClick={() => setOpen(open() === i() ? null : i())}
                onMouseEnter={() => open() !== null && setOpen(i())}
              >
                {t(m.label)}
              </button>
              <Show when={open() === i()}>
                <div class="dropdown">
                  <MenuList items={m.items} onDone={close} />
                </div>
              </Show>
            </div>
          )}
        </For>
      </Show>
      <div class="menubar-title">
        {s.projectName()}
        <Show when={(s.modelVersion(), s.repo.dirty)}>
          <span class="dirty-dot" title={t("status.modified")} />
        </Show>
      </div>
    </div>
  );
}

function ToolButton(props: { cmd: string; icon: string; active?: boolean }) {
  const c = command(props.cmd);
  return (
    <button
      class="tool-button"
      classList={{ active: props.active ?? c?.checked?.() }}
      disabled={c?.enabled ? !c.enabled() : false}
      title={`${c ? t(c.label) : ""}${shortcutLabel(props.cmd) ? ` (${shortcutLabel(props.cmd)})` : ""}`}
      aria-label={c ? t(c.label) : props.cmd}
      onClick={() => execute(props.cmd)}
    >
      <Icon name={props.icon} />
    </button>
  );
}

export function Toolbar() {
  const narrow = () => windowWidth() < 900;
  return (
    <div class="toolbar" role="toolbar">
      <ToolButton cmd="file:new" icon="new" />
      <ToolButton cmd="file:open" icon="open" />
      <ToolButton cmd="file:save" icon="save" />
      <div class="toolbar-sep" />
      <ToolButton cmd="edit:undo" icon="undo" />
      <ToolButton cmd="edit:redo" icon="redo" />
      <div class="toolbar-sep" />
      <ToolButton cmd="view:zoom-out" icon="zoomOut" />
      <ToolButton cmd="view:zoom-in" icon="zoomIn" />
      <ToolButton cmd="view:fit" icon="fit" />
      <ToolButton cmd="view:show-grid" icon="grid" />
      <Show when={!narrow()}>
        <div class="toolbar-sep" />
        <ToolButton cmd="format:painter" icon="painter" active={!!painterSource()} />
        <ToolButton cmd="view:sidebar" icon="sidebar" />
        <ToolButton cmd="view:navigator" icon="panelRight" />
      </Show>
      <div class="toolbar-spacer" />
      <button class="toolbar-search" onClick={() => execute("view:command-palette")} title={t("cmd.view.commandPalette")}>
        <Icon name="search" />
        <span>{t("cmd.view.commandPalette")}</span>
        <kbd>Ctrl+Maj+P</kbd>
      </button>
    </div>
  );
}

export function StatusBar() {
  const path = createMemo(() => {
    s.modelVersion();
    const el = s.selection()[0];
    if (!el) return "";
    let m = s.modelOf(el);
    const parts: string[] = [];
    while (m) {
      parts.unshift(m.name || m._type.replace(/^UML/, ""));
      m = s.repo.parentOf(m);
    }
    return parts.join(" › ");
  });
  const zoom = () => {
    s.modelVersion();
    return Math.round((zoomTick(), activeEditor()?.zoom ?? 1) * 100);
  };
  return (
    <div class="statusbar">
      <span class="status-path" title={path()}>
        {path() || t("status.ready")}
      </span>
      <span class="status-spacer" />
      <span class="status-item">{t("status.elements", { n: (s.modelVersion(), [...s.repo.all()].filter((e) => !meta.isKindOf(e._type, "View")).length) })}</span>
      <span class="status-item">{(s.modelVersion(), s.repo.dirty) ? t("status.modified") : t("status.saved")}</span>
      <button class="status-button" onClick={() => execute("view:language")} title={t("cmd.view.language")}>
        {lang().toUpperCase()}
      </button>
      <button class="status-button" onClick={() => execute("view:toggle-theme")} title={t("cmd.view.toggleTheme")} aria-label={t("cmd.view.toggleTheme")}>
        <Icon name={s.theme() === "dark" ? "moon" : "sun"} />
      </button>
      <button class="status-button" onClick={() => execute("view:actual-size")} title={t("cmd.view.actualSize")}>
        {zoom()}%
      </button>
    </div>
  );
}

/** Bumped by the editor on viewport changes (zoom display, minimap). */
export const [zoomTick, setZoomTick] = createSignal(0);
