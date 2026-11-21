// Color variables: `$background`, `$foreground`, `$transparent` and
// `$<hue><1..12>` resolve against the active theme, so one diagram looks
// right in both light and dark. Scales come from Radix Colors (MIT).
import * as radix from "@radix-ui/colors";

export type Theme = "light" | "dark";

export const HUES = ["slate", "gray", "red", "pink", "purple", "blue", "cyan", "green", "brown", "orange", "yellow", "lime", "mint"] as const;

const BASE: Record<Theme, Record<string, string>> = {
  light: { background: "#ffffff", foreground: "#1c2024", transparent: "transparent" },
  dark: { background: "#1b1d22", foreground: "#e6e8eb", transparent: "transparent" },
};

export function resolveColor(color: string | undefined, theme: Theme, fallback = "$foreground"): string {
  const c = color || fallback;
  if (!c.startsWith("$")) return c;
  const name = c.slice(1);
  const base = BASE[theme][name];
  if (base) return base;
  const m = /^([a-z]+)(\d{1,2})$/.exec(name);
  if (m) {
    const scale = (radix as unknown as Record<string, Record<string, string>>)[theme === "dark" ? `${m[1]}Dark` : m[1]];
    const v = scale?.[`${m[1]}${m[2]}`];
    if (v) return v;
  }
  return c === fallback ? BASE[theme].foreground : resolveColor(fallback, theme);
}

/** Palette shown by the color dialog: rows of variable names. */
export function paletteRows(): string[][] {
  return [["$background", "$foreground", "$transparent"], ...HUES.map((h) => Array.from({ length: 12 }, (_, i) => `$${h}${i + 1}`))];
}

/** Fixed light-theme colors (legacy export, older files). */
export function toLiteral(color: string): string {
  return resolveColor(color, "light");
}
