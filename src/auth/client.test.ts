// The page's side of local sign-in: PKCE, the authorize address, taking the code from the
// sign-in window, and the calls to the local endpoints. The PKCE vector is RFC 7636, Appendix B;
// the authorize parameters are GitHub's, from its docs for GitHub App user tokens.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { authorizeUrl, challengeOf, exchangeCode, makeRandom, SIGN_IN_CHANNEL, waitForCode } from './client';

describe('PKCE', () => {
  it('derives the S256 challenge of RFC 7636, Appendix B', async () => {
    expect(await challengeOf('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('makes 32 random bytes, base64url without padding', () => {
    // RFC 7636, Appendix B: these octets encode to the verifier above.
    const octets = [116, 24, 223, 180, 151, 153, 224, 37, 79, 250, 96, 125, 216, 173, 187, 186, 22, 212, 37, 77, 105, 214, 191, 240, 91, 88, 5, 88, 83, 132, 141, 121];
    const fill = (a: Uint8Array) => {
      a.set(octets);
      return a;
    };
    expect(makeRandom(fill)).toBe('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk');
    expect(makeRandom()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(makeRandom()).not.toBe(makeRandom());
  });
});

describe('authorizeUrl', () => {
  it('asks GitHub for a code for this app, sent back to the local callback, with state and the S256 challenge', () => {
    const url = new URL(authorizeUrl({ clientId: 'Iv23liTestClient01', origin: 'http://127.0.0.1:5173', state: 'st', challenge: 'ch' }));
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'Iv23liTestClient01',
      redirect_uri: 'http://127.0.0.1:5173/auth/callback',
      state: 'st',
      code_challenge: 'ch',
      code_challenge_method: 'S256',
    });
  });
});

describe('waitForCode', () => {
  const send = (message: unknown) => {
    const channel = new BroadcastChannel(SIGN_IN_CHANNEL);
    channel.postMessage(message);
    channel.close();
  };

  it('takes the code sent with its own state, and ignores everything else', async () => {
    const waiting = waitForCode('mine', 1000);
    send({ type: 'keyballer-sign-in', code: 'theirs', state: 'other', error: null });
    send({ type: 'something-else', code: 'x', state: 'mine' });
    send('mine');
    send({ type: 'keyballer-sign-in', code: 'ok-code', state: 'mine', error: null });
    await expect(waiting).resolves.toBe('ok-code');
  });

  it('says so when the sign-in was cancelled on GitHub', async () => {
    const waiting = waitForCode('mine', 1000);
    send({ type: 'keyballer-sign-in', code: null, state: 'mine', error: 'access_denied' });
    await expect(waiting).rejects.toMatchObject({ key: 'auth.err.cancelled' });
  });

  it('gives up after the time allowed', async () => {
    await expect(waitForCode('mine', 30)).rejects.toMatchObject({ key: 'auth.err.timeout' });
  });

  it('refuses a code that could not be a GitHub code', async () => {
    const waiting = waitForCode('mine', 1000);
    send({ type: 'keyballer-sign-in', code: 'a b', state: 'mine', error: null });
    await expect(waiting).rejects.toMatchObject({ key: 'auth.err.failed' });
  });
});

describe('exchangeCode', () => {
  afterEach(() => vi.unstubAllGlobals());
  const token = `ghu_${'T0k'.repeat(12)}`;

  it('posts the code and verifier to the local endpoint and keeps the token with its end time', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ access_token: token, expires_in: 28800 }));
    vi.stubGlobal('fetch', fetch);
    const session = await exchangeCode('code1', 'verifier', 1_000_000);
    expect(session).toEqual({ token, expiresAt: 1_000_000 + 28800 * 1000 });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('/auth/token');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(String(init?.body))).toEqual({ code: 'code1', code_verifier: 'verifier' });
  });

  it('fails plainly when the exchange does', async () => {
    for (const res of [Response.json({ error: 'github' }, { status: 502 }), Response.json({ access_token: 'gho_x' }), new Response('nope')]) {
      vi.stubGlobal('fetch', vi.fn(async () => res));
      await expect(exchangeCode('code1', 'verifier', 0)).rejects.toMatchObject({ key: 'auth.err.failed' });
    }
  });
});
