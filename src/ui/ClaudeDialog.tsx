// "Connect Claude" dialog: registers the MCP bridge in Claude Desktop / Claude
// Code and lets the user keep Claude read-only.
import { For, Show, createResource, createSignal } from "solid-js";
import { claudeReadOnly, mcpClients, mcpError, setClaudeReadOnly } from "./claude";
import { t } from "./i18n";
import { Icon } from "./icons";
import { Modal } from "./Modal";
import * as platform from "./platform";
import * as s from "./store";

const close = () => s.setDialog(null);

const CLIENTS = [
  { id: "desktop", name: "Claude Desktop", hint: "claude.desktopHint" },
  { id: "code", name: "Claude Code", hint: "claude.codeHint" },
] as const;

export function ClaudeDialog() {
  const [status, { mutate }] = createResource(platform.claudeStatus);
  const [busy, setBusy] = createSignal<string | null>(null);
  const [changed, setChanged] = createSignal<string[]>([]);
  const toggle = async (client: "desktop" | "code", enable: boolean) => {
    setBusy(client);
    try {
      mutate(await platform.claudeConnect(client, enable));
      setChanged([...changed(), client]);
      s.toast(t(enable ? "claude.connected" : "claude.disconnected", { client: client === "desktop" ? "Claude Desktop" : "Claude Code" }));
    } catch (e) {
      s.reportError(e);
    } finally {
      setBusy(null);
    }
  };
  const manual = () => {
    const st = status();
    return st ? JSON.stringify({ mcpServers: { constella: { command: st.command, args: st.args } } }, null, 2) : "";
  };
  return (
    <Modal title={t("claude.title")} onClose={close} width={560}>
      <p class="claude-intro">{t("claude.intro")}</p>
      <Show when={platform.isTauri} fallback={<p class="claude-note">{t("claude.desktopOnly")}</p>}>
        <div class="claude-state">
          <span class="claude-dot" classList={{ on: mcpClients() > 0 }} />
          {mcpError() ? t("claude.error", { msg: mcpError()! }) : mcpClients() > 0 ? t("claude.active", { n: mcpClients() }) : t("claude.waiting")}
        </div>
        <div class="claude-clients">
          <For each={CLIENTS}>
            {(c) => {
              const st = () => status()?.[c.id];
              return (
                <div class="claude-client">
                  <div class="claude-client-text">
                    <strong>{c.name}</strong>
                    <span>
                      {st()?.configured ? t(changed().includes(c.id) ? c.hint : "claude.registered") : st()?.available ? t("claude.detected") : t("claude.notDetected")}
                    </span>
                  </div>
                  <button class="button" classList={{ primary: !st()?.configured }} disabled={!st() || busy() !== null || (!!mcpError() && !st()!.configured) || (!st()!.available && !st()!.configured)} onClick={() => toggle(c.id, !st()!.configured)}>
                    {busy() === c.id ? "…" : st()?.configured ? t("claude.disconnect") : t("claude.connect")}
                  </button>
                </div>
              );
            }}
          </For>
        </div>
        <label class="flag claude-write">
          <input type="checkbox" checked={!claudeReadOnly()} onChange={(e) => setClaudeReadOnly(!e.currentTarget.checked)} />
          {t("claude.allowWrite")}
        </label>
        <details class="claude-manual">
          <summary>{t("claude.manual")}</summary>
          <p>{t("claude.manualText")}</p>
          <pre class="code-text">{manual()}</pre>
          <button class="button" onClick={() => navigator.clipboard.writeText(manual()).then(() => s.toast(t("toast.copied")))}>
            <Icon name="copy" /> {t("claude.copy")}
          </button>
        </details>
      </Show>
      <p class="claude-note">{t("claude.examples")}</p>
      <footer class="modal-footer">
        <span class="spacer" />
        <button class="button" onClick={close}>
          {t("dialog.close")}
        </button>
      </footer>
    </Modal>
  );
}
