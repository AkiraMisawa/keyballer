import { Kbd } from '../commands/keys';
import { useCommand } from '../commands/react';
import { msg, type Localized } from '../i18n/core';
import { useI18n } from '../i18n/react';
import { bootloaderLabel, formatBytes, processorLabel } from '../lib/format';
import { canFlash, type QmkBuild } from '../lib/manifest';

interface Props {
  build: QmkBuild;
  /** Position in the list; the first nine get the shortcuts 1–9. */
  index: number;
  /** Why flashing cannot start now; absent when it can. */
  blocked: Localized | undefined;
  loading: boolean;
  onFlash: () => void;
  onKeymap: () => void;
  /** The key that opens this firmware's keymap, when it has one. */
  keymapShortcut?: string;
}

export function FirmwareCard({ build, index, blocked, loading, onFlash, onKeymap, keymapShortcut }: Props) {
  const { t, lang } = useI18n();
  const shortcut = index < 9 ? String(index + 1) : '';
  const flashable = canFlash(build);
  const unknown = t('common.unknown');
  const unsupported = msg('card.unsupported', { bootloader: build.bootloader ?? unknown, format: build.format });
  useCommand({
    id: `flash:${build.id}`,
    words: `flash ${build.id}`,
    title: msg('shortcut.flashBuild', { name: build.name }),
    group: 'group.firmware',
    shortcut: shortcut || undefined,
    unavailable: !flashable ? unsupported : (blocked ?? (loading ? msg('why.loading') : undefined)),
    run: onFlash,
  });
  const ratio = build.size && build.max_size ? build.size / build.max_size : null;
  const level = ratio === null ? '' : ratio > 0.97 ? 'err' : ratio > 0.9 ? 'warn' : '';

  return (
    <article className="card">
      <div className="card-head">
        <h3>{build.name}</h3>
        <code className="muted">
          {build.keyboard}:{build.keymap}
        </code>
      </div>

      <ul className="chips" aria-label={t('card.specs')}>
        <li>{processorLabel(build.processor, unknown)}</li>
        <li>{bootloaderLabel(build.bootloader, unknown)}</li>
        {build.split && <li>{t('card.split')}</li>}
      </ul>

      {ratio !== null && (
        <div className="size">
          <div className={`meter ${level}`} aria-hidden="true">
            <div style={{ width: `${Math.min(100, ratio * 100)}%` }} />
          </div>
          <span className="num">
            {t('card.size', {
              size: formatBytes(build.size!, lang),
              max: formatBytes(build.max_size!, lang),
              free: formatBytes(build.max_size! - build.size!, lang),
            })}
          </span>
        </div>
      )}

      <div className="row">
        {flashable ? (
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
        ) : (
          <p className="note">{t(unsupported.key, unsupported.params)}</p>
        )}
        <button
          type="button"
          onClick={onKeymap}
          aria-keyshortcuts={keymapShortcut?.toUpperCase()}
          data-keymap={build.id}
        >
          {t('card.keymap')}
          {keymapShortcut && <Kbd>{keymapShortcut.toUpperCase()}</Kbd>}
        </button>
      </div>
    </article>
  );
}
