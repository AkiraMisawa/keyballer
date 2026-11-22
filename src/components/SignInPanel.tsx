// Local sign-in in the repository section: a button before, the account and "Sign out" after,
// and a link to install the app when the sign-in cannot reach the connected repository. The
// commands live in SignInCommands, which stays on screen with the keymap too.

import { useCommand } from '../commands/react';
import { msg } from '../i18n/core';
import { useI18n } from '../i18n/react';
import type { SignIn } from '../auth/useSignIn';

export function SignInCommands({ signIn }: { signIn: SignIn }) {
  useCommand({
    id: 'auth.signIn',
    words: 'sign in',
    title: msg('cmd.signIn'),
    group: 'group.repo',
    unavailable: signIn.login
      ? msg('why.signedIn')
      : signIn.busy
        ? msg('why.signingIn')
        : signIn.ready
          ? undefined
          : msg('why.signInPreparing'),
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
export function SignInButton({ signIn }: { signIn: SignIn }) {
  const { t } = useI18n();
  return (
    <>
      <div className="row">
        <button type="button" onClick={signIn.start} disabled={!signIn.ready || signIn.busy}>
          {signIn.busy ? t('auth.signingIn') : t('auth.signIn')}
        </button>
      </div>
      {signIn.problem && (
        <p className={signIn.problem === 'auth.ended' ? 'note' : 'err'} role="alert">
          {t(signIn.problem)}
        </p>
      )}
    </>
  );
}

interface Props {
  signIn: SignIn;
  /** The connected repository, if any. */
  repo: string | null;
  /** Whether the sign-in reaches it: null while unknown. */
  reaches: boolean | null;
}

export function SignInPanel({ signIn, repo, reaches }: Props) {
  const { t } = useI18n();
  if (!signIn.login) {
    return (
      <div className="stack">
        <p className="note">{t('auth.note')}</p>
        <SignInButton signIn={signIn} />
      </div>
    );
  }
  const slug = signIn.setup.appSlug;
  return (
    <div className="stack">
      <div className="row">
        <p>{t('auth.signedIn', { login: signIn.login })}</p>
        <button type="button" onClick={signIn.end}>
          {t('auth.signOut')}
        </button>
      </div>
      <p className="note">{t('auth.lasts')}</p>
      {repo && reaches === false && (
        <div className="notice stack" role="region" aria-labelledby="sign-in-reach">
          <p id="sign-in-reach">{t('auth.notInstalled', { repo })}</p>
          {slug ? (
            <a href={`https://github.com/apps/${slug}/installations/new`} target="_blank" rel="noreferrer">
              {t('auth.install', { repo })}
            </a>
          ) : (
            <p className="note">{t('auth.installManual')}</p>
          )}
        </div>
      )}
    </div>
  );
}
