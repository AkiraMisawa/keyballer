// manifest.json comes from the config repository's `firmware` branch, so it is
// untrusted input: its paths go into GitHub API URLs with the user's token.

import { describe, expect, it } from 'vitest';
import { isPlainPath, parseManifest } from './manifest';

const SHA = '58e1bc2d3f4a5b6c7d8e9f00112233445566778a';
const build = (extra: Record<string, unknown> = {}) => ({
  id: 'keyball39',
  name: 'Keyball39',
  keyboard: 'keyball/keyball39',
  keymap: 'am338',
  file: 'keyball_keyball39_am338.hex',
  format: 'hex',
  size: 27000,
  max_size: 28672,
  processor: 'atmega32u4',
  bootloader: 'caterina',
  split: true,
  view: 'keyball39.view.json',
  ...extra,
});
const manifest = (extra: Record<string, unknown> = {}, b = build()) => ({
  schema: 1,
  source: { repository: 'AkiraMisawa/keyballer-config', sha: SHA, ref: 'refs/heads/main' },
  run: { id: 1, url: 'https://github.com/AkiraMisawa/keyballer-config/actions/runs/1' },
  built_at: '2026-11-22T00:00:00Z',
  builds: [b],
  ...extra,
});

describe('plain paths', () => {
  it('accepts file names and folders below the branch root', () => {
    expect(isPlainPath('keyball_keyball39_am338.hex')).toBe(true);
    expect(isPlainPath('views/keyball39.view.json')).toBe(true);
  });

  it('refuses paths that could leave the contents folder', () => {
    expect(isPlainPath('../../../../user/installations')).toBe(false);
    expect(isPlainPath('a/../b')).toBe(false);
    expect(isPlainPath('./a')).toBe(false);
    expect(isPlainPath('/a')).toBe(false);
    expect(isPlainPath('a//b')).toBe(false);
    expect(isPlainPath('')).toBe(false);
    expect(isPlainPath('a/')).toBe(false);
    expect(isPlainPath('%2e%2e/user')).toBe(false);
    expect(isPlainPath('a\\..\\b')).toBe(false);
    expect(isPlainPath('a?ref=x')).toBe(false);
    expect(isPlainPath('a#b')).toBe(false);
  });
});

describe('parseManifest', () => {
  it('reads a manifest written by make_manifest.py', () => {
    expect(parseManifest(manifest()).builds[0].file).toBe('keyball_keyball39_am338.hex');
  });

  it('refuses firmware and view paths that are not plain', () => {
    expect(() => parseManifest(manifest({}, build({ file: '../../../../user' })))).toThrow();
    expect(() => parseManifest(manifest({}, build({ view: '../x.view.json' })))).toThrow();
  });

  it('refuses a source commit that is not a full SHA', () => {
    expect(() => parseManifest(manifest({ source: { repository: 'a/b', sha: 'main', ref: 'x' } }))).toThrow();
    expect(() => parseManifest(manifest({ source: { repository: 'a/b', sha: SHA.slice(0, 7), ref: 'x' } }))).toThrow();
    expect(() => parseManifest(manifest({ source: { repository: 'a/b', sha: `${SHA}/../x`, ref: 'x' } }))).toThrow();
  });
});
