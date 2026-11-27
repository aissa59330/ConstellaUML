// Connection with Claude: serves the MCP tools of src/ai to the
// `constella --mcp` bridges started by Claude Desktop / Claude Code.
import { createSignal } from "solid-js";
import { handleLine, toolList } from "../ai/mcp";
import type { ToolEnv } from "../ai/tools";
import { canvasMeasurer } from "../render/canvas";
import { renderRaster } from "./exporting";
import * as platform from "./platform";
import * as s from "./store";

/** Bridges currently connected (one per Claude session using ConstellaUML). */
export const [mcpClients, setMcpClients] = createSignal(0);
export const [mcpError, setMcpError] = createSignal<string | null>(null);

const READ_ONLY_KEY = "constella.claudeReadOnly";
export const [claudeReadOnly, setClaudeReadOnlyRaw] = createSignal(load());

function load(): boolean {
  try {
    return localStorage.getItem(READ_ONLY_KEY) === "true";
  } catch {
    return false;
  }
}

export function setClaudeReadOnly(v: boolean): void {
  setClaudeReadOnlyRaw(v);
  try {
    localStorage.setItem(READ_ONLY_KEY, String(v));
  } catch {
    /* ignore */
  }
}

function env(): ToolEnv {
  return {
    repo: s.repo,
    measure: canvasMeasurer,
    theme: s.theme(),
    readOnly: claudeReadOnly(),
    activeDiagram: s.activeDiagram,
    selection: s.selection,
    openDiagram: s.openDiagram,
    select: (els) => s.select(els),
    renderPng: async (d) => renderRaster(d, { format: "png", background: true, scale: 1, margin: 10, theme: s.theme() }).toDataURL("image/png").split(",")[1],
  };
}

/** Listens for requests relayed by the bridges, then opens the socket. */
export async function startClaudeBridge(): Promise<void> {
  if (!platform.isTauri) return;
  const { listen } = await import("@tauri-apps/api/event");
  const { invoke } = await import("@tauri-apps/api/core");
  await listen<{ conn: number; message: string }>("mcp-request", async (e) => {
    const reply = await handleLine(e.payload.message, env);
    if (reply) await invoke("mcp_reply", { conn: e.payload.conn, message: reply }).catch(() => {});
  });
  await listen<number>("mcp-clients", (e) => setMcpClients(e.payload));
  try {
    await invoke("mcp_start", { tools: JSON.stringify(toolList()) });
    setMcpError(null);
  } catch (e) {
    setMcpError(String(e));
  }
}
