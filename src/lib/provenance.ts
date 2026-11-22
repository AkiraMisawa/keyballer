// Firmware provenance. Keyballer's build workflow (build-qmk.yml) writes each firmware file's
// SHA-256 into manifest.json, then keeps an artifact named after the manifest's own SHA-256 with
// its workflow run. Before flashing, the run named in the manifest must:
// - have been started by a push or a manual dispatch on the default branch, for the manifest's commit;
// - use Keyballer's build-qmk.yml or build-zmk.yml, and have succeeded;
// - hold that artifact, not yet expired;
// and the firmware's bytes must match the manifest.
// GitHub sets a run's branch, event, commit and workflows, and only a run can hold artifacts. So a
// token that rewrites the firmware branch, or runs a workflow of its own on another branch,
// cannot vouch for different bytes. Changing what main builds is a commit on main, which the
// flash dialog shows.

import type { MessageKey } from '../i18n/messages';

/** The reusable workflows that config repositories call to build firmware (QMK, ZMK); any ref. */
const KEYBALLER_WORKFLOWS = ['build-qmk.yml', 'build-zmk.yml'].map((f) => `AkiraMisawa/keyballer/.github/workflows/${f}@`);
const isKeyballerWorkflow = (path: string) => KEYBALLER_WORKFLOWS.some((prefix) => path.startsWith(prefix));
/** Keyballer builds, saves and flashes from this branch (the editor commits to it too). */
export const BRANCH = 'main';

/** The Keyballer workflow commit a run used, if it used Keyballer's workflow. */
export const keyballerWorkflowSha = (run: ProvenanceRun): string | undefined =>
  (run.referenced_workflows ?? []).find((w) => isKeyballerWorkflow(w.path))?.sha;

/** The fields of a GitHub Actions workflow run that provenance reads. */
export interface ProvenanceRun {
  id: number;
  event: string;
  head_branch: string | null;
  head_sha: string;
  status: string | null;
  conclusion: string | null;
  referenced_workflows?: { path: string; sha?: string }[] | null;
}

export interface RunArtifact {
  name: string;
  expired: boolean;
}

export type Verdict = { ok: true } | { ok: false; reason: MessageKey };

/** How the source commit relates to the default branch head, as the compare API reports it. */
export type CompareStatus = 'identical' | 'behind' | 'ahead' | 'diverged';

export const manifestArtifactName = (manifestDigest: string) => `keyballer-manifest-${manifestDigest}`;

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const STARTED_ON_PURPOSE = new Set(['push', 'workflow_dispatch']);
const STILL_ON_BRANCH = new Set<CompareStatus>(['identical', 'behind']);

export function judgeProvenance({
  run,
  artifacts,
  defaultBranch,
  manifest,
  file,
  branchStatus,
  workflowOnKeyballerMain,
}: {
  run: ProvenanceRun;
  artifacts: readonly RunArtifact[];
  defaultBranch: string;
  /** What the manifest says about its build, and the SHA-256 of its bytes. */
  manifest: { sourceSha: string; runId: number; digest: string };
  /** The firmware file's SHA-256 as the manifest lists it, and as downloaded. */
  file: { expected: string | undefined; actual: string };
  /**
   * The compare API's status for <default branch head>...<source commit>: `identical` or `behind`
   * when the commit is still on the default branch. Anything else means it was force-pushed away.
   */
  branchStatus: CompareStatus;
  /**
   * Whether the Keyballer workflow commit the run used is on Keyballer's own main branch. GitHub
   * serves a fork's commits through the parent's name, so a SHA alone is not Keyballer's code.
   */
  workflowOnKeyballerMain: boolean;
}): Verdict {
  const usesKeyballer = (run.referenced_workflows ?? []).some((w) => isKeyballerWorkflow(w.path));
  const isTheBuild =
    run.id === manifest.runId &&
    run.head_sha === manifest.sourceSha &&
    usesKeyballer &&
    run.status === 'completed' &&
    run.conclusion === 'success';
  if (!isTheBuild || file.expected === undefined) return { ok: false, reason: 'provenance.err.noRecord' };
  if (!workflowOnKeyballerMain) return { ok: false, reason: 'provenance.err.workflow' };
  // Exactly "main": a renamed or look-alike default branch (Cyrillic "а") is not it.
  if (defaultBranch !== BRANCH) return { ok: false, reason: 'provenance.err.notMain' };
  if (run.head_branch !== defaultBranch || !STARTED_ON_PURPOSE.has(run.event) || !STILL_ON_BRANCH.has(branchStatus)) {
    return { ok: false, reason: 'provenance.err.notDefault' };
  }
  const record = artifacts.find((a) => a.name === manifestArtifactName(manifest.digest));
  if (!record) return { ok: false, reason: 'provenance.err.noRecord' };
  if (record.expired) return { ok: false, reason: 'provenance.err.expired' };
  if (file.actual !== file.expected) return { ok: false, reason: 'provenance.err.mismatch' };
  return { ok: true };
}
