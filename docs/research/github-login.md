# Sign in with GitHub: GitHub App + Cloudflare Worker

Research date: 2026-11-22.

Sources are primary; links are at the end. **Observed** marks results from unauthenticated `curl` probes run on 2026-11-22 at 02:27 UTC. The probes sent no credentials, and the only client ID used was the dummy `Iv1.0000000000000000`. **Inference** marks my own reasoning, which no source states.

## Summary

- The web flow's code exchange requires `client_secret`. PKCE (since 2025-07-14) is recommended but does not drop the secret. The device flow needs no secret, even to refresh.
- `github.com/login/...` sends no CORS headers (Observed), so the token exchange needs a Worker. `api.github.com` allows any origin with `Authorization`.
- User tokens last 8 hours and refresh tokens 6 months. Each refresh rotates both. Expiry is on by default, and GitHub recommends keeping it.
- A token can do only what the app's permissions, the user's own access and the app's installations all allow. Keyballer needs Contents read & write and Actions read.
- Revocation needs Basic `client_id:client_secret`. The only secret-less route is `POST /credentials/revoke`, which is meant for leaked credentials.
- `github.io` and `workers.dev` are public suffixes, so a Worker cookie is third-party; only a `Partitioned` cookie works across browsers.
- Pages sends no security headers, and a `<meta>` CSP cannot set `frame-ancestors`.

## 1. Flows, client_secret, PKCE

- **Web flow.** The user goes to `GET github.com/login/oauth/authorize` with `client_id`, `redirect_uri`, `state`, `code_challenge` and `code_challenge_method`. Only `S256` is allowed; "`plain` … is not supported". The app then calls `POST github.com/login/oauth/access_token` with `client_id`, `code`, `redirect_uri` and `code_verifier`, where **`client_secret` is "Required"** ([gh-uat]). Codes expire after 10 minutes ([gh-oauth]).
- **Device flow.** It must be enabled in the app's settings. `POST github.com/login/device/code` takes `client_id` and returns `device_code`, an 8-character `user_code`, `expires_in` (900 s) and `interval` (5 s). The app then polls `access_token` with `grant_type=urn:ietf:params:oauth:grant-type:device_code` ([gh-uat]). "The `client_secret` is not needed for the device flow" ([gh-oauth]).
- **Refresh.** `client_secret` is "Required unless the user access token was generated using the device flow" ([gh-refresh]).
- **PKCE.** Supported for GitHub Apps since **2025-07-14**, and not enforced, because "GitHub does not distinguish between public and confidential clients". It does not apply to the device flow ([cl-pkce]). **No source says that PKCE allows a code exchange without the secret.** I could not test it without a real app.
- **Single-page apps.** GitHub counts them as public clients: "You do have to ship the client secret in the application's code, and you should use PKCE". Such clients "are trivially spoofable". GitHub calls the "authorization code with PKCE" "preferable" to the device flow ([gh-bp]).

## 2. CORS

- **Docs.** The REST API "supports … CORS … from any origin" ([gh-cors]). Nothing is said about CORS on `login/oauth/access_token` or `login/device/code`.
- **Observed on github.com.**
  - `OPTIONS` on both endpoints returns `404` with no `Access-Control-*` headers.
  - A form `POST` with a dummy client ID returns `404 {"error":"Not Found"}` with no `Access-Control-Allow-Origin`.
  - I could not test a successful response.
  - A browser withholds any response that lacks `Access-Control-Allow-Origin`, even after a simple request with no preflight ([mdn-cors]). So call these endpoints from the Worker.
- **Authorize.** `authorize` is a page navigation, so CORS does not apply.
- **Observed on api.github.com.**
  - `OPTIONS` returns `204` with `access-control-allow-origin: *`.
  - `Allow-Headers` includes `Authorization`; methods are `GET, POST, PATCH, PUT, DELETE`; max-age is `86400`.
  - The same holds for `/credentials/revoke`, `/applications/{id}/token` and `/app-manifests/{code}/conversions`.
  - **Inference:** CORS does not depend on the token type, so `ghu_` tokens work from the browser just as today's PATs do.

## 3. Token lifetime

- **Lifetimes.** `ghu_` access tokens expire after 8 hours (`expires_in` 28800). `ghr_` refresh tokens expire after 6 months (`refresh_token_expires_in` 15897600) ([gh-refresh], [gh-uat]).
- **Rotation.** "Once you use a refresh token, that refresh token and the old user access token will no longer work" ([gh-refresh]).
- **The opt-out** is *Optional Features → "User-to-server token expiration" → Opt-out*. On the registration form it is the checkbox "Expire user authorization tokens", which is on by default. GitHub "recommends that you opt in" ([gh-refresh], [gh-register], [gh-bp]).
- **`offline_access`.** Since 2026-10-13, a GitHub App may request this scope to get a refresh token for a single sign-in ([cl-2026-10]).

## 4. What a user token can reach

- **Three limits.** The app can access only resources "the user has access to", only those "it has permission to access", and only "in an account where it is installed" ([gh-onbehalf]). If the app can write but the user can only read, the token can only read ([gh-choose]).
- **Installing.** Installing grants "chosen repositories" ([gh-diff]). To install on one repository, pick **Only select repositories** and choose it ([gh-install]).
- **Install links** can pre-select that repository: `github.com/apps/SLUG/installations/new/permissions?suggested_target_id=USER_ID&repository_ids[]=REPO_ID` ([gh-migrate]).
- **Authorizing and installing are independent** ([gh-install]). "An app does not need to be installed in order for a user to authorize the app" ([gh-onbehalf]).
  - `GET /user/installations` lists the installations the user can access, with `repository_selection` (`all` or `selected`).
  - `GET /user/installations/{id}/repositories` lists the repositories reachable in one installation ([gh-inst-api]).
  - **Inference:** before the user installs the app, the first call returns an empty list.
- **Permissions** ([gh-perms]):

  | Keyballer calls | Permission |
  |---|---|
  | `GET contents/{path}`, `GET git/ref/{ref}`, `GET git/commits/{sha}` | Contents: read |
  | `POST git/trees`, `POST git/commits`, `PATCH git/refs/{ref}` | Contents: write |
  | `GET actions/runs` (and runs or artifacts by ID) | Actions: read |

  - **Metadata** read is also listed. I did not confirm that it is mandatory.
  - **Workflows.** `PATCH git/refs` also appears under **Workflows: write** with an "additional permissions" flag. Workflows is the permission for editing `.github/workflows` ([gh-choose]). **Inference:** it is needed only if a commit touches a workflow file.
- **"Request user authorization (OAuth) during installation."** It asks the user to authorize during install. The Setup URL is then disabled, and users go to the Callback URL "as part of the authorization flow" ([gh-register]). In effect, install and sign-in become one step.
  - That authorization is started by GitHub. **The docs do not say whether Keyballer's `state` or PKCE challenge survive it.** The install URL accepts `?state=`, but the docs do not say where it is delivered ([gh-share]).
  - A Setup URL receives an `installation_id` that "Bad actors can … spoof" ([gh-setup]).

## 5. Manifest flow

- **What a manifest can preset** ([gh-manifest]):
  - `url` (required) and `name`.
  - `hook_attributes`, whose `active` can be false.
  - `redirect_url`, up to 10 `callback_urls` and `setup_url`.
  - `public`, `default_permissions` and `default_events`.
  - `request_oauth_on_install` and `setup_on_update`.
- **What it cannot preset:** **there is no parameter for token expiry or the device flow.**
- **Steps.**
  1. A form POSTs `manifest` (and optionally `state`) to `github.com/settings/apps/new`.
  2. The person may edit the name, then clicks **Create GitHub App**.
  3. GitHub redirects back with a `code`.
  4. Within one hour, the code goes to `POST /app-manifests/{code}/conversions` ([gh-manifest]). The response includes `client_id`, `client_secret` and `pem` ([gh-apps-api]).

## 6. Signing out and revoking

- **With the secret.** `DELETE /applications/{client_id}/token` revokes one token. `DELETE /applications/{client_id}/grant` revokes all of the app's tokens for that user. Both require "Basic authentication" with the client ID and secret, and accept `ghu_` tokens ([gh-oauth-api]).
- **Without the secret.** `POST /credentials/revoke` has supported `ghu_` and `ghr_` since 2026-03-26 ([cl-revoke]). It is unauthenticated, limited to 60 requests per hour, and "intended to revoke credentials the caller does not own and may have found exposed". "Credential owners will be notified" ([gh-revoke]). That rules it out for normal sign-out.
- **By the user.** Users can revoke the app themselves under *Settings → Applications → Authorized GitHub Apps* ([gh-revoke-ui]).

## 7. Cloudflare Workers, free plan

- **Limits.** The free plan allows 100,000 requests per day, reset at midnight UTC; beyond that it returns error 1027. Each request gets 10 ms of CPU (time waiting on the network does not count) and 50 subrequests. External `fetch()` calls count as subrequests, which also means they are allowed ([cf-limits]).
- **User-Agent.** GitHub rejects REST requests that have no `User-Agent` ([gh-rest-start]). The Workers docs do not say whether `fetch` sets one, so set it explicitly.
- **Secrets.** Use `npx wrangler secret put <KEY>`, or in the dashboard go to *Worker → Settings → Variables and Secrets → Add → Secret*. Code reads it as `env.KEY`. The value cannot be viewed afterwards. Local values go in `.dev.vars`, which is not committed ([cf-secrets]).
- **CORS.** Cloudflare's example answers `OPTIONS` in the Worker and returns an explicit origin with `Vary: Origin` ([cf-cors]). Requests that carry credentials need an explicit origin and `Access-Control-Allow-Credentials: true` ([mdn-cors]).
- **workers.dev and custom domains.** Every Worker gets `<name>.<subdomain>.workers.dev`. Cloudflare recommends a route or custom domain for production ([cf-wdev]). A custom domain needs a Cloudflare zone that you own ([cf-domain]).

## 8. Security guidance

- **Storage.** GitHub says to encrypt tokens on the back end. For client-side apps it notes that storage "may not be fully secure", and it names no browser API ([gh-bp]). RFC 10017 §8.5 says localStorage "does not protect against unauthorized access from malicious JavaScript" ([rfc10017]).
- **State.** `state` is "an unguessable random string"; if it does not match, abort ([gh-oauth]). Under RFC 9700 §2.1, a client may rely on PKCE instead of `state` only after confirming the server supports PKCE ([rfc9700]).
- **Callback URLs.**
  - A GitHub App may have up to 10, matched exactly unless wildcard matching is on ([gh-callback]).
  - Apps with a single callback that were created before 2026-08-03 have wildcard matching on by default ([cl-2026-08]).
  - The OAuth-app docs allow any port on `http://127.0.0.1/...` and advise against `localhost` ([gh-oauth]). **The GitHub App docs do not mention loopback.**
- **Browser-based apps (RFC 10017, BCP 212, August 2026)** ([rfc10017]):
  - The patterns, "in decreasing order of security", are BFF, then token-mediating backend, then a browser-only client (§6).
  - A BFF is "strongly recommended" for sensitive apps (§6.1.4.3).
  - Refresh tokens held in a browser must be rotated or sender-constrained (§6.3.2.3); GitHub rotates.
  - BFF cookies MUST be `Secure` and `HttpOnly`, and SHOULD be `SameSite=Strict` with the `__Host-Http-` prefix. A BFF on another site "MUST implement a proper CSRF defense" (§6.1.3.2–3).
- **Third-party cookies.**
  - **Observed:** `github.io` and `workers.dev` are both on the Public Suffix List, so the page and the Worker are different sites.
  - CORS cookies "are subject to normal third-party cookie policies" ([mdn-cors]).
  - Safari has blocked cross-site cookies by default since 2020 ([webkit-3pc]). Since Safari 26.2 (2025-12-12) it accepts them only with `Partitioned; SameSite=None; Secure` ([webkit-262]).
  - Firefox partitions third-party cookies by default. Chrome allows them except in Incognito or when the user blocks them ([mdn-3pc]), and on 2025-04-22 Google decided to keep that approach ([ps-2025]).
  - CHIPS has been "Baseline 2025" since December 2025, partitioned by top-level site ([mdn-chips]).
  - **Inference, untested:** `__Host-rt=…; Secure; HttpOnly; SameSite=None; Path=/; Partitioned` should work. Because it cannot be `SameSite=Strict`, it needs its own CSRF defense.

## 9. Hardening a static SPA that holds tokens

- **(a) Meta tags.**
  - A `<meta>` CSP cannot carry `report-uri`, `frame-ancestors` or `sandbox`, nor a Report-Only policy. It covers only content after it, so it must come first in `<head>` ([w3c-csp] §3.3).
  - `report-to` is not in that list; unconfirmed.
  - The referrer policy can be set with `<meta name="referrer" content="no-referrer">` ([mdn-referrer]).
- **(b) Clickjacking.**
  - **Observed:** the Keyballer page sends no CSP, `X-Frame-Options` or `Referrer-Policy` header.
  - No docs.github.com page I found offers custom headers on github.com Pages.
  - `X-Frame-Options` in `<meta>` "has no effect" ([mdn-xfo]).
  - Framing protection therefore needs another host, for example a Worker that adds headers ([cf-sechead]).
- **(c) Code and state.** `history.replaceState` rewrites the current entry without loading anything ([mdn-replace]); RFC 10017 §7.2.1 uses it to remove the code from the URL. The default `strict-origin-when-cross-origin` sends the full URL to same-origin requests ([mdn-referrer]). So call `replaceState` before any fetch, and also set `no-referrer`.
- **(d) Trusted Types.** `require-trusted-types-for 'script'` has been "Baseline 2026" since February 2026 ([mdn-tt]). CSP3 §3.3 does not exclude it from `<meta>`; I found no explicit statement either way.
- **(e) Worker logs.**
  - Workers Logs is on by default for new Workers. It records one invocation log per request ("<Method> <URL>") plus `console.log` output, kept for 3 days on the free plan. The docs do not say whether headers or bodies are captured. `observability.logs.invocation_logs = false` turns invocation logs off ([cf-logs]).
  - Tail events redact `cookie`, `set-cookie`, and any header whose name contains "auth", "key", "secret", "token" or "jwt". They also redact ID-like strings in URLs, by "heuristic" ([cf-tail]).
  - So keep tokens and codes out of URLs, send them in POST bodies, and never log bodies.
- **(f) Origin checks and rate limits.**
  - Browser scripts cannot set `Origin` ([mdn-forbidden], [mdn-origin]), but `curl` can (Observed). An Origin allow-list therefore stops other sites from using the Worker through their visitors' browsers, not scripts.
  - The Rate Limiting binding has been GA since 2025-09-19 ([cf-rl-ga]). It counts per location, is "eventually consistent", uses periods of 10 or 60 s, and advises against keying on IP ([cf-rl]). **Whether the free plan includes it is not stated.**
  - WAF rate limiting is zone-level. The free plan gets 1 rule with a 10-second period, counted per IP ([cf-waf-rl]); whether it covers workers.dev is not stated.
  - **Inference:** a flood of requests can use up the daily 100,000 and block sign-in until midnight UTC.

## What this means for Keyballer

**A. Web flow + PKCE, exchanged by a Worker (recommended).**

- **Flow.** The SPA creates `state` and a verifier and redirects to `authorize`. Pages receives the `code`, and the SPA calls `replaceState` and POSTs the code and verifier to the Worker. The Worker adds the secret, calls `access_token`, and also handles refresh and `DELETE …/grant`.
- **Pros.** One click, GitHub's preferred flow ([gh-bp]), and the secret stays off the browser.
- **Where the refresh token lives:**
  - **A1 (token-mediating).** The SPA keeps the refresh token. This is the simplest option. It beats today's PAT through 8-hour tokens, rotation and single-repository installs.
  - **A2.** The Worker keeps the refresh token in a `Partitioned` HttpOnly cookie and the SPA holds only the access token, in memory. This needs credentialed CORS, an Origin check and a non-simple request. Untested.
  - **Later.** A custom domain for both the page and the Worker would make them the same site and allow a full BFF.

**B. Device flow through a Worker.**

- The Worker only relays requests to get past CORS, and no secret is involved anywhere, including refresh ([gh-refresh]).
- The cost is the user experience: the user copies an 8-character code into `github.com/login/device` while the app polls. GitHub also says "Don't enable device flow without reason" ([gh-bp]).

**C. PKCE with no secret and no Worker.** Not viable. The docs require the secret for the exchange ([gh-uat]), and the endpoint sends no CORS headers (Observed). Shipping the secret in the bundle would still fail on CORS.

**App settings**

- **Repository permissions:**
  - Contents: read & write.
  - Actions: read.
  - Metadata: read.
  - Workflows: none, unless commits touch `.github/workflows`.
- **General:**
  - No account permissions.
  - Webhook "Active" off.
  - "Expire user authorization tokens" on.
  - Installable on "Any account".
  - Device flow off, unless you choose option B.
- **Callback URLs:** exact match with wildcard off. Use `https://akiramisawa.github.io/keyballer/` and a development URL such as `http://127.0.0.1:5173/keyballer/`.
- **Request OAuth on install:** either leave it off and use a Setup URL that sends the user to sign-in, or turn it on and have the callback discard any code whose `state` does not match.
- **In the app:** check `/user/installations` first, then link to the install URL that pre-selects the config repository.

**Manual steps for the owner**

1. Register the app, by hand or by manifest, and note the client ID.
   - After a manifest registration, check the token-expiry and device-flow settings, which a manifest cannot set.
   - For option A, generate a client secret.
2. Create a Cloudflare account and deploy the Worker with `wrangler deploy`.
3. Run `wrangler secret put GITHUB_CLIENT_SECRET`, and set the client ID and allowed origin as variables.
4. Decide whether to turn off invocation logs.
5. Add a `<meta>` CSP whose `connect-src` allows only `api.github.com` and the Worker, plus `<meta name="referrer" content="no-referrer">`.
6. Optionally, add a custom domain (needed for WAF rules and same-site cookies).
7. Each user installs the app on their config repository with "Only select repositories".

## Not confirmed

- Whether successful `access_token` and `device/code` responses carry CORS headers. Error responses and preflights do not (Observed).
- Whether a code can be exchanged with PKCE but no secret. The docs say the secret is Required.
- Whether loopback ports may vary in **GitHub App** callbacks.
- Whether `state` or PKCE survive an authorization that starts at install.
- Whether Metadata read is mandatory.
- Whether the free plan includes the Rate Limiting binding, and whether WAF rules cover workers.dev.
- Whether `report-to` and Trusted Types work in `<meta>`.
- Whether a Partitioned cookie works in this setup (untested).
- Whether Workers Logs captures headers or bodies.

## Sources

[gh-uat]: https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app
[gh-refresh]: https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens
[gh-oauth]: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps
[gh-bp]: https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/best-practices-for-creating-a-github-app
[gh-callback]: https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-user-authorization-callback-url
[gh-register]: https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app
[gh-setup]: https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-setup-url
[gh-onbehalf]: https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-with-a-github-app-on-behalf-of-a-user
[gh-choose]: https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app
[gh-perms]: https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps
[gh-diff]: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/differences-between-github-apps-and-oauth-apps
[gh-install]: https://docs.github.com/en/apps/using-github-apps/installing-a-github-app-from-a-third-party
[gh-migrate]: https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/migrating-oauth-apps-to-github-apps
[gh-share]: https://docs.github.com/en/apps/sharing-github-apps/sharing-your-github-app
[gh-inst-api]: https://docs.github.com/en/rest/apps/installations
[gh-manifest]: https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest
[gh-apps-api]: https://docs.github.com/en/rest/apps/apps#create-a-github-app-from-a-manifest
[gh-oauth-api]: https://docs.github.com/en/rest/apps/oauth-applications
[gh-revoke]: https://docs.github.com/en/rest/credentials/revoke
[gh-revoke-ui]: https://docs.github.com/en/apps/using-github-apps/reviewing-and-revoking-authorization-of-github-apps
[gh-cors]: https://docs.github.com/en/rest/using-the-rest-api/using-cors-and-jsonp-to-make-cross-origin-requests
[gh-rest-start]: https://docs.github.com/en/rest/using-the-rest-api/getting-started-with-the-rest-api
[cl-pkce]: https://github.blog/changelog/2025-07-14-pkce-support-for-oauth-and-github-app-authentication/
[cl-revoke]: https://github.blog/changelog/2026-03-26-credential-revocation-api-now-supports-github-oauth-and-github-app-credentials/
[cl-2026-08]: https://github.blog/changelog/2026-08-14-multiple-redirect-uris-and-token-refresh-for-oauth-apps/
[cl-2026-10]: https://github.blog/changelog/2026-10-13-github-app-improvements-for-least-privilege-and-management/
[cf-limits]: https://developers.cloudflare.com/workers/platform/limits/
[cf-secrets]: https://developers.cloudflare.com/workers/configuration/secrets/
[cf-cors]: https://developers.cloudflare.com/workers/examples/cors-header-proxy/
[cf-wdev]: https://developers.cloudflare.com/workers/configuration/routing/workers-dev/
[cf-domain]: https://developers.cloudflare.com/workers/configuration/routing/custom-domains/
[cf-logs]: https://developers.cloudflare.com/workers/observability/logs/workers-logs/
[cf-tail]: https://developers.cloudflare.com/workers/runtime-apis/handlers/tail/
[cf-rl]: https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
[cf-rl-ga]: https://developers.cloudflare.com/changelog/post/2025-09-19-ratelimit-workers-ga/
[cf-waf-rl]: https://developers.cloudflare.com/waf/rate-limiting-rules/
[cf-sechead]: https://developers.cloudflare.com/workers/examples/security-headers/
[rfc10017]: https://www.rfc-editor.org/rfc/rfc10017.html
[rfc9700]: https://www.rfc-editor.org/rfc/rfc9700.html
[w3c-csp]: https://www.w3.org/TR/CSP3/#meta-element
[mdn-cors]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS
[mdn-3pc]: https://developer.mozilla.org/en-US/docs/Web/Privacy/Guides/Third-party_cookies
[mdn-chips]: https://developer.mozilla.org/en-US/docs/Web/Privacy/Guides/Privacy_sandbox/Partitioned_cookies
[mdn-referrer]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referrer-Policy
[mdn-replace]: https://developer.mozilla.org/en-US/docs/Web/API/History/replaceState
[mdn-xfo]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-Frame-Options
[mdn-tt]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/require-trusted-types-for
[mdn-forbidden]: https://developer.mozilla.org/en-US/docs/Glossary/Forbidden_request_header
[mdn-origin]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Origin
[webkit-3pc]: https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/
[webkit-262]: https://webkit.org/blog/17640/webkit-features-for-safari-26-2/
[ps-2025]: https://privacysandbox.google.com/blog/privacy-sandbox-next-steps

- GitHub docs: [gh-uat], [gh-refresh], [gh-oauth], [gh-bp], [gh-callback], [gh-register], [gh-setup], [gh-onbehalf], [gh-choose], [gh-perms], [gh-diff], [gh-install], [gh-migrate], [gh-share], [gh-inst-api], [gh-manifest], [gh-apps-api], [gh-oauth-api], [gh-revoke], [gh-revoke-ui], [gh-cors], [gh-rest-start]
- GitHub changelog: [cl-pkce] (2025-07-14), [cl-revoke] (2026-03-26), [cl-2026-08] (2026-08-14), [cl-2026-10] (2026-10-13)
- Cloudflare: [cf-limits], [cf-secrets], [cf-cors], [cf-wdev], [cf-domain], [cf-logs], [cf-tail], [cf-rl], [cf-rl-ga], [cf-waf-rl], [cf-sechead]
- Standards: [rfc10017], [rfc9700], [w3c-csp]
- Browsers: [mdn-cors], [mdn-3pc], [mdn-chips], [mdn-referrer], [mdn-replace], [mdn-xfo], [mdn-tt], [mdn-forbidden], [mdn-origin], [webkit-3pc], [webkit-262], [ps-2025]
- Public Suffix List (checked `github.io` and `workers.dev`): https://publicsuffix.org/list/public_suffix_list.dat
