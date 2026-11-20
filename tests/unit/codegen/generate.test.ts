import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_GEN_OPTIONS, type Language, type VirtualFile, generate, zipFiles } from "../../../src/codegen";
import { shopModel } from "../../fixtures/codegen-model";

const opts = { ...DEFAULT_GEN_OPTIONS };
const gen = (lang: Language) => {
  const { repo, model } = shopModel();
  return generate(repo, model, lang, opts);
};
const file = (files: VirtualFile[], path: string) => {
  const f = files.find((x) => x.path === path);
  if (!f) throw new Error(`${path} not in ${files.map((x) => x.path).join(", ")}`);
  return f.content;
};

function has(cmd: string): boolean {
  try {
    execFileSync("sh", ["-c", `command -v ${cmd}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function writeAll(files: VirtualFile[]): string {
  const dir = mkdtempSync(join(tmpdir(), "constella-gen-"));
  for (const f of files) {
    mkdirSync(dirname(join(dir, f.path)), { recursive: true });
    writeFileSync(join(dir, f.path), f.content);
  }
  return dir;
}

describe("code generation", () => {
  it("Java: packages, imports, inheritance, association fields", () => {
    const files = gen("java");
    expect(files.map((f) => f.path).sort()).toEqual(
      ["shop/domain/Book.java", "shop/domain/Category.java", "shop/domain/Order.java", "shop/domain/Printable.java", "shop/domain/Product.java", "shop/service/OrderService.java"].sort(),
    );
    const book = file(files, "shop/domain/Book.java");
    expect(book).toContain("package shop.domain;");
    expect(book).toContain("public class Book extends Product implements Printable {");
    expect(book).toContain("public Category category;");
    expect(file(files, "shop/domain/Product.java")).toContain("public abstract String describe();");
    expect(file(files, "shop/domain/Product.java")).toContain("/**\n * Something we sell.\n */");
    expect(file(files, "shop/domain/Order.java")).toContain("public List<Product> items;");
    expect(file(files, "shop/service/OrderService.java")).toContain("import shop.domain.Order;");
    expect(file(files, "shop/domain/Category.java")).toContain("BOOK,\n    FOOD;");
  });

  it("C#: namespaces, properties of interfaces, NotImplementedException", () => {
    const files = gen("csharp");
    const book = file(files, "shop/domain/Book.cs");
    expect(book).toContain("namespace shop.domain\n{");
    expect(book).toContain("public class Book : Product, Printable");
    expect(book).toContain("throw new NotImplementedException();");
    expect(book).toContain("public override string Describe()");
    expect(book).toContain("public virtual void Print(int copies)");
    expect(file(files, "shop/service/OrderService.cs")).toContain("using shop.domain;");
  });

  it.runIf(has("g++"))("C++ output compiles (g++ -fsyntax-only)", () => {
    const files = gen("cpp");
    expect(files.some((f) => f.path === "shop/domain/Book.cpp")).toBe(true);
    const dir = writeAll(files);
    for (const f of files.filter((x) => x.path.endsWith(".cpp"))) execFileSync("g++", ["-std=c++17", "-fsyntax-only", "-I", dir, join(dir, f.path)], { stdio: "pipe" });
  });

  it.runIf(has("python3"))("Python output imports and runs", () => {
    const files = gen("python");
    expect(files.some((f) => f.path === "shop/__init__.py")).toBe(true);
    const book = file(files, "shop/domain/book.py");
    expect(book).toContain("class Book(Product, Printable):");
    const dir = writeAll(files);
    const out = execFileSync("python3", ["-c", "from shop.domain.book import Book; b = Book(); print(b.isbn, Book.count)"], { cwd: dir, encoding: "utf8" });
    expect(out.trim()).toBe("None 0");
  });

  it("TypeScript output type-checks", () => {
    const files = gen("typescript");
    const book = file(files, "shop/domain/Book.ts");
    expect(book).toContain('import { Product } from "./Product";');
    expect(book).toContain('import type { Printable } from "./Printable";');
    expect(file(files, "shop/service/OrderService.ts")).toContain('from "../domain/Order"');
    const dir = writeAll(files);
    // Run from the output folder so the project's own tsconfig.json is not involved.
    execFileSync(process.execPath, [join(process.cwd(), "node_modules/typescript/bin/tsc"), "--noEmit", "--strict", "--target", "es2020", ...files.map((f) => f.path)], { cwd: dir, stdio: "pipe" });
  });

  it.runIf(has("php"))("PHP output passes php -l", () => {
    const files = gen("php");
    expect(file(files, "shop/domain/Book.php")).toContain("namespace shop\\domain;");
    const dir = writeAll(files);
    for (const f of files) execFileSync("php", ["-l", join(dir, f.path)], { stdio: "pipe" });
  });

  it("indentation and documentation options", () => {
    const { repo, model } = shopModel();
    const files = generate(repo, model, "java", { ...opts, indent: 0, docComments: false });
    const product = file(files, "shop/domain/Product.java");
    expect(product).toContain("\tprotected int id;");
    expect(product).not.toContain("Something we sell");
  });

  it("zips files readable by unzip", () => {
    const zip = zipFiles([{ path: "a/b.txt", content: "héllo" }]);
    expect([...zip.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    if (has("unzip")) {
      const dir = mkdtempSync(join(tmpdir(), "constella-zip-"));
      writeFileSync(join(dir, "x.zip"), zip);
      expect(execFileSync("unzip", ["-p", join(dir, "x.zip"), "a/b.txt"], { encoding: "utf8" })).toBe("héllo");
    }
  });
});
