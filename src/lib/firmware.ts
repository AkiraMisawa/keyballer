// Loading firmware to flash from the config repository's `firmware` branch, checked against the
// build run first (see provenance.ts). The manifest used here is the one whose bytes were checked,
// not the one shown in the list, so a file path cannot be swapped in between.

import { LocalizedError } from '../i18n/core';
import {
  compareCommits,
  getBranchHead,
  getCommitInfo,
  getDefaultBranch,
  getFirmwareBytes,
  getProvenanceRun,
  getRunArtifacts,
  repoName,
  type CommitInfo,
  type RepoRef,
} from './github';
import { parseIntelHex } from './ihex';
import { isCommitSha, parseManifest, type FirmwareBuild } from './manifest';
import { BRANCH, judgeProvenance, keyballerWorkflowSha, manifestArtifactName, sha256Hex } from './provenance';

/** Keyballer's own repository, home of the build workflow. */
const KEYBALLER_REPO: RepoRef = { owner: 'AkiraMisawa', repo: 'keyballer' };

/** Where checked firmware came from, for the flash dialog. */
export interface FirmwareSource extends CommitInfo {
  repository: string;
  branch: string;
  runUrl: string;
  /** How many commits the default branch has gained since this firmware's commit. */
  behindBy: number;
  /**
   * Against the last firmware flashed from this repository with Keyballer: commits added since
   * (`newer`), and commits it lacks that the last one had (`older`, a rollback).
   */
  sinceLast: { sha: string; newer: number; older: number; url: string } | null;
}

export interface VerifiedFirmware {
  build: FirmwareBuild;
  image: Uint8Array;
  source: FirmwareSource;
}

const MANIFEST = 'manifest.json';

export async function loadVerifiedFirmware(
  r: RepoRef,
  firmwareSha: string,
  buildId: string,
  token: string,
  /** The source commit of the last firmware flashed from this repository, if remembered. */
  lastFlashed?: string,
): Promise<VerifiedFirmware> {
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
  const manifestDigest = await sha256Hex(manifestBytes);

  // Lookups go to the connected repository, never to one the manifest names.
  const [run, artifacts, defaultBranch] = await Promise.all([
    getProvenanceRun(r, manifest.run.id, token),
    getRunArtifacts(r, manifest.run.id, manifestArtifactName(manifestDigest), token),
    getDefaultBranch(r, token),
  ]);
  // Still on the default branch? Compared by SHA, so a tag named like the branch cannot answer.
  const head = await getBranchHead(r, defaultBranch, token);
  const sinceSource = await compareCommits(r, head, manifest.source.sha, token);
  // The Keyballer workflow commit the run used must be on Keyballer's main (public; no token).
  const workflowSha = keyballerWorkflowSha(run);
  let workflowOnKeyballerMain = false;
  if (workflowSha && isCommitSha(workflowSha)) {
    const keyballerHead = await getBranchHead(KEYBALLER_REPO, BRANCH, '');
    const status = (await compareCommits(KEYBALLER_REPO, keyballerHead, workflowSha, '')).status;
    workflowOnKeyballerMain = status === 'identical' || status === 'behind';
  }
  const verdict = judgeProvenance({
    run,
    artifacts,
    defaultBranch,
    manifest: { sourceSha: manifest.source.sha, runId: manifest.run.id, digest: manifestDigest },
    file: { expected: build.sha256, actual: await sha256Hex(hex) },
    branchStatus: sinceSource.status,
    workflowOnKeyballerMain,
  });
  if (!verdict.ok) throw new LocalizedError(verdict.reason);

  const commit = await getCommitInfo(r, manifest.source.sha, token);
  let sinceLast: FirmwareSource['sinceLast'] = null;
  if (lastFlashed && isCommitSha(lastFlashed) && lastFlashed !== manifest.source.sha) {
    try {
      const since = await compareCommits(r, lastFlashed, manifest.source.sha, token);
      sinceLast = { sha: lastFlashed, newer: since.aheadBy, older: since.behindBy, url: since.url };
    } catch {
      // The remembered commit may be gone; the dialog then shows no comparison.
    }
  }
  const { data } = parseIntelHex(new TextDecoder().decode(hex));
  const repository = repoName(r);
  return {
    build,
    image: data,
    source: {
      ...commit,
      repository,
      branch: defaultBranch,
      runUrl: `https://github.com/${repository}/actions/runs/${run.id}`,
      behindBy: sinceSource.behindBy,
      sinceLast,
    },
  };
}
