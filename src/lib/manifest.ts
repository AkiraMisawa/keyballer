// The manifest.json that the build workflow publishes on the `firmware`
// branch of a config repository. Written by scripts/make_manifest.py.

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
    throw new Error('manifest.json の形式が想定と違います');
  }
  return m as FirmwareManifest;
}

/** Whether this app can flash the build, and why not if it cannot. */
export function flashSupport(build: FirmwareBuild): { ok: true } | { ok: false; reason: string } {
  if (build.bootloader === 'caterina' && build.format === 'hex') return { ok: true };
  return {
    ok: false,
    reason: `この書き込み方式（${build.bootloader ?? '不明'} / ${build.format}）にはまだ対応していません`,
  };
}
