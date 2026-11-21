// Buttons around the quick-edit field: visibility on the
// left, "add" and "add a related class" actions on the right.
import { For, Show, createSignal } from "solid-js";
import type { Element } from "../core/element";
import { meta } from "../core/meta/registry";
import type { FeatureKind, LinkKind } from "../notation/uml";
import { t } from "./i18n";
import { Icon } from "./icons";

const VISIBILITIES = ["public", "protected", "private", "package"] as const;
const VIS_ICON: Record<string, string> = { public: "visPublic", protected: "visProtected", private: "visPrivate", package: "visPackage" };

export interface QuickEditActions {
  visibility(v: string): void;
  add(kind: FeatureKind): void;
  link(kind: LinkKind): void;
  move(delta: -1 | 1): void;
  remove(): void;
}

interface Button {
  icon: string;
  label: string;
  run: () => void;
}

/** Feature lists a classifier type offers in the bar. */
function addButtons(model: Element, a: QuickEditActions): Button[] {
  const type = model._type;
  const out: Button[] = [];
  if (type === "UMLEnumeration") out.push({ icon: "literal", label: "qe.addLiteral", run: () => a.add("literals") });
  if (type !== "UMLPrimitiveType") {
    out.push({ icon: "attribute", label: "qe.addAttribute", run: () => a.add("attributes") });
    out.push({ icon: "operation", label: "qe.addOperation", run: () => a.add("operations") });
  }
  if (type === "UMLClass" || type === "UMLSignal" || type === "UMLInterface") out.push({ icon: "reception", label: "qe.addReception", run: () => a.add("receptions") });
  out.push({ icon: "templateParameter", label: "qe.addTemplateParameter", run: () => a.add("templateParameters") });
  return out;
}

function linkButtons(model: Element, a: QuickEditActions): Button[] {
  const out: Button[] = [
    { icon: "superclass", label: "qe.superclass", run: () => a.link("superclass") },
    { icon: "subclass", label: "qe.subclass", run: () => a.link("subclass") },
  ];
  if (model._type !== "UMLInterface") {
    out.push({ icon: "providedInterface", label: "qe.providedInterface", run: () => a.link("providedInterface") });
    out.push({ icon: "requiredInterface", label: "qe.requiredInterface", run: () => a.link("requiredInterface") });
    out.push({ icon: "association", label: "qe.association", run: () => a.link("association") });
    out.push({ icon: "aggregation", label: "qe.aggregation", run: () => a.link("aggregation") });
    out.push({ icon: "composition", label: "qe.composition", run: () => a.link("composition") });
  }
  return out;
}

function featureButtons(a: QuickEditActions): Button[] {
  return [
    { icon: "attribute", label: "qe.addAttribute", run: () => a.add("attributes") },
    { icon: "operation", label: "qe.addOperation", run: () => a.add("operations") },
    { icon: "up", label: "qe.moveUp", run: () => a.move(-1) },
    { icon: "down", label: "qe.moveDown", run: () => a.move(1) },
    { icon: "trash", label: "qe.delete", run: () => a.remove() },
  ];
}

/** Buttons keep the text field focused (mousedown is cancelled) so nothing is committed by a blur. */
function ToolButton(props: Button) {
  return (
    <button class="qe-button" title={t(props.label)} aria-label={t(props.label)} onMouseDown={(e) => e.preventDefault()} onClick={() => props.run()}>
      <Icon name={props.icon} />
    </button>
  );
}

export function QuickEditBar(props: { model: Element; isFeature: boolean; actions: QuickEditActions }) {
  const [visOpen, setVisOpen] = createSignal(false);
  const hasVisibility = () => !!meta.field(props.model._type, "visibility");
  const isClassifier = () => !props.isFeature && meta.isKindOf(props.model._type, "UMLClassifier") && props.model._type !== "UMLUseCase" && props.model._type !== "UMLActor";
  const groups = (): Button[][] => {
    if (props.isFeature) return [featureButtons(props.actions)];
    if (!isClassifier()) return [];
    return [addButtons(props.model, props.actions), linkButtons(props.model, props.actions)];
  };
  return (
    <>
      <Show when={hasVisibility()}>
        <div class="qe-left">
          <button
            class="qe-button"
            title={t("qe.visibility")}
            aria-label={t("qe.visibility")}
            aria-haspopup="menu"
            aria-expanded={visOpen()}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setVisOpen(!visOpen())}
          >
            <Icon name={VIS_ICON[props.model.visibility ?? "public"] ?? "visPublic"} />
          </button>
          <Show when={visOpen()}>
            <div class="qe-menu" role="menu">
              <For each={VISIBILITIES}>
                {(v) => (
                  <button
                    class="menu-item"
                    role="menuitemradio"
                    aria-checked={(props.model.visibility ?? "public") === v}
                    classList={{ on: (props.model.visibility ?? "public") === v }}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setVisOpen(false);
                      props.actions.visibility(v);
                    }}
                  >
                    <Icon name={VIS_ICON[v]} />
                    <span class="menu-label">{t(`vis.${v}`)}</span>
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>
      </Show>
      <Show when={groups().length}>
        <div class="qe-right">
          <For each={groups()}>
            {(g) => (
              <div class="qe-group">
                <For each={g}>{(b) => <ToolButton {...b} />}</For>
              </div>
            )}
          </For>
        </div>
      </Show>
    </>
  );
}
