// The glue that decides what gets flashed: it must check the exact bytes it returns, use the
// manifest whose bytes were checked, and ask only the connected repository.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadVerifiedFirmware } from './firmware';
import { sha256Hex } from './provenance';
import { uf2Image } from './uf2.testing';

const REPO = { owner: 'me', repo: 'config' };
const SOURCE = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const FIRMWARE = 'f'.repeat(40);
const RUN = 4242;
const KB_HEAD = 'c'.repeat(40);
const KB_OLD = 'd'.repeat(40);
// A one-byte Intel HEX image: byte 0xAA at address 0 (record checksum 0x55), then end of file.
const IMAGE_HEX = ':01000000AA55\r\n:00000001FF\r\n';

async function setup(
  over: {
    artifactFor?: (digest: string) => string;
    runBranch?: string;
    hex?: string;
    workflowSha?: string;
    /** A ZMK build instead: the UF2 bytes served, and the range the manifest records. */
    zmk?: { bytes: Uint8Array; blocks: number; start?: number };
  } = {},
) {
  const enc = new TextEncoder();
  const zmk = over.zmk;
  const served = zmk ? zmk.bytes : enc.encode(over.hex ?? IMAGE_HEX);
  const build = zmk
    ? {
        id: 'kb', name: 'KB', firmware: 'zmk', format: 'uf2', file: 'kb.uf2', size: zmk.blocks * 256, group: 'kb', board: 'xiao_ble',
        shield: 's', role: 'standalone', studio: false, west: 'kb.west.yml', zmk_sha: null, zephyr_sha: null, image: 'i',
        uf2: { family: 0xada52840, blocks: zmk.blocks, start: zmk.start ?? 0x27000, end: (zmk.start ?? 0x27000) + 256 * zmk.blocks },
        sha256: await sha256Hex(zmk.bytes),
      }
    : { id: 'kb', name: 'KB', keyboard: 'k', keymap: 'm', file: 'kb.hex', format: 'hex', split: false, sha256: await sha256Hex(enc.encode(IMAGE_HEX)) };
  const manifest = enc.encode(
    JSON.stringify({
      schema: 1,
      source: { repository: 'someone/else', sha: SOURCE, ref: 'refs/heads/main' },
      run: { id: RUN, url: 'x' },
      built_at: '2026-11-22T00:00:00Z',
      builds: [build],
    }),
  );
  const manifestDigest = await sha256Hex(manifest);
  const requested: string[] = [];
  const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = new URL(url);
      // Without a token, files at a commit come from raw.githubusercontent.com (github.ts).
      if (u.hostname === 'raw.githubusercontent.com') {
        requested.push(`raw:${u.pathname}`);
        if (u.pathname === `/me/config/${FIRMWARE}/manifest.json`) return new Response(manifest);
        if (u.pathname === `/me/config/${FIRMWARE}/${zmk ? 'kb.uf2' : 'kb.hex'}`) return new Response(served as Uint8Array<ArrayBuffer>);
        return new Response('404: Not Found', { status: 404 });
      }
      requested.push(u.pathname + u.search);
      const p = u.pathname;
      if (p === '/repos/AkiraMisawa/keyballer/git/ref/heads/main') return json({ object: { sha: KB_HEAD } });
      if (p === `/repos/AkiraMisawa/keyballer/compare/${KB_HEAD}...${KB_OLD}`) return json({ status: 'behind', behind_by: 3, ahead_by: 0, html_url: 'k' });
      if (p.startsWith('/repos/AkiraMisawa/keyballer/compare/')) return json({ status: 'ahead', behind_by: 0, ahead_by: 1, html_url: 'k' });
      if (!p.startsWith('/repos/me/config')) return new Response('{}', { status: 404 });
      if (p.endsWith('/contents/manifest.json')) return new Response(manifest);
      if (p.endsWith(zmk ? '/contents/kb.uf2' : '/contents/kb.hex')) return new Response(served as Uint8Array<ArrayBuffer>);
      if (p.endsWith(`/actions/runs/${RUN}`)) {
        return json({
          id: RUN,
          event: 'push',
          head_branch: over.runBranch ?? 'main',
          head_sha: SOURCE,
          status: 'completed',
          conclusion: 'success',
          referenced_workflows: [{ path: `AkiraMisawa/keyballer/.github/workflows/build-${zmk ? 'zmk' : 'qmk'}.yml@main`, sha: over.workflowSha ?? KB_OLD }],
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
    expect(new TextDecoder().decode(verified.bytes)).toBe(IMAGE_HEX);
    expect(verified.source).toMatchObject({ sha: SOURCE, branch: 'main', behindBy: 2, repository: 'me/config' });
    // Lookups about the firmware go to the connected repository; Keyballer's repo is asked only about its workflow.
    expect(requested.every((r) => r.startsWith('/repos/me/config') || r.startsWith('raw:/me/config/') || r.startsWith('/repos/AkiraMisawa/keyballer/'))).toBe(true);
    // The manifest and the firmware come from raw, at the firmware commit.
    expect(requested).toEqual(expect.arrayContaining([`raw:/me/config/${FIRMWARE}/manifest.json`, `raw:/me/config/${FIRMWARE}/kb.hex`]));
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

  it('returns a checked UF2 file from a run of the ZMK workflow', async () => {
    const bytes = uf2Image(3);
    await setup({ zmk: { bytes, blocks: 3 } });
    const verified = await loadVerifiedFirmware(REPO, FIRMWARE, 'kb', '');
    expect(verified.bytes).toEqual(bytes);
    expect(verified.source).toMatchObject({ sha: SOURCE, branch: 'main' });
  });

  it('refuses a UF2 file that would overwrite the bootloader, even when its record matches', async () => {
    await setup({ zmk: { bytes: uf2Image(3, 0x27000, { family: 0xd663823c }), blocks: 3 } });
    await expect(loadVerifiedFirmware(REPO, FIRMWARE, 'kb', '')).rejects.toMatchObject({ key: 'uf2.err.check' });
    await setup({ zmk: { bytes: uf2Image(3, 0xf4000), blocks: 3, start: 0xf4000 } });
    await expect(loadVerifiedFirmware(REPO, FIRMWARE, 'kb', '')).rejects.toMatchObject({ key: 'uf2.err.check' });
  });

  it('refuses a UF2 file whose blocks differ from what the build recorded', async () => {
    await setup({ zmk: { bytes: uf2Image(3), blocks: 4 } });
    await expect(loadVerifiedFirmware(REPO, FIRMWARE, 'kb', '')).rejects.toMatchObject({ key: 'uf2.err.check' });
    // The same number of blocks, at other addresses than the build recorded.
    await setup({ zmk: { bytes: uf2Image(3, 0x28000), blocks: 3 } });
    await expect(loadVerifiedFirmware(REPO, FIRMWARE, 'kb', '')).rejects.toMatchObject({ key: 'uf2.err.check' });
  });

  it('refuses a build run of another branch', async () => {
    await setup({ runBranch: 'feature' });
    await expect(loadVerifiedFirmware(REPO, FIRMWARE, 'kb', '')).rejects.toMatchObject({ key: 'provenance.err.notDefault' });
  });
});

