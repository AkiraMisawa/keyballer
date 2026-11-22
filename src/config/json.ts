// keyballer.json read and written with its keys in their written order, two
// spaces of indentation and a final newline, as Keyballer and Python's
// json.dumps(indent=2, ensure_ascii=False) write it. JSON.parse would move
// number-like keys (views.ball."3") to the front.

export type Json = null | boolean | number | string | Json[] | JsonObject;
export type JsonObject = Map<string, Json>;

export function readJson(text: string): Json {
  let at = 0;
  const fail = (): never => {
    throw new SyntaxError(`keyballer.json is not valid JSON near character ${at}`);
  };
  const space = () => {
    while (at < text.length && /\s/.test(text[at])) at++;
  };
  const value = (): Json => {
    space();
    const ch = text[at];
    if (ch === '{') {
      at++;
      const object: JsonObject = new Map();
      space();
      if (text[at] === '}') {
        at++;
        return object;
      }
      for (;;) {
        space();
        const key = value();
        if (typeof key !== 'string') fail();
        space();
        if (text[at++] !== ':') fail();
        object.set(key as string, value());
        space();
        if (text[at] === ',') at++;
        else if (text[at] === '}') {
          at++;
          return object;
        } else fail();
      }
    }
    if (ch === '[') {
      at++;
      const array: Json[] = [];
      space();
      if (text[at] === ']') {
        at++;
        return array;
      }
      for (;;) {
        array.push(value());
        space();
        if (text[at] === ',') at++;
        else if (text[at] === ']') {
          at++;
          return array;
        } else fail();
      }
    }
    // Strings, numbers and literals are read by JSON.parse itself.
    const scalar = /^(?:"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(text.slice(at));
    if (!scalar) return fail();
    at += scalar[0].length;
    return JSON.parse(scalar[0]) as Json;
  };
  const result = value();
  space();
  if (at !== text.length) fail();
  return result;
}

function write(value: Json, indent: string): string {
  const inner = `${indent}  `;
  if (value instanceof Map) {
    if (value.size === 0) return '{}';
    const lines = [...value].map(([k, v]) => `${inner}${JSON.stringify(k)}: ${write(v, inner)}`);
    return `{\n${lines.join(',\n')}\n${indent}}`;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return `[\n${value.map((v) => `${inner}${write(v, inner)}`).join(',\n')}\n${indent}]`;
  }
  return JSON.stringify(value);
}

export function writeJson(value: Json): string {
  return `${write(value, '')}\n`;
}

/** The value at a path, or undefined. */
export function getJson(doc: Json, path: (string | number)[]): Json | undefined {
  let node: Json | undefined = doc;
  for (const key of path) {
    if (node instanceof Map && typeof key === 'string') node = node.get(key);
    else if (Array.isArray(node) && typeof key === 'number') node = node[key];
    else return undefined;
  }
  return node;
}

/**
 * A copy with the value at `path` set: objects missing on the way are created, a new key goes
 * last, and undefined removes the key.
 */
export function setJson(doc: Json, path: (string | number)[], value: Json | undefined): Json {
  if (path.length === 0) return value ?? null;
  const [key, ...rest] = path;
  if (typeof key === 'number') {
    const array = Array.isArray(doc) ? [...doc] : [];
    const next = setJson(array[key] ?? null, rest, value);
    array[key] = next;
    return array;
  }
  const object: JsonObject = doc instanceof Map ? new Map(doc) : new Map();
  if (rest.length === 0 && value === undefined) {
    object.delete(key);
    return object;
  }
  object.set(key, setJson(object.get(key) ?? (typeof rest[0] === 'number' ? [] : new Map()), rest, value));
  return object;
}
