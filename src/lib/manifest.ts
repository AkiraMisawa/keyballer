// The manifest.json that the build workflow publishes on the `firmware`
// branch of a config repository. Written by scripts/make_manifest.py.

import { LocalizedError } from '../i18n/core';

interface BuildBase {
  id: string;
  name: string;
  file: string;
  format: 'hex' | 'bin' | 'uf2' | string;
  size: number | null;
  /** The keymap view file next to the firmware, when the build could write one. */
  view?: string;
  /** Why the build could not write the keymap view. */
  view_error?: string;
  /** SHA-256 of the firmware file and of the view, written by the build. */
  sha256?: string;
  view_sha256?: string;
}

/** A QMK build (scripts/build_qmk.py). */
export interface QmkBuild extends BuildBase {
  firmware?: 'qmk';
  keyboard: string;
  keymap: string;
  max_size: number | null;
  processor: string | null;
  bootloader: string | null;
  split: boolean;
  /** Whether it was built with LEDs (builds[].leds); missing when keyballer.json did not say. */
  leds?: boolean;
}

/**
 * What a ZMK build is for, from its .config: one half of a split keyboard, a whole one, or a reset.
 * Listed in flashing order: the central half first.
 */
const ZMK_ROLES = ['central', 'peripheral', 'standalone', 'settings_reset'] as const;
export type ZmkRole = (typeof ZMK_ROLES)[number];

/** A ZMK build (scripts/build_zmk.py): a UF2 file for the Adafruit nRF52 bootloader. */
export interface ZmkBuild extends BuildBase {
  firmware: 'zmk';
  format: 'uf2';
  /** Builds of one keyboard share a group: both halves and the settings reset. */
  group: string;
  board: string;
  shield: string;
  snippet?: string;
  role: ZmkRole;
  studio: boolean;
  /** The UF2 file's blocks and address range, as the build checked them. */
  uf2: { family: number; blocks: number; start: number; end: number };
  /** The resolved west manifest (every project at a SHA), and its SHA-256. */
  west: string;
  west_sha256?: string;
  zmk_sha: string | null;
  zephyr_sha: string | null;
  image: string;
}

export type FirmwareBuild = QmkBuild | ZmkBuild;

export const isZmk = (b: FirmwareBuild): b is ZmkBuild => b.firmware === 'zmk';

export interface FirmwareManifest {
  schema: 1;
  source: { repository: string; sha: string; ref: string };
  run: { id: number; url: string };
  built_at: string;
  builds: FirmwareBuild[];
}

/**
 * A path inside the `firmware` branch that stays there: segments of letters, digits, `_`, `-` and
 * `.`, none empty and none starting with a dot. Manifest paths go into GitHub API URLs with the
 * user's token, so `..`, encoded characters, `?` or `#` could reach other API paths.
 */
export function isPlainPath(path: string): boolean {
  return path.split('/').every((segment) => /^[A-Za-z0-9_][A-Za-z0-9._-]*$/.test(segment));
}

/** A full commit SHA, as GitHub writes it. */
export const isCommitSha = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);

export function parseManifest(value: unknown): FirmwareManifest {
  const m = value as Partial<FirmwareManifest> | null;
  if (!m || m.schema !== 1 || !Array.isArray(m.builds) || !isCommitSha(m.source?.sha)) {
    throw new LocalizedError('manifest.err.format');
  }
  for (const b of m.builds as (Partial<BuildBase> & { firmware?: string; west_sha256?: string })[]) {
    const plain = typeof b?.file === 'string' && isPlainPath(b.file) && (b.view === undefined || (typeof b.view === 'string' && isPlainPath(b.view)));
    const digests = [b?.sha256, b?.view_sha256, b?.west_sha256].every((d) => d === undefined || (typeof d === 'string' && /^[0-9a-f]{64}$/.test(d)));
    if (!plain || !digests) throw new LocalizedError('manifest.err.format');
    if (b.firmware === 'zmk' && !isZmkBuild(b as Partial<ZmkBuild>)) throw new LocalizedError('manifest.err.format');
  }
  return m as FirmwareManifest;
}

const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;

function isZmkBuild(b: Partial<ZmkBuild>): boolean {
  const u = b.uf2;
  return (
    b.format === 'uf2' &&
    typeof b.file === 'string' && b.file.endsWith('.uf2') &&
    typeof b.group === 'string' && /^[a-z0-9][a-z0-9_-]*$/.test(b.group) &&
    typeof b.board === 'string' &&
    typeof b.shield === 'string' &&
    typeof b.role === 'string' && (ZMK_ROLES as readonly string[]).includes(b.role) &&
    typeof b.west === 'string' && isPlainPath(b.west) &&
    !!u && isCount(u.family) && isCount(u.blocks) && u.blocks > 0 && isCount(u.start) && isCount(u.end) && u.start < u.end &&
    (b.zmk_sha == null || isCommitSha(b.zmk_sha)) &&
    (b.zephyr_sha == null || isCommitSha(b.zephyr_sha))
  );
}

const roleRank = (b: ZmkBuild) => ZMK_ROLES.indexOf(b.role);

/**
 * The firmware cards: one per QMK build, and the builds of each ZMK keyboard together, the central
 * half first. The settings reset has no card; the UF2 panel offers it under "fix pairing".
 */
export function firmwareCards(builds: FirmwareBuild[]): FirmwareBuild[] {
  const groups = builds.map((b) => (isZmk(b) ? b.group : `\0${b.id}`));
  const firstOf = (key: string) => groups.indexOf(key);
  return builds
    .map((b, i) => ({ b, at: firstOf(groups[i]), rank: isZmk(b) ? roleRank(b) : 0 }))
    .filter(({ b }) => !(isZmk(b) && b.role === 'settings_reset'))
    .sort((x, y) => x.at - y.at || x.rank - y.rank)
    .map(({ b }) => b);
}

/** All builds of one ZMK keyboard, in flashing order: the halves, then the settings reset. */
export function keyboardOf(builds: FirmwareBuild[], build: ZmkBuild): ZmkBuild[] {
  return builds.filter((b): b is ZmkBuild => isZmk(b) && b.group === build.group).sort((x, y) => roleRank(x) - roleRank(y));
}

/** Whether this app can flash the build. */
export function canFlash(build: FirmwareBuild): boolean {
  return !isZmk(build) && build.bootloader === 'caterina' && build.format === 'hex';
}
