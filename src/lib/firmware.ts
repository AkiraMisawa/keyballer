// Loading firmware to flash from the config repository's `firmware` branch, checked against the
// build's record first (see provenance.ts). The manifest used here is the one whose bytes were
// checked, not the one shown in the list, so a file path cannot be swapped in between.

import { LocalizedError } from '../i18n/core';
import {
  getCheckRuns,
  getCommitInfo,
  getDefaultBranch,
  getFirmwareBytes,
  isOnBranch,
  repoName,
  type CommitInfo,
  type RepoRef,
} from './github';
import { parseIntelHex } from './ihex';
import { parseManifest, type FirmwareBuild } from './manifest';
import { judgeProvenance, PROVENANCE_CHECK, sha256Hex } from './provenance';

/** Where checked firmware came from, for the flash dialog. */
export interface FirmwareSource extends CommitInfo {
  repository: string;
}

export interface VerifiedFirmware {
  build: FirmwareBuild;
  image: Uint8Array;
  source: FirmwareSource;
}

const MANIFEST = 'manifest.json';

export async function loadVerifiedFirmware(r: RepoRef, firmwareSha: string, buildId: string, token: string): Promise<VerifiedFirmware> {
  const manifestBytes = await getFirmwareBytes(r, firmwareSha, MANIFEST, token);
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(manifestBytes));
  } catch {
    throw new LocalizedError('manifest.err.format');
  }
  const manifest = parseManifest(parsed);
  const build = manifest.builds.find((b) => b.id === buildId);
  if (!build) throw new LocalizedError('manifest.err.format');
  const hex = await getFirmwareBytes(r, firmwareSha, build.file, token);

  // Lookups go to the connected repository, never to one the manifest names.
  const sha = manifest.source.sha;
  const [checkRuns, branch] = await Promise.all([getCheckRuns(r, sha, PROVENANCE_CHECK, token), getDefaultBranch(r, token)]);
  const onDefaultBranch = await isOnBranch(r, branch, sha, token);
  const verdict = judgeProvenance({
    sha,
    checkRuns,
    files: [
      { path: MANIFEST, digest: await sha256Hex(manifestBytes) },
      { path: build.file, digest: await sha256Hex(hex) },
    ],
    onDefaultBranch,
  });
  if (!verdict.ok) throw new LocalizedError(verdict.reason);

  const commit = await getCommitInfo(r, sha, token);
  const { data } = parseIntelHex(new TextDecoder().decode(hex));
  return { build, image: data, source: { ...commit, repository: repoName(r) } };
}
