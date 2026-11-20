// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { applyPainter, execute, setPainterSource } from "../../../src/ui/commands";
import * as s from "../../../src/ui/store";
import { createEdge, createNode, findTool, type EdgeTool, type NodeTool } from "../../../src/notation/uml";
import { exportSvg } from "../../../src/render/diagram";
import { approxMeasurer } from "../../../src/render/graphics";

let d: any;
const node = (id: string, x: number, y: number, w = 100, h = 60) => createNode(s.repo, d, findTool(id) as NodeTool, { x, y, w, h });

beforeEach(() => {
  s.newDocument();
  d = s.activeDiagram();
});

describe("format commands", () => {
  it("aligns, distributes and resizes selected views (one undo step each)", async () => {
    const a = node("class", 0, 0), b = node("class", 200, 40), c = node("class", 300, 90, 140, 80);
    s.select([a, b, c]);
    await execute("format:align-top");
    expect([a.top, b.top, c.top]).toEqual([0, 0, 0]);
    await execute("format:align-right");
    expect(new Set([a.left + a.width, b.left + b.width, c.left + c.width]).size).toBe(1);
    s.repo.undo();
    await execute("format:distribute-h");
    const sorted = [a, b, c].sort((x, y) => x.left - y.left);
    expect(sorted[1].left - (sorted[0].left + sorted[0].width)).toBeCloseTo(sorted[2].left - (sorted[1].left + sorted[1].width), 0);
    await execute("format:same-size");
    expect([b.width, b.height]).toEqual([a.width, a.height]);
    s.repo.undo();
  });

  it("toggles view flags and line styles", async () => {
    const a = node("class", 0, 0), b = node("class", 300, 0);
    const e = createEdge(s.repo, d, findTool("association") as EdgeTool, a, b);
    s.select([a]);
    await execute("format:suppress-attributes");
    expect(a.suppressAttributes).toBe(true);
    await execute("format:stereotype-0");
    expect(a.stereotypeDisplay).toBe("none");
    s.select([e]);
    await execute("format:line-oblique");
    expect(e.lineStyle).toBe(1);
    await execute("format:line-curve");
    expect(e.lineStyle).toBe(3);
  });

  it("copies style with the format painter", () => {
    const a = node("class", 0, 0), b = node("class", 300, 0);
    s.repo.transact("style", (tx) => tx.set(a, "fillColor", "$blue3"));
    setPainterSource(a);
    expect(applyPainter(b)).toBe(true);
    expect(b.fillColor).toBe("$blue3");
    expect(applyPainter(b)).toBe(false); // one-shot
  });

  it("orders views front / back", async () => {
    const a = node("class", 0, 0), b = node("class", 50, 50);
    s.select([a]);
    await execute("format:bring-to-front");
    expect(d.ownedViews[d.ownedViews.length - 1]).toBe(a);
    await execute("format:send-to-back");
    expect(d.ownedViews[0]).toBe(a);
    expect(b).toBeDefined();
  });
});

describe("class diagram rendering", () => {
  it("draws every class-diagram element and annotation", () => {
    const ids = ["class", "interface", "signal", "dataType", "primitiveType", "enumeration", "package", "model", "subsystem", "text", "note", "rectangle", "roundRect", "ellipse", "hyperlink"];
    const views = ids.map((id, i) => node(id, (i % 5) * 160, Math.floor(i / 5) * 140));
    const edges = ["association", "directedAssociation", "aggregation", "composition", "generalization", "dependency", "realization"];
    edges.forEach((id) => createEdge(s.repo, d, findTool(id) as EdgeTool, views[0], views[2]));
    createEdge(s.repo, d, findTool("interfaceRealization") as EdgeTool, views[0], views[1]);
    createEdge(s.repo, d, findTool("noteLink") as EdgeTool, views[10], views[0]);
    const svg = exportSvg(d, { repo: s.repo, measure: approxMeasurer }, { theme: "dark", margin: 8, background: true }, approxMeasurer);
    for (const kw of ["«interface»", "«signal»", "«dataType»", "«primitive»", "«enumeration»", "Class1", "Note", "Text", "https://"]) expect(svg).toContain(kw);
    expect((svg.match(/<polygon/g) ?? []).length).toBeGreaterThanOrEqual(6); // arrowheads, diamonds, note fold
    expect(svg).toContain('stroke-dasharray="6 4"'); // dependency / realization / note link
  });
});
