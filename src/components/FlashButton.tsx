// "Flash" on a firmware card, and its command: `flash <id>`, with the digit shortcut for the first
// nine cards. Shared by QMK and ZMK cards.

import { Kbd } from '../commands/keys';
import { useCommand } from '../commands/react';
import { msg, type Localized } from '../i18n/core';
import { useI18n } from '../i18n/react';

interface Props {
  id: string;
  name: string;
  /** Position in the list; the first nine get the shortcuts 1–9. */
  index: number;
  /** Why it cannot run now, if it cannot. */
  unavailable: Localized | undefined;
  /** Why this firmware can never be flashed here: shown instead of the button, and the command says it. */
  refusal?: Localized;
  loading: boolean;
  onFlash: () => void;
}

export function FlashButton({ id, name, index, unavailable, refusal, loading, onFlash }: Props) {
  const { t } = useI18n();
  const shortcut = index < 9 ? String(index + 1) : '';
  useCommand({
    id: `flash:${id}`,
    words: `flash ${id}`,
    title: msg('shortcut.flashBuild', { name }),
    group: 'group.firmware',
    shortcut: shortcut || undefined,
    unavailable: refusal ?? unavailable ?? (loading ? msg('why.loading') : undefined),
    run: onFlash,
  });
  if (refusal) return <p className="note">{t(refusal.key, refusal.params)}</p>;
  return (
    <button type="button" className="primary" onClick={onFlash} disabled={!!unavailable || loading} aria-keyshortcuts={shortcut || undefined}>
      {loading ? t('card.loading') : t('card.flash')}
      {shortcut && <Kbd>{shortcut}</Kbd>}
    </button>
  );
}
