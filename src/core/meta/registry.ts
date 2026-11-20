// Declarative metamodel. Field kinds drive the property editor, defaults on
// creation and validation; serialization itself is shape-driven (see element.ts).

export type FieldKind =
  | "string"
  | "text" // multi-line
  | "boolean"
  | "integer"
  | "number"
  | "enum"
  | "ref"
  | "refs"
  | "typeRef" // a string ("String") or a reference to a classifier
  | "element"
  | "elements"
  | "color"
  | "font"
  | "points";

export interface FieldDef {
  name: string;
  kind: FieldKind;
  default?: unknown;
  options?: (string | number)[];
  /** Base type allowed for ref / refs / typeRef pickers. */
  refType?: string;
  /** Shown in the property editor (false for structural / internal fields). */
  editable?: boolean;
}

export interface TypeDef {
  name: string;
  super?: string;
  abstract?: boolean;
  fields?: FieldDef[];
  /** Containment rules: child type → field that holds it. */
  contains?: Record<string, string>;
}

export class MetaRegistry {
  private types = new Map<string, TypeDef>();
  private fieldCache = new Map<string, FieldDef[]>();

  register(defs: TypeDef[]): void {
    for (const d of defs) this.types.set(d.name, d);
    this.fieldCache.clear();
  }

  has(type: string): boolean {
    return this.types.has(type);
  }

  get(type: string): TypeDef | undefined {
    return this.types.get(type);
  }

  names(): string[] {
    return [...this.types.keys()];
  }

  /** Type chain from `type` up to the root. Unknown types yield [type]. */
  ancestors(type: string): string[] {
    const chain: string[] = [];
    let t: string | undefined = type;
    while (t && !chain.includes(t)) {
      chain.push(t);
      t = this.types.get(t)?.super;
    }
    return chain;
  }

  isKindOf(type: string, base: string): boolean {
    return this.ancestors(type).includes(base);
  }

  fields(type: string): FieldDef[] {
    let cached = this.fieldCache.get(type);
    if (!cached) {
      const seen = new Map<string, FieldDef>();
      for (const t of this.ancestors(type).reverse()) for (const f of this.types.get(t)?.fields ?? []) seen.set(f.name, f);
      cached = [...seen.values()];
      this.fieldCache.set(type, cached);
    }
    return cached;
  }

  field(type: string, name: string): FieldDef | undefined {
    return this.fields(type).find((f) => f.name === name);
  }

  defaultOf(type: string, name: string): unknown {
    return this.field(type, name)?.default;
  }

  /** Field of `ownerType` that can hold a child of `childType`, if any. */
  containerField(ownerType: string, childType: string): string | undefined {
    for (const t of this.ancestors(ownerType)) {
      const rules = this.types.get(t)?.contains;
      if (!rules) continue;
      for (const [base, field] of Object.entries(rules)) if (this.isKindOf(childType, base)) return field;
    }
    return undefined;
  }
}

export const meta = new MetaRegistry();
