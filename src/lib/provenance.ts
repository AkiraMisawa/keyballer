// Firmware provenance. The build's publish job (build-qmk.yml) creates a check run named
// `keyballer-firmware` on the source commit, listing the SHA-256 of every file it published, in
// sha256sum's format. Check runs can only be created by GitHub Apps with Checks write: a user's
// token (signed in or personal) cannot make one. So before flashing, the bytes must match a
// successful run made by GitHub Actions, for a commit on the default branch.

import type { MessageKey } from '../i18n/messages';

export const PROVENANCE_CHECK = 'keyballer-firmware';

/** The fields of a GitHub check run that provenance reads. */
export interface CheckRun {
  name: string;
  head_sha: string;
  status: string;
  conclusion: string | null;
  app: { slug: string } | null;
  output: { text: string | null };
}

export type Verdict = { ok: true } | { ok: false; reason: MessageKey };

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** sha256sum output (`<hex>  <path>`, or `<hex> *<path>` in binary mode) as path → digest. */
export function parseDigests(text: string): Map<string, string> {
  const digests = new Map<string, string>();
  for (const line of text.split('\n')) {
    const m = /^([0-9a-f]{64}) [ *](\S+)$/.exec(line.trimEnd());
    if (m) digests.set(m[2], m[1]);
  }
  return digests;
}

/**
 * Whether the files may be flashed: one successful `keyballer-firmware` run of GitHub Actions on
 * this commit must list every file with its digest, and the commit must be on the default branch.
 */
export function judgeProvenance({
  sha,
  checkRuns,
  files,
  onDefaultBranch,
}: {
  sha: string;
  checkRuns: readonly CheckRun[];
  files: readonly { path: string; digest: string }[];
  onDefaultBranch: boolean;
}): Verdict {
  const vouching = checkRuns.filter(
    (r) =>
      r.name === PROVENANCE_CHECK &&
      r.head_sha === sha &&
      r.app?.slug === 'github-actions' &&
      r.status === 'completed' &&
      r.conclusion === 'success',
  );
  if (vouching.length === 0) return { ok: false, reason: 'provenance.err.noCheck' };
  const matches = vouching.some((r) => {
    const listed = parseDigests(r.output.text ?? '');
    return files.every((f) => listed.get(f.path) === f.digest);
  });
  if (!matches) return { ok: false, reason: 'provenance.err.mismatch' };
  if (!onDefaultBranch) return { ok: false, reason: 'provenance.err.notDefault' };
  return { ok: true };
}
