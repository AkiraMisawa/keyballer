// A ZMK firmware in the list: its name, board and shield, which half it is, "Flash", which opens
// the UF2 panel, and its keymap when the build made a view (docs/plans/zmk.md). The settings reset
// has no card; the panel offers it.

import { Kbd } from '../commands/keys';
import type { Localized } from '../i18n/core';
import { useI18n } from '../i18n/react';
import { formatBytes } from '../lib/format';
import type { ZmkBuild } from '../lib/manifest';
import { FlashButton } from './FlashButton';

interface Props {
  build: ZmkBuild;
  /** Position in the list; the first nine get the shortcuts 1–9. */
  index: number;
  /** Why the panel cannot open now; absent when it can. */
  blocked: Localized | undefined;
  loading: boolean;
  onFlash: () => void;
  onKeymap: () => void;
  /** The key that opens this firmware's keymap, when it has one. */
  keymapShortcut?: string;
}

export function ZmkCard({ build, index, blocked, loading, onFlash, onKeymap, keymapShortcut }: Props) {
  const { t, lang } = useI18n();
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
        <FlashButton id={build.id} name={build.name} index={index} unavailable={blocked} loading={loading} onFlash={onFlash} />
        {build.view && (
          <button type="button" onClick={onKeymap} aria-keyshortcuts={keymapShortcut?.toUpperCase()} data-keymap={build.id}>
            {t('card.keymap')}
            {keymapShortcut && <Kbd>{keymapShortcut.toUpperCase()}</Kbd>}
          </button>
        )}
      </div>
    </article>
  );
}
