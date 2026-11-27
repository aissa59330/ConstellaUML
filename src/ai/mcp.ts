// MCP requests relayed by the `constella --mcp` bridge (JSON-RPC 2.0). The
// bridge answers `initialize` itself; the app serves the tools. Handling is
// stateless, so a bridge can (re)connect at any point of a Claude session.
import { ContentResult, type Content, type ToolDef, type ToolEnv, TOOLS } from "./tools";

type Id = string | number | null;

interface Request {
  jsonrpc?: string;
  id?: Id;
  method?: string;
  params?: any;
}

export type Response = { jsonrpc: "2.0"; id: Id } & ({ result: unknown } | { error: { code: number; message: string } });

/** Tool list as sent to clients (also cached by the bridge for when the app is closed). */
export function toolList(tools: ToolDef[] = TOOLS) {
  return tools.map((t) => ({
    name: t.name,
    title: t.title,
    description: t.write ? t.description : `${t.description} (lecture seule)`,
    inputSchema: t.inputSchema,
    annotations: { title: t.title, readOnlyHint: !t.write, destructiveHint: t.name === "delete_elements", openWorldHint: false },
  }));
}

function toContent(result: unknown): Content[] {
  if (result instanceof ContentResult) return result.content;
  if (typeof result === "string") return [{ type: "text", text: result }];
  return [{ type: "text", text: JSON.stringify(result ?? null, null, 2) }];
}

async function callTool(params: any, env: ToolEnv, tools: ToolDef[]): Promise<{ content: Content[]; isError?: boolean }> {
  const tool = tools.find((t) => t.name === params?.name);
  if (!tool) throw Object.assign(new Error(`Outil inconnu : ${params?.name}`), { code: -32602 });
  if (tool.write && env.readOnly)
    return { content: [{ type: "text", text: "ConstellaUML est en lecture seule pour Claude. L'utilisateur peut autoriser les modifications depuis le bouton Claude de la barre d'outils." }], isError: true };
  try {
    return { content: toContent(await tool.run(params.arguments ?? {}, env)) };
  } catch (e) {
    // Tool failures go back to the model as results so it can correct itself.
    return { content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true };
  }
}

/** Answer to one JSON-RPC message, or null for notifications. */
export async function handleMessage(msg: Request, env: () => ToolEnv, tools: ToolDef[] = TOOLS): Promise<Response | null> {
  if (msg.id === undefined || msg.id === null) return null;
  const id = msg.id;
  try {
    switch (msg.method) {
      case "ping":
        return { jsonrpc: "2.0", id, result: {} };
      case "tools/list":
        return { jsonrpc: "2.0", id, result: { tools: toolList(tools) } };
      case "tools/call":
        return { jsonrpc: "2.0", id, result: await callTool(msg.params, env(), tools) };
      default:
        return { jsonrpc: "2.0", id, error: { code: -32601, message: `Méthode non prise en charge : ${msg.method}` } };
    }
  } catch (e) {
    const code = (e as { code?: number }).code ?? -32603;
    return { jsonrpc: "2.0", id, error: { code, message: e instanceof Error ? e.message : String(e) } };
  }
}

/** Parses one line from the bridge and answers it. */
export async function handleLine(line: string, env: () => ToolEnv, tools: ToolDef[] = TOOLS): Promise<string | null> {
  let msg: unknown;
  try {
    msg = JSON.parse(line);
  } catch {
    return JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON invalide" } });
  }
  if (Array.isArray(msg)) {
    const out = (await Promise.all(msg.map((m) => handleMessage(m, env, tools)))).filter((r) => r !== null);
    return out.length ? JSON.stringify(out) : null;
  }
  const r = await handleMessage(msg as Request, env, tools);
  return r && JSON.stringify(r);
}
