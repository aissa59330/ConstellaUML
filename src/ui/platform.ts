// Native services through Tauri, with a browser fallback so the UI can also be
// developed and tested in a plain web page (vite dev server, Playwright).
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog, save as saveDialog, ask } from "@tauri-apps/plugin-dialog";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface FileFilter {
  name: string;
  extensions: string[];
}

export const MDJ_FILTER: FileFilter = { name: "Projet UML (*.mdj)", extensions: ["mdj"] };
export const MFJ_FILTER: FileFilter = { name: "Fragment (*.mfj)", extensions: ["mfj"] };

/** Browser-only: files picked with <input type=file>, keyed by fake path. */
const browserFiles = new Map<string, string>();

export async function pickOpenPath(filters: FileFilter[]): Promise<string | null> {
  if (isTauri) {
    const p = await openDialog({ multiple: false, directory: false, filters });
    return typeof p === "string" ? p : null;
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = filters.flatMap((f) => f.extensions.map((e) => "." + e)).join(",");
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      browserFiles.set(f.name, await f.text());
      resolve(f.name);
    };
    input.click();
  });
}

export async function pickSavePath(defaultName: string, filters: FileFilter[]): Promise<string | null> {
  if (isTauri) return (await saveDialog({ defaultPath: defaultName, filters })) ?? null;
  return defaultName;
}

export async function pickFolder(): Promise<string | null> {
  if (isTauri) {
    const p = await openDialog({ directory: true, multiple: false });
    return typeof p === "string" ? p : null;
  }
  return "";
}

export async function readText(path: string): Promise<string> {
  if (isTauri) return invoke<string>("read_text_file", { path });
  const t = browserFiles.get(path);
  if (t === undefined) throw new Error(`Fichier introuvable : ${path}`);
  return t;
}

function download(name: string, data: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name.split("/").pop() ?? name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function writeText(path: string, contents: string): Promise<void> {
  if (isTauri) return invoke("write_text_file", { path, contents });
  browserFiles.set(path, contents);
  download(path, contents, "application/json");
}

export async function writeBinary(path: string, data: Uint8Array): Promise<void> {
  if (isTauri) return invoke("write_binary_file", { path, contents: Array.from(data) });
  download(path, data as BlobPart, "application/octet-stream");
}

export async function autosaveWrite(contents: string): Promise<void> {
  if (isTauri) return invoke("autosave_write", { contents });
  try {
    localStorage.setItem("constella.autosave", contents);
  } catch {
    /* quota */
  }
}

export async function autosaveRead(): Promise<string | null> {
  if (isTauri) return invoke<string | null>("autosave_read");
  try {
    return localStorage.getItem("constella.autosave");
  } catch {
    return null;
  }
}

export async function autosaveClear(): Promise<void> {
  if (isTauri) return invoke("autosave_clear");
  try {
    localStorage.removeItem("constella.autosave");
  } catch {
    /* ignore */
  }
}

export async function startupFile(): Promise<string | null> {
  return isTauri ? invoke<string | null>("startup_file") : null;
}

export async function confirm(message: string, title = "Constella"): Promise<boolean> {
  if (isTauri) return ask(message, { title, kind: "warning" });
  return window.confirm(message);
}

export async function setWindowTitle(title: string): Promise<void> {
  document.title = title;
  if (isTauri) {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setTitle(title);
  }
}

export async function quit(): Promise<void> {
  if (isTauri) {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().destroy();
  } else window.close();
}

export function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export interface SourceFile {
  path: string;
  content: string;
}

/**
 * Lets the user pick a source folder and returns its files with one of
 * `extensions` (paths relative to the folder), or null if cancelled.
 */
export async function pickSourceFiles(extensions: string[]): Promise<{ folder: string; files: SourceFile[] } | null> {
  if (isTauri) {
    const folder = await pickFolder();
    if (!folder) return null;
    return { folder, files: await invoke<SourceFile[]>("read_source_tree", { root: folder, extensions }) };
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.setAttribute("webkitdirectory", "");
    input.onchange = async () => {
      const picked = [...(input.files ?? [])].filter((f) => extensions.some((x) => f.name.endsWith(x)) && !/(^|\/)(node_modules|\.git|vendor|dist|build)\//.test(f.webkitRelativePath));
      if (!picked.length) return resolve(null);
      // Drop the top folder from "folder/a/B.java".
      const files = await Promise.all(picked.map(async (f) => ({ path: f.webkitRelativePath.split("/").slice(1).join("/") || f.name, content: await f.text() })));
      resolve({ folder: picked[0].webkitRelativePath.split("/")[0], files });
    };
    input.click();
  });
}

/** Writes generated files under a folder the user picks; in a browser, downloads them as a .zip. */
export async function saveGeneratedFiles(files: SourceFile[], zip: () => Uint8Array, zipName: string): Promise<string | null> {
  if (isTauri) {
    const folder = await pickFolder();
    if (!folder) return null;
    await invoke<number>("write_files", { root: folder, files });
    return folder;
  }
  download(zipName, zip() as BlobPart, "application/zip");
  return zipName;
}

/** Saves one text file (SQL script…) where the user chooses. */
export async function saveTextAs(defaultName: string, contents: string, filters: FileFilter[]): Promise<string | null> {
  if (isTauri) {
    const p = await pickSavePath(defaultName, filters);
    if (!p) return null;
    await writeText(p, contents);
    return p;
  }
  download(defaultName, contents, "text/plain");
  return defaultName;
}
