import { type FontSpec, type Graphics, type HAlign, type Point, type Rect, type StrokeStyle, type TextMeasurer } from "./graphics";
import { tracePath } from "./canvas";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const n = (v: number) => (Math.round(v * 100) / 100).toString();

/** Builds an SVG document; mirrors CanvasGraphics so exports match the screen. */
export class SvgGraphics implements Graphics {
  private parts: string[] = [];
  private stack: number[] = [];
  private shadow = false;

  constructor(private measurer: TextMeasurer) {}

  width(text: string, font: FontSpec): number {
    return this.measurer.width(text, font);
  }

  // Each save() opens a frame counting the <g> wrappers created by
  // translate/scale since then; restore() closes exactly those.
  private base = 0;

  save(): void {
    this.stack.push(0);
  }

  restore(): void {
    const count = this.stack.pop() ?? 0;
    for (let i = 0; i < count; i++) this.parts.push("</g>");
  }

  private openGroup(transform: string): void {
    this.parts.push(`<g transform="${transform}">`);
    if (this.stack.length) this.stack[this.stack.length - 1]++;
    else this.base++;
  }

  translate(x: number, y: number): void {
    this.openGroup(`translate(${n(x)} ${n(y)})`);
  }

  scale(s: number): void {
    this.openGroup(`scale(${n(s)})`);
  }

  setShadow(on: boolean): void {
    this.shadow = on;
  }

  private strokeAttrs(s: StrokeStyle | null): string {
    if (!s) return ' stroke="none"';
    return ` stroke="${esc(s.color)}" stroke-width="${n(s.width ?? 1)}"${s.dash?.length ? ` stroke-dasharray="${s.dash.join(" ")}"` : ""}`;
  }

  private fillAttrs(fill: string | null): string {
    return ` fill="${!fill || fill === "transparent" ? "none" : esc(fill)}"`;
  }

  // Drop shadow as an offset translucent copy of the shape: SVG filters are
  // dropped or mis-rendered by several viewers (librsvg, LibreOffice).
  private withShadow(fill: string | null, el: (attrs: string) => string): void {
    if (this.shadow && fill && fill !== "transparent")
      this.parts.push(`<g transform="translate(2 2)">${el(' fill="#000000" fill-opacity="0.12" stroke="none"')}</g>`);
    this.parts.push(el(""));
  }

  rect(r: Rect, fill: string | null, stroke: StrokeStyle | null, radius = 0): void {
    const geo = `x="${n(r.x)}" y="${n(r.y)}" width="${n(r.w)}" height="${n(r.h)}"${radius ? ` rx="${n(radius)}"` : ""}`;
    this.withShadow(fill, (sh) => `<rect ${geo}${sh || this.fillAttrs(fill) + this.strokeAttrs(stroke)}/>`);
  }

  ellipse(r: Rect, fill: string | null, stroke: StrokeStyle | null): void {
    const geo = `cx="${n(r.x + r.w / 2)}" cy="${n(r.y + r.h / 2)}" rx="${n(r.w / 2)}" ry="${n(r.h / 2)}"`;
    this.withShadow(fill, (sh) => `<ellipse ${geo}${sh || this.fillAttrs(fill) + this.strokeAttrs(stroke)}/>`);
  }

  polygon(pts: Point[], fill: string | null, stroke: StrokeStyle | null): void {
    this.parts.push(`<polygon points="${pts.map((p) => `${n(p.x)},${n(p.y)}`).join(" ")}"${this.fillAttrs(fill)}${this.strokeAttrs(stroke)}/>`);
  }

  polyline(pts: Point[], stroke: StrokeStyle, mode: "straight" | "rounded" | "curve" = "straight"): void {
    let d = "";
    tracePath(
      pts,
      mode,
      (x, y) => (d += `M${n(x)} ${n(y)}`),
      (x, y) => (d += `L${n(x)} ${n(y)}`),
      (cx, cy, x, y) => (d += `Q${n(cx)} ${n(cy)} ${n(x)} ${n(y)}`),
    );
    this.parts.push(`<path d="${d}" fill="none"${this.strokeAttrs(stroke)}/>`);
  }

  text(s: string, x: number, y: number, font: FontSpec, color: string, align: HAlign = "left", underline = false): void {
    const anchor = align === "center" ? "middle" : align === "right" ? "end" : "start";
    this.parts.push(
      `<text x="${n(x)}" y="${n(y)}" dominant-baseline="central" text-anchor="${anchor}" font-family="${esc(font.family)}, Arial, sans-serif" font-size="${font.size}"${font.bold ? ' font-weight="bold"' : ""}${font.italic ? ' font-style="italic"' : ""}${underline ? ' text-decoration="underline"' : ""} fill="${esc(color)}" xml:space="preserve">${esc(s)}</text>`,
    );
  }

  image(src: string, r: Rect): void {
    this.parts.push(`<image href="${esc(src)}" x="${n(r.x)}" y="${n(r.y)}" width="${n(r.w)}" height="${n(r.h)}"/>`);
  }

  toString(width: number, height: number, background: string | null): string {
    while (this.stack.length) this.restore();
    for (; this.base > 0; this.base--) this.parts.push("</g>");
    const bg = background ? `<rect width="100%" height="100%" fill="${esc(background)}"/>` : "";
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${n(width)}" height="${n(height)}" viewBox="0 0 ${n(width)} ${n(height)}">${bg}${this.parts.join("")}</svg>\n`;
  }
}
