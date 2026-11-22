// The local sign-in endpoints (docs/plans/github-login.md, phase 3). Vite's dev and preview servers
// mount this handler (see vite.config.ts); it never ships to the browser. It holds the GitHub App's
// client secret, exchanges a sign-in code for a user token, and revokes tokens.
//
// It answers only the page it serves: requests must name the loopback address as their host (a
// DNS-rebound name is refused) and, for POSTs, come from that same origin. Input is checked field
// by field and never repeated, nothing is logged, and GitHub's own wording is never passed on.

export interface AuthConfig {
  clientId: string;
  clientSecret: string;
  /** The app's URL name, for the install link; optional. */
  appSlug: string | null;
}

/** Reads the app's settings from the environment (.env.local); null unless they look right. */
export function parseAuthConfig(env: Record<string, string | undefined>): AuthConfig | null {
  const clientId = env.KEYBALLER_GITHUB_CLIENT_ID?.trim() ?? '';
  const clientSecret = env.KEYBALLER_GITHUB_CLIENT_SECRET?.trim() ?? '';
  const appSlug = env.KEYBALLER_GITHUB_APP_SLUG?.trim() ?? '';
  if (!/^[A-Za-z0-9.]{1,64}$/.test(clientId) || !/^[A-Za-z0-9_]{20,255}$/.test(clientSecret)) return null;
  return { clientId, clientSecret, appSlug: /^[a-z0-9-]{1,64}$/.test(appSlug) ? appSlug : null };
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

const USER_AGENT = 'Keyballer-local-sign-in';
const MAX_BODY = 1024;
/** Eight hours, the most a sign-in lasts (GitHub's own lifetime for user tokens). */
const MAX_LIFETIME = 28800;

const LOOPBACK_HOST = /^127\.0\.0\.1:[1-9][0-9]{0,4}$/;
const CODE = /^[A-Za-z0-9_-]{1,64}$/;
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
const USER_TOKEN = /^ghu_[A-Za-z0-9_]{16,255}$/;

export const CALLBACK_PATH = '/auth/callback';

/**
 * Answers `/auth/…` requests, or returns null for anything else, which the app's server handles.
 */
export async function handleAuth(request: Request, config: AuthConfig | null, fetch: Fetch): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/auth/')) return null;
  // The host the browser asked for. A page on another site that rebinds its own name to 127.0.0.1
  // still sends its own name here.
  if (!LOOPBACK_HOST.test(url.host)) return error(403, 'forbidden');
  const origin = `http://${url.host}`;
  const route = `${request.method} ${url.pathname}`;

  switch (route) {
    case 'GET /auth/status':
      return json(200, { clientId: config?.clientId ?? null, appSlug: config?.appSlug ?? null });
    case `GET ${CALLBACK_PATH}`:
      return callbackPage();
    case `GET ${CALLBACK_PATH}.js`:
      return new Response(CALLBACK_SCRIPT, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' } });
    case 'POST /auth/token':
    case 'POST /auth/revoke':
      break;
    default:
      return error(404, 'not_found');
  }

  // Browsers always send Origin on a POST, and other sites cannot fake it.
  if (request.headers.get('origin') !== origin) return error(403, 'forbidden');
  if (!config) return error(503, 'not_configured');
  const body = await readJson(request);
  if (body === undefined) return error(400, 'bad_request');

  if (route === 'POST /auth/token') {
    if (!hasExactly(body, ['code', 'code_verifier']) || !matches(body.code, CODE) || !matches(body.code_verifier, VERIFIER)) {
      return error(400, 'bad_request');
    }
    return exchange(config, body.code, body.code_verifier, origin + CALLBACK_PATH, fetch);
  }
  if (!hasExactly(body, ['access_token']) || !matches(body.access_token, USER_TOKEN)) return error(400, 'bad_request');
  await revoke(config, body.access_token, fetch);
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}

async function exchange(config: AuthConfig, code: string, verifier: string, redirectUri: string, fetch: Fetch): Promise<Response> {
  try {
    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': USER_AGENT },
      body: JSON.stringify({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
      }),
      redirect: 'error',
    });
    if (!res.ok) return error(502, 'github');
    const answer: unknown = await res.json();
    if (!isObject(answer) || !matches(answer.access_token, USER_TOKEN)) return error(502, 'github');
    // The refresh token is dropped: a sign-in ends with the tab, or after 8 hours.
    const lifetime = typeof answer.expires_in === 'number' && answer.expires_in > 0 ? Math.min(answer.expires_in, MAX_LIFETIME) : MAX_LIFETIME;
    return json(200, { access_token: answer.access_token, expires_in: lifetime });
  } catch {
    return error(502, 'github');
  }
}

async function revoke(config: AuthConfig, token: string, fetch: Fetch): Promise<void> {
  try {
    await fetch(`https://api.github.com/applications/${encodeURIComponent(config.clientId)}/token`, {
      method: 'DELETE',
      headers: {
        authorization: `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'content-type': 'application/json',
        'user-agent': USER_AGENT,
      },
      body: JSON.stringify({ access_token: token }),
      redirect: 'error',
    });
  } catch {
    // Signing out forgets the token in the page either way; GitHub ends it after 8 hours.
  }
}

/** The body as JSON, read up to 1 KB from the stream; undefined if it is anything else. */
async function readJson(request: Request): Promise<Record<string, unknown> | undefined> {
  const type = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (type !== 'application/json' || !request.body) return undefined;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) {
        await reader.cancel();
        return undefined;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, at);
      at += chunk.byteLength;
    }
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    return isObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const matches = (v: unknown, pattern: RegExp): v is string => typeof v === 'string' && pattern.test(v);

function hasExactly(o: Record<string, unknown>, keys: string[]): boolean {
  const own = Object.keys(o).sort();
  return own.length === keys.length && [...keys].sort().every((k, i) => own[i] === k);
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

const error = (status: number, code: string) => json(status, { error: code });

const CALLBACK_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "require-trusted-types-for 'script'",
].join('; ');

/** The page GitHub sends the sign-in window back to. It shows no part of the address. */
function callbackPage(): Response {
  const html = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Keyballer sign-in</title>
<p>Finishing sign-in. You can close this window.</p>
<p lang="ja">サインインを終えています。このウィンドウは閉じてかまいません。</p>
<script type="module" src="${CALLBACK_PATH}.js"></script>
`;
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': CALLBACK_CSP,
      'referrer-policy': 'no-referrer',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

/**
 * Runs in the sign-in window. It takes the code out of the address before anything else, hands the
 * code and state to the Keyballer tab waiting for them (only that tab knows the state), and closes.
 */
const CALLBACK_SCRIPT = `const params = new URLSearchParams(location.search);
history.replaceState(null, '', location.pathname);
const channel = new BroadcastChannel('keyballer-sign-in');
channel.postMessage({ type: 'keyballer-sign-in', code: params.get('code'), state: params.get('state'), error: params.get('error') });
channel.close();
setTimeout(() => window.close(), 300);
`;
