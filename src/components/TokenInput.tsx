// The field a personal access token is pasted into, in the repository section and in the save
// review, and the tab's memory of it. A refused token is shown as typed, with the reason, and is
// never sent.

import { useEffect, useRef, useState } from 'react';
import type { SignIn } from '../auth/useSignIn';
import type { MessageKey } from '../i18n/messages';
import { useI18n } from '../i18n/react';
import { checkPastedToken } from '../lib/token';

/** The token field, shared by the repository section and the save review. */
export interface TokenField {
  /** What was typed or pasted. */
  input: string;
  /** The token to send: empty unless the input was taken. */
  value: string;
  /** Why the input was refused, if it was. */
  problem: MessageKey | null;
  set: (input: string) => void;
  /** Local sign-in, where Keyballer runs on this machine; its token is used while signed in. */
  signIn: SignIn | null;
}

/** The token, held in this tab's memory only: the signed-in one, or else the pasted one. */
export function useTokenField(signIn: SignIn | null): TokenField {
  const [input, set] = useState('');
  const checked = checkPastedToken(input);
  const pasted = checked.ok ? checked.token : '';
  return { input, value: signIn?.token || pasted, problem: checked.ok ? null : checked.reason, set, signIn };
}

export function TokenInput({ id, tokenField }: { id: string; tokenField: TokenField }) {
  const { t } = useI18n();
  const problemId = `${id}-problem`;
  // Uncontrolled: React copies a controlled input's value into its `value` attribute, where CSS
  // selectors and saved copies of the page could see the token. The field is filled once, from
  // memory, when it appears.
  const field = useRef<HTMLInputElement>(null);
  const initial = useRef(tokenField.input);
  useEffect(() => {
    if (field.current) field.current.value = initial.current;
  }, []);
  return (
    <>
      <input
        ref={field}
        id={id}
        type="password"
        onChange={(e) => tokenField.set(e.target.value)}
        placeholder="github_pat_…"
        autoComplete="off"
        spellCheck={false}
        aria-invalid={tokenField.problem ? true : undefined}
        aria-describedby={tokenField.problem ? problemId : undefined}
      />
      {tokenField.problem && (
        <p id={problemId} className="err" role="alert">
          {t(tokenField.problem)}
        </p>
      )}
    </>
  );
}
