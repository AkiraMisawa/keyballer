// The field a personal access token is pasted into, in the repository section and in the save
// review. A refused token is shown as typed, with the reason, and is never sent.

import { useI18n } from '../i18n/react';
import type { TokenField } from '../lib/token';

export function TokenInput({ id, field }: { id: string; field: TokenField }) {
  const { t } = useI18n();
  const problemId = `${id}-problem`;
  return (
    <>
      <input
        id={id}
        type="password"
        value={field.input}
        onChange={(e) => field.set(e.target.value)}
        placeholder="github_pat_…"
        autoComplete="off"
        spellCheck={false}
        aria-invalid={field.problem ? true : undefined}
        aria-describedby={field.problem ? problemId : undefined}
      />
      {field.problem && (
        <p id={problemId} className="err" role="alert">
          {t(field.problem)}
        </p>
      )}
    </>
  );
}
