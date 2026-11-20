// Phase 3 dialogs: code generation, reverse engineering, SQL import and
// SQL → query tree.
import { For, Show, createMemo, createSignal, type JSX } from "solid-js";
import { DEFAULT_GEN_OPTIONS, type GenOptions, LANGUAGES, type Language, generate, zipFiles } from "../codegen";
import { buildUmlModel, importSchema, parseSql, reverse } from "../codegen/reverse";
import type { Element } from "../core/element";
import { meta } from "../core/meta/registry";
import { buildQueryTree, diagramOfElements } from "../notation/uml";
import { canvasMeasurer } from "../render/canvas";
import { t } from "./i18n";
import * as platform from "./platform";
import * as s from "./store";
import { Modal as BaseModal } from "./Modal";

const close = () => s.setDialog(null);

function Modal(props: { title: string; children: JSX.Element; width?: number }) {
  return (
    <BaseModal title={props.title} onClose={close} width={props.width ?? 720}>
      {props.children}
    </BaseModal>
  );
}

/** Persisted dialog options (per-user convenience). */
function remembered<T>(key: string, initial: T): [() => T, (v: T) => void] {
  let start = initial;
  try {
    const raw = localStorage.getItem(`constella.${key}`);
    if (raw) start = { ...initial, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  const [get, set] = createSignal<T>(start);
  return [
    get,
    (v: T) => {
      set(() => v);
      try {
        localStorage.setItem(`constella.${key}`, JSON.stringify(v));
      } catch {
        /* ignore */
      }
    },
  ];
}

/** Element the action applies to: the selected package / data model, or the project. */
function baseElement(accept: (e: Element) => boolean): Element {
  // Dialogs only open with a project; the fallback covers a project closed meanwhile.
  if (!s.repo.root) return { _type: "Project", _id: "", name: "" };
  let el = s.modelOf(s.selection()[0] ?? s.repo.root) ?? s.repo.root;
  if (meta.isKindOf(el._type, "Diagram")) el = s.repo.parentOf(el) ?? s.repo.root!;
  while (el !== s.repo.root && !accept(el)) el = s.repo.parentOf(el) ?? s.repo.root!;
  return el;
}

const isPackage = (e: Element) => meta.isKindOf(e._type, "UMLPackage");
const isDataModel = (e: Element) => e._type === "ERDDataModel";

// ---- generate ----------------------------------------------------------------------------

export function CodeGenDialog() {
  const [lang, setLang] = remembered<{ id: Language }>("codegenLang", { id: "java" });
  const [opts, setOpts] = remembered<GenOptions>("codegenOptions", DEFAULT_GEN_OPTIONS);
  const patch = (p: Partial<GenOptions>) => setOpts({ ...opts(), ...p });
  const base = () => baseElement(lang().id === "sql" ? isDataModel : isPackage);
  const files = createMemo(() => {
    s.modelVersion();
    try {
      return generate(s.repo, base(), lang().id, opts());
    } catch (e) {
      s.reportError(e);
      return [];
    }
  });
  const [current, setCurrent] = createSignal(0);
  const shown = () => files()[Math.min(current(), files().length - 1)];
  const save = async () => {
    const list = files();
    if (!list.length) return;
    const where =
      lang().id === "sql" && list.length === 1
        ? await platform.saveTextAs(list[0].path, list[0].content, [{ name: "SQL", extensions: ["sql"] }])
        : await platform.saveGeneratedFiles(list, () => zipFiles(list), `${base().name || "code"}-${lang().id}.zip`);
    if (where) s.toast(t("codegen.written", { count: list.length, where }));
  };
  return (
    <Modal title={t("codegen.title")} width={860}>
      <div class="form-grid">
        <label>{t("codegen.language")}</label>
        <select value={lang().id} onChange={(e) => (setLang({ id: e.currentTarget.value as Language }), setCurrent(0))}>
          <For each={LANGUAGES}>{(l) => <option value={l.id}>{l.label}</option>}</For>
        </select>
        <label>{t("codegen.base")}</label>
        <span class="mono">{base().name || base()._type}</span>
        <Show when={lang().id === "sql"}>
          <label>{t("codegen.dialect")}</label>
          <select value={opts().dialect} onChange={(e) => patch({ dialect: e.currentTarget.value as GenOptions["dialect"] })}>
            <option value="mysql">MySQL / MariaDB</option>
            <option value="postgresql">PostgreSQL</option>
            <option value="sqlite">SQLite</option>
          </select>
        </Show>
        <label>{t("codegen.indent")}</label>
        <select value={String(opts().indent)} onChange={(e) => patch({ indent: Number(e.currentTarget.value) })}>
          <option value="2">2 {t("codegen.spaces")}</option>
          <option value="4">4 {t("codegen.spaces")}</option>
          <option value="0">{t("codegen.tab")}</option>
        </select>
        <span />
        <div class="flag-list">
          <label class="flag">
            <input type="checkbox" checked={opts().docComments} onChange={(e) => patch({ docComments: e.currentTarget.checked })} />
            {t("codegen.docComments")}
          </label>
          <Show when={lang().id !== "sql"}>
            <label class="flag">
              <input type="checkbox" checked={opts().associationFields} onChange={(e) => patch({ associationFields: e.currentTarget.checked })} />
              {t("codegen.associationFields")}
            </label>
          </Show>
          <Show when={lang().id === "sql"}>
            <label class="flag">
              <input type="checkbox" checked={!!opts().dropTables} onChange={(e) => patch({ dropTables: e.currentTarget.checked })} />
              {t("codegen.dropTables")}
            </label>
          </Show>
        </div>
      </div>
      <div class="code-preview">
        <ul class="code-files">
          <For each={files()} fallback={<li class="muted">{t("codegen.nothing")}</li>}>
            {(f, i) => (
              <li classList={{ on: i() === current() }} onClick={() => setCurrent(i())} title={f.path}>
                {f.path}
              </li>
            )}
          </For>
        </ul>
        <pre class="code-text">{shown()?.content ?? ""}</pre>
      </div>
      <footer class="modal-footer">
        <span class="muted">{t("codegen.count", { count: files().length })}</span>
        <span class="spacer" />
        <button class="button" onClick={close}>
          {t("dialog.close")}
        </button>
        <button class="button primary" disabled={!files().length} onClick={save}>
          {lang().id === "sql" ? t("codegen.saveSql") : platform.isTauri ? t("codegen.writeFolder") : t("codegen.download")}
        </button>
      </footer>
    </Modal>
  );
}

// ---- reverse -------------------------------------------------------------------------------

export function ReverseDialog() {
  const [lang, setLang] = remembered<{ id: Language }>("reverseLang", { id: "java" });
  const [opts, setOpts] = remembered("reverseOptions", { associations: true, diagrams: true });
  const [log, setLog] = createSignal<string[]>([]);
  const [busy, setBusy] = createSignal(false);
  const run = async () => {
    const spec = LANGUAGES.find((l) => l.id === lang().id)!;
    setBusy(true);
    try {
      const picked = await platform.pickSourceFiles(spec.extensions);
      if (!picked) return;
      const result = reverse(spec.id, picked.files);
      const owner = baseElement(isPackage);
      const key = `reverse-${Date.now()}`;
      const { packages, classifiers } = buildUmlModel(s.repo, owner, result.types, { associations: opts().associations }, key);
      const lines = [t("reverse.summary", { files: picked.files.length, types: result.types.length }), ...result.errors.slice(0, 200)];
      if (opts().diagrams) {
        // One class diagram per package holding classifiers, created inside that package.
        for (const [path, pkg] of packages) {
          const own = classifiers.filter((c) => s.repo.parentOf(c) === pkg);
          if (!own.length) continue;
          const d = diagramOfElements(s.repo, pkg, "UMLClassDiagram", path ? path.split("/").pop()! : picked.folder.split(/[\\/]/).pop() || "Reverse", own, canvasMeasurer, s.theme(), key);
          s.openDiagram(d._id);
        }
        const pkgs = [...packages.entries()].filter(([path]) => path && !path.includes("/")).map(([, p]) => p);
        if (pkgs.length > 1) diagramOfElements(s.repo, owner, "UMLPackageDiagram", t("reverse.packages"), pkgs, canvasMeasurer, s.theme(), key);
      }
      setLog(lines);
      s.toast(lines[0]);
    } catch (e) {
      s.reportError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={t("reverse.title")} width={620}>
      <div class="form-grid">
        <label>{t("codegen.language")}</label>
        <select value={lang().id} onChange={(e) => setLang({ id: e.currentTarget.value as Language })}>
          <For each={LANGUAGES.filter((l) => l.reverse && l.id !== "sql")}>{(l) => <option value={l.id}>{l.label}</option>}</For>
        </select>
        <label>{t("reverse.into")}</label>
        <span class="mono">{baseElement(isPackage).name || baseElement(isPackage)._type}</span>
        <span />
        <div class="flag-list">
          <label class="flag">
            <input type="checkbox" checked={opts().associations} onChange={(e) => setOpts({ ...opts(), associations: e.currentTarget.checked })} />
            {t("reverse.associations")}
          </label>
          <label class="flag">
            <input type="checkbox" checked={opts().diagrams} onChange={(e) => setOpts({ ...opts(), diagrams: e.currentTarget.checked })} />
            {t("reverse.diagrams")}
          </label>
        </div>
      </div>
      <Show when={log().length}>
        <pre class="code-text log">{log().join("\n")}</pre>
      </Show>
      <footer class="modal-footer">
        <span class="spacer" />
        <button class="button" onClick={close}>
          {t("dialog.close")}
        </button>
        <button class="button primary" disabled={busy()} onClick={run}>
          {t("reverse.pickFolder")}
        </button>
      </footer>
    </Modal>
  );
}

// ---- SQL import & query tree -------------------------------------------------------------------

export function SqlImportDialog() {
  const [sql, setSql] = createSignal("");
  const [opts, setOpts] = remembered("sqlImportOptions", { erd: true, relational: true });
  const openFile = async () => {
    const p = await platform.pickOpenPath([{ name: "SQL", extensions: ["sql", "ddl", "txt"] }]);
    if (p) setSql(await platform.readText(p));
  };
  const run = () => {
    try {
      const schema = parseSql(sql());
      if (!schema.tables.length) throw new Error(t("sql.noTable"));
      const key = `sql-${Date.now()}`;
      const { dataModel, entities, relationships } = importSchema(s.repo, s.repo.root!, schema);
      const elements = [...entities, ...relationships];
      let first: Element | undefined;
      if (opts().erd) first = diagramOfElements(s.repo, dataModel, "ERDDiagram", t("diagram.ERDDiagram"), elements, canvasMeasurer, s.theme(), key);
      if (opts().relational) {
        const d = diagramOfElements(s.repo, dataModel, "ERDRelationalDiagram", t("diagram.ERDRelationalDiagram"), elements, canvasMeasurer, s.theme(), key);
        first ??= d;
      }
      if (first) s.openDiagram(first._id);
      s.select([dataModel]);
      s.toast(t("sql.imported", { tables: entities.length, errors: schema.errors.length }));
      close();
    } catch (e) {
      s.reportError(e);
    }
  };
  return (
    <Modal title={t("sql.importTitle")} width={680}>
      <textarea class="field-input code-input" rows={14} placeholder="CREATE TABLE …" value={sql()} onInput={(e) => setSql(e.currentTarget.value)} spellcheck={false} />
      <div class="flag-list">
        <label class="flag">
          <input type="checkbox" checked={opts().erd} onChange={(e) => setOpts({ ...opts(), erd: e.currentTarget.checked })} />
          {t("diagram.ERDDiagram")}
        </label>
        <label class="flag">
          <input type="checkbox" checked={opts().relational} onChange={(e) => setOpts({ ...opts(), relational: e.currentTarget.checked })} />
          {t("diagram.ERDRelationalDiagram")}
        </label>
      </div>
      <footer class="modal-footer">
        <button class="button" onClick={openFile}>
          {t("sql.openFile")}
        </button>
        <span class="spacer" />
        <button class="button" onClick={close}>
          {t("dialog.close")}
        </button>
        <button class="button primary" disabled={!sql().trim()} onClick={run}>
          {t("sql.import")}
        </button>
      </footer>
    </Modal>
  );
}

export function QueryTreeDialog() {
  const [sql, setSql] = createSignal("SELECT *\nFROM Album\nWHERE idAlbum = 156");
  const [algebra, setAlgebra] = createSignal(false);
  const run = () => {
    try {
      const { diagram } = buildQueryTree(s.repo, baseElement(isPackage), sql());
      if (algebra()) s.repo.transact("notation", (tx) => tx.set(diagram, "notation", "algebra"));
      s.openDiagram(diagram._id);
      s.select([diagram]);
      close();
    } catch (e) {
      s.reportError(e);
    }
  };
  return (
    <Modal title={t("queryTree.title")} width={600}>
      <textarea class="field-input code-input" rows={9} value={sql()} onInput={(e) => setSql(e.currentTarget.value)} spellcheck={false} />
      <label class="flag">
        <input type="checkbox" checked={algebra()} onChange={(e) => setAlgebra(e.currentTarget.checked)} />
        {t("queryTree.algebra")}
      </label>
      <footer class="modal-footer">
        <span class="spacer" />
        <button class="button" onClick={close}>
          {t("dialog.close")}
        </button>
        <button class="button primary" disabled={!sql().trim()} onClick={run}>
          {t("queryTree.create")}
        </button>
      </footer>
    </Modal>
  );
}
