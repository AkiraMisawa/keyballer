// Firmware provenance: flash only bytes that Keyballer's build workflow made for the default
// branch. manifest.json lists each firmware file's SHA-256, and the publish job keeps an artifact
// named after the manifest's own digest with its run. A run's branch, event, commit and workflows
// are set by GitHub, so a token that rewrites the firmware branch cannot make a run vouch for it.

import { describe, expect, it } from 'vitest';
import { judgeProvenance, keyballerWorkflowSha, manifestArtifactName, sha256Hex, type ProvenanceRun } from './provenance';

// FIPS 180-2, appendix B.1: SHA-256("abc"); and SHA-256 of the empty string.
const ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
const EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const SOURCE = '58e1bc2d3f4a5b6c7d8e9f00112233445566778a';
const OTHER_SHA = '0123456789abcdef0123456789abcdef01234567';

const run = (extra: Partial<ProvenanceRun> = {}): ProvenanceRun => ({
  id: 44975575890,
  event: 'push',
  head_branch: 'main',
  head_sha: SOURCE,
  status: 'completed',
  conclusion: 'success',
  // As the Actions API reports it for a config repository's build.yml.
  referenced_workflows: [{ path: 'AkiraMisawa/keyballer/.github/workflows/build-qmk.yml@main' }],
  ...extra,
});
const record = { name: `keyballer-manifest-${EMPTY}`, expired: false };
const judge = (over: Partial<Parameters<typeof judgeProvenance>[0]> = {}) =>
  judgeProvenance({
    run: run(),
    artifacts: [record],
    defaultBranch: 'main',
    manifest: { sourceSha: SOURCE, runId: 44975575890, digest: EMPTY },
    file: { expected: ABC, actual: ABC },
    // The compare API's status for <default branch head>...<source commit>.
    branchStatus: 'identical',
    // Whether the workflow commit the run used is on Keyballer's own main branch.
    workflowOnKeyballerMain: true,
    ...over,
  });

describe('sha256Hex', () => {
  it('matches the FIPS 180-2 example', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe(ABC);
  });
});

describe('manifestArtifactName', () => {
  it('names the record after the manifest digest', () => {
    expect(manifestArtifactName(EMPTY)).toBe(`keyballer-manifest-${EMPTY}`);
  });
});

describe('judgeProvenance', () => {
  it('accepts a file listed in a manifest that a default-branch build run kept a record of', () => {
    expect(judge()).toEqual({ ok: true });
    expect(judge({ run: run({ event: 'workflow_dispatch' }) })).toEqual({ ok: true });
    expect(
      judge({ run: run({ referenced_workflows: [{ path: 'AkiraMisawa/keyballer/.github/workflows/build-qmk.yml@v1.2.0' }] }) }),
    ).toEqual({ ok: true });
  });

  it('accepts a run of the ZMK workflow, and refuses one that names Keyballer twice', () => {
    const zmk = { path: 'AkiraMisawa/keyballer/.github/workflows/build-zmk.yml@main', sha: 'c'.repeat(40) };
    expect(judge({ run: run({ referenced_workflows: [zmk] }) })).toEqual({ ok: true });
    expect(keyballerWorkflowSha(run({ referenced_workflows: [zmk] }))).toBe('c'.repeat(40));
    // Only one of two references would be checked against Keyballer's main.
    const twice = run({ referenced_workflows: [zmk, { path: 'AkiraMisawa/keyballer/.github/workflows/build-qmk.yml@main', sha: 'd'.repeat(40) }] });
    expect(keyballerWorkflowSha(twice)).toBeUndefined();
    expect(judge({ run: twice })).toEqual({ ok: false, reason: 'provenance.err.noRecord' });
    for (const path of ['AkiraMisawa/keyballer/.github/workflows/build-zmk.yml.evil@main', 'someone/keyballer/.github/workflows/build-zmk.yml@main']) {
      expect(judge({ run: run({ referenced_workflows: [{ path, sha: 'c'.repeat(40) }] }) })).toEqual({ ok: false, reason: 'provenance.err.noRecord' });
    }
  });

  it('refuses when the run keeps no record of this manifest', () => {
    expect(judge({ artifacts: [] })).toEqual({ ok: false, reason: 'provenance.err.noRecord' });
    expect(judge({ artifacts: [{ name: `keyballer-manifest-${ABC}`, expired: false }] })).toEqual({
      ok: false,
      reason: 'provenance.err.noRecord',
    });
  });

  it('refuses a record that has expired', () => {
    expect(judge({ artifacts: [{ ...record, expired: true }] })).toEqual({ ok: false, reason: 'provenance.err.expired' });
  });

  it('refuses a run that is not the manifest build of this commit by Keyballer workflow', () => {
    const refused = { ok: false, reason: 'provenance.err.noRecord' };
    expect(judge({ run: run({ id: 1 }) })).toEqual(refused);
    expect(judge({ run: run({ head_sha: OTHER_SHA }) })).toEqual(refused);
    expect(judge({ run: run({ referenced_workflows: [] }) })).toEqual(refused);
    expect(judge({ run: run({ referenced_workflows: undefined }) })).toEqual(refused);
    expect(judge({ run: run({ referenced_workflows: [{ path: 'someone/keyballer/.github/workflows/build-qmk.yml@main' }] }) })).toEqual(refused);
    expect(judge({ run: run({ referenced_workflows: [{ path: 'AkiraMisawa/keyballer/.github/workflows/build-qmk.yml.evil@main' }] }) })).toEqual(refused);
    expect(judge({ run: run({ conclusion: 'failure' }) })).toEqual(refused);
    expect(judge({ run: run({ status: 'in_progress', conclusion: null }) })).toEqual(refused);
  });

  it('accepts an older build whose commit is still on the default branch', () => {
    expect(judge({ branchStatus: 'behind' })).toEqual({ ok: true });
  });

  it('refuses a commit that is no longer on the default branch (force-pushed away)', () => {
    expect(judge({ branchStatus: 'diverged' })).toEqual({ ok: false, reason: 'provenance.err.notDefault' });
    expect(judge({ branchStatus: 'ahead' })).toEqual({ ok: false, reason: 'provenance.err.notDefault' });
  });

  it('refuses a run that used a Keyballer workflow commit not on Keyballer main (a fork or imposter commit)', () => {
    expect(judge({ workflowOnKeyballerMain: false })).toEqual({ ok: false, reason: 'provenance.err.workflow' });
  });

  it('works only with main, so a renamed or look-alike default branch cannot stand in', () => {
    // A Cyrillic "а" in place of the Latin "a".
    expect(judge({ defaultBranch: 'm\u0430in', run: run({ head_branch: 'm\u0430in' }) })).toEqual({
      ok: false,
      reason: 'provenance.err.notMain',
    });
    expect(judge({ defaultBranch: 'master', run: run({ head_branch: 'master' }) })).toEqual({ ok: false, reason: 'provenance.err.notMain' });
  });

  it('refuses a build run for another branch or started some other way', () => {
    const refused = { ok: false, reason: 'provenance.err.notDefault' };
    expect(judge({ run: run({ head_branch: 'x' }) })).toEqual(refused);
    expect(judge({ run: run({ event: 'pull_request' }) })).toEqual(refused);
    expect(judge({ run: run({ event: 'workflow_run' }) })).toEqual(refused);
  });

  it('refuses a file that differs from the manifest, or a manifest without digests', () => {
    expect(judge({ file: { expected: ABC, actual: EMPTY } })).toEqual({ ok: false, reason: 'provenance.err.mismatch' });
    expect(judge({ file: { expected: undefined, actual: ABC } })).toEqual({ ok: false, reason: 'provenance.err.noRecord' });
  });
});
