// Local sign-in in the repository section: a button before, the account and "Sign out" after,
// and a link to install the app when the sign-in cannot reach the connected repository. The
// commands live in SignInCommands, which stays on screen with the keymap too; the review dialog
// reuses SignInButton and InstallApp.

import { useEffect, useRef, type RefObject } from 'react';
import { useCommand } from '../commands/react';
import { msg } from '../i18n/core';
import { useI18n } from '../i18n/react';
import type { SignIn } from '../auth/useSignIn';

const installPage = (slug: string) => `https://github.com/apps/${slug}/installations/new`;

export function SignInCommands({ signIn }: { signIn: SignIn }) {
  useCommand({
    id: 'auth.signIn',
    words: 'sign in',
    title: msg('cmd.signIn'),
    group: 'group.repo',
    unavailable: signIn.cannotStart ? msg(signIn.cannotStart) : undefined,
    run: signIn.start,
  });
  useCommand({
    id: 'auth.signOut',
    words: 'sign out',
    title: msg('cmd.signOut'),
    group: 'group.repo',
    unavailable: signIn.login ? undefined : msg('why.notSignedIn'),
    run: signIn.end,
  });
  return null;
}

/** The button, with what is happening and why a sign-in did not finish. */
export function SignInButton({ signIn, buttonRef }: { signIn: SignIn; buttonRef?: RefObject<HTMLButtonElement | null> }) {
  const { t } = useI18n();
  return (
    <>
      <div className="row">
        <button ref={buttonRef} type="button" onClick={signIn.start} disabled={signIn.cannotStart !== null}>
          {signIn.waiting ? t('auth.signInAgain') : t('auth.signIn')}
        </button>
      </div>
      {signIn.waiting && (
        <p className="note" role="status">
          {t('auth.waiting')}
        </p>
      )}
      {signIn.problem && (
        <p className={signIn.problem === 'auth.ended' ? 'note' : 'err'} role={signIn.problem === 'auth.ended' ? 'status' : 'alert'}>
          {t(signIn.problem)}
        </p>
      )}
    </>
  );
}

/** Said when the sign-in cannot reach the connected repository, with the way to fix it. */
export function InstallApp({ signIn, repo }: { signIn: SignIn; repo: string }) {
  const { t } = useI18n();
  const slug = signIn.setup.appSlug;
  useCommand({
    id: 'auth.install',
    words: 'install app',
    title: msg('cmd.installApp'),
    group: 'group.repo',
    unavailable: slug ? undefined : msg('auth.installManual'),
    run: () => slug && window.open(installPage(slug), '_blank', 'noopener'),
  });
  return (
    <div className="notice stack" role="region" aria-labelledby="sign-in-reach">
      <p id="sign-in-reach">{t('auth.notInstalled', { repo })}</p>
      {slug ? (
        <a href={installPage(slug)} target="_blank" rel="noreferrer">
          {t('auth.install', { repo })}
        </a>
      ) : (
        <p className="note">{t('auth.installManual')}</p>
      )}
    </div>
  );
}

interface Props {
  signIn: SignIn;
  /** The connected repository, if any. */
  repo: string | null;
}

export function SignInPanel({ signIn, repo }: Props) {
  const { t } = useI18n();
  const status = useRef<HTMLParagraphElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  // Focus moves on (DESIGN.md §8): to the result after signing in, and back to the button after
  // signing out, when the control that had it went away.
  const was = useRef(signIn.login);
  useEffect(() => {
    const lost = !document.activeElement || document.activeElement === document.body;
    if (lost && !was.current && signIn.login) status.current?.focus();
    if (lost && was.current && !signIn.login) button.current?.focus();
    was.current = signIn.login;
  }, [signIn.login]);

  if (!signIn.login) {
    return (
      <div className="stack">
        <p className="note">{t('auth.note')}</p>
        <SignInButton signIn={signIn} buttonRef={button} />
      </div>
    );
  }
  return (
    <div className="stack">
      <div className="row">
        <p ref={status} tabIndex={-1} role="status">
          {t('auth.signedIn', { login: signIn.login })}
        </p>
        <button type="button" onClick={signIn.end}>
          {t('auth.signOut')}
        </button>
      </div>
      <p className="note">{t('auth.lasts')}</p>
      {repo && signIn.reaches === false && <InstallApp signIn={signIn} repo={repo} />}
    </div>
  );
}
