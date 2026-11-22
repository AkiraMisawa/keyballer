// The glue that decides what gets flashed: it must check the exact bytes it returns, use the
// manifest whose bytes were checked, and ask only the connected repository.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadVerifiedFirmware } from './firmware';
import { sha256Hex } from './provenance';

const REPO = { owner: 'me', repo: 'config' };
const SOURCE = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const FIRMWARE = 'f'.repeat(40);
const RUN = 4242;
const KB_HEAD = 'c'.repeat(40);
const KB_OLD = 'd'.repeat(40);
// A one-byte Intel HEX image: byte 0xAA at address 0 (record checksum 0x55), then end of file.
const IMAGE_HEX = ':01000000AA55\r\n:00000001FF\r\n';

async function setup(over: { artifactFor?: (digest: string) => string; runBranch?: string; hex?: string; workflowSha?: string } = {}) {
  const enc = new TextEncoder();
  const hex = enc.encode(over.hex ?? IMAGE_HEX);
  const manifest = enc.encode(
    JSON.stringify({
      schema: 1,
      source: { repository: 'someone/else', sha: SOURCE, ref: 'refs/heads/main' },
      run: { id: RUN, url: 'x' },
      built_at: '2026-11-22T00:00:00Z',
      builds: [{ id: 'kb', name: 'KB', keyboard: 'k', keymap: 'm', file: 'kb.hex', format: 'hex', split: false, sha256: await sha256Hex(enc.encode(IMAGE_HEX)) }],
    }),
  );
  const manifestDigest = await sha256Hex(manifest);
  const requested: string[] = [];
  const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = new URL(url);
      requested.push(u.pathname + u.search);
      const p = u.pathname;
      if (p === '/repos/AkiraMisawa/keyballer/git/ref/heads/main') return json({ object: { sha: KB_HEAD } });
      if (p === `/repos/AkiraMisawa/keyballer/compare/${KB_HEAD}...${KB_OLD}`) return json({ status: 'behind', behind_by: 3, ahead_by: 0, html_url: 'k' });
      if (p.startsWith('/repos/AkiraMisawa/keyballer/compare/')) return json({ status: 'ahead', behind_by: 0, ahead_by: 1, html_url: 'k' });
      if (!p.startsWith('/repos/me/config')) return new Response('{}', { status: 404 });
      if (p.endsWith('/contents/manifest.json')) return new Response(manifest);
      if (p.endsWith('/contents/kb.hex')) return new Response(hex);
      if (p.endsWith(`/actions/runs/${RUN}`)) {
        return json({
          id: RUN,
          event: 'push',
          head_branch: over.runBranch ?? 'main',
          head_sha: SOURCE,
          status: 'completed',
          conclusion: 'success',
          referenced_workflows: [{ path: 'AkiraMisawa/keyballer/.github/workflows/build-qmk.yml@main', sha: over.workflowSha ?? KB_OLD }],
        });
      }
      if (p.endsWith(`/actions/runs/${RUN}/artifacts`)) {
        const name = (over.artifactFor ?? ((d) => `keyballer-manifest-${d}`))(manifestDigest);
        return json({ artifacts: u.searchParams.get('name') === name ? [{ name, expired: false }] : [] });
      }
      if (p === '/repos/me/config') return json({ default_branch: 'main' });
      if (p.endsWith('/git/ref/heads/main')) return json({ object: { sha: HEAD } });
      if (p.endsWith(`/compare/${HEAD}...${SOURCE}`)) return json({ status: 'behind', behind_by: 2, ahead_by: 0, html_url: 'c' });
      if (p.endsWith(`/commits/${SOURCE}`)) return json({ sha: SOURCE, html_url: 'h', commit: { message: 'Tidy', author: { date: 'd' } } });
      return new Response('{}', { status: 404 });
    }),
  );
  return requested;
}

describe('loadVerifiedFirmware', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns the checked image and its source, asking only the connected repository', async () => {
    const requested = await setup();
    const verified = await loadVerifiedFirmware(REPO, FIRMWARE, 'kb', '');
    expect([...verified.image.slice(0, 1)]).toEqual([0xaa]);
    expect(verified.source).toMatchObject({ sha: SOURCE, branch: 'main', behindBy: 2, repository: 'me/config' });
    // Lookups about the firmware go to the connected repository; Keyballer's repo is asked only about its workflow.
    expect(requested.every((r) => r.startsWith('/repos/me/config') || r.startsWith('/repos/AkiraMisawa/keyballer/'))).toBe(true);
  });

  it('refuses when the run kept no record of these manifest bytes', async () => {
    await setup({ artifactFor: () => 'keyballer-manifest-something-else' });
    await expect(loadVerifiedFirmware(REPO, FIRMWARE, 'kb', '')).rejects.toMatchObject({ key: 'provenance.err.noRecord' });
  });

  it('refuses a firmware file that differs from the manifest', async () => {
    await setup({ hex: ':01000000BB44\r\n:00000001FF\r\n' });
    await expect(loadVerifiedFirmware(REPO, FIRMWARE, 'kb', '')).rejects.toMatchObject({ key: 'provenance.err.mismatch' });
  });

  it('refuses a run that used a workflow commit not on Keyballer main', async () => {
    await setup({ workflowSha: 'e'.repeat(40) });
    await expect(loadVerifiedFirmware(REPO, FIRMWARE, 'kb', '')).rejects.toMatchObject({ key: 'provenance.err.workflow' });
  });

  it('refuses a build run of another branch', async () => {
    await setup({ runBranch: 'feature' });
    await expect(loadVerifiedFirmware(REPO, FIRMWARE, 'kb', '')).rejects.toMatchObject({ key: 'provenance.err.notDefault' });
  });
});

