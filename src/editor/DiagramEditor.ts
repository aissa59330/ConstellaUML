// Interactive diagram editor on a <canvas>. Rendering is immediate-mode: any
// change (model, selection, viewport) schedules one redraw of the whole scene.
import type { Element } from "../core/element";
import { ref } from "../core/element";
import { meta } from "../core/meta/registry";
import type { Repository } from "../core/repository";
import { formatPoints, labelPolar, parsePoints, routeOf, LS_CURVE, LS_OBLIQUE } from "../notation/edges";
import {
  type EdgeTool,
  type NodeTool,
  CommandError,
  createEdge,
  createNode,
  createText,
  findTool,
  moveViews,
  resizeView,
} from "../notation/uml";
import { type RenderCtx, boundsOf, isEdgeView, viewKind } from "../notation/views";
import { CanvasGraphics, canvasMeasurer } from "../render/canvas";
import { type Theme, resolveColor } from "../render/colors";
import { arrangeDiagram, diagramBounds, drawDiagram, hitTest } from "../render/diagram";
import { type Point, type Rect, contains, intersects } from "../render/graphics";

export interface EditorHost {
  repo: Repository;
  diagram(): Element | undefined;
  theme(): Theme;
  selection(): Element[];
  select(els: Element[]): void;
  tool(): string | null;
  setTool(id: string | null): void;
  toolSticky(): boolean;
  showGrid(): boolean;
  snapToGrid(): boolean;
  grid: number;
  onError(e: unknown): void;
  onQuickEdit(target: Element, view: Element, screen: Rect): void;
  onContextMenu(x: number, y: number): void;
  onViewportChange(): void;
  onFormatPainter?(target: Element): boolean;
}

type Drag =
  | { kind: "move"; start: Point; last: Point; views: Element[]; key: string; moved: boolean }
  | { kind: "resize"; view: Element; handle: number; start: Point; orig: Rect; key: string }
  | { kind: "rubber"; start: Point; current: Point; additive: boolean }
  | { kind: "pan"; startClient: Point; origScroll: Point }
  | { kind: "create"; tool: NodeTool; start: Point; current: Point }
  | { kind: "connect"; tool: EdgeTool; source: Element; current: Point }
  | { kind: "bend"; edge: Element; index: number; pts: Point[]; key: string }
  | { kind: "reconnect"; edge: Element; end: "head" | "tail"; current: Point }
  | { kind: "label"; label: Element; edge: Element; key: string };

const HANDLE = 7;
let dragSeq = 0;

export class DiagramEditor {
  zoom = 1;
  scroll: Point = { x: -40, y: -40 };
  private drag: Drag | null = null;
  private frame = 0;
  private ctx2d: CanvasRenderingContext2D;
  private resizeObserver: ResizeObserver;
  private hover: Element | null = null;

  constructor(
    readonly canvas: HTMLCanvasElement,
    private host: EditorHost,
  ) {
    this.ctx2d = canvas.getContext("2d")!;
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("dblclick", this.onDoubleClick);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    canvas.addEventListener("contextmenu", this.onContextMenu);
    this.resizeObserver = new ResizeObserver(() => this.requestRender());
    this.resizeObserver.observe(canvas.parentElement!);
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
  }

  get renderCtx(): RenderCtx {
    return { repo: this.host.repo, theme: this.host.theme(), measure: canvasMeasurer };
  }

  // ---- coordinates ---------------------------------------------------------------

  toDiagram(clientX: number, clientY: number): Point {
    const r = this.canvas.getBoundingClientRect();
    return { x: (clientX - r.left) / this.zoom + this.scroll.x, y: (clientY - r.top) / this.zoom + this.scroll.y };
  }

  toScreen(p: Point): Point {
    return { x: (p.x - this.scroll.x) * this.zoom, y: (p.y - this.scroll.y) * this.zoom };
  }

  viewportSize(): { w: number; h: number } {
    const r = this.canvas.parentElement!.getBoundingClientRect();
    return { w: r.width, h: r.height };
  }

  visibleRect(): Rect {
    const { w, h } = this.viewportSize();
    return { x: this.scroll.x, y: this.scroll.y, w: w / this.zoom, h: h / this.zoom };
  }

  setZoom(z: number, anchor?: Point): void {
    const nz = Math.min(4, Math.max(0.1, Math.round(z * 100) / 100));
    const { w, h } = this.viewportSize();
    const a = anchor ?? { x: this.scroll.x + w / 2 / this.zoom, y: this.scroll.y + h / 2 / this.zoom };
    const sx = (a.x - this.scroll.x) * this.zoom, sy = (a.y - this.scroll.y) * this.zoom;
    this.zoom = nz;
    this.scroll = { x: a.x - sx / nz, y: a.y - sy / nz };
    this.changed();
  }

  zoomBy(f: number): void {
    const steps = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];
    const next = f > 1 ? steps.find((s) => s > this.zoom + 0.001) : [...steps].reverse().find((s) => s < this.zoom - 0.001);
    this.setZoom(next ?? this.zoom);
  }

  fit(): void {
    const d = this.host.diagram();
    if (!d) return;
    arrangeDiagram(d, this.renderCtx);
    const b = diagramBounds(d);
    const { w, h } = this.viewportSize();
    if (!b || w === 0) return;
    const z = Math.min(2, Math.max(0.1, Math.min((w - 40) / b.w, (h - 40) / b.h)));
    this.zoom = Math.round(z * 100) / 100;
    this.scroll = { x: b.x + b.w / 2 - w / 2 / this.zoom, y: b.y + b.h / 2 - h / 2 / this.zoom };
    this.changed();
  }

  scrollTo(center: Point): void {
    const { w, h } = this.viewportSize();
    this.scroll = { x: center.x - w / 2 / this.zoom, y: center.y - h / 2 / this.zoom };
    this.changed();
  }

  /** Scrolls so that `r` is visible. */
  reveal(r: Rect): void {
    const v = this.visibleRect();
    if (contains(v, { x: r.x, y: r.y }) && contains(v, { x: r.x + r.w, y: r.y + r.h })) return;
    this.scrollTo({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
  }

  private changed(): void {
    this.requestRender();
    this.host.onViewportChange();
  }

  // ---- rendering ----------------------------------------------------------------------

  requestRender(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  render(): void {
    const { w, h } = this.viewportSize();
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.max(1, Math.floor(w * dpr)), ch = Math.max(1, Math.floor(h * dpr));
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
      this.canvas.style.width = `${w}px`;
      this.canvas.style.height = `${h}px`;
    }
    const c = this.ctx2d;
    const theme = this.host.theme();
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = resolveColor("$background", theme);
    c.fillRect(0, 0, w, h);
    const d = this.host.diagram();
    if (!d) return;
    c.scale(this.zoom, this.zoom);
    c.translate(-this.scroll.x, -this.scroll.y);
    if (this.host.showGrid()) this.drawGrid(c, theme);
    const g = new CanvasGraphics(c);
    const ctx = { ...this.renderCtx, g };
    arrangeDiagram(d, ctx);
    drawDiagram(d, ctx);
    this.drawSelection(c, theme);
    this.drawDragFeedback(c, theme);
  }

  private drawGrid(c: CanvasRenderingContext2D, theme: Theme): void {
    const step = this.host.grid * (this.zoom < 0.5 ? 4 : 1);
    const v = this.visibleRect();
    c.fillStyle = theme === "dark" ? "rgba(255,255,255,0.09)" : "rgba(0,0,0,0.12)";
    const size = 1 / this.zoom;
    for (let x = Math.floor(v.x / step) * step; x < v.x + v.w; x += step)
      for (let y = Math.floor(v.y / step) * step; y < v.y + v.h; y += step) c.fillRect(x, y, size, size);
  }

  private accent(theme: Theme): string {
    return theme === "dark" ? "#70b8ff" : "#0d74ce";
  }

  private drawSelection(c: CanvasRenderingContext2D, theme: Theme): void {
    const accent = this.accent(theme);
    const lw = 1 / this.zoom;
    const hs = HANDLE / this.zoom;
    const sel = this.host.selection();
    const diagram = this.host.diagram();
    for (const v of sel) {
      if (this.host.repo.diagramOf(v) !== diagram) continue;
      if (isEdgeView(v)) {
        const pts = routeOf(v, this.renderCtx);
        c.strokeStyle = accent;
        c.lineWidth = 3 * lw;
        c.globalAlpha = 0.35;
        c.beginPath();
        pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
        c.stroke();
        c.globalAlpha = 1;
        pts.forEach((p, i) => {
          const end = i === 0 || i === pts.length - 1;
          c.fillStyle = end ? accent : resolveColor("$background", theme);
          c.strokeStyle = accent;
          c.lineWidth = lw;
          c.beginPath();
          c.rect(p.x - hs / 2, p.y - hs / 2, hs, hs);
          c.fill();
          c.stroke();
        });
        continue;
      }
      const r = boundsOf(v);
      c.strokeStyle = accent;
      c.lineWidth = lw;
      if (v._type === "EdgeLabelView" || meta.isKindOf(v._type, "UMLFeatureView")) {
        c.fillStyle = accent;
        c.globalAlpha = 0.15;
        c.fillRect(r.x, r.y, r.w, r.h);
        c.globalAlpha = 1;
        c.strokeRect(r.x, r.y, r.w, r.h);
        continue;
      }
      c.setLineDash([4 / this.zoom, 3 / this.zoom]);
      c.strokeRect(r.x - 2 * lw, r.y - 2 * lw, r.w + 4 * lw, r.h + 4 * lw);
      c.setLineDash([]);
      for (const p of this.handlePoints(r)) {
        c.fillStyle = resolveColor("$background", theme);
        c.beginPath();
        c.rect(p.x - hs / 2, p.y - hs / 2, hs, hs);
        c.fill();
        c.stroke();
      }
    }
    if (this.hover && !sel.includes(this.hover) && this.drag?.kind === "connect") {
      const r = boundsOf(this.hover);
      c.strokeStyle = accent;
      c.lineWidth = 2 * lw;
      c.strokeRect(r.x - 3 * lw, r.y - 3 * lw, r.w + 6 * lw, r.h + 6 * lw);
    }
  }

  private drawDragFeedback(c: CanvasRenderingContext2D, theme: Theme): void {
    const d = this.drag;
    if (!d) return;
    const accent = this.accent(theme);
    c.strokeStyle = accent;
    c.lineWidth = 1 / this.zoom;
    if (d.kind === "rubber" || d.kind === "create") {
      const r = rectFrom(d.start, d.current);
      c.fillStyle = accent;
      c.globalAlpha = 0.08;
      c.fillRect(r.x, r.y, r.w, r.h);
      c.globalAlpha = 1;
      c.setLineDash([4 / this.zoom, 3 / this.zoom]);
      c.strokeRect(r.x, r.y, r.w, r.h);
      c.setLineDash([]);
    } else if (d.kind === "connect" || d.kind === "reconnect") {
      const from = d.kind === "connect" ? centerOf(boundsOf(d.source)) : routeOf(d.edge, this.renderCtx)[d.end === "head" ? 0 : routeOf(d.edge, this.renderCtx).length - 1];
      c.setLineDash([5 / this.zoom, 4 / this.zoom]);
      c.beginPath();
      c.moveTo(from.x, from.y);
      c.lineTo(d.current.x, d.current.y);
      c.stroke();
      c.setLineDash([]);
    }
  }

  private handlePoints(r: Rect): Point[] {
    const xs = [r.x, r.x + r.w / 2, r.x + r.w], ys = [r.y, r.y + r.h / 2, r.y + r.h];
    // Order: NW, N, NE, E, SE, S, SW, W
    return [
      { x: xs[0], y: ys[0] },
      { x: xs[1], y: ys[0] },
      { x: xs[2], y: ys[0] },
      { x: xs[2], y: ys[1] },
      { x: xs[2], y: ys[2] },
      { x: xs[1], y: ys[2] },
      { x: xs[0], y: ys[2] },
      { x: xs[0], y: ys[1] },
    ];
  }

  // ---- hit testing --------------------------------------------------------------------

  private hitAt(p: Point): Element | null {
    const d = this.host.diagram();
    return d ? hitTest(d, p, 5 / this.zoom, this.renderCtx) : null;
  }

  /** Node (top-level) view at p, ignoring edges, labels and feature lines. */
  private nodeAt(p: Point, exclude?: Element): Element | null {
    const d = this.host.diagram();
    if (!d) return null;
    const views = (d.ownedViews ?? []) as Element[];
    for (let i = views.length - 1; i >= 0; i--) {
      const v = views[i];
      if (v === exclude || v.visible === false) continue;
      if (isEdgeView(v)) {
        if (viewKind(v._type)?.hit?.(v, p, 5 / this.zoom, this.renderCtx) === v) return v;
        continue;
      }
      if (contains(boundsOf(v), p)) return v;
    }
    return null;
  }

  private topLevel(v: Element): Element {
    const d = this.host.diagram();
    let cur: Element | undefined = v;
    while (cur && !d?.ownedViews?.includes(cur)) cur = this.host.repo.parentOf(cur);
    return cur ?? v;
  }

  private handleAt(p: Point): { view: Element; handle: number } | null {
    const tol = HANDLE / this.zoom;
    for (const v of this.host.selection()) {
      if (isEdgeView(v) || !meta.isKindOf(v._type, "NodeView") || v._type === "EdgeLabelView" || meta.isKindOf(v._type, "UMLFeatureView")) continue;
      const pts = this.handlePoints(boundsOf(v));
      for (let i = 0; i < pts.length; i++) if (Math.abs(pts[i].x - p.x) <= tol && Math.abs(pts[i].y - p.y) <= tol) return { view: v, handle: i };
    }
    return null;
  }

  private edgePointAt(p: Point): { edge: Element; index: number; count: number } | null {
    const tol = HANDLE / this.zoom;
    for (const v of this.host.selection()) {
      if (!isEdgeView(v)) continue;
      const pts = routeOf(v, this.renderCtx);
      for (let i = 0; i < pts.length; i++) if (Math.abs(pts[i].x - p.x) <= tol && Math.abs(pts[i].y - p.y) <= tol) return { edge: v, index: i, count: pts.length };
    }
    return null;
  }

  private snap(v: number): number {
    return this.host.snapToGrid() ? Math.round(v / this.host.grid) * this.host.grid : v;
  }

  // ---- pointer --------------------------------------------------------------------------

  private onPointerDown = (e: PointerEvent): void => {
    this.canvas.focus();
    if (e.button === 2) return;
    const p = this.toDiagram(e.clientX, e.clientY);
    const diagram = this.host.diagram();
    if (!diagram) return;
    this.canvas.setPointerCapture(e.pointerId);
    if (e.button === 1 || (e.button === 0 && e.ctrlKey && !this.host.tool())) {
      this.drag = { kind: "pan", startClient: { x: e.clientX, y: e.clientY }, origScroll: { ...this.scroll } };
      this.canvas.style.cursor = "grabbing";
      return;
    }
    const toolId = this.host.tool();
    const t = toolId ? findTool(toolId) : undefined;
    if (t?.kind === "node") {
      this.drag = { kind: "create", tool: t, start: { x: this.snap(p.x), y: this.snap(p.y) }, current: p };
      return;
    }
    if (t?.kind === "edge") {
      const src = this.nodeAt(p);
      if (src) this.drag = { kind: "connect", tool: t, source: src, current: p };
      return;
    }
    const ep = this.edgePointAt(p);
    if (ep) {
      const isEnd = ep.index === 0 || ep.index === ep.count - 1;
      if (isEnd && ep.edge.head && ep.edge.tail) {
        this.drag = { kind: "reconnect", edge: ep.edge, end: ep.index === 0 ? "tail" : "head", current: p };
        return;
      }
      if (!isEnd && (ep.edge.lineStyle === LS_OBLIQUE || ep.edge.lineStyle === LS_CURVE)) {
        this.drag = { kind: "bend", edge: ep.edge, index: ep.index, pts: [...routeOf(ep.edge, this.renderCtx)], key: `bend${++dragSeq}` };
        return;
      }
    }
    const h = this.handleAt(p);
    if (h) {
      this.drag = { kind: "resize", view: h.view, handle: h.handle, start: p, orig: boundsOf(h.view), key: `resize${++dragSeq}` };
      return;
    }
    const hit = this.hitAt(p);
    if (!hit) {
      if (!e.shiftKey) this.host.select([]);
      this.drag = { kind: "rubber", start: p, current: p, additive: e.shiftKey };
      return;
    }
    if (this.host.onFormatPainter?.(hit)) return;
    const sel = this.host.selection();
    if (e.shiftKey) {
      this.host.select(sel.includes(hit) ? sel.filter((s) => s !== hit) : [...sel, hit]);
      return;
    }
    if (!sel.includes(hit)) this.host.select([hit]);
    if (hit._type === "EdgeLabelView") {
      const edge = this.host.repo.deref(hit.hostEdge);
      if (edge) this.drag = { kind: "label", label: hit, edge, key: `label${++dragSeq}` };
      return;
    }
    // Moving a feature line moves its classifier.
    const movable = (sel.includes(hit) ? sel : [hit]).map((v) => this.topLevel(v));
    if (isEdgeView(hit) && !(hit.lineStyle === LS_OBLIQUE || hit.lineStyle === LS_CURVE)) return;
    this.drag = { kind: "move", start: p, last: p, views: [...new Set(movable)], key: `move${++dragSeq}`, moved: false };
  };

  private onPointerMove = (e: PointerEvent): void => {
    const p = this.toDiagram(e.clientX, e.clientY);
    const d = this.drag;
    if (!d) {
      this.updateCursor(p);
      return;
    }
    try {
      switch (d.kind) {
        case "pan":
          this.scroll = { x: d.origScroll.x - (e.clientX - d.startClient.x) / this.zoom, y: d.origScroll.y - (e.clientY - d.startClient.y) / this.zoom };
          this.changed();
          return;
        case "rubber":
        case "create":
          d.current = p;
          break;
        case "connect":
        case "reconnect":
          d.current = p;
          this.hover = this.nodeAt(p, d.kind === "reconnect" ? d.edge : undefined);
          break;
        case "move": {
          const anchor = d.views.find((v) => meta.isKindOf(v._type, "NodeView"));
          let dx = p.x - d.last.x, dy = p.y - d.last.y;
          if (anchor && this.host.snapToGrid()) {
            const total = { x: p.x - d.start.x, y: p.y - d.start.y };
            const origX = anchor.left - (d.last.x - d.start.x), origY = anchor.top - (d.last.y - d.start.y);
            dx = this.snap(origX + total.x) - anchor.left;
            dy = this.snap(origY + total.y) - anchor.top;
          }
          if (dx || dy) {
            moveViews(this.host.repo, d.views, dx, dy, d.key);
            d.last = { x: d.last.x + dx, y: d.last.y + dy };
            d.moved = true;
          }
          break;
        }
        case "resize": {
          const r = { ...d.orig };
          const dx = p.x - d.start.x, dy = p.y - d.start.y;
          const h = d.handle;
          if (h === 0 || h === 6 || h === 7) {
            r.x = this.snap(d.orig.x + dx);
            r.w = d.orig.x + d.orig.w - r.x;
          }
          if (h === 2 || h === 3 || h === 4) r.w = this.snap(d.orig.x + d.orig.w + dx) - d.orig.x;
          if (h === 0 || h === 1 || h === 2) {
            r.y = this.snap(d.orig.y + dy);
            r.h = d.orig.y + d.orig.h - r.y;
          }
          if (h === 4 || h === 5 || h === 6) r.h = this.snap(d.orig.y + d.orig.h + dy) - d.orig.y;
          if (r.w >= 10 && r.h >= 10) resizeView(this.host.repo, d.view, r, d.key);
          break;
        }
        case "bend": {
          const pts = [...d.pts];
          pts[d.index] = { x: this.snap(p.x), y: this.snap(p.y) };
          this.host.repo.transact("Move point", (tx) => tx.set(d.edge, "points", formatPoints(pts)), d.key);
          break;
        }
        case "label": {
          const pts = routeOf(d.edge, this.renderCtx);
          const polar = labelPolar(pts, d.label.edgePosition ?? 1, p);
          this.host.repo.transact(
            "Move label",
            (tx) => {
              tx.set(d.label, "alpha", polar.alpha);
              tx.set(d.label, "distance", polar.distance);
            },
            d.key,
          );
          break;
        }
      }
    } catch (err) {
      this.host.onError(err);
      this.drag = null;
    }
    this.requestRender();
  };

  private onPointerUp = (e: PointerEvent): void => {
    const d = this.drag;
    this.drag = null;
    this.canvas.style.cursor = "";
    this.hover = null;
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    if (!d) return;
    const diagram = this.host.diagram();
    const p = this.toDiagram(e.clientX, e.clientY);
    try {
      if (d.kind === "rubber") {
        const r = rectFrom(d.start, d.current);
        if (r.w > 2 || r.h > 2) {
          const inside = ((diagram?.ownedViews ?? []) as Element[]).filter((v) => {
            if (v.visible === false) return false;
            if (isEdgeView(v)) return routeOf(v, this.renderCtx).every((pt) => contains(r, pt));
            return intersects(r, boundsOf(v));
          });
          this.host.select(d.additive ? [...new Set([...this.host.selection(), ...inside])] : inside);
        }
      } else if (d.kind === "create" && diagram) {
        let r = rectFrom(d.start, { x: this.snap(d.current.x), y: this.snap(d.current.y) });
        if (r.w < 10 || r.h < 10) r = { x: d.start.x, y: d.start.y, w: d.tool.size[0], h: d.tool.size[1] };
        const view = createNode(this.host.repo, diagram, d.tool, r);
        this.finishTool();
        this.host.select([view]);
        if (d.tool.modelType) this.startQuickEdit(view);
      } else if (d.kind === "connect" && diagram) {
        const target = this.nodeAt(p);
        if (target) {
          const view = createEdge(this.host.repo, diagram, d.tool, d.source, target);
          this.finishTool();
          this.host.select([view]);
        }
      } else if (d.kind === "reconnect") {
        const target = this.nodeAt(p, d.edge);
        if (target) this.reconnect(d.edge, d.end, target);
      } else if (d.kind === "move" && !d.moved) {
        // plain click: keep selection as set in pointerdown
      }
    } catch (err) {
      this.host.onError(err);
    }
    this.requestRender();
  };

  private finishTool(): void {
    if (!this.host.toolSticky()) this.host.setTool(null);
  }

  /** Moves one end of an edge to another node, updating the relationship too. */
  private reconnect(edge: Element, end: "head" | "tail", target: Element): void {
    const repo = this.host.repo;
    const model = repo.deref(edge.model);
    const targetModel = repo.deref(target.model);
    if (model && !targetModel) throw new CommandError("Ce lien doit relier des éléments du modèle.");
    repo.transact("Reconnect", (tx) => {
      tx.set(edge, end, ref(target));
      if (!model || !targetModel) return;
      if (model._type === "UMLAssociation") {
        const e = end === "tail" ? model.end1 : model.end2;
        if (e) tx.set(e, "reference", ref(targetModel));
      } else if (meta.isKindOf(model._type, "UMLDirectedRelationship")) {
        tx.set(model, end === "tail" ? "source" : "target", ref(targetModel));
      }
    });
  }

  private updateCursor(p: Point): void {
    if (this.host.tool()) {
      this.canvas.style.cursor = "crosshair";
      return;
    }
    const h = this.handleAt(p);
    if (h) {
      this.canvas.style.cursor = ["nwse-resize", "ns-resize", "nesw-resize", "ew-resize", "nwse-resize", "ns-resize", "nesw-resize", "ew-resize"][h.handle];
      return;
    }
    if (this.edgePointAt(p)) {
      this.canvas.style.cursor = "pointer";
      return;
    }
    this.canvas.style.cursor = this.hitAt(p) ? "move" : "default";
  }

  private onDoubleClick = (e: MouseEvent): void => {
    const p = this.toDiagram(e.clientX, e.clientY);
    const diagram = this.host.diagram();
    if (!diagram) return;
    const hit = this.hitAt(p);
    try {
      if (!hit) {
        const v = createText(this.host.repo, diagram, this.snap(p.x), this.snap(p.y));
        this.host.select([v]);
        this.startQuickEdit(v);
        return;
      }
      if (hit._type === "HyperlinkView") {
        const target = this.host.repo.deref(hit.reference);
        if (target) this.host.select([target]);
        else if (/^https?:\/\//.test(hit.url ?? "")) window.open(hit.url, "_blank");
        return;
      }
      this.host.select([hit]);
      this.startQuickEdit(hit);
    } catch (err) {
      this.host.onError(err);
    }
  };

  startQuickEdit(view: Element): void {
    this.render();
    let r: Rect;
    if (isEdgeView(view)) {
      const pts = routeOf(view, this.renderCtx);
      const mid = pts[Math.floor(pts.length / 2)] ?? { x: 0, y: 0 };
      r = { x: mid.x - 60, y: mid.y - 12, w: 120, h: 24 };
    } else r = boundsOf(view);
    const tl = this.toScreen({ x: r.x, y: r.y });
    this.host.onQuickEdit(view, view, { x: tl.x, y: tl.y, w: r.w * this.zoom, h: Math.min(r.h, 400) * this.zoom });
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const f = Math.exp(-e.deltaY * 0.0015);
      this.setZoom(this.zoom * f, this.toDiagram(e.clientX, e.clientY));
      return;
    }
    const dx = e.shiftKey ? e.deltaY : e.deltaX;
    const dy = e.shiftKey ? 0 : e.deltaY;
    this.scroll = { x: this.scroll.x + dx / this.zoom, y: this.scroll.y + dy / this.zoom };
    this.changed();
  };

  private onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
    const p = this.toDiagram(e.clientX, e.clientY);
    const hit = this.hitAt(p);
    if (hit && !this.host.selection().includes(hit)) this.host.select([hit]);
    if (!hit) this.host.select([]);
    this.host.onContextMenu(e.clientX, e.clientY);
  };

  /** Arrow keys: 1px, or one grid step with Shift. */
  nudge(dx: number, dy: number, big: boolean): void {
    const step = big ? this.host.grid : 1;
    const views = this.host.selection().map((v) => this.topLevel(v)).filter((v) => meta.isKindOf(v._type, "NodeView"));
    if (views.length) moveViews(this.host.repo, [...new Set(views)], dx * step, dy * step, `nudge`);
  }

  thumbnail(target: HTMLCanvasElement): void {
    const d = this.host.diagram();
    const c = target.getContext("2d");
    if (!d || !c) return;
    const theme = this.host.theme();
    const b = diagramBounds(d) ?? { x: 0, y: 0, w: 100, h: 100 };
    const v = this.visibleRect();
    const all = {
      x: Math.min(b.x, v.x) - 20,
      y: Math.min(b.y, v.y) - 20,
      w: Math.max(b.x + b.w, v.x + v.w) - Math.min(b.x, v.x) + 40,
      h: Math.max(b.y + b.h, v.y + v.h) - Math.min(b.y, v.y) + 40,
    };
    const dpr = window.devicePixelRatio || 1;
    const W = target.clientWidth, H = target.clientHeight;
    target.width = W * dpr;
    target.height = H * dpr;
    const s = Math.min(W / all.w, H / all.h);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    c.fillStyle = resolveColor("$background", theme);
    c.fillRect(0, 0, W, H);
    c.translate((W - all.w * s) / 2, (H - all.h * s) / 2);
    c.scale(s, s);
    c.translate(-all.x, -all.y);
    drawDiagram(d, { ...this.renderCtx, g: new CanvasGraphics(c) });
    c.strokeStyle = this.accent(theme);
    c.lineWidth = 2 / s;
    c.fillStyle = this.accent(theme);
    c.globalAlpha = 0.1;
    c.fillRect(v.x, v.y, v.w, v.h);
    c.globalAlpha = 1;
    c.strokeRect(v.x, v.y, v.w, v.h);
    (target as HTMLCanvasElement & { __map?: unknown }).__map = { all, s, ox: (W - all.w * s) / 2, oy: (H - all.h * s) / 2 };
  }

  /** Minimap click → diagram point. */
  minimapToDiagram(target: HTMLCanvasElement, x: number, y: number): Point | null {
    const m = (target as HTMLCanvasElement & { __map?: { all: Rect; s: number; ox: number; oy: number } }).__map;
    if (!m) return null;
    return { x: (x - m.ox) / m.s + m.all.x, y: (y - m.oy) / m.s + m.all.y };
  }

  /** Bend points and line style helpers for oblique edges, used by format commands. */
  static straighten(repo: Repository, edges: Element[]): void {
    repo.transact("Straighten", (tx) => {
      for (const e of edges) {
        const pts = parsePoints(e.points);
        if (pts.length > 2) tx.set(e, "points", formatPoints([pts[0], pts[pts.length - 1]]));
      }
    });
  }
}

function rectFrom(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

function centerOf(r: Rect): Point {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}
