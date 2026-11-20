import { type JSX, onCleanup, onMount } from "solid-js";
import { t } from "./i18n";
import { Icon } from "./icons";

export function Modal(props: { title: string; onClose: () => void; children: JSX.Element; width?: number; class?: string }) {
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      props.onClose();
    }
  };
  onMount(() => document.addEventListener("keydown", onKey, true));
  onCleanup(() => document.removeEventListener("keydown", onKey, true));
  return (
    <div class="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class={`modal ${props.class ?? ""}`} role="dialog" aria-modal="true" aria-label={props.title} style={{ width: `min(${props.width ?? 440}px, calc(100vw - 32px))` }}>
        <header class="modal-header">
          <h2>{props.title}</h2>
          <button class="icon-button" aria-label={t("dialog.close")} onClick={props.onClose}>
            <Icon name="close" />
          </button>
        </header>
        <div class="modal-body">{props.children}</div>
      </div>
    </div>
  );
}
