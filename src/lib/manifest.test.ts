// manifest.json comes from the config repository's `firmware` branch, so it is
// untrusted input: its paths go into GitHub API URLs with the user's token.

import { describe, expect, it } from 'vitest';
import { firmwareCards, isPlainPath, keyboardOf, parseManifest, type FirmwareBuild } from './manifest';

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

/** A ZMK build as scripts/build_zmk.py records it. */
const zmk = (id: string, role: string, group = 'roba', extra: Record<string, unknown> = {}) => ({
  id, name: id, firmware: 'zmk', format: 'uf2', file: `${id}.uf2`, size: 256, group, board: 'seeeduino_xiao_ble', shield: id,
  role, studio: false, west: `${id}.west.yml`, zmk_sha: SHA, zephyr_sha: SHA, image: 'i',
  uf2: { family: 0xada52840, blocks: 1, start: 0x27000, end: 0x27100 }, ...extra,
});

describe('ZMK builds in the manifest', () => {
  it('takes a ZMK build as the build records it', () => {
    expect(parseManifest(manifest({}, zmk('roba-right', 'central') as never)).builds[0]).toMatchObject({ firmware: 'zmk', role: 'central' });
  });

  it('refuses ZMK builds with fields that do not fit', () => {
    const bad: Record<string, unknown>[] = [
      { format: 'hex' },
      { file: 'roba-right.bat' },
      { role: 'leader' },
      { group: 'Ro Ba' },
      { west: '../west.yml' },
      { uf2: { family: 0xada52840, blocks: 1, start: 0x27100, end: 0x27000 } },
      { uf2: { family: 0xada52840, blocks: 0, start: 0x27000, end: 0x27100 } },
      { uf2: undefined },
      { zmk_sha: 'main' },
      { west_sha256: 'x' },
    ];
    for (const extra of bad) {
      expect(() => parseManifest(manifest({}, zmk('r', 'central', 'roba', extra) as never)), JSON.stringify(extra)).toThrow();
    }
  });
});

describe('firmwareCards and keyboardOf', () => {
  const builds = [
    build({ id: 'keyball39' }),
    zmk('roba-reset', 'settings_reset'),
    zmk('roba-left', 'peripheral'),
    zmk('m40', 'standalone', 'meteorite40'),
    zmk('roba-right', 'central'),
  ] as unknown as FirmwareBuild[];

  it('lists each keyboard once, the central half first, without the settings reset', () => {
    expect(firmwareCards(builds).map((b) => b.id)).toEqual(['keyball39', 'roba-right', 'roba-left', 'm40']);
  });

  it('gives a keyboard\'s builds in flashing order, the settings reset last', () => {
    const right = builds.find((b) => b.id === 'roba-right')!;
    expect(keyboardOf(builds, right as never).map((b) => b.id)).toEqual(['roba-right', 'roba-left', 'roba-reset']);
  });
});
