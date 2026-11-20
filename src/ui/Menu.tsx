import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { Portal } from "solid-js/web";
import { type MenuItem, command, execute, shortcutLabel } from "./commands";
import { t } from "./i18n";
import { Icon } from "./icons";
import { basename } from "./platform";
import { confirmDiscard, openDocument, recentFiles, reportError } from "./store";

/** Vertical menu list (dropdowns, submenus, context menus). */
export function MenuList(props: { items: MenuItem[]; onDone: () => void; level?: number }) {
  const [openSub, setOpenSub] = createSignal<number | null>(null);
  return (
    <div class="menu" role="menu">
      <For each={props.items}>
        {(item, i) => {
          if ("sep" in item) return <div class="menu-sep" role="separator" />;
          if ("recent" in item)
            return (
              <div class="menu-item has-sub" role="menuitem" onMouseEnter={() => setOpenSub(i())} onMouseLeave={() => setOpenSub(null)}>
                <span class="menu-check" />
                <span class="menu-label">{t("cmd.file.openRecent")}</span>
                <Icon name="chevronRight" size={12} />
                <Show when={openSub() === i()}>
                  <div class="submenu">
                    <div class="menu">
                      <Show when={recentFiles().length} fallback={<div class="menu-item disabled">—</div>}>
                        <For each={recentFiles()}>
                          {(p) => (
                            <button
                              class="menu-item"
                              title={p}
                              onClick={async () => {
                                props.onDone();
                                if (await confirmDiscard()) openDocument(p).catch(reportError);
                              }}
                            >
                              <span class="menu-check" />
                              <span class="menu-label">{basename(p)}</span>
                            </button>
                          )}
                        </For>
                      </Show>
                    </div>
                  </div>
                </Show>
              </div>
            );
          if ("children" in item)
            return (
              <div class="menu-item has-sub" role="menuitem" aria-haspopup="true" onMouseEnter={() => setOpenSub(i())} onMouseLeave={() => setOpenSub(null)}>
                <span class="menu-check" />
                <span class="menu-label">{t(item.label)}</span>
                <Icon name="chevronRight" size={12} />
                <Show when={openSub() === i()}>
                  <div class="submenu">
                    <MenuList items={item.children} onDone={props.onDone} level={(props.level ?? 0) + 1} />
                  </div>
                </Show>
              </div>
            );
          const c = command(item.cmd);
          if (!c) return null;
          const enabled = () => !c.enabled || c.enabled();
          return (
            <button
              class="menu-item"
              role={c.checked ? "menuitemcheckbox" : "menuitem"}
              aria-checked={c.checked ? c.checked() : undefined}
              disabled={!enabled()}
              onClick={() => {
                props.onDone();
                execute(c.id);
              }}
            >
              <span class="menu-check">{c.checked?.() && <Icon name="check" size={12} />}</span>
              <span class="menu-label">{t(c.label)}</span>
              <span class="menu-key">{shortcutLabel(c.id)}</span>
            </button>
          );
        }}
      </For>
    </div>
  );
}

/** Floating context menu at a screen position; closes on outside click / Esc. */
export function ContextMenu(props: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  let el!: HTMLDivElement;
  const [pos, setPos] = createSignal({ x: props.x, y: props.y });
  const onDown = (e: MouseEvent) => {
    if (!el.contains(e.target as Node)) props.onClose();
  };
  const onKey = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
  onMount(() => {
    const r = el.getBoundingClientRect();
    setPos({ x: Math.min(props.x, window.innerWidth - r.width - 4), y: Math.min(props.y, window.innerHeight - r.height - 4) });
    setTimeout(() => document.addEventListener("mousedown", onDown));
    document.addEventListener("keydown", onKey);
  });
  onCleanup(() => {
    document.removeEventListener("mousedown", onDown);
    document.removeEventListener("keydown", onKey);
  });
  return (
    <Portal>
      <div ref={el} class="context-menu" style={{ left: `${pos().x}px`, top: `${pos().y}px` }}>
        <MenuList items={props.items} onDone={props.onClose} />
      </div>
    </Portal>
  );
}
