// Firmware provenance: flash only bytes that GitHub Actions built from a commit
// on the default branch. A token can rewrite the `firmware` branch, but it
// cannot create check runs, so the check run is what vouches for the bytes.

import { describe, expect, it } from 'vitest';
import { judgeProvenance, parseDigests, sha256Hex, type CheckRun } from './provenance';

// FIPS 180-2, appendix B.1: SHA-256("abc").
const ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
const OTHER = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'; // SHA-256("")
const SHA = '58e1bc2d3f4a5b6c7d8e9f00112233445566778a';

const run = (extra: Partial<CheckRun> = {}): CheckRun => ({
  name: 'keyballer-firmware',
  head_sha: SHA,
  status: 'completed',
  conclusion: 'success',
  app: { slug: 'github-actions' },
  output: { text: `${ABC}  keyball39.hex\n${OTHER}  manifest.json\n` },
  ...extra,
});
const files = [
  { path: 'keyball39.hex', digest: ABC },
  { path: 'manifest.json', digest: OTHER },
];
const judge = (checkRuns: CheckRun[], over: Partial<Parameters<typeof judgeProvenance>[0]> = {}) =>
  judgeProvenance({ sha: SHA, checkRuns, files, onDefaultBranch: true, ...over });

describe('sha256Hex', () => {
  it('matches the FIPS 180-2 example', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe(ABC);
  });
});

describe('parseDigests', () => {
  it('reads sha256sum output, in text and binary mode', () => {
    expect(parseDigests(`${ABC}  a.hex\n${OTHER} *b.json\n`)).toEqual(
      new Map([
        ['a.hex', ABC],
        ['b.json', OTHER],
      ]),
    );
  });

  it('ignores anything that is not a digest line', () => {
    expect(parseDigests(`Firmware digests\n\n${ABC.toUpperCase()}  a.hex\nnot a digest  b\n`)).toEqual(new Map());
  });
});

describe('judgeProvenance', () => {
  it('accepts bytes listed by a successful keyballer-firmware run of GitHub Actions', () => {
    expect(judge([run()])).toEqual({ ok: true });
  });

  it('refuses when no run vouches for this commit', () => {
    expect(judge([])).toEqual({ ok: false, reason: 'provenance.err.noCheck' });
    expect(judge([run({ app: { slug: 'keyballer' } })])).toEqual({ ok: false, reason: 'provenance.err.noCheck' });
    expect(judge([run({ app: null })])).toEqual({ ok: false, reason: 'provenance.err.noCheck' });
    expect(judge([run({ name: 'build' })])).toEqual({ ok: false, reason: 'provenance.err.noCheck' });
    expect(judge([run({ head_sha: OTHER.slice(0, 40) })])).toEqual({ ok: false, reason: 'provenance.err.noCheck' });
    expect(judge([run({ conclusion: 'failure' })])).toEqual({ ok: false, reason: 'provenance.err.noCheck' });
    expect(judge([run({ status: 'in_progress', conclusion: null })])).toEqual({ ok: false, reason: 'provenance.err.noCheck' });
  });

  it('refuses bytes that differ from what the build listed', () => {
    expect(judge([run({ output: { text: `${OTHER}  keyball39.hex\n${OTHER}  manifest.json\n` } })])).toEqual({
      ok: false,
      reason: 'provenance.err.mismatch',
    });
    expect(judge([run({ output: { text: `${OTHER}  manifest.json\n` } })])).toEqual({ ok: false, reason: 'provenance.err.mismatch' });
    expect(judge([run({ output: { text: null } })])).toEqual({ ok: false, reason: 'provenance.err.mismatch' });
  });

  it('needs one run to vouch for every file, not a mix of runs', () => {
    const hexOnly = run({ output: { text: `${ABC}  keyball39.hex\n${ABC}  manifest.json\n` } });
    const manifestOnly = run({ output: { text: `${OTHER}  keyball39.hex\n${OTHER}  manifest.json\n` } });
    expect(judge([hexOnly, manifestOnly])).toEqual({ ok: false, reason: 'provenance.err.mismatch' });
    expect(judge([hexOnly, run()])).toEqual({ ok: true });
  });

  it('refuses a commit that is not on the default branch', () => {
    expect(judge([run()], { onDefaultBranch: false })).toEqual({ ok: false, reason: 'provenance.err.notDefault' });
  });
});
