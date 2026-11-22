// Said once, after deleting the token an older version kept in localStorage: deleting it here
// does not revoke it, so the notice links to the GitHub page where it can be revoked.

import { useCommand } from '../commands/react';
import { msg } from '../i18n/core';
import { useI18n } from '../i18n/react';

const REVOKE_PAGE = {
  classic: 'https://github.com/settings/tokens',
  'fine-grained': 'https://github.com/settings/personal-access-tokens',
} as const;

export function ForgottenToken({ kind }: { kind: keyof typeof REVOKE_PAGE }) {
  const { t } = useI18n();
  const url = REVOKE_PAGE[kind];
  useCommand({
    id: 'token.revoke',
    words: 'revoke token',
    title: msg('cmd.revokeToken'),
    group: 'group.repo',
    run: () => window.open(url, '_blank', 'noopener'),
  });
  return (
    <div className="banner info stack" role="status">
      <p>{t('token.forgotten')}</p>
      <a href={url} target="_blank" rel="noreferrer">
        {t('token.revoke')}
      </a>
    </div>
  );
}
