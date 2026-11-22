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
}

export interface FirmwareManifest {
  schema: 1;
  source: { repository: string; sha: string; ref: string };
  run: { id: number; url: string };
  built_at: string;
  builds: FirmwareBuild[];
}

export function parseManifest(value: unknown): FirmwareManifest {
  const m = value as Partial<FirmwareManifest> | null;
  if (!m || m.schema !== 1 || !Array.isArray(m.builds) || !m.source?.sha) {
    throw new LocalizedError('manifest.err.format');
  }
  return m as FirmwareManifest;
}

/** Whether this app can flash the build. */
export function canFlash(build: FirmwareBuild): boolean {
  return build.bootloader === 'caterina' && build.format === 'hex';
}
