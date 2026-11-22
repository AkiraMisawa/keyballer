// What the page, the sign-in window and the local server (server.ts) agree on. Nothing secret:
// the page imports this too.

/** Where GitHub sends the sign-in window back to; the app's callback URLs name it. */
export const CALLBACK_PATH = '/auth/callback';
export const TOKEN_PATH = '/auth/token';
export const REVOKE_PATH = '/auth/revoke';
export const STATUS_PATH = '/auth/status';

/** The channel and message type the sign-in window uses to hand back the code. */
export const SIGN_IN_CHANNEL = 'keyballer-sign-in';
export const SIGN_IN_MESSAGE = 'keyballer-sign-in';

/** A code from GitHub's authorize step. */
export const CODE = /^[A-Za-z0-9_-]{1,64}$/;
/** A PKCE verifier (RFC 7636 §4.1). */
export const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
/** A GitHub App user token. */
export const USER_TOKEN = /^ghu_[A-Za-z0-9_]{16,255}$/;

/** The most a sign-in lasts, in seconds: GitHub's own lifetime for user tokens, 8 hours. */
export const MAX_LIFETIME_S = 28800;
