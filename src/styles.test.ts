// Checks the colour tokens in styles.css against the contrast pairs in
// DESIGN.md, for both the light and the dark theme.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Read the file directly: Vitest does not load CSS contents, even with ?raw.
const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

function tokens(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) out[m[1]] = m[2];
  return out;
}

const light = tokens(css.match(/^:root\s*\{([^}]*)\}/m)![1]);
const dark = tokens(css.match(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([^}]*)\}/)![1]);

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// [foreground, background, minimum ratio] — keep in sync with DESIGN.md §2.
const PAIRS: [string, string, number][] = [
  ...['bg', 'surface', 'cap'].flatMap((bg): [string, string, number][] => [
    ['text', bg, 4.5],
    ['muted', bg, 4.5],
  ]),
  ['ink-text', 'ink', 4.5],
  ['ok', 'ok-soft', 4.5],
  ['busy', 'busy-soft', 4.5],
  ['err', 'err-soft', 4.5],
  ['err', 'bg', 4.5],
  ['err', 'surface', 4.5],
  ...['bg', 'surface', 'cap'].flatMap((bg): [string, string, number][] => [
    ['edge', bg, 3],
    ['ball', bg, 3],
  ]),
  ['focus', 'bg', 3],
  ['focus', 'surface', 3],
];

describe.each([
  ['light', light],
  ['dark', dark],
])('%s theme', (_name, theme) => {
  it('defines the same tokens as the other theme', () => {
    expect(Object.keys(theme).sort()).toEqual(Object.keys(light).sort());
  });

  it.each(PAIRS)('--%s on --%s reaches %s:1', (fg, bg, min) => {
    expect(theme[fg], `--${fg}`).toBeDefined();
    expect(theme[bg], `--${bg}`).toBeDefined();
    expect(contrast(theme[fg], theme[bg])).toBeGreaterThanOrEqual(min);
  });
});
