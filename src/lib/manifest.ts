// The manifest.json that the build workflow publishes on the `firmware`
// branch of a config repository. Written by scripts/make_manifest.py.

import { LocalizedError } from '../i18n/core';

export interface FirmwareBuild {
  id: string;
  name: string;
  keyboard: string;
  keymap: string;
  file: string;
  format: 'hex' | 'bin' | 'uf2' | string;
  size: number | null;
  max_size: number | null;
  processor: string | null;
  bootloader: string | null;
  split: boolean;
  /** The keymap view file next to the firmware, when the build could write one. */
  view?: string;
  /** Why the build could not write the keymap view. */
  view_error?: string;
  /** SHA-256 of the firmware file and of the view, written by the build. */
  sha256?: string;
  view_sha256?: string;
}

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
  for (const b of m.builds as Partial<FirmwareBuild>[]) {
    const plain = typeof b?.file === 'string' && isPlainPath(b.file) && (b.view === undefined || (typeof b.view === 'string' && isPlainPath(b.view)));
    const digests = [b?.sha256, b?.view_sha256].every((d) => d === undefined || (typeof d === 'string' && /^[0-9a-f]{64}$/.test(d)));
    if (!plain || !digests) throw new LocalizedError('manifest.err.format');
  }
  return m as FirmwareManifest;
}

/** Whether this app can flash the build. */
export function canFlash(build: FirmwareBuild): boolean {
  return build.bootloader === 'caterina' && build.format === 'hex';
}
