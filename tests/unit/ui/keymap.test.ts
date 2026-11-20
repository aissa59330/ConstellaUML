// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { allCommands, chord, command } from "../../../src/ui/commands";

// Every row of docs/keymap.md with an id and a shortcut must be bound.
const doc = readFileSync("docs/keymap.md", "utf8");
const rows = [...doc.matchAll(/^\| [^|]+ \| `([a-z-]+:[a-z0-9-.]+)` \| `([^`]+)`/gm)].map((m) => ({ id: m[1], key: m[2] }));

const normalize = (k: string) => k.replace("Suppr", "Delete").replace("↑", "ArrowUp").replace("↓", "ArrowDown");

// Not implemented yet (later phases): validated by FEATURES.md, not silently skipped.
const LATER = new Set(["model:tag-editor", "view:thumbnails", "view:markdown-doc", "view:relationships", "view:script-console", "format:show-diagram-name", "format:suppress-columns", "format:stereotype-0..5"]);

describe("keymap parity (docs/keymap.md)", () => {
  it("parses the reference table", () => expect(rows.length).toBeGreaterThan(60));

  for (const { id, key } of rows) {
    if (LATER.has(id)) continue;
    it(`${key} → ${id}`, () => {
      const c = command(id) ?? command(id.replace(/-(show|suppress)-/, "-$1-"));
      expect(c, `command ${id} is registered`).toBeDefined();
      expect(c!.keys?.map(normalize)).toContain(normalize(key));
    });
  }

  it("binds the six stereotype display shortcuts", () => {
    for (let i = 0; i <= 5; i++) expect(command(`format:stereotype-${i}`)?.keys).toContain(`Ctrl+Shift+${i}`);
  });

  it("has no shortcut bound twice", () => {
    const seen = new Map<string, string>();
    for (const c of allCommands())
      for (const k of c.keys ?? []) {
        expect(seen.get(k), `${k} used by ${seen.get(k)} and ${c.id}`).toBeUndefined();
        seen.set(k, c.id);
      }
  });

  it("normalizes keyboard events into chords", () => {
    const ev = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);
    expect(chord(ev({ key: "P", code: "KeyP", ctrlKey: true, shiftKey: true }))).toBe("Ctrl+Shift+P");
    expect(chord(ev({ key: "Delete", code: "Delete", ctrlKey: true }))).toBe("Ctrl+Delete");
    expect(chord(ev({ key: "}", code: "BracketRight", ctrlKey: true, shiftKey: true }))).toBe("Ctrl+Shift+]");
    expect(chord(ev({ key: "!", code: "Digit1", ctrlKey: true, shiftKey: true }))).toBe("Ctrl+Shift+1");
    expect(chord(ev({ key: "l", code: "KeyL", ctrlKey: true, altKey: true }))).toBe("Ctrl+Alt+L");
    expect(chord(ev({ key: "F4", code: "F4", shiftKey: true }))).toBe("Shift+F4");
  });
});
