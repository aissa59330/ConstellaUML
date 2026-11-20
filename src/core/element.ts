// Elements are plain JSON-shaped objects, exactly as stored in .mdj files.
// Containment = nested objects carrying `_type`; references = `{ $ref: id }`.
// Keeping the file shape at runtime makes round-tripping lossless: unknown
// fields and unknown types simply ride along.

export interface Ref {
  $ref: string;
}

export interface Element {
  _type: string;
  _id: string;
  _parent?: Ref;
  [field: string]: any;
}

export function isRef(v: unknown): v is Ref {
  return typeof v === "object" && v !== null && !Array.isArray(v) && typeof (v as Ref).$ref === "string" && Object.keys(v).length === 1;
}

export function isElement(v: unknown): v is Element {
  return typeof v === "object" && v !== null && !Array.isArray(v) && typeof (v as Element)._type === "string" && typeof (v as Element)._id === "string";
}

export function ref(el: Element | string): Ref {
  return { $ref: typeof el === "string" ? el : el._id };
}

/** Yields every element contained (directly or not) in `el`, including `el`. */
export function* walk(el: Element): Generator<Element> {
  yield el;
  for (const key in el) {
    if (key === "_parent") continue;
    const v = el[key];
    if (Array.isArray(v)) {
      for (const item of v) if (isElement(item)) yield* walk(item);
    } else if (isElement(v)) {
      yield* walk(v);
    }
  }
}

/** Direct containment slots of an element: [field, index (-1 = single slot), child]. */
export function* children(el: Element): Generator<[string, number, Element]> {
  for (const key in el) {
    if (key === "_parent") continue;
    const v = el[key];
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) if (isElement(v[i])) yield [key, i, v[i]];
    } else if (isElement(v)) {
      yield [key, -1, v];
    }
  }
}

let lastTime = 0;
let counter = 0;

/** 20-char base64 ids, time-prefixed like the ones found in .mdj files. */
export function newId(): string {
  const bytes = new Uint8Array(14);
  let t = Date.now();
  if (t === lastTime) counter++;
  else {
    lastTime = t;
    counter = 0;
  }
  for (let i = 5; i >= 0; i--) {
    bytes[i] = t & 0xff;
    t = Math.floor(t / 256);
  }
  bytes[6] = counter & 0xff;
  crypto.getRandomValues(bytes.subarray(7));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Deep copy with fresh ids; internal references are remapped, external ones kept. */
export function cloneWithNewIds(el: Element): Element {
  const map = new Map<string, string>();
  for (const e of walk(el)) map.set(e._id, newId());
  const copy = (v: any): any => {
    if (Array.isArray(v)) return v.map(copy);
    if (isRef(v)) return { $ref: map.get(v.$ref) ?? v.$ref };
    if (v && typeof v === "object") {
      const o: any = {};
      for (const k in v) o[k] = k === "_id" ? map.get(v._id) : copy(v[k]);
      return o;
    }
    return v;
  };
  const result = copy(el) as Element;
  result._parent = el._parent ? { ...el._parent } : undefined;
  if (!result._parent) delete result._parent;
  return result;
}
