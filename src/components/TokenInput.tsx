// The field a personal access token is pasted into, in the repository section and in the save
// review, and the tab's memory of it. A refused token is shown as typed, with the reason, and is
// never sent. (A local sign-in, src/auth/useSignIn.ts, is the other way to get a token.)

import { useEffect, useRef, useState } from 'react';
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
}

/** The pasted token, held in this tab's memory only. */
export function useTokenField(): TokenField {
  const [input, set] = useState('');
  const checked = checkPastedToken(input);
  return checked.ok
    ? { input, value: checked.token, problem: null, set }
    : { input, value: '', problem: checked.reason, set };
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
  // Cleared from outside (signing in replaces a pasted token): empty the field too.
  useEffect(() => {
    if (tokenField.input === '' && field.current) field.current.value = '';
  }, [tokenField.input]);
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
