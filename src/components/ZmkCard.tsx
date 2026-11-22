// A ZMK firmware in the list: its name, board and shield, which half it is, and "Flash", which
// opens the UF2 panel (docs/plans/zmk.md). The settings reset has no card; the panel offers it.

import { Kbd } from '../commands/keys';
import { useCommand } from '../commands/react';
import { msg, type Localized } from '../i18n/core';
import { useI18n } from '../i18n/react';
import { formatBytes } from '../lib/format';
import type { ZmkBuild } from '../lib/manifest';

interface Props {
  build: ZmkBuild;
  /** Position in the list; the first nine get the shortcuts 1–9. */
  index: number;
  /** Why the panel cannot open now; absent when it can. */
  blocked: Localized | undefined;
  loading: boolean;
  onFlash: () => void;
}

export function ZmkCard({ build, index, blocked, loading, onFlash }: Props) {
  const { t, lang } = useI18n();
  const shortcut = index < 9 ? String(index + 1) : '';
  useCommand({
    id: `flash:${build.id}`,
    words: `flash ${build.id}`,
    title: msg('shortcut.flashBuild', { name: build.name }),
    group: 'group.firmware',
    shortcut: shortcut || undefined,
    unavailable: blocked ?? (loading ? msg('why.loading') : undefined),
    run: onFlash,
  });
  return (
    <article className="card">
      <div className="card-head">
        <h3>{build.name}</h3>
        <code className="muted">
          {build.board} {build.shield}
        </code>
      </div>

      <ul className="chips" aria-label={t('card.specs')}>
        {build.role === 'central' && <li>{t('zmk.role.central')}</li>}
        {build.role === 'peripheral' && <li>{t('zmk.role.peripheral')}</li>}
        {build.studio && <li>{t('zmk.studio')}</li>}
        <li>UF2</li>
        {build.size !== null && <li>{t('zmk.size', { size: formatBytes(build.size, lang) })}</li>}
      </ul>

      <div className="row">
        <button
          type="button"
          className="primary"
          onClick={onFlash}
          disabled={!!blocked || loading}
          aria-keyshortcuts={shortcut || undefined}
        >
          {loading ? t('card.loading') : t('card.flash')}
          {shortcut && <Kbd>{shortcut}</Kbd>}
        </button>
      </div>
    </article>
  );
}
