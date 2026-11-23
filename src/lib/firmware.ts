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
  GitHubError,
  repoName,
  type CommitInfo,
  type RepoRef,
} from './github';
import { isCommitSha, isZmk, parseManifest, type FirmwareBuild } from './manifest';
import { checkUf2 } from './uf2';
import { BRANCH, judgeProvenance, keyballerWorkflowSha, manifestArtifactName, sha256Hex } from './provenance';

/** Keyballer's own repository, home of the build workflow. */
const KEYBALLER_REPO: RepoRef = { owner: 'AkiraMisawa', repo: 'keyballer' };

/**
 * A question to Keyballer's own repository, which is public. It is asked with the token when there
 * is one, since GitHub allows 60 requests an hour without one and 5,000 with one; the token goes
 * to api.github.com only, as every request with it does. A token GitHub will not show the
 * repository to (a GitHub App's token reaches only the repositories it is installed on) is left
 * out and the question asked again.
 */
async function askKeyballer<T>(token: string, ask: (token: string) => Promise<T>): Promise<T> {
  if (!token) return ask('');
  try {
    return await ask(token);
  } catch (e) {
    // Refused for this token, but not GitHub's request limit: asking again would only spend more.
    const refused = e instanceof GitHubError && [401, 403, 404].includes(e.status) && !e.key.startsWith('gh.err.rateLimit');
    if (refused) return ask('');
    throw e;
  }
}

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
  /** The file's bytes, checked against the build's record (and, for UF2, block by block). */
  bytes: Uint8Array;
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
  const bytes = await getFirmwareBytes(r, firmwareSha, build.file, token);
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
  // The Keyballer workflow commit the run used must be on Keyballer's main.
  const workflowSha = keyballerWorkflowSha(run);
  let workflowOnKeyballerMain = false;
  if (workflowSha && isCommitSha(workflowSha)) {
    const keyballerHead = await askKeyballer(token, (t) => getBranchHead(KEYBALLER_REPO, BRANCH, t));
    const status = (await askKeyballer(token, (t) => compareCommits(KEYBALLER_REPO, keyballerHead, workflowSha, t))).status;
    workflowOnKeyballerMain = status === 'identical' || status === 'behind';
  }
  const verdict = judgeProvenance({
    run,
    artifacts,
    defaultBranch,
    manifest: { sourceSha: manifest.source.sha, runId: manifest.run.id, digest: manifestDigest },
    file: { expected: build.sha256, actual: await sha256Hex(bytes) },
    branchStatus: sinceSource.status,
    workflowOnKeyballerMain,
  });
  if (!verdict.ok) throw new LocalizedError(verdict.reason);
  // A UF2 file must also be an nRF52840 application image, as the build checked it: the bootloader
  // flashes whatever it is given, the bootloader itself included.
  if (isZmk(build)) {
    const checked = checkUf2(bytes);
    const u = build.uf2;
    if (!checked.ok || checked.uf2.blocks !== u.blocks || checked.uf2.start !== u.start || checked.uf2.end !== u.end) {
      throw new LocalizedError('uf2.err.check');
    }
  }

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
  const repository = repoName(r);
  return {
    build,
    bytes,
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
