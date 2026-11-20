// Language-neutral result of reverse engineering source files.

export interface RField {
  name: string;
  type: string;
  visibility: string;
  isStatic: boolean;
  isReadOnly: boolean;
  defaultValue: string;
  doc: string;
}

export interface RParam {
  name: string;
  type: string;
  defaultValue: string;
}

export interface RMethod {
  name: string;
  params: RParam[];
  returnType: string;
  visibility: string;
  isStatic: boolean;
  isAbstract: boolean;
  doc: string;
}

export interface RType {
  kind: "class" | "interface" | "enum";
  name: string;
  /** Package / namespace / module path. */
  pkg: string[];
  visibility: string;
  isAbstract: boolean;
  isFinal: boolean;
  doc: string;
  supers: string[];
  interfaces: string[];
  fields: RField[];
  methods: RMethod[];
  literals: string[];
  typeParams: string[];
}

export interface ReverseResult {
  types: RType[];
  /** "file:line: message" for the parts that were skipped. */
  errors: string[];
}

export function newType(kind: RType["kind"], name: string, pkg: string[]): RType {
  return { kind, name, pkg, visibility: "public", isAbstract: false, isFinal: false, doc: "", supers: [], interfaces: [], fields: [], methods: [], literals: [], typeParams: [] };
}

/** `List<Book>`, `Book[]`, `?Book`, `Book|null`, `Optional[Book]` → element type and whether it is a collection. */
export function unwrapType(type: string): { base: string; many: boolean } {
  let t = type.trim().replace(/^\?/, "").replace(/\s*\|\s*(null|undefined|None)\b/g, "").replace(/^(Optional)\[(.*)\]$/, "$2");
  let many = false;
  const arr = /^(.*?)(\[\])+$/.exec(t);
  if (arr) {
    t = arr[1];
    many = true;
  }
  const gen = /^(?:java\.util\.)?(List|ArrayList|LinkedList|Set|HashSet|TreeSet|Collection|Iterable|Array|ReadonlyArray|Sequence|list|set|tuple|frozenset|vector|std::vector|IEnumerable|ICollection|IList)\s*[<[]\s*(.+?)\s*[>\]]$/.exec(t);
  if (gen) {
    t = gen[2];
    many = true;
  }
  if (/^array$/i.test(t)) many = true;
  return { base: t.trim(), many };
}
