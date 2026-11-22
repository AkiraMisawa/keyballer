import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

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

// Relative asset paths so the same build works at any URL path,
// such as https://<user>.github.io/keyballer/.
export default defineConfig({
  base: './',
  plugins: [react(), securityMeta()],
});
