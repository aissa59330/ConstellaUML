// Image export (PNG / JPEG / SVG) of one or all diagrams, and copy to clipboard.
import type { Element } from "../core/element";
import { meta } from "../core/meta/registry";
import { canvasMeasurer, CanvasGraphics } from "../render/canvas";
import { type Theme, resolveColor } from "../render/colors";
import { arrangeDiagram, diagramBounds, drawDiagram, exportSvg } from "../render/diagram";
import { t } from "./i18n";
import * as platform from "./platform";
import { activeDiagram, repo, theme, toast } from "./store";

export type ImageFormat = "png" | "jpeg" | "svg";

export interface ImageOptions {
  format: ImageFormat;
  background: boolean;
  scale: 1 | 2;
  margin: number;
  theme: Theme;
}

export function renderRaster(diagram: Element, o: ImageOptions): HTMLCanvasElement {
  const ctx = { repo, theme: o.theme, measure: canvasMeasurer };
  arrangeDiagram(diagram, ctx);
  const b = diagramBounds(diagram) ?? { x: 0, y: 0, w: 100, h: 100 };
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil((b.w + o.margin * 2) * o.scale);
  canvas.height = Math.ceil((b.h + o.margin * 2) * o.scale);
  const c = canvas.getContext("2d")!;
  if (o.background || o.format === "jpeg") {
    c.fillStyle = resolveColor("$background", o.theme);
    c.fillRect(0, 0, canvas.width, canvas.height);
  }
  c.scale(o.scale, o.scale);
  c.translate(o.margin - b.x, o.margin - b.y);
  drawDiagram(diagram, { ...ctx, g: new CanvasGraphics(c) });
  return canvas;
}

export async function encode(diagram: Element, o: ImageOptions): Promise<Uint8Array> {
  if (o.format === "svg") {
    const svg = exportSvg(diagram, { repo, measure: canvasMeasurer }, { theme: o.theme, margin: o.margin, background: o.background }, canvasMeasurer);
    return new TextEncoder().encode(svg);
  }
  const canvas = renderRaster(diagram, o);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, o.format === "jpeg" ? "image/jpeg" : "image/png", 0.95));
  if (!blob) throw new Error("encodage de l'image impossible");
  return new Uint8Array(await blob.arrayBuffer());
}

const safe = (name: string) => (name || "diagram").replace(/[\\/:*?"<>|]+/g, "_");

export async function exportCurrent(o: ImageOptions): Promise<string | null> {
  const d = activeDiagram();
  if (!d) return null;
  const path = await platform.pickSavePath(`${safe(d.name)}.${o.format === "jpeg" ? "jpg" : o.format}`, [{ name: o.format.toUpperCase(), extensions: [o.format === "jpeg" ? "jpg" : o.format] }]);
  if (!path) return null;
  await platform.writeBinary(path, await encode(d, o));
  toast(t("export.done", { path: platform.basename(path) }));
  return path;
}

export async function exportAll(o: ImageOptions): Promise<number> {
  const folder = await platform.pickFolder();
  if (folder === null) return 0;
  const diagrams = [...repo.all()].filter((e) => meta.isKindOf(e._type, "Diagram"));
  const used = new Set<string>();
  for (const d of diagrams) {
    let name = safe(d.name);
    for (let i = 2; used.has(name); i++) name = `${safe(d.name)}-${i}`;
    used.add(name);
    const ext = o.format === "jpeg" ? "jpg" : o.format;
    await platform.writeBinary(folder ? `${folder}/${name}.${ext}` : `${name}.${ext}`, await encode(d, o));
  }
  toast(t("export.done", { path: `${diagrams.length} × ${o.format.toUpperCase()}` }));
  return diagrams.length;
}

export async function copyDiagramImage(o: Partial<ImageOptions> = {}): Promise<void> {
  const d = activeDiagram();
  if (!d) return;
  const opts: ImageOptions = { format: "png", background: true, scale: 2, margin: 10, theme: theme(), ...o };
  try {
    const canvas = renderRaster(d, opts);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
    if (!blob || !("ClipboardItem" in window)) throw new Error("unsupported");
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    toast(t("toast.copied"));
  } catch {
    toast(t("toast.clipboardUnsupported"), "error");
  }
}
