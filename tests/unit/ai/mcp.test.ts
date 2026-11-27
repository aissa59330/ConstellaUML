import { describe, expect, it } from "vitest";
import type { Element } from "../../../src/core/element";
import { Repository } from "../../../src/core/repository";
import { newProject } from "../../../src/io/mdj";
import { approxMeasurer } from "../../../src/render/graphics";
import { handleLine, handleMessage, toolList } from "../../../src/ai/mcp";
import type { ToolEnv } from "../../../src/ai/tools";

function setup(readOnly = false) {
  const repo = new Repository();
  repo.load(newProject());
  let active: Element = repo.root!.ownedElements[0].ownedElements[0];
  const env: ToolEnv = {
    repo,
    measure: approxMeasurer,
    theme: "light",
    readOnly,
    activeDiagram: () => active,
    selection: () => [],
    openDiagram: (id) => (active = repo.get(id)!),
    select: () => {},
  };
  let n = 0;
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r: any = await handleMessage({ jsonrpc: "2.0", id: ++n, method: "tools/call", params: { name, arguments: args } }, () => env);
    const text = r.result.content[0].text as string;
    return { isError: !!r.result.isError, text, json: () => JSON.parse(text) };
  };
  return { repo, env, call, active: () => active };
}

describe("MCP tools", () => {
  it("lists tools with JSON schemas", () => {
    const tools = toolList();
    expect(tools.map((t) => t.name)).toContain("add_element");
    for (const t of tools) expect(t.inputSchema).toMatchObject({ type: "object" });
  });

  it("builds a class diagram, each call being one undo step", async () => {
    const { repo, call } = setup();
    const livre = (await call("add_element", { tool: "class", name: "Livre", attributes: ["- titre: String", "- isbn: String"], operations: ["+ emprunter(date: Date): Boolean"] })).json();
    expect(livre.model.name).toBe("Livre");
    expect(livre.outline.join("\n")).toContain("opération +emprunter(date: Date): Boolean");
    expect(repo.undoName()).toBe("Claude : class");

    const doc = (await call("add_element", { tool: "class", name: "Document" })).json();
    const gen = await call("add_relationship", { tool: "generalization", from: livre.viewId, to: doc.model.id });
    expect(gen.isError).toBe(false);
    const assoc = await call("add_relationship", { tool: "association", from: livre.model.id, to: doc.viewId, source_end: { multiplicity: "0..*" }, target_end: { name: "source", multiplicity: "1" } });
    expect(assoc.text).toContain("Livre(0..*) - Document(1)");

    const outline = (await call("get_project_outline")).text;
    expect(outline).toContain('UMLClass "Livre"');
    expect(outline).toContain("attribut -titre: String");
    expect(outline).toContain("UMLGeneralization Livre → Document");

    const diagram = (await call("get_diagram")).json();
    expect(diagram.nodes).toHaveLength(2);
    expect(diagram.edges).toHaveLength(2);

    expect((await call("auto_layout")).isError).toBe(false);
    expect((await call("undo_last_change")).text).toContain("disposition");
  });

  it("reports mistakes to the model without changing the project", async () => {
    const { repo, call } = setup();
    const before = repo.size();
    const bad = await call("add_element", { tool: "lifeline", name: "X" });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain("class");
    const unknown = await call("update_element", { id: "nope" });
    expect(unknown.isError).toBe(true);
    expect(repo.size()).toBe(before);
    expect((await call("undo_last_change")).isError).toBe(true);
  });

  it("updates fields and deletes", async () => {
    const { call, repo } = setup();
    const c = (await call("add_element", { tool: "class", name: "A" })).json();
    await call("update_element", { id: c.viewId, expression: "«entity» Abonne", fields: { isAbstract: true, fillColor: "#ffeecc" } });
    const el = repo.get(c.model.id)!;
    expect(el.name).toBe("Abonne");
    expect(el.isAbstract).toBe(true);
    expect(repo.get(c.viewId)!.fillColor).toBe("#ffeecc");
    expect((await call("update_element", { id: c.model.id, fields: { nope: 1 } })).isError).toBe(true);
    await call("delete_elements", { ids: [c.model.id] });
    expect(repo.get(c.model.id)).toBeUndefined();
  });

  it("creates other diagrams and opens them", async () => {
    const { call, active } = setup();
    const d = (await call("create_diagram", { type: "UMLSequenceDiagram", name: "Emprunt" })).json();
    expect(d.owner.type).toBe("UMLInteraction");
    expect(active()._id).toBe(d.diagram.id);
    const tools = (await call("list_diagram_tools")).json();
    expect(tools.nodeTools.map((t: any) => t.tool)).toContain("lifeline");
  });

  it("refuses writes in read-only mode", async () => {
    const { call } = setup(true);
    const r = await call("add_element", { tool: "class" });
    expect(r.isError).toBe(true);
    expect((await call("get_context")).json().readOnly).toBe(true);
  });

  it("speaks JSON-RPC", async () => {
    const env = () => setup().env;
    expect(await handleLine('{"jsonrpc":"2.0","method":"notifications/initialized"}', env)).toBeNull();
    expect(JSON.parse((await handleLine("{oops", env))!).error.code).toBe(-32700);
    expect(JSON.parse((await handleLine('{"jsonrpc":"2.0","id":1,"method":"resources/list"}', env))!).error.code).toBe(-32601);
    expect(JSON.parse((await handleLine('{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"zzz"}}', env))!).error.code).toBe(-32602);
  });
});
