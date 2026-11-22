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
      if (depth === 1 && text.slice(i, j + 1) === '"builds"') inBuilds = true;
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
export function setBallMm(text: string, buildId: string, mm: number): string {
  const span = buildSpans(text).find((s) => (JSON.parse(text.slice(s.start, s.end + 1)) as { id?: string }).id === buildId);
  if (!span) throw new Error(`keyballer.json has no build ${buildId}`);
  const body = text.slice(span.start, span.end + 1);
  const existing = /("ball_mm"[ \t]*:[ \t]*)(-?\d+(?:\.\d+)?)/.exec(body);
  let next: string;
  if (existing) {
    next = body.replace(existing[0], `${existing[1]}${mm}`);
  } else {
    // After the last field, on its own line, indented like the object's fields.
    const lastField = body.slice(0, body.lastIndexOf('}')).trimEnd();
    const indent = /^\{[ \t]*\r?\n([ \t]*)"/.exec(body)?.[1] ?? '  ';
    next = `${lastField},\n${indent}"ball_mm": ${mm}${body.slice(lastField.length)}`;
  }
  return text.slice(0, span.start) + next + text.slice(span.end + 1);
}
