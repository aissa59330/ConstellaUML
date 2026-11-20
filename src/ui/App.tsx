import { For, Show, createEffect, onCleanup, onMount } from "solid-js";
import { MenuBar, StatusBar, Toolbar, windowWidth } from "./Chrome";
import { handleShortcut } from "./commands";
import { DiagramArea } from "./DiagramArea";
import { Dialogs, FindResults } from "./Dialogs";
import { Explorer } from "./Explorer";
import { lang, setLang } from "./i18n";
import { Inspector } from "./Inspector";
import * as platform from "./platform";
import { Toolbox, WorkingDiagrams } from "./Sidebar";
import * as s from "./store";

function Splitter(props: { onDrag: (dx: number) => void; vertical?: boolean; label: string }) {
  const down = (e: PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    let last = props.vertical ? e.clientY : e.clientX;
    el.onpointermove = (ev) => {
      const cur = props.vertical ? ev.clientY : ev.clientX;
      props.onDrag(cur - last);
      last = cur;
    };
    el.onpointerup = () => (el.onpointermove = null);
  };
  return <div class="splitter" classList={{ vertical: !!props.vertical }} role="separator" aria-label={props.label} onPointerDown={down} />;
}

function isEditable(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}

const TEXT_KEYS = new Set(["Ctrl+A", "Ctrl+C", "Ctrl+V", "Ctrl+X", "Ctrl+Z", "Ctrl+Y", "Ctrl+Shift+Z", "Delete", "Ctrl+Delete"]);

export function App() {
  let navigatorEl!: HTMLDivElement;
  const compactSidebar = () => windowWidth() < 1100;
  const overlayNavigator = () => windowWidth() < 860;

  const onKey = (e: KeyboardEvent) => {
    if (s.dialog()) return;
    if (isEditable(e.target)) {
      const chordStr = (e.ctrlKey || e.metaKey ? "Ctrl+" : "") + (e.shiftKey ? "Shift+" : "") + (e.key.length === 1 ? e.key.toUpperCase() : e.key);
      if (!(e.ctrlKey || e.metaKey) || TEXT_KEYS.has(chordStr)) return;
    }
    handleShortcut(e);
  };

  onMount(async () => {
    s.setTheme(s.theme());
    setLang(lang());
    document.addEventListener("keydown", onKey);
    s.newDocument();
    try {
      const start = await platform.startupFile();
      if (start) await s.openDocument(start);
      else await s.recoverAutosave();
    } catch (e) {
      s.reportError(e);
    }
    s.startAutosave();
    if (platform.isTauri) {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      await win.onCloseRequested(async (ev) => {
        ev.preventDefault();
        if (await s.confirmDiscard()) {
          await platform.autosaveClear();
          await win.destroy();
        }
      });
    } else {
      window.addEventListener("beforeunload", (e) => {
        if (s.repo.dirty) e.preventDefault();
      });
    }
  });
  onCleanup(() => document.removeEventListener("keydown", onKey));

  createEffect(() => {
    platform.setWindowTitle(`${(s.modelVersion(), s.repo.dirty) ? "● " : ""}${s.projectName()} — Constella`);
  });

  return (
    <div class="app" classList={{ "compact-sidebar": compactSidebar() }}>
      <MenuBar />
      <Show when={s.panels().toolbar}>
        <Toolbar />
      </Show>
      <div class="workspace">
        <Show when={s.panels().sidebar}>
          <aside class="sidebar" style={{ width: compactSidebar() ? "52px" : `${s.sidebarWidth()}px` }}>
            <Show when={!compactSidebar()}>
              <WorkingDiagrams />
            </Show>
            <Show when={s.panels().toolbox}>
              <Toolbox />
            </Show>
          </aside>
          <Show when={!compactSidebar()}>
            <Splitter label="sidebar" onDrag={(dx) => s.setSidebarWidth(Math.max(160, Math.min(420, s.sidebarWidth() + dx)))} />
          </Show>
        </Show>
        <main class="center">
          <DiagramArea />
          <Show when={s.panels().bottom}>
            <FindResults />
          </Show>
        </main>
        <Show when={s.panels().navigator}>
          <Show when={!overlayNavigator()}>
            <Splitter label="navigator" onDrag={(dx) => s.setNavigatorWidth(Math.max(220, Math.min(560, s.navigatorWidth() - dx)))} />
          </Show>
          <aside class="navigator" classList={{ overlay: overlayNavigator() }} ref={navigatorEl} style={{ width: `${overlayNavigator() ? Math.min(320, windowWidth() - 40) : s.navigatorWidth()}px` }}>
            <div class="navigator-top" style={{ flex: s.panels().editors ? `${s.explorerRatio()} 1 0` : "1 1 0" }}>
              <Explorer />
            </div>
            <Show when={s.panels().editors}>
              <Splitter
                vertical
                label="editors"
                onDrag={(dy) => {
                  const h = navigatorEl.getBoundingClientRect().height || 1;
                  s.setExplorerRatio(Math.max(0.15, Math.min(0.85, s.explorerRatio() + dy / h)));
                }}
              />
              <div class="navigator-bottom" style={{ flex: `${1 - s.explorerRatio()} 1 0` }}>
                <Inspector />
              </div>
            </Show>
          </aside>
        </Show>
      </div>
      <Show when={s.panels().statusbar}>
        <StatusBar />
      </Show>
      <Dialogs />
      <div class="toasts" role="status" aria-live="polite">
        <For each={s.toasts()}>{(toast) => <div class={`toast ${toast.kind}`}>{toast.text}</div>}</For>
      </div>
    </div>
  );
}
