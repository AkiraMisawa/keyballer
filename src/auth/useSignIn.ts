// Local sign-in for the page (docs/plans/github-login.md, phase 3). Null unless Keyballer runs on
// this machine with the GitHub App set up. The token lives in this hook's state only. The sign-in
// ends, and the token is revoked, when the tab closes or reloads, on sign-out, or at expiry.

import { useCallback, useEffect, useRef, useState } from 'react';
import { LocalizedError } from '../i18n/core';
import type { MessageKey } from '../i18n/messages';
import { appReaches, getLogin, repoName, type RepoRef } from '../lib/github';
import {
  exchangeCode,
  getSignInSetup,
  prepareSignIn,
  revokeToken,
  SIGN_IN_TIMEOUT_MS,
  waitForCode,
  watchExpiry,
  type PreparedSignIn,
  type Session,
  type SignInSetup,
} from './client';

export interface SignIn {
  setup: SignInSetup;
  /** The signed-in account, or null. */
  login: string | null;
  /** The user token while signed in, otherwise empty. */
  token: string;
  /** Waiting for the sign-in window. Starting again opens a new one. */
  waiting: boolean;
  /** Why a sign-in cannot start now, or null when it can. */
  cannotStart: MessageKey | null;
  /** Why the last sign-in did not finish, or that it ended. */
  problem: MessageKey | null;
  /** Whether the sign-in reaches the connected repository: null while unknown or not signed in. */
  reaches: boolean | null;
  start: () => void;
  end: () => void;
}

export function useSignIn(repo: RepoRef | null): SignIn | null {
  const [setup, setSetup] = useState<SignInSetup | null>(null);
  const [prepared, setPrepared] = useState<PreparedSignIn | null>(null);
  const [session, setSession] = useState<(Session & { login: string }) | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [problem, setProblem] = useState<MessageKey | null>(null);
  const [reaches, setReaches] = useState<boolean | null>(null);
  /** The sign-in in progress; starting again aborts it, so its answer is ignored. */
  const attempt = useRef<AbortController | null>(null);

  useEffect(() => {
    let live = true;
    void getSignInSetup().then((s) => live && setSetup(s));
    return () => {
      live = false;
    };
  }, []);

  // The sign-in window must open in the click itself (Safari blocks it after an await), so the
  // state and the PKCE challenge are made before, also while waiting, for starting again.
  useEffect(() => {
    if (!setup || session || prepared) return;
    let live = true;
    void prepareSignIn(setup.clientId, location.origin).then((p) => live && setPrepared(p));
    return () => {
      live = false;
    };
  }, [setup, session, prepared]);

  // The token stops working at its expiry; the page forgets it then and says so.
  useEffect(() => {
    if (!session) return;
    return watchExpiry(session, () => {
      setSession(null);
      setProblem('auth.ended');
    });
  }, [session]);

  // Closing or reloading the tab ends the sign-in on GitHub too, as far as the browser lets the
  // request out (it is sent with keepalive). Otherwise the token would work until its expiry.
  useEffect(() => {
    if (!session) return;
    const leave = () => {
      revokeToken(session.token);
      setSession(null);
    };
    addEventListener('pagehide', leave);
    return () => removeEventListener('pagehide', leave);
  }, [session]);

  // Does the app's installation reach the connected repository? Without it, the token can read a
  // public repository but not save to it. Keyed on the name: a refresh gives a new object.
  const token = session?.token ?? '';
  const name = repo ? repoName(repo) : '';
  const repoRef = useRef(repo);
  repoRef.current = repo;
  useEffect(() => {
    setReaches(null);
    const target = repoRef.current;
    if (!token || !target) return;
    let live = true;
    appReaches(target, token).then(
      (r) => live && setReaches(r),
      () => live && setReaches(null),
    );
    return () => {
      live = false;
    };
  }, [token, name]);

  const start = useCallback(() => {
    if (!prepared || session) return;
    attempt.current?.abort();
    const controller = new AbortController();
    attempt.current = controller;
    const once = prepared;
    setPrepared(null);
    setWaiting(true);
    setProblem(null);
    // Listen before opening, so a fast answer is not missed.
    const code = waitForCode(once.state, SIGN_IN_TIMEOUT_MS, controller.signal);
    window.open(once.url, 'keyballer-sign-in', 'popup,noopener');
    void code
      .then((c) => exchangeCode(c, once.verifier))
      .then(async (s) => {
        try {
          const login = await getLogin(s.token);
          // A newer sign-in started meanwhile: this token is not kept, so it is revoked.
          if (controller.signal.aborted) revokeToken(s.token);
          else setSession({ ...s, login });
        } catch (e) {
          // Not kept, so not left working on GitHub either.
          revokeToken(s.token);
          throw e;
        }
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setProblem(e instanceof LocalizedError && e.key.startsWith('auth.') ? e.key : 'auth.err.failed');
      })
      .finally(() => {
        if (attempt.current === controller) {
          attempt.current = null;
          setWaiting(false);
        }
      });
  }, [prepared, session]);

  const end = useCallback(() => {
    if (session) revokeToken(session.token);
    setSession(null);
    setProblem(null);
  }, [session]);

  if (!setup) return null;
  return {
    setup,
    login: session?.login ?? null,
    token,
    waiting,
    cannotStart: session ? 'why.signedIn' : prepared ? null : 'why.signInPreparing',
    problem,
    reaches,
    start,
    end,
  };
}
