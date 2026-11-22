# Sign in with GitHub, and firmware provenance

Status: phase 1 built; phase 2 built except an origin of its own; phase 3 built, and a real sign-in waits for the owner's GitHub App (2026-11-22).

Decided with the owner:
- Sign-in is for running Keyballer on their own machine ("ローカル使用だけでいいや"). The hosted site keeps the personal access token, which is kept for one tab only.
- A sign-in lasts one tab and at most 8 hours, with no refresh token.
- The user site `akiramisawa.github.io` was deleted, which removed Google's analytics tag from Keyballer's origin.
- Moving Keyballer to an organization's origin is no longer needed for sign-in, and stays out of scope.

Every phase is reviewed adversarially; the findings are folded in below. Facts and sources: [../research/github-login.md](../research/github-login.md).

## Problem

**The token.** Saving needs a fine-grained personal access token that I make on GitHub and paste into Keyballer. That is fiddly the first time, and the token is long-lived. Keyballer keeps it in `localStorage`, where every page on the same origin can read it: `akiramisawa.github.io` also serves `3style` and `ex-grid`. Without a token, reads are limited to 60 requests an hour.

**What a token leads to.** Write access to a config repository means code on my keyboard, and a keyboard types into my computer. A stolen token could:
- push a hex file straight to the `firmware` branch, so that I flash it with no build and no commit on `main`;
- commit C code that the build turns into firmware.

**Other gaps found in review.**
- A `?repo=` link could switch Keyballer to someone else's repository without asking.
- The flash dialog did not say where firmware came from.
- A crafted manifest could make Keyballer send authenticated GETs to other API paths (`../` in a file path).

## Solution

**Firmware provenance (phase 1).**
- Before flashing, Keyballer checks that the bytes are what Keyballer's build workflow recorded in a successful run for the default branch.
- The flash dialog shows that run and the commit.
- A token that rewrites the `firmware` branch, or runs a workflow of its own on another branch, cannot make a run vouch for other bytes.

**Hardening (phase 1).**
- Ask before opening a linked repository.
- Check manifest paths.
- Refuse to run inside a frame.
- Ship a CSP with Trusted Types.
- Pin actions by commit SHA.

**Tokens on the hosted site (phase 2).**
- The personal access token is kept in memory for one tab, never in `localStorage`.
- The token saved there today is deleted, and the page says once where to revoke it.
- Classic tokens (`ghp_`) are refused: they reach every repository, and they can carry the `workflow` scope.

**Local sign-in (phase 3).**
- Run locally (`npm run dev` or `npm run preview`, on `127.0.0.1`), Keyballer shows "Sign in with GitHub".
- It uses a private **Keyballer** GitHub App, the web flow with PKCE, and a popup.
- Vite's local server exchanges the code, using a client secret that the owner puts in `.env.local`.
- The token lasts 8 hours, lives in memory, and reaches only the config repository.

## User stories

1. As a Keyball owner, I want Keyballer to refuse firmware that its build did not record for my default branch, and to show the run and commit it came from, so that a leaked token cannot put code on my keyboard unseen.
2. As a Keyball owner, I want Keyballer to ask before opening a repository named in a link, if it differs from mine, so that a link cannot make me flash someone else's firmware.
3. As a Keyball owner, I want my token kept only while the tab is open on the hosted site, so that it does not sit in the browser for months.
4. As a Keyball owner running Keyballer locally, I want to sign in with GitHub in one click, so that I can save without making and pasting a token.
5. As a Keyball owner, I want signing in to keep my unsaved changes, so that I can sign in from the review when saving needs it.
6. As a Keyball owner, I want the sign-in to reach only my config repository, only to read and write files and read build runs, and to end with the tab or after 8 hours, so that a leak is small.
7. As a Keyball owner, I want signing out to revoke the token on GitHub, so that signing out means it.
8. As a keyboard user, I want `sign in` and `sign out` as commands.

## Phase 1: provenance and hardening (built)

### Firmware provenance

**Recording (`build-qmk.yml`, `scripts/make_manifest.py`).**
- The publish job runs only when the run is for the repository's default branch.
- `manifest.json` lists the SHA-256 of each build's firmware file (`sha256`) and view (`view_sha256`).
- The job uploads an artifact named `keyballer-manifest-<SHA-256 of manifest.json>`, holding the manifest, before it pushes the `firmware` branch.

**Checking (`src/lib/provenance.ts`, `src/lib/firmware.ts`).** Keyballer downloads `manifest.json` and the firmware file from the `firmware` branch and hashes both. It reads the run named in the manifest (`run.id`) and the run's artifacts, from the connected repository only. It flashes only if all of these hold:
- The run's commit is `source.sha`.
- The run references `AkiraMisawa/keyballer/.github/workflows/build-qmk.yml`, and the workflow commit it used is on Keyballer's own `main`. GitHub serves a fork's commits through the parent's name, so a SHA alone is not Keyballer's code.
- The repository's default branch is exactly `main`, as the editor already assumes. A renamed or look-alike branch (a Cyrillic `а`) is refused.
- The run completed successfully.
- The run's branch is the default branch, and it was started by a push or a manual dispatch.
- The commit is still on the default branch: the compare API, from the branch head SHA to `source.sha`, reports `identical` or `behind`. SHAs are used, not names, so a tag named like the branch cannot answer for it. A commit force-pushed away from `main` is refused.
- It holds an unexpired artifact named after the manifest's SHA-256.
- The firmware's SHA-256 equals the manifest's `sha256`.

The manifest that is checked is the one used to pick the file.

**Why it holds.** GitHub sets a run's branch, event, commit and referenced workflows, and only a run can upload artifacts. Rewriting the `firmware` branch changes the bytes but not any run.

A token that can write workflows could run a workflow of its own on a side branch: its branch is not the default branch. To produce a run on the default branch, it would have to commit to `main`, which the flash dialog shows.

An earlier version used a check run, which any workflow in the repository can create; the review found that, and this design replaced it.

**What it does not stop.**
- **A commit to `main`.** A token can commit C code to `main`, and the build would vouch for that firmware. Defences:
  - The flash dialog shows the run, the commit, its message and its date, so I can tell whether I recognise the change.
  - It says plainly that a commit's author, date and message are written by whoever made it. A stolen token acts as my own account, so no identity check can tell the attacker from me.
  - Tokens should be short-lived and scoped (phase 2 and phase 3).
- **Rolling back** to an older firmware that a run did record is possible, while its commit is still on `main` and its record has not expired. That includes a commit merged in with `-s ours`, and an old run re-run with Actions: write, which renews its record. The dialog says how many commits `main` has gained since then, and when the firmware is older than the last one flashed.
- **Upstream.** QMK is checked out by version tag, and the build image's Python packages are installed without hashes. Both are trusted upstreams, not inputs a token controls.
- **What changed.** Keyballer remembers (in `localStorage`; it is not a secret) the commit of the last firmware it flashed from each repository, and the dialog links to the comparison and counts the commits.
- **Expiry.** Artifacts expire after 90 days; older firmware is built again before flashing.

### The build's own inputs

`keyballer.json` is untrusted input to the build: its values reach `$GITHUB_OUTPUT`, container images and git. The independent review showed that a newline in `qmk.image` could add lines to the plan job's outputs and run code in the publish job, which could then record a forged manifest in a genuine run. Now:
- `build_qmk.py` fetches each source repository's branches and tags (history only), and requires one of them to contain `sources[].ref`. A fork's commit, which GitHub also serves through the parent's URL, is refused. This was verified with a real fork commit of `Yowkees/keyball`.
- `build_qmk.py` checks every value with `fullmatch`:
  - build ids;
  - `qmk.version` (`0.22.14`);
  - `qmk.image`, which must be pinned by `@sha256:`;
  - `sources[].repo` (owner/name);
  - `sources[].ref`, which must be a full commit SHA, because a branch or tag could change what `main` builds without a commit;
  - `sources[].path` and `sources[].as`.
- The workflow never puts expressions in shell text. Values arrive as environment variables and are quoted.
- Checkouts do not keep their token (`persist-credentials: false`).
- The publish job also checks the branch case-sensitively, because GitHub's `==` ignores case.

This validation guards the workflow's own shell. It is not a boundary against the config repository's code: `rules.mk` and `keymap.c` already run in the build job, which could upload a record too. That stays the accepted "commit to `main`" case, because such a record names the attacker's commit, which must still be on `main`.

### Smaller hardening

- **`?repo=`.** A repository named in the address that differs from the saved one is not opened; the repository section asks first, and the focus starts on keeping mine. The parameter is removed from the address once it has been answered.
- **Paths.** `builds[].file` and `builds[].view` must be plain relative paths: segments of letters, digits, `_`, `-` and `.`, with none empty or starting with a dot. `source.sha` must be 40 hex characters. Digests must be 64 hex characters. `getRaw` refuses any other path before sending a request.
- **Framing.** Inside a frame (`window.top !== window.self`), Keyballer renders only "Open Keyballer in its own tab". A `<meta>` CSP cannot set `frame-ancestors`.
- **CSP** (production builds, `<meta>` right after the charset; the dev server keeps Vite's needs):
  - `default-src 'self'`
  - `script-src 'self'`
  - `connect-src 'self' https://api.github.com`
  - `img-src 'self' data:`
  - `style-src 'self'`
  - `font-src 'self'`
  - `object-src 'none'`
  - `base-uri 'none'`
  - `form-action 'none'`
  - `frame-src 'none'`
  - `worker-src 'none'`
  - `require-trusted-types-for 'script'`
  - plus `no-referrer`
- **Pinning.** Actions are pinned by commit SHA, and CI installs with `npm ci --ignore-scripts`.

## Phase 2: tokens on the hosted site (built, except its own origin)

- **Storage.** The personal access token is kept in memory for the tab (`useTokenField` in `src/components/TokenInput.tsx`; the checks are in `src/lib/token.ts`), typed in the repository section or in the review; both show the same field. Nothing token-like is written to `localStorage`. The field is uncontrolled, so React does not copy the token into its `value` attribute.
- **Removing the old token.** On load, before anything renders, `keyballer.token` is removed from `localStorage`. If it was there, a notice in the repository section says so and links to the GitHub page where that kind of token is revoked (classic or fine-grained), because deleting a token does not revoke it. The command `open tokens` opens the same page. The notice shows once, since the token is gone afterwards. A framed Keyballer leaves the token alone, as no one would see the notice.
- **Classic tokens are refused.** Tokens starting with `ghp_` are refused with the reason, and anything else that is not a fine-grained token (`github_pat_` followed by letters, digits and `_`) is refused too, so nothing pasted can add to the `Authorization` header. A classic token reaches every repository, `AkiraMisawa/keyballer` included, so a stolen one is an owner compromise: it could change the build workflow itself. The field takes only fine-grained tokens (`github_pat_`). The app's tokens (`ghu_`) come only from the local sign-in (phase 3), which does not go through the field. The recommended fine-grained token covers the config repository only, with Contents: Read and write and Actions: Read.
- **Its own origin (not built).** Web Serial permission belongs to the origin. `3style` and `ex-grid` share `akiramisawa.github.io` with Keyballer, so a script on either could use the keyboard's port and set Keyballer's `localStorage`. Only an origin of its own fixes this: the owner creates an organization (for example `keyballer-app`), Keyballer moves there, and callers update `uses:`. Whether to move is the owner's call; as decided above, it is out of scope for now, so the same-origin row of the threat model stays unmitigated.

## Phase 3: local sign-in (built)

### The flow

GitHub's web flow with PKCE (S256), in a popup, as reviewed. The device flow was rejected, because a device code can be phished and GitHub advises against enabling it without reason.

0. **Where it shows.** Only when the page's host is `127.0.0.1` and `GET /auth/status` returns a client ID, that is, when `npm run dev` or `npm run preview` runs with the app's settings in `.env.local`. The hosted site never shows it.
1. **Before the click.** When the button appears, Keyballer makes a random `state` (32 bytes) and a PKCE verifier (32 random bytes, base64url) with Web Crypto, and computes the challenge. Both stay in memory.
2. **The click.** It opens `github.com/login/oauth/authorize` synchronously, because Safari blocks `window.open` after an `await`. The call is `window.open(url, 'keyballer-sign-in', 'popup,noopener')`.
3. **The callback.** GitHub sends the window to `/auth/callback`, which the local server serves with real headers:
   - a CSP of its own (`default-src 'none'; script-src 'self'; frame-ancestors 'none'`, and Trusted Types);
   - `Referrer-Policy: no-referrer`, `Cache-Control: no-store` and `nosniff`.

   Its one script, `/auth/callback.js`, calls `history.replaceState` first, sends `{type, code, state, error}` on a `BroadcastChannel`, and tries to close the window. The page never shows any part of the address.
4. **Taking the code.** The page waiting for that exact `state` takes one message within 10 minutes and forgets the `state`. Messages for other states are ignored, and a repeat of the same one finds nothing listening. It POSTs `{code, code_verifier}` to `/auth/token` on its own origin.
5. **The exchange.** The local server adds the client ID, the client secret and the fixed `redirect_uri`, then calls `github.com/login/oauth/access_token`. It returns `{access_token, expires_in}` and nothing else; a response without an `access_token` is an error. The refresh token is dropped.
6. **After sign-in.**
   - The page keeps the token in memory and shows the login from `GET /user`. If that lookup fails, the token is revoked, not kept.
   - Signing in clears a pasted token. Afterwards, a valid token pasted in the review (which asks for one when a save fails) takes precedence; otherwise the sign-in's token is used.
   - It checks that the app's installations reach the connected repository: `GET /user/installations`, then the repositories of an installation on that owner. If they do not reach it, it says so and links to the install page (with `KEYBALLER_GITHUB_APP_SLUG`).
   - It forgets the token when it expires, and says so.
   - Closing or reloading the tab revokes the token: on `pagehide`, a `keepalive` POST goes to `/auth/revoke`. This is best effort, so the 8-hour expiry still bounds a token the browser could not revoke.
   - While a sign-in waits, it can be started again, for a window that was closed or blocked. `noopener` hides the window from the page. The old wait is aborted, and a token it still obtains is revoked.
   - The review offers the same sign-in when saving needs a token, so unsaved changes stay.
   - The commands are `sign in`, `sign out` and `install app`. After signing in, focus moves to the result, or to Save in the review. After signing out, it moves to the sign-in button.

**Signing out.** The page POSTs the token to `/auth/revoke`, which calls `DELETE /applications/{client_id}/token` with Basic auth, then forgets it.

### The local auth endpoints (`src/auth/server.ts`)

**Shape.** One fetch-style handler, `handleAuth(Request, config, fetch) → Response | null`, mounted by a Vite plugin in `configureServer` and `configurePreviewServer` (`vite.config.ts`). It returns null for paths outside `/auth/`. The same handler could later run in a Worker.

**What it accepts.**
- Only these routes; anything else under `/auth/` gets 404:
  - `POST /auth/token` and `POST /auth/revoke`;
  - `GET /auth/status`, which returns the public client ID and app slug, or nulls;
  - `GET /auth/callback` and `GET /auth/callback.js`.
- `Host` must be the server's own address, `127.0.0.1:5173` for dev or `127.0.0.1:4173` for preview, which blocks DNS rebinding.
  - Vite's own host check runs before the handler, too.
  - The servers listen on `127.0.0.1` only, on those fixed ports (`strictPort`), because the callback URLs name them.
  - Vite's CORS is off (`cors: false`).
  - The plugin also refuses any client whose socket address is not loopback, so starting the server with `--host` does not open the endpoints to the network.
- On the POSTs, `Origin` must equal `http://` and that host exactly.
- Anything else gets 403.
- The body must be `application/json`, read from the stream up to 1 KB, and an object with exactly the expected fields:
  - `code`: `^[A-Za-z0-9_-]{1,64}$`
  - `code_verifier`: `^[A-Za-z0-9._~-]{43,128}$`
  - `access_token`: `^ghu_[A-Za-z0-9_]{16,255}$`
- Any bad input gets the same `400 {"error":"bad_request"}`, and input is never echoed.
- Without the app's settings, the POSTs get `503`.
- A refusal or an odd answer from GitHub gets `502 {"error":"github"}`, without GitHub's wording. That includes an `access_token` that is not a `ghu_` token.
- The lifetime returned is at most 8 hours, also when expiry is off in the app.

**What it sends.**
- It calls only GitHub's two endpoints, with `redirect: 'error'`, `Accept: application/json` and an explicit `User-Agent`. The `redirect_uri` is `http://127.0.0.1:<the server's port>/auth/callback`.
- It returns `Cache-Control: no-store`.
- `/revoke` answers `204` whatever happens.
- It logs nothing.

**The secret.**
- `KEYBALLER_GITHUB_CLIENT_ID`, `KEYBALLER_GITHUB_CLIENT_SECRET` and, optionally, `KEYBALLER_GITHUB_APP_SLUG` live in `.env.local`, which git ignores. The owner writes them.
- They are read with Vite's `loadEnv` in `vite.config.ts`, on the server side only, and checked by `parseAuthConfig`. Malformed settings turn sign-in off. Variables without the `VITE_` prefix never reach the client.
- `npm run build` ends with `scripts/check-dist.mjs`, which fails if `dist/` contains the variable names or, when `.env.local` is present, their values.

### The GitHub App (registered by the owner, by hand)

- **Visibility:** private ("Only on this account").
- **Repository permissions:** Contents: Read and write, Actions: Read, Metadata: Read. No account permissions, no Workflows.
- **Tokens:** "Expire user authorization tokens" on.
- **Off:** the webhook, the device flow, "Request user authorization during installation", and the Setup URL.
- **Callback URLs:** `http://127.0.0.1:5173/auth/callback` and `http://127.0.0.1:4173/auth/callback`, matched exactly.
- **Secret and key:** the owner generates a client secret and writes it into `.env.local` themselves. No private key is generated.

## Threat model

| Threat | What it could do | Defence |
|---|---|---|
| A stolen token rewrites the `firmware` branch | Code on my keyboard with no build | Provenance: the bytes must match a manifest recorded by a successful default-branch run of Keyballer's workflow, and a token cannot change runs. Publishing runs only for the default branch. |
| A stolen token commits a value to `keyballer.json` that injects into the workflow | Running code in the publish job and recording a forged manifest | Strict `fullmatch` validation of every value, environment variables instead of expressions in shell, and no persisted tokens. The commit itself stays on `main`, and force-pushing it away fails the branch check. |
| A stolen token bumps a source branch or tag | New code with a one-line commit | `sources[].ref` must be a commit SHA and `qmk.image` a digest. |
| A stolen token that can write workflows runs its own workflow | Forging a record | Only a run on the default branch counts; a side-branch run does not. Changing `main`'s workflow is a visible commit. Classic tokens are refused (phase 2). Neither Keyballer's app nor the recommended fine-grained token can write workflows. |
| A stolen token commits C to `main` | Firmware built from the attacker's code | Not preventable once a token can write. The flash dialog shows the run, commit, message and date, and says these are self-reported. Tokens are short-lived and scoped. A ruleset on `main` is recommended. |
| A malicious `?repo=` link, or a page navigating my tab | Me flashing someone else's firmware | Asks first, with the focus on keeping mine. The flash dialog names the source. |
| A crafted manifest path (`../`) | Authenticated GETs to other API paths | Path and SHA checks, and `getRaw` refuses unsafe paths. |
| XSS (data from a config repository) | Steal the token | React escapes text, and there is no `innerHTML` (checked). A `script-src 'self'` CSP and Trusted Types (verified to block `innerHTML`). Tokens in memory only (phases 2 and 3). |
| Other pages on the same origin (`3style`, `ex-grid`) | Read storage, script Keyballer's windows, use the keyboard's serial port (permission is per origin) | **Unmitigated: only an origin of its own fixes it, and moving is the owner's call (phase 2).** Tokens are never in storage (phase 2), but a page that holds a reference to Keyballer's window can still read the field or the page's memory. Local sign-in runs on `127.0.0.1`. |
| A stolen classic token, or any token that can write `AkiraMisawa/keyballer` | Changing the build workflow or the app itself | An owner compromise, outside what Keyballer can check. Classic tokens are refused (phase 2), and a ruleset on Keyballer's `main` is recommended. |
| A stolen admin token switches the default branch (a look-alike name) | A record for code that is not on the real `main` | Only `main` is accepted. |
| A commit to `main` changing `sources[].ref` to a fork's commit | Building someone else's code behind an "upstream" name | The ref must be contained in a branch or tag of the named repository. |
| A run using a fork or imposter commit of Keyballer's workflow | A forged record | The workflow commit must be on Keyballer's `main`. |
| Clickjacking | Tricking me into flashing or saving | Framed, only a link renders (verified, including a sandboxed frame). |
| Other websites calling the local auth endpoints | Using the app's identity | Exact `Origin` and `Host` checks, and JSON only. Codes are useless without the verifier, which stays in the page's memory. |
| A code or state leaking | Exchanging the code | PKCE, single-use `state`, `replaceState` first, and `no-referrer`. |
| The client secret leaking | Impersonating the app | It lives only in `.env.local` on the owner's machine; it is never bundled (build test) or logged. It can be rotated on GitHub. |
| Owner accounts and pipelines | Code in the site or the build for every user | Actions pinned by SHA, `--ignore-scripts`, and the lockfile. A ruleset on `main` is recommended. |

## Testing decisions

**Seams (TDD, expected values from independent sources):**
- **Provenance** (`judgeProvenance`): checked against FIPS 180-2 SHA-256 vectors, with run fields as the Actions API returns them.
- **Manifest paths and SHAs**
- **`getRaw`:** it refuses unsafe paths before any request (checked with a stubbed `fetch`).
- **`make_manifest.py` digests:** against the FIPS vector.
- **Pasted tokens** (`checkPastedToken`, `forgetStoredToken`): GitHub's documented token prefixes, the 255-character limit, header-breaking input, and storage that throws or will not delete.
- **The local auth handler:**
  - abuse cases first: `Origin`, `Host`, method, path, content type, a streamed oversize body, fields, no echo;
  - then the calls to GitHub and the response shaping.
- **The auth module** (`src/auth/client.ts`):
  - PKCE (RFC 7636 Appendix B) and the authorize address;
  - `state` and message handling over a real `BroadcastChannel`, including aborting a wait;
  - the exchange, expiry, and no storage (the state, verifier and token are never written to `localStorage` or `sessionStorage`);
  - the installations, through `appReaches`.

  The sign-in UI was checked in the browser, with `window.open` captured and only the made-up token's requests answered, so nothing reached GitHub.

**Reviews per phase:**
- the security-review method
- an independent security review given only the code and this threat model
- the two-axis code review

**In the browser, on a production build:**
- the CSP holds (a `securitypolicyviolation` listener records nothing in normal use, and it blocks a probe);
- the framing guard works;
- the `?repo=` prompt works;
- provenance refuses old and tampered firmware;
- after a real build, provenance accepts the firmware and the dialog shows the source.

## Out of scope

- Hosted sign-in, which needs a server such as a Worker and an origin of its own.
- Refresh tokens.
- Sigstore attestations: they need Enterprise for private repositories.
- Organisations and teams.
