// Settings written into the config repository's files: config.h defines and
// keyballer.json fields. Each change touches as little text as possible, and
// a change to the same value leaves the text identical.

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `#define NAME value  // comment`: the parts before, of and after the value. */
function defineLine(name: string): RegExp {
  return new RegExp(
    `^([ \\t]*#[ \\t]*define[ \\t]+${escape(name)})([ \\t]+)(.*?)([ \\t]*(?:\\/\\/.*|\\/\\*.*)?)$`,
    'm',
  );
}

/** The value of `#define NAME value`, or undefined when the file does not define it. */
export function readDefine(text: string, name: string): string | undefined {
  return defineLine(name).exec(text)?.[3];
}

/** Sets `#define NAME value`: in place when defined (keeping spacing and comment), else at the end. */
export function setDefine(text: string, name: string, value: string): string {
  const line = defineLine(name);
  if (line.test(text)) return text.replace(line, (_all, head, gap, _old, tail) => `${head}${gap}${value}${tail}`);
  const ending = text === '' || text.endsWith('\n') ? '' : '\n';
  return `${text}${ending}#define ${name} ${value}\n`;
}

/** A `#define NAME` line, with or without a value: what `#ifdef NAME` sees. */
const flagLine = (name: string, flags = 'm') =>
  new RegExp(`^[ \\t]*#[ \\t]*define[ \\t]+${escape(name)}(?=[ \\t\\r\\n/]|$)[^\\n]*(?:\\n|$)`, flags);

/** The text with block comments taken out, so that a define inside one does not count. */
const withoutBlockComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));

/** Whether the file defines NAME (`#define NAME`, with or without a value). */
export function readFlag(text: string, name: string): boolean {
  return flagLine(name).test(withoutBlockComments(text));
}

/**
 * Adds `#define NAME` at the end, or removes every line that defines it (in each branch of an
 * `#if` too). A block comment that starts on such a line and goes on is kept.
 */
export function setFlag(text: string, name: string, on: boolean): string {
  if (!on) {
    return text.replace(flagLine(name, 'gm'), (line) => {
      const open = line.indexOf('/*');
      return open >= 0 && line.indexOf('*/', open) < 0 ? line.slice(open) : '';
    });
  }
  if (readFlag(text, name)) return text;
  const ending = text === '' || text.endsWith('\n') ? '' : '\n';
  return `${text}${ending}#define ${name}\n`;
}

/**
 * Sets `#define NAME value` over a keyboard's own define of it: in place when the file defines it,
 * else `#undef NAME` and the define at the end (QMK reads the keyboard's config.h first).
 */
export function setOverride(text: string, name: string, value: string): string {
  if (readDefine(text, name) !== undefined) return setDefine(text, name, value);
  const ending = text === '' || text.endsWith('\n') ? '' : '\n';
  return `${text}${ending}#undef ${name}\n#define ${name} ${value}\n`;
}

/** Sets `NAME = value` in a rules.mk: in place when set, else at the end. */
export function setRule(text: string, name: string, value: string): string {
  const line = new RegExp(`^([ \\t]*${escape(name)}[ \\t]*=[ \\t]*)(.*?)([ \\t]*(?:#.*)?)$`, 'm');
  if (line.test(text)) return text.replace(line, (_all, head, _old, tail) => `${head}${value}${tail}`);
  const ending = text === '' || text.endsWith('\n') ? '' : '\n';
  return `${text}${ending}${name} = ${value}\n`;
}

/**
 * The text span of each object in keyballer.json's "builds" array. Found by scanning the text,
 * because writing the parsed file back would reorder keys (JSON.stringify puts number-like keys
 * such as views.ball."3" first).
 */
function buildSpans(text: string): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  let depth = 0;
  let inBuilds = false;
  let objectStart = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      // The key "builds", not a string value that says builds.
      if (depth === 1 && text.slice(i, j + 1) === '"builds"' && /^\s*:/.test(text.slice(j + 1))) inBuilds = true;
      i = j;
    } else if (ch === '{' || ch === '[') {
      if (inBuilds && depth === 2 && ch === '{') objectStart = i;
      depth++;
    } else if (ch === '}' || ch === ']') {
      depth--;
      if (inBuilds && depth === 2 && ch === '}') spans.push({ start: objectStart, end: i });
      if (inBuilds && depth === 1) inBuilds = false;
    }
  }
  return spans;
}

/** Sets the trackball diameter of one build in keyballer.json, leaving the rest of the text as is. */
export const setBallMm = (text: string, buildId: string, mm: number) => setBuildValue(text, buildId, 'ball_mm', mm);

/**
 * The value of a field of an object's own (not of an object nested in it): where its value starts
 * and ends in the object's text. Only a scalar value is placed; an object or array value is null.
 */
function ownField(body: string, key: string): { start: number; end: number } | null | undefined {
  let depth = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < body.length && body[j] !== '"') j += body[j] === '\\' ? 2 : 1;
      const colon = /^\s*:\s*/.exec(body.slice(j + 1));
      if (depth === 1 && colon && body.slice(i, j + 1) === JSON.stringify(key)) {
        const start = j + 1 + colon[0].length;
        const scalar = /^("(?:[^"\\]|\\.)*"|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(body.slice(start));
        return scalar ? { start, end: start + scalar[0].length } : null;
      }
      i = j;
    } else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') depth--;
  }
  return undefined;
}

/** Sets a number or true/false field of one build in keyballer.json, leaving the rest of the text as is. */
export function setBuildValue(text: string, buildId: string, key: string, value: number | boolean): string {
  const span = buildSpans(text).find((s) => (JSON.parse(text.slice(s.start, s.end + 1)) as { id?: string }).id === buildId);
  if (!span) throw new Error(`keyballer.json has no build ${buildId}`);
  const body = text.slice(span.start, span.end + 1);
  const field = ownField(body, key);
  if (field === null) throw new Error(`builds[].${key} of ${buildId} is not a single value`);
  let next: string;
  if (field) {
    next = body.slice(0, field.start) + String(value) + body.slice(field.end);
  } else {
    // After the last field, on its own line, indented like the object's fields.
    const lastField = body.slice(0, body.lastIndexOf('}')).trimEnd();
    const indent = /^\{[ \t]*\r?\n([ \t]*)"/.exec(body)?.[1] ?? '  ';
    const ownLine = /^\{[ \t]*\r?\n/.test(body);
    next = `${lastField},${ownLine ? `\n${indent}` : ' '}"${key}": ${value}${body.slice(lastField.length)}`;
  }
  return text.slice(0, span.start) + next + text.slice(span.end + 1);
}
