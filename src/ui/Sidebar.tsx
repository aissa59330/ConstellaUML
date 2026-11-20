// Left sidebar: working diagrams and the contextual toolbox.
import { For, Show, createSignal } from "solid-js";
import { toolGroupsFor } from "../notation/uml";
import { t } from "./i18n";
import { Icon } from "./icons";
import * as s from "./store";

export function WorkingDiagrams() {
  return (
    <section class="panel working-diagrams">
      <header class="panel-header">{t("panel.workingDiagrams")}</header>
      <div class="panel-body list">
        <For each={s.openDiagrams()}>
          {(id) => {
            const d = () => (s.modelVersion(), s.repo.get(id));
            return (
              <Show when={d()}>
                <div class="list-row" classList={{ active: s.activeDiagramId() === id }} onClick={() => s.setActiveDiagramId(id)} title={d()!.name}>
                  <Icon name="diagram" />
                  <span class="ellipsis">{d()!.name}</span>
                  <button
                    class="row-action"
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
    </section>
  );
}

export function Toolbox() {
  const [collapsed, setCollapsed] = createSignal<Record<string, boolean>>({});
  const groups = () => toolGroupsFor(s.activeDiagram()?._type ?? "");
  return (
    <section class="panel toolbox">
      <header class="panel-header">{t("panel.toolbox")}</header>
      <div class="panel-body">
        <Show when={s.activeDiagram()} fallback={<p class="empty-hint">—</p>}>
          <button class="tool-row" classList={{ active: s.tool() === null }} onClick={() => s.setTool(null)}>
            <Icon name="select" />
            <span>{t("toolbox.select")}</span>
          </button>
          <For each={groups()}>
            {(g) => (
              <div class="tool-group">
                <button class="tool-group-header" onClick={() => setCollapsed({ ...collapsed(), [g.id]: !collapsed()[g.id] })} aria-expanded={!collapsed()[g.id]}>
                  <Icon name={collapsed()[g.id] ? "chevronRight" : "chevronDown"} size={12} />
                  {t(g.label)}
                </button>
                <Show when={!collapsed()[g.id]}>
                  <div class="tool-grid">
                    <For each={g.tools}>
                      {(tool) => (
                        <button
                          class="tool-row"
                          classList={{ active: s.tool() === tool.id }}
                          title={t(tool.label)}
                          onClick={(e) => {
                            s.setTool(s.tool() === tool.id ? null : tool.id);
                            s.setToolSticky(e.shiftKey);
                          }}
                          onDblClick={() => {
                            s.setTool(tool.id);
                            s.setToolSticky(true);
                          }}
                        >
                          <Icon name={tool.icon} />
                          <span class="ellipsis">{t(tool.label)}</span>
                        </button>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            )}
          </For>
        </Show>
      </div>
    </section>
  );
}
