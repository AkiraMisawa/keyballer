import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin, type PreviewServer, type ViteDevServer } from 'vite';
import { handleAuth, parseAuthConfig, type AuthConfig } from './src/auth/server.ts';

/**
 * The production page's security policy. GitHub Pages cannot send headers, so it goes in <meta>
 * tags right after the charset, before any script. A <meta> policy cannot set frame-ancestors;
 * main.tsx refuses to run inside a frame instead. See docs/plans/github-login.md.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // The GitHub API is the only server the page talks to.
  "connect-src 'self' https://api.github.com",
  "img-src 'self' data:",
  // React's style props go through the CSSOM, which CSP does not restrict.
  "style-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "require-trusted-types-for 'script'",
].join('; ');

function securityMeta(): Plugin {
  return {
    name: 'keyballer-security-meta',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const charset = '<meta charset="UTF-8" />';
        if (!html.includes(charset)) throw new Error('index.html must start <head> with the UTF-8 charset meta');
        return html.replace(
          charset,
          `${charset}\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />\n    <meta name="referrer" content="no-referrer" />`,
        );
      },
    },
  };
}

/**
 * Local sign-in (docs/plans/github-login.md, phase 3): mounts src/auth/server.ts on the dev and
 * preview servers. The GitHub App's settings come from .env.local, read here on the server only;
 * Vite exposes only VITE_ variables to the page, and `npm run build` checks dist/ for them.
 */
function localSignIn(config: AuthConfig | null): Plugin {
  // Each server answers only for its own address, which the callback URL is built from.
  const mount = (server: ViteDevServer | PreviewServer, port: number | undefined) => {
    const host = `127.0.0.1:${port}`;
    server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
      if (!req.url?.startsWith('/auth/')) return next();
      // Only this machine, even if the server is started with --host: Host and Origin are only
      // headers, which another computer could send.
      if (!LOOPBACK_PEERS.has(req.socket.remoteAddress ?? '')) {
        res.statusCode = 403;
        return res.end();
      }
      void serveAuth(req, res, config, host);
    });
  };
  return {
    name: 'keyballer-local-sign-in',
    configureServer: (server) => mount(server, server.config.server.port),
    configurePreviewServer: (server) => mount(server, server.config.preview.port),
  };
}

const LOOPBACK_PEERS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

async function serveAuth(req: IncomingMessage, res: ServerResponse, config: AuthConfig | null, host: string) {
  try {
    // The URL is built from the Host header, which the handler checks against the loopback address.
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? ''}`);
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
    }
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    const request = new Request(url, {
      method: req.method,
      headers,
      body: hasBody ? (Readable.toWeb(req) as ReadableStream<Uint8Array>) : undefined,
      duplex: 'half',
    } as RequestInit);
    const response = (await handleAuth(request, config, fetch, host)) ?? new Response(null, { status: 404 });
    res.statusCode = response.status;
    response.headers.forEach((value, name) => res.setHeader(name, value));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    res.statusCode = 400;
    res.end();
  }
}

// Relative asset paths so the same build works at any URL path,
// such as https://<user>.github.io/keyballer/.
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react(), securityMeta(), localSignIn(parseAuthConfig(loadEnv(mode, process.cwd(), 'KEYBALLER_GITHUB_')))],
  // Loopback only, on fixed ports: the GitHub App's callback URLs name exactly these. No CORS:
  // nothing on another origin needs to read these servers.
  server: { host: '127.0.0.1', port: 5173, strictPort: true, cors: false },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true, cors: false },
}));
