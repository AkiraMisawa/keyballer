// Said once, after deleting the token an older version kept in localStorage: deleting it here
// does not revoke it, so the notice links to the GitHub page where it can be revoked.

import { useCommand } from '../commands/react';
import { msg } from '../i18n/core';
import { useI18n } from '../i18n/react';
import type { ForgottenTokenKind } from '../lib/token';

const REVOKE_PAGE: Record<ForgottenTokenKind, string> = {
  classic: 'https://github.com/settings/tokens',
  'fine-grained': 'https://github.com/settings/personal-access-tokens',
};

export function ForgottenToken({ kind }: { kind: ForgottenTokenKind }) {
  const { t } = useI18n();
  const url = REVOKE_PAGE[kind];
  useCommand({
    id: 'token.openSettings',
    words: 'open tokens',
    title: msg('cmd.openTokens'),
    group: 'group.repo',
    run: () => window.open(url, '_blank', 'noopener'),
  });
  return (
    <div className="notice stack" role="region" aria-labelledby="forgotten-token">
      <p id="forgotten-token">{t('token.forgotten')}</p>
      <a href={url} target="_blank" rel="noreferrer">
        {t('token.revoke')}
      </a>
    </div>
  );
}
