# Sign in with GitHub

Status: phase 1 in progress (2026-11-22). Since this was written, the owner deleted the user site (`AkiraMisawa/akiramisawa.github.io`), so Google's analytics tag no longer runs on Keyballer's origin. Two pieces are still open: the move to an organization (phase 2), and whether sign-in is hosted or local-only (phase 3); both are decided before those phases start. Decided with the owner:
- Keyballer moves to an origin of its own: a free GitHub organization.
- The personal access token stays as a fallback, kept for one tab only.
- A sign-in lasts one tab and at most 8 hours, with no refresh token.

The design was reviewed adversarially before writing code; the findings are folded in below. Facts and sources: [../research/github-login.md](../research/github-login.md). Replaces the pasted token for saving ([keymap-editor.md](keymap-editor.md), [trackball-settings.md](trackball-settings.md)).

## Problem

Saving needs a fine-grained personal access token that I make on GitHub and paste into Keyballer. That is fiddly the first time, and the token is long-lived. Keyballer keeps it in `localStorage`. Without a token, reads are limited to 60 requests an hour.

**What can read that token.** Keyballer is served from `akiramisawa.github.io`. Every page there is the same origin and can read its storage. Until 2026-11-22 that included the user site, which loaded Google's analytics tag (`gtag.js`, an inactive Universal Analytics ID) and a CDN stylesheet; the owner has since deleted it. `3style` (no scripts) and `ex-grid` (a Blazor app) remain.

**What the token leads to.** Write access to a config repository means code on my keyboard, and a keyboard types into my computer. Today a stolen token could do two things:
- Push a hex file straight to the `firmware` branch, so that I flash it without any build or commit on `main`.
- Commit C code that the build turns into firmware.

**Other gaps, found in review:**
- A `?repo=` link can switch Keyballer to someone else's repository without asking, and the flash dialog does not say where the firmware came from.
- A crafted manifest can make Keyballer send authenticated GET requests to other GitHub API paths (`../` in a file path).

## Solution

**Sign-in.** A **Keyballer GitHub App** and a **Cloudflare Worker** (free plan) that holds the app's client secret.
- "Sign in with GitHub" opens GitHub's authorization page in a small window, so the page and its unsaved edits stay as they are.
- Keyballer gets a token that lasts 8 hours and lives only in the page's memory. Reloading or closing the tab ends the sign-in. Signing in again is one click, with no consent page.
- The app reaches only the repositories it is installed on: I install it on my config repository alone.
- Signing out revokes the token.

**Firmware provenance.** Before flashing, Keyballer checks that the firmware's bytes are what GitHub Actions built from a commit on `main`, and shows that commit. A token, stolen or not, cannot fake that.

**An origin of its own.** Keyballer moves to `https://keyballer-app.github.io/keyballer/`, an organization's site that holds only Keyballer. The token saved on the old origin is deleted, and I am pointed to the page where I can revoke it.

## User stories

1. As a Keyball owner, I want to sign in with GitHub in one click, so that I can save without making and pasting a token.
2. As a Keyball owner, I want signing in to keep my unsaved changes, so that I can sign in from the review when saving needs it.
3. As a Keyball owner, I want Keyballer to reach only my config repository, and only to read and write files and read build runs and checks, so that a mistake or a leak cannot touch anything else.
4. As a Keyball owner, I want to be told when the app is not installed on my config repository, with a link to install it there, so that the first save works.
5. As a Keyball owner, I want the sign-in to end when I close or reload the tab, and after 8 hours at most, so that nothing that can write to my repository stays on the computer.
6. As a Keyball owner, I want signing out to revoke the token on GitHub, so that signing out means it.
7. As a Keyball owner, I want to see who I am signed in as, so that I know which account will commit.
8. As a Keyball owner whose sign-in expired, I want to sign in again without losing edits, so that the 8-hour limit costs one click.
9. As a Keyball owner, I want Keyballer to refuse firmware that GitHub Actions did not build from `main`, and to show the commit it came from, so that a leaked token cannot put code on my keyboard unseen.
10. As a Keyball owner, I want Keyballer to ask before opening a repository named in a link, if it differs from mine, so that a link cannot make me flash someone else's firmware.
11. As a keyboard user, I want `sign in` and `sign out` as commands, so that the command line reaches them.
12. As someone with my own config repository, I want the same sign-in, so that the app is not only for its author.
13. As the owner of Keyballer, I want the client secret only in the Worker, and the Worker to do nothing but Keyballer's two calls, so that neither can be misused.

## Phases

Each phase is its own pull request, in this order.

1. **Hardening that needs no setup.** This protects today's PAT users too.
   - firmware provenance
   - the `?repo=` prompt
   - path and SHA checks
   - showing the source in the flash dialog
   - the framing guard
   - the CSP and referrer tags
   - publishing only from the default branch
   - SHA-pinned actions and `npm ci --ignore-scripts`
2. **Leaving the old origin.**
   - A release on `akiramisawa.github.io/keyballer/` deletes the saved PAT and links to GitHub's token settings.
   - The owner creates the organization, and Keyballer moves.
   - A small page at the old URL deletes the PAT and links to the new site.
3. **Sign-in.** The Worker, the auth module, the screen, the PAT fallback (tab only), and the owner's setup.
4. **Abuse tests and reviews** against the deployed Worker and site (see Testing decisions).

## Implementation decisions

### The sign-in flow

GitHub's web flow with PKCE (S256). The research rules out the alternatives:
- A browser-only exchange: GitHub's token endpoint has no CORS and requires the client secret even with PKCE.
- The device flow: the person has to copy a code by hand.

1. **Before the click.** When the sign-in button appears, Keyballer makes a random `state` (32 bytes) and a PKCE `code_verifier` (32 random bytes, base64url) with Web Crypto, and computes the S256 challenge. Both values stay in the page's memory only.
   - The click opens `github.com/login/oauth/authorize` synchronously. Safari blocks `window.open` after an `await`.
   - It uses `window.open(url, 'keyballer-sign-in', 'popup,noopener')`, with `client_id`, the fixed `redirect_uri`, `state`, and `code_challenge` with method `S256`.
2. **The callback.** GitHub sends the window to `callback.html`. This is a separate page in the same build, with its own CSP and one script file, and nothing else.
   - It removes the query from the address bar (`history.replaceState`) first.
   - It sends `{type: 'keyballer-sign-in', code, state}` on a `BroadcastChannel`, which only same-origin pages can hear.
   - Then it closes. If it cannot close, it says the window can be closed.
3. **Taking the code.** The page waiting for that exact `state` takes one message and forgets the `state`. It ignores any message of another shape or `state`, and any that arrives after 10 minutes, the code's lifetime. It POSTs `{code, code_verifier}` to the Worker.
4. **The exchange.** The Worker adds the client ID, the client secret and the fixed `redirect_uri`, then calls `github.com/login/oauth/access_token`. It returns `{access_token, expires_in}` and nothing else. A response without an `access_token` is an error.
5. **After sign-in.** The page keeps the token in memory. It calls `GET /user` for the login and avatar, then checks that the config repository is reachable through `GET /user/installations` and `GET /user/installations/{id}/repositories`.

**No refresh token in the browser.** The Worker drops it. Keeping one would mean holding a 6-month credential in browser storage, or in a cross-site `Partitioned` cookie. The cookie is untested and would need its own CSRF defence.

**Memory only.** `sessionStorage` would be written to disk and brought back by session restore and "Duplicate tab". So a reload means signing in again, which takes one click.

**Signing out.** The page POSTs the token to the Worker's `/revoke`, which calls `DELETE /applications/{client_id}/token` with Basic auth. The page then forgets the token. If revoking fails, the page says so and links to GitHub's authorized apps page. A PAT is never sent to the Worker: signing out of a PAT only forgets it, and the page links to GitHub's token settings.

### The Worker (`worker/`)

**Shape.** One handler, no runtime dependencies, no state, no storage. The pinned `wrangler` is a development dependency with a lockfile.

**Endpoints.** It answers only these and returns 404 for anything else:
- `OPTIONS` and `POST /token`
- `OPTIONS` and `POST /revoke`

**Origin.**
- `Origin` must exactly match the environment's single allowed origin. Production allows only the new site; the dev environment allows only `http://127.0.0.1:5173`.
- Anything else, including a missing `Origin` or `null`, gets 403 with no CORS headers.
- The allowed origin gets `Access-Control-Allow-Origin: <origin>` and `Vary: Origin`, with no `Allow-Credentials` and no cookies.

**Body.**
- `Content-Type` must be `application/json`, so every call needs a preflight and a cross-site form cannot post.
- The body is read from the stream up to 1 KB and then cut off; `Content-Length` is not trusted.
- It must be a JSON object with exactly the expected fields:
  - `code`: `^[A-Za-z0-9_-]{1,64}$`
  - `code_verifier`: `^[A-Za-z0-9._~-]{43,128}$` (RFC 7636)
  - `access_token`: `^ghu_[A-Za-z0-9_]{16,255}$`
- Every parse or validation failure gets the same `400 {"error":"bad_request"}`. Errors are caught everywhere, so no input is ever echoed: V8 quotes input in `JSON.parse` errors.

**Calls to GitHub.**
- The Worker never takes a URL or `redirect_uri` from the request.
- It calls only `https://github.com/login/oauth/access_token` and `https://api.github.com/applications/{client_id}/token`.
- It sends `Accept: application/json` and an explicit `User-Agent`.

**Responses.**
- Only the fields above are passed back.
- GitHub errors become one of three short codes: `bad_verification_code`, `expired` or `github_error`.
- `/revoke` answers `204` whether or not the token was valid, so it cannot tell a caller anything about a token.
- Every response has `Cache-Control: no-store` and `Content-Type: application/json`.

**Secrets and settings.**
- `GITHUB_CLIENT_SECRET` is a Worker secret, set by the owner per environment. It is never in the repository, in CI or in this conversation.
- The client ID and allowed origin are variables in `wrangler.toml`.

**Logs and previews.**
- `observability.enabled = false`, and nothing is logged anywhere.
- `preview_urls = false`, because preview URLs run with the same secrets.
- `workers_dev` is the only route.

**Rate limits.** A flood can use up the free plan's 100,000 requests a day. That stops sign-in until midnight UTC, but no data is at risk. A rate-limit rule is added if the free plan offers one; that is to be checked during setup.

**Deploying.** The owner runs `wrangler deploy` from a clone, with a Cloudflare API token limited to editing Workers rather than `wrangler login`. No Cloudflare credential is kept in GitHub.

### Two apps, two Workers

The production app's only callback is the production `callback.html`. A separate **Keyballer (dev)** app has the callback `http://127.0.0.1:5173/callback.html` and pairs with the Worker's `dev` environment.

The split matters because of a loopback attack. Once someone has authorized the production app, authorization needs no consent. With a loopback callback on that app, any site could send them through it and catch the code on whatever listens on port 5173.

The build picks its client ID, app slug and Worker URL by mode (`src/lib/auth-config.ts`). These are public values.

### Firmware provenance

**What the workflow adds** (`build-qmk.yml`):
- The publish job runs only when the run is for the repository's default branch, on a push or a dispatch.
- It records the source commit in `manifest.json`, as it does today.
- It also creates a **check run** named `keyballer-firmware` on that commit. The check run is made with the job's `GITHUB_TOKEN`, which needs `checks: write`. Its output lists the file name and SHA-256 of each published firmware file.
- Config repositories add `checks: write` to their `build.yml`; the README says how.

**What Keyballer checks before flashing:**
- It downloads the firmware and computes its SHA-256.
- It reads the check runs for `manifest.source.sha`.
- It flashes only if a `keyballer-firmware` check run made by the `github-actions` app lists that file with that digest, and the commit is on the default branch.
- Otherwise it refuses and says why. "Flash a file from my computer" stays as the deliberate way around.

**Why it holds.** Keyballer's app has no Checks write permission, and fine-grained tokens cannot create check runs. So a stolen token can replace the files on `firmware`, but it cannot vouch for them.

**What it does not stop.** A token can still commit C code to `main`, and the build would vouch for that firmware. For that path the flash dialog shows the source: `owner/repo@sha`, the commit's author, its message and its time. A commit I did not make is visible before I flash.

**What the app needs for this.** Checks: Read. Fine-grained PATs: to check during phase 1 whether they can read check runs. Public repositories can be read without a token.

### Smaller hardening (phase 1)

**`?repo=`.** A repository named in the URL that differs from the saved one is not opened directly. The repository section asks: "Open `owner/repo`? Firmware from it can run on your keyboard." It offers Open and Keep mine.

**Paths.**
- `builds[].file` and `builds[].view` from a manifest must be plain relative paths: no empty, `.` or `..` segments, and no leading `/`.
- `manifest.source.sha` must be 40 hex characters.
- `getRaw` refuses any other path, so a manifest cannot reach other API paths.

**Framing.** If the page is inside a frame (`window.top !== window.self`), it renders only a link: "Open Keyballer in its own tab". A `<meta>` CSP cannot set `frame-ancestors`, and inside a frame, flashing, signing in and saving can all be clickjacked.

**CSP.** GitHub Pages cannot send headers, so the production build puts a `<meta>` CSP first in `<head>`:
- `default-src 'self'`
- `script-src 'self'`
- `connect-src 'self' https://api.github.com <worker>`
- `img-src 'self' data: https://avatars.githubusercontent.com`
- `style-src 'self'`
- `object-src 'none'`
- `base-uri 'none'`
- `form-action 'none'`
- `require-trusted-types-for 'script'`

Notes on the policy:
- React's style props go through the CSSOM, which CSP does not block.
- Both forms call `preventDefault`, so `form-action 'none'` breaks nothing.
- `callback.html` has its own policy.
- The development server keeps Vite's needs.

**Referrer.** `<meta name="referrer" content="no-referrer">`.

**Pinning** (in Keyballer's own workflows):
- actions are pinned by SHA
- `npm ci --ignore-scripts`
- `main` gets a ruleset that blocks force-pushes and deletion

The README recommends the same ruleset for config repositories, and pinning `uses:` and `keyballer_ref` to a release tag.

### Tokens in the page

**The auth module** (`src/lib/auth.ts`) owns:
- the PKCE values
- checking the callback message
- the token and its expiry
- signing in and out
- the installation check

**The token.** It lives in memory only. It never goes to storage, a URL or a log, and is sent only to `api.github.com` and to the Worker's `/revoke`.

**Expiry.**
- A token past `expires_in` counts as signed out.
- A 401 forgets it and asks to sign in again.
- Unsaved edits stay through both.

**The PAT fallback** ("Use a token instead"). It is kept in memory for the tab, like the signed-in token. Nothing token-like is ever written to `localStorage`, and the old `keyballer.token` key is removed on every load.

### Installing the app

"Request user authorization during installation" is off. When it is on, GitHub starts the authorization without Keyballer's `state` or PKCE. There is no Setup URL, because its `installation_id` can be spoofed.

After sign-in, if the config repository is not among the installations, the repository section names the repository and links to `github.com/apps/<slug>/installations/new`:
- For a public repository the link pre-selects it.
- A private repository's ID cannot be read before installing, so the link opens without a selection, and the notice names the repository to choose.

"Check again" re-reads the installations.

### App settings (registered by the owner, by hand)

**Permissions** (repository permissions only):
- Contents: Read and write
- Actions: Read
- Checks: Read
- Metadata: Read

There are no account permissions and no Workflows permission: Keyballer never commits under `.github/workflows`.

**Other settings:**
- Webhook: inactive.
- "Expire user authorization tokens": on.
- Device flow: off.
- Callback URL: one per app, matched exactly.
- Installable on any account (story 12).

**Registering by hand, not by manifest.** A manifest registration hands the client secret and private key to a web page, and it cannot set token expiry. The owner generates the client secret on GitHub and passes it straight to `wrangler secret put`. No private key is generated.

### The move

**The organization.**
- Name: `keyballer-app`. `keyballer` is taken.
- No other repository in it gets a Pages site. The org settings turn off Pages creation for members, so the origin stays Keyballer's alone.
- Passkeys or 2FA are on for the organization and for Cloudflare.

**What changes:**
- the Pages URL
- `uses: AkiraMisawa/keyballer/...` and `repository: AkiraMisawa/keyballer` in `build-qmk.yml`, the config repositories and the docs
- links in config repository READMEs
- the Worker's allowed origin and the callback URL

**Never recreate `AkiraMisawa/keyballer`.** GitHub redirects the old name. A new repository with that name would take over every config repository that still refers to it.

**Old origin.**
- Before the move, a release deletes `keyballer.token` from `localStorage` and says once that it did, with a link to GitHub's token settings to revoke the PAT. Deleting a token does not revoke it.
- After the move, the user-site repository gets a `keyballer/` page at the old URL. It does the same deletion and links to the new site.

### Screen

- **Before sign-in**, the repository section shows "Sign in with GitHub". "Use a token instead" sits under it.
- **After sign-in** it shows the avatar and login, "Sign out", and the install notice when needed.
- **In the review**, when saving needs sign-in, the dialog shows the same button. The dialog and the edits stay open while the window is out.
- **The flash dialog** shows the firmware's source commit and the provenance result.
- **Commands:** `sign in`, `sign out`. Messages are in English and Japanese.

### Owner setup

Each step says what to click, and the setup goes in the README.

1. Create the `keyballer-app` organization: passkeys, no other Pages. Transfer `keyballer` to it.
2. Register the **Keyballer** and **Keyballer (dev)** GitHub Apps with the settings above, and generate a client secret for each.
3. Create a Cloudflare account and an API token limited to editing Workers. Deploy both environments (`wrangler deploy`, `wrangler deploy --env dev`), then set each secret (`wrangler secret put GITHUB_CLIENT_SECRET [--env dev]`).
4. Put both client IDs, slugs and Worker URLs into `src/lib/auth-config.ts`.
5. Install the app on the config repository, selecting only that repository. Add `checks: write` to its `build.yml`.

## Threat model

| Threat | What it could do | Defence |
|---|---|---|
| A stolen token pushes firmware to the `firmware` branch | Code on my keyboard with no build and no commit on `main` | Provenance: the digests must match a check run by `github-actions` for a commit on the default branch, and tokens cannot create check runs. Publishing runs only from the default branch. |
| A stolen token commits C to `main` | Firmware built from the attacker's code | The flash dialog shows the commit, its author and its message. Tokens last 8 hours at most, and a sign-in reaches one repository. A ruleset blocks force-pushes and deletion on `main`. |
| XSS in Keyballer (data from a config repository) | Steal the token | React escapes text, and there is no `innerHTML` (checked). A `script-src 'self'` CSP and Trusted Types back it up. The token lives in memory only, for 8 hours at most. |
| Another page on the same origin | Read storage, script Keyballer's windows | The move to `keyballer-app.github.io`, with no other Pages. The old PAT is deleted on the old origin. |
| A malicious `?repo=` link, or a page that navigates my tab | Me flashing someone else's firmware | Ask before opening another repository. The flash dialog names the source. |
| A crafted manifest path (`../`) | Authenticated GETs to other API paths | Paths and SHAs are checked, and `getRaw` refuses anything else. |
| A code or state leaking (history, Referer) | Exchanging the code | The code is useless without the verifier, which stays in memory. The callback clears its URL first. `no-referrer` is set. Codes are single-use and last 10 minutes. |
| Login CSRF | Me committing as the attacker | `state` must match exactly and is used once, and the verifier must match. |
| The loopback callback | An attacker catching codes on port 5173 | A separate dev app. The production app has only the production callback. |
| Another site using the Worker through visitors' browsers | Using Keyballer's identity | An exact single origin, JSON only with a preflight, and no credentials or cookies. |
| Scripts calling the Worker directly (forged `Origin`) | Exchanging stolen codes, using up the quota, probing tokens | Codes need the verifier. Strict validation returns one generic error. `/revoke` answers the same for every token. Running out of quota only stops sign-in. |
| The client secret leaking | Impersonating the app | It lives only in Worker secrets: no logs, no previews, and a scoped Cloudflare token. If it leaks, it is rotated on GitHub. |
| Owner accounts and pipelines (a Keyballer `main` push, devDependencies, action tags, wrangler, the Cloudflare account) | Code in the site or the Worker for every user, or in every config repository's build | A ruleset on `main`, SHA-pinned actions, `--ignore-scripts`, a pinned wrangler with a lockfile, a scoped API token, and passkeys. Config repositories are advised to pin `uses:` to a tag. |
| Too much access | Damage beyond the config repository | Repository permissions only, an install on one repository, no Workflows permission, and Checks read only. |
| Clickjacking | Tricking me into flashing, signing in or saving | When framed, only "Open in its own tab" is rendered. |
| A popup message from elsewhere | Injecting a code | Same-origin channel, an exact shape and `state`, taken once, within 10 minutes. The verifier must still match. |
| Worker logs and error text | Leaking tokens | Observability off, and no input echoed in errors. Secrets never go in URLs. |

## Testing decisions

**Seams (TDD, expected values from independent sources):**

1. **The Worker handler**, run with a stub `fetch` and env. This is the security seam, and abuse cases come first.
   - Requests it must refuse:
     - a wrong, missing or `null` `Origin`
     - a wrong method or path
     - a wrong content type
     - a body over 1 KB (streamed, with a lying `Content-Length`)
     - JSON that is not an object
     - extra or missing fields
     - a malformed code, verifier or token
     - a supplied `redirect_uri`
   - No input is echoed in any error.
   - Calls to GitHub:
     - the secret is added
     - `redirect_uri` is fixed
     - the `User-Agent` is set
     - only the two fields pass back
     - a 200 without `access_token` is an error
     - errors map to short codes
     - revoke uses Basic auth
     - `/revoke` gives the same answer for valid and invalid tokens
     - every response has `no-store`
2. **The auth module**:
   - The S256 challenge matches RFC 7636 Appendix B.
   - The verifier and `state` have the right length and characters.
   - The authorize URL is correct.
   - Callback messages with a wrong `state`, a reused `state`, a wrong shape or a late arrival are refused.
   - Expiry and 401s are handled.
   - Nothing reaches `localStorage`, and the old key is removed.
3. **Firmware provenance** (pure): a check-run list and a file digest give flash or refuse.
   - wrong app
   - wrong name
   - missing file
   - digest mismatch
   - commit not on the default branch
   - a good case taken from a real run's output
4. **Manifest paths**: `..`, `.`, empty segments, a leading `/`, percent-encoded dots, and a bad SHA are all refused.
5. **The command line `?repo=` prompt and the framing guard** are checked in the browser.

**Reviews after implementing each phase:**
- the security-review skill
- an independent security review by an agent given only the code and this threat model
- the two-axis code review

**Abuse tests against the deployed Worker with `curl`**, each refused:
- a wrong `Origin`
- no `Origin`
- `Origin: null`
- a form POST
- a replayed code
- a wrong verifier
- a streamed 2 KB body
- an unknown path
- `/revoke` with a valid token and a junk token, which must answer the same

Also checked: whether a wrong verifier burns the code (so a racing attacker could block sign-in).

**In the browser:**
- Sign in from the review with unsaved edits.
- The code and state are gone from the address bar and history.
- `localStorage` and `sessionStorage` hold no token.
- The CSP shows no violations in normal use.
- Framed, only the link renders.
- The install notice works for a public and for a private repository.
- Sign-out revokes the token: a later API call returns 401.
- Provenance refuses a `firmware` branch edited by hand.
- The flash dialog shows the source.

**Recorded in the pull requests:** what was and was not checked, with screenshots.

## Out of scope

- Keeping sign-in across tabs or days (refresh tokens, a backend-for-frontend with a cookie). Possible later on a custom domain, where the page and the Worker share a site.
- A rate-limit rule, if the free plan has none.
- Verifying Sigstore build attestations in the browser. Check runs give the same guarantee here, and attestations need Enterprise for private repositories.
- Organizations and teams beyond installing the app on one repository.
- GitHub Enterprise.
