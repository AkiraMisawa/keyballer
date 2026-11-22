// The local sign-in endpoints that Vite's own server mounts (docs/plans/github-login.md, phase 3).
// Abuse cases first: other websites, DNS rebinding, odd methods and bodies. Then the calls to
// GitHub, whose URLs and fields come from GitHub's documentation for GitHub App user tokens.

import { describe, expect, it, vi } from 'vitest';
import { handleAuth, parseAuthConfig, type AuthConfig } from './server';

const CONFIG: AuthConfig = { clientId: 'Iv23liTestClient01', clientSecret: 'f'.repeat(40), appSlug: 'keyballer-test' };
const ORIGIN = 'http://127.0.0.1:5173';
const CODE = 'a1b2c3d4e5f6a7b8c9d0';
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const USER_TOKEN = `ghu_${'T0k'.repeat(12)}`;

function request(path: string, init: { method?: string; host?: string; origin?: string | null; type?: string | null; body?: BodyInit } = {}) {
  const headers = new Headers({ host: init.host ?? '127.0.0.1:5173' });
  if (init.origin !== null) headers.set('origin', init.origin ?? ORIGIN);
  if (init.type !== null) headers.set('content-type', init.type ?? 'application/json');
  return new Request(`http://${init.host ?? '127.0.0.1:5173'}${path}`, {
    method: init.method ?? 'POST',
    headers,
    body: init.body,
    duplex: 'half',
  } as RequestInit);
}

const tokenBody = (fields: Record<string, unknown> = { code: CODE, code_verifier: VERIFIER }) => JSON.stringify(fields);

/** A fetch that must not be called. */
const noFetch = () => vi.fn(async () => new Response('unexpected', { status: 500 }));

describe('handleAuth: what it refuses', () => {
  it('leaves other paths to the app', async () => {
    expect(await handleAuth(request('/src/main.tsx', { method: 'GET' }), CONFIG, noFetch())).toBeNull();
    expect(await handleAuth(request('/authority', { method: 'GET' }), CONFIG, noFetch())).toBeNull();
  });

  it('refuses any host but the loopback address, which stops DNS rebinding', async () => {
    for (const host of ['evil.example:5173', '127.0.0.1.evil.example:5173', 'localhost:5173', '[::1]:5173', '127.0.0.2:5173', '0.0.0.0:5173', '127.0.0.1']) {
      const fetch = noFetch();
      const res = await handleAuth(request('/auth/token', { host, origin: `http://${host}`, body: tokenBody() }), CONFIG, fetch);
      expect(res?.status, host).toBe(403);
      expect(fetch).not.toHaveBeenCalled();
    }
  });

  it("refuses requests from other origins, or that do not say where they come from", async () => {
    for (const origin of ['http://evil.example', 'null', 'http://127.0.0.1:4173', 'https://127.0.0.1:5173', null]) {
      for (const path of ['/auth/token', '/auth/revoke']) {
        const fetch = noFetch();
        const res = await handleAuth(request(path, { origin, body: tokenBody() }), CONFIG, fetch);
        expect(res?.status, `${path} ${origin}`).toBe(403);
        expect(fetch).not.toHaveBeenCalled();
      }
    }
  });

  it('answers only the methods and paths it has', async () => {
    const cases: [string, string][] = [
      ['GET', '/auth/token'],
      ['PUT', '/auth/token'],
      ['POST', '/auth/status'],
      ['POST', '/auth/callback'],
      ['GET', '/auth/'],
      ['POST', '/auth/token/'],
      ['POST', '/auth/other'],
    ];
    for (const [method, path] of cases) {
      const res = await handleAuth(request(path, { method, body: method === 'GET' ? undefined : tokenBody() }), CONFIG, noFetch());
      expect(res?.status, `${method} ${path}`).toBe(404);
    }
  });

  it('takes JSON only', async () => {
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', null]) {
      const res = await handleAuth(request('/auth/token', { type, body: tokenBody() }), CONFIG, noFetch());
      expect(res?.status, String(type)).toBe(400);
    }
  });

  it('stops reading a body over 1 KB, even one that never ends', async () => {
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode('{"code":"' + 'a'.repeat(256)));
      },
    });
    const res = await handleAuth(request('/auth/token', { body: endless }), CONFIG, noFetch());
    expect(res?.status).toBe(400);
  });

  it('takes exactly the expected fields, in the expected shapes', async () => {
    const bad: Record<string, unknown>[] = [
      {},
      { code: CODE },
      { code: CODE, code_verifier: VERIFIER, extra: 1 },
      { code: 'has space', code_verifier: VERIFIER },
      { code: CODE, code_verifier: 'short' },
      { code: CODE, code_verifier: 'v'.repeat(129) },
      { code: 42, code_verifier: VERIFIER },
      { code: 'a'.repeat(65), code_verifier: VERIFIER },
    ];
    for (const fields of bad) {
      const res = await handleAuth(request('/auth/token', { body: tokenBody(fields) }), CONFIG, noFetch());
      expect(res?.status, JSON.stringify(fields)).toBe(400);
    }
    for (const body of ['[]', 'null', '"x"', '{', `${tokenBody()}x`]) {
      const res = await handleAuth(request('/auth/token', { body }), CONFIG, noFetch());
      expect(res?.status, body).toBe(400);
    }
    for (const token of ['ghp_abcdefghijklmnopqrstuvwxyz', 'ghu_short', `ghu_${'a'.repeat(20)}\n`, `Bearer ${USER_TOKEN}`]) {
      const res = await handleAuth(request('/auth/revoke', { body: JSON.stringify({ access_token: token }) }), CONFIG, noFetch());
      expect(res?.status, token).toBe(400);
    }
  });

  it('never repeats what it was sent', async () => {
    const marker = 'MARKER<script>';
    const res = await handleAuth(request('/auth/token', { body: tokenBody({ code: marker, code_verifier: marker }) }), CONFIG, noFetch());
    expect(await res!.text()).toBe('{"error":"bad_request"}');
  });

  it('says sign-in is not set up when the app has no client ID or secret', async () => {
    const res = await handleAuth(request('/auth/token', { body: tokenBody() }), null, noFetch());
    expect(res?.status).toBe(503);
    const status = await handleAuth(request('/auth/status', { method: 'GET', origin: null, type: null }), null, noFetch());
    expect(await status!.json()).toEqual({ clientId: null, appSlug: null });
  });
});

describe('handleAuth: exchanging the code', () => {
  const github = (body: unknown, status = 200) =>
    vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

  it('sends the code, the verifier, the secret and the fixed callback to GitHub, and returns only the token and its lifetime', async () => {
    const fetch = github({ access_token: USER_TOKEN, expires_in: 28800, refresh_token: `ghr_${'r'.repeat(70)}`, refresh_token_expires_in: 15897600, token_type: 'bearer', scope: '' });
    const res = await handleAuth(request('/auth/token', { body: tokenBody() }), CONFIG, fetch);
    expect(res?.status).toBe(200);
    expect(res?.headers.get('cache-control')).toBe('no-store');
    expect(await res!.json()).toEqual({ access_token: USER_TOKEN, expires_in: 28800 });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://github.com/login/oauth/access_token');
    expect(init?.method).toBe('POST');
    const headers = new Headers(init?.headers);
    expect(headers.get('accept')).toBe('application/json');
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('user-agent')).toBeTruthy();
    expect(JSON.parse(String(init?.body))).toEqual({
      client_id: CONFIG.clientId,
      client_secret: CONFIG.clientSecret,
      code: CODE,
      code_verifier: VERIFIER,
      redirect_uri: 'http://127.0.0.1:5173/auth/callback',
    });
  });

  it('caps the lifetime at 8 hours, also when expiry is off in the app settings', async () => {
    const noExpiry = await handleAuth(request('/auth/token', { body: tokenBody() }), CONFIG, github({ access_token: USER_TOKEN, token_type: 'bearer' }));
    expect(await noExpiry!.json()).toEqual({ access_token: USER_TOKEN, expires_in: 28800 });
    const long = await handleAuth(request('/auth/token', { body: tokenBody() }), CONFIG, github({ access_token: USER_TOKEN, expires_in: 999999 }));
    expect((await long!.json()).expires_in).toBe(28800);
  });

  it('reports a refusal from GitHub without passing on its words', async () => {
    for (const fetch of [
      github({ error: 'bad_verification_code', error_description: 'The code passed is incorrect or expired.' }),
      github({ access_token: 'gho_notAnAppUserToken1234567890' }),
      github({ message: 'Not Found' }, 404),
      vi.fn(async () => {
        throw new TypeError('network down');
      }),
    ]) {
      const res = await handleAuth(request('/auth/token', { body: tokenBody() }), CONFIG, fetch);
      expect(res?.status).toBe(502);
      expect(await res!.text()).toBe('{"error":"github"}');
    }
  });

  it('revokes a token with the app credentials, and answers 204 whatever GitHub says', async () => {
    for (const status of [204, 404, 500]) {
      const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(null, { status }));
      const res = await handleAuth(request('/auth/revoke', { body: JSON.stringify({ access_token: USER_TOKEN }) }), CONFIG, fetch);
      expect(res?.status).toBe(204);
      const [url, init] = fetch.mock.calls[0];
      expect(url).toBe(`https://api.github.com/applications/${CONFIG.clientId}/token`);
      expect(init?.method).toBe('DELETE');
      const headers = new Headers(init?.headers);
      expect(headers.get('authorization')).toBe(`Basic ${btoa(`${CONFIG.clientId}:${CONFIG.clientSecret}`)}`);
      expect(headers.get('accept')).toBe('application/vnd.github+json');
      expect(JSON.parse(String(init?.body))).toEqual({ access_token: USER_TOKEN });
    }
  });
});

describe('handleAuth: the callback page and status', () => {
  it('serves the callback page with its own strict policy, and never puts the code in the page', async () => {
    const res = await handleAuth(request(`/auth/callback?code=${CODE}&state=<b>x</b>`, { method: 'GET', origin: null, type: null }), CONFIG, noFetch());
    expect(res?.status).toBe(200);
    expect(res?.headers.get('content-type')).toMatch(/^text\/html/);
    const csp = res?.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(res?.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res?.headers.get('cache-control')).toBe('no-store');
    const html = await res!.text();
    expect(html).not.toContain(CODE);
    expect(html).not.toContain('<b>x</b>');
    expect(html).toContain('src="/auth/callback.js"');

    const script = await handleAuth(request('/auth/callback.js', { method: 'GET', origin: null, type: null }), CONFIG, noFetch());
    expect(script?.headers.get('content-type')).toMatch(/^text\/javascript/);
    expect(await script!.text()).toContain('BroadcastChannel');
  });

  it('tells the page whether sign-in is set up, with the public client ID and app name', async () => {
    const res = await handleAuth(request('/auth/status', { method: 'GET', origin: null, type: null }), CONFIG, noFetch());
    expect(res?.headers.get('cache-control')).toBe('no-store');
    expect(await res!.json()).toEqual({ clientId: CONFIG.clientId, appSlug: CONFIG.appSlug });
  });
});

describe('parseAuthConfig', () => {
  it('reads the client ID, secret and app name from .env.local', () => {
    expect(
      parseAuthConfig({
        KEYBALLER_GITHUB_CLIENT_ID: ' Iv23liTestClient01\n',
        KEYBALLER_GITHUB_CLIENT_SECRET: 'f'.repeat(40),
        KEYBALLER_GITHUB_APP_SLUG: 'keyballer-test',
      }),
    ).toEqual(CONFIG);
  });

  it('turns sign-in off when either credential is missing or malformed', () => {
    const secret = 'f'.repeat(40);
    for (const env of [
      {},
      { KEYBALLER_GITHUB_CLIENT_ID: 'Iv23liTestClient01' },
      { KEYBALLER_GITHUB_CLIENT_SECRET: secret },
      { KEYBALLER_GITHUB_CLIENT_ID: 'Iv23li/../x', KEYBALLER_GITHUB_CLIENT_SECRET: secret },
      { KEYBALLER_GITHUB_CLIENT_ID: 'Iv23liTestClient01', KEYBALLER_GITHUB_CLIENT_SECRET: 'short' },
      { KEYBALLER_GITHUB_CLIENT_ID: 'Iv23liTestClient01', KEYBALLER_GITHUB_CLIENT_SECRET: `${secret}\r\nX: 1` },
    ]) {
      expect(parseAuthConfig(env), JSON.stringify(Object.keys(env))).toBeNull();
    }
  });

  it('leaves the install link out when the app name is missing or odd', () => {
    const config = parseAuthConfig({ KEYBALLER_GITHUB_CLIENT_ID: 'Iv23liTestClient01', KEYBALLER_GITHUB_CLIENT_SECRET: 'f'.repeat(40), KEYBALLER_GITHUB_APP_SLUG: 'Evil App/..' });
    expect(config?.appSlug).toBeNull();
  });
});
