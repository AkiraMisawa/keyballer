// Firmware provenance. Keyballer's build workflow (build-qmk.yml) writes each firmware file's
// SHA-256 into manifest.json, then keeps an artifact named after the manifest's own SHA-256 with
// its workflow run. Before flashing, the run named in the manifest must:
// - have been started by a push or a manual dispatch on the default branch, for the manifest's commit;
// - use Keyballer's build-qmk.yml, and have succeeded;
// - hold that artifact, not yet expired;
// and the firmware's bytes must match the manifest.
// GitHub sets a run's branch, event, commit and workflows, and only a run can hold artifacts. So a
// token that rewrites the firmware branch, or runs a workflow of its own on another branch,
// cannot vouch for different bytes. Changing what main builds is a commit on main, which the
// flash dialog shows.

import type { MessageKey } from '../i18n/messages';

/** The reusable workflow that config repositories call to build firmware; any ref of it. */
export const KEYBALLER_WORKFLOW = 'AkiraMisawa/keyballer/.github/workflows/build-qmk.yml@';

/** The fields of a GitHub Actions workflow run that provenance reads. */
export interface ProvenanceRun {
  id: number;
  event: string;
  head_branch: string | null;
  head_sha: string;
  status: string | null;
  conclusion: string | null;
  referenced_workflows?: { path: string }[] | null;
}

export interface RunArtifact {
  name: string;
  expired: boolean;
}

export type Verdict = { ok: true } | { ok: false; reason: MessageKey };

export const manifestArtifactName = (manifestDigest: string) => `keyballer-manifest-${manifestDigest}`;

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const STARTED_ON_PURPOSE = new Set(['push', 'workflow_dispatch']);
const ON_BRANCH = new Set(['identical', 'behind']);

export function judgeProvenance({
  run,
  artifacts,
  defaultBranch,
  manifest,
  file,
  onBranch,
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
  onBranch: string;
}): Verdict {
  const usesKeyballer = (run.referenced_workflows ?? []).some((w) => w.path.startsWith(KEYBALLER_WORKFLOW));
  const isTheBuild =
    run.id === manifest.runId &&
    run.head_sha === manifest.sourceSha &&
    usesKeyballer &&
    run.status === 'completed' &&
    run.conclusion === 'success';
  if (!isTheBuild || file.expected === undefined) return { ok: false, reason: 'provenance.err.noRecord' };
  if (run.head_branch !== defaultBranch || !STARTED_ON_PURPOSE.has(run.event) || !ON_BRANCH.has(onBranch)) {
    return { ok: false, reason: 'provenance.err.notDefault' };
  }
  const record = artifacts.find((a) => a.name === manifestArtifactName(manifest.digest));
  if (!record) return { ok: false, reason: 'provenance.err.noRecord' };
  if (record.expired) return { ok: false, reason: 'provenance.err.expired' };
  if (file.actual !== file.expected) return { ok: false, reason: 'provenance.err.mismatch' };
  return { ok: true };
}
