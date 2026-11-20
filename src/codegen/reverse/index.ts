// Reverse engineering entry point: source files → types (or SQL → tables).
import type { Language } from "../types";
import type { ReverseResult } from "./ir";
import { reverseJava } from "./java";
import { reversePhp } from "./php";
import { reversePython } from "./python";
import { reverseTypeScript } from "./typescript";

export * from "./ir";
export { buildUmlModel, type BuildOptions } from "./build-uml";
export { importSchema } from "./build-erd";
export { parseSql, type SqlSchema } from "./sql";

const REVERSERS: Partial<Record<Language, (files: { path: string; content: string }[]) => ReverseResult>> = {
  java: reverseJava,
  python: reversePython,
  typescript: reverseTypeScript,
  php: reversePhp,
};

export function reverse(lang: Language, files: { path: string; content: string }[]): ReverseResult {
  const fn = REVERSERS[lang];
  if (!fn) throw new Error(`Pas de reverse engineering pour ${lang}.`);
  return fn(files);
}
