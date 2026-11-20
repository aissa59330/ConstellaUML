// Code generation entry point: model element → files.
import type { Element } from "../core/element";
import type { Repository } from "../core/repository";
import { generateCpp } from "./langs/cpp";
import { generateCSharp } from "./langs/csharp";
import { generateJava } from "./langs/java";
import { generatePhp } from "./langs/php";
import { generatePython } from "./langs/python";
import { generateTypeScript } from "./langs/typescript";
import { collectTypes } from "./model";
import { generateSql } from "./sql";
import type { GenOptions, Language, VirtualFile } from "./types";

export * from "./types";
export { collectTypes } from "./model";
export { collectEntities, generateSql } from "./sql";
export { zipFiles } from "./zip";

const GENERATORS = {
  java: generateJava,
  csharp: generateCSharp,
  cpp: generateCpp,
  python: generatePython,
  typescript: generateTypeScript,
  php: generatePhp,
};

export function generate(repo: Repository, base: Element, lang: Language, o: GenOptions): VirtualFile[] {
  if (lang === "sql") return [{ path: `${(base.name || "schema").replace(/[^\w.-]+/g, "_")}.sql`, content: generateSql(repo, base, o) }];
  return GENERATORS[lang](collectTypes(repo, base, o), o);
}
