// The head of a flash panel: its title, which takes focus where the panel says so, and Close (Esc).

import type { RefObject } from 'react';
import { useI18n } from '../i18n/react';

interface Props {
  id: string;
  title: string;
  headingRef?: RefObject<HTMLHeadingElement | null>;
  onClose: () => void;
  /** While something cannot be interrupted. */
  closeDisabled?: boolean;
}

export function PanelHead({ id, title, headingRef, onClose, closeDisabled }: Props) {
  const { t } = useI18n();
  return (
    <div className="panel-head">
      <h2 id={id} ref={headingRef} tabIndex={-1}>
        {title}
      </h2>
      <button type="button" className="ghost" onClick={onClose} disabled={closeDisabled} aria-keyshortcuts="Escape">
        {t('common.close')}
      </button>
    </div>
  );
}
