import { msg } from '../i18n/core';
import { useI18n } from '../i18n/react';
import { bootloaderLabel, formatBytes, processorLabel } from '../lib/format';
import { canFlash, type FirmwareBuild } from '../lib/manifest';
import { Kbd, useShortcut } from '../shortcuts';

interface Props {
  build: FirmwareBuild;
  /** Position in the list; the first nine get the shortcuts 1–9. */
  index: number;
  canStart: boolean;
  loading: boolean;
  onFlash: () => void;
}

export function FirmwareCard({ build, index, canStart, loading, onFlash }: Props) {
  const { t, lang } = useI18n();
  const shortcut = index < 9 ? String(index + 1) : '';
  const flashable = canFlash(build);
  useShortcut(shortcut, msg('shortcut.flashBuild', { name: build.name }), onFlash,
    !!shortcut && flashable && canStart && !loading);
  const unknown = t('common.unknown');
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

      {flashable ? (
        <button
          type="button"
          className="primary"
          onClick={onFlash}
          disabled={!canStart || loading}
          aria-keyshortcuts={shortcut || undefined}
        >
          {loading ? t('card.loading') : t('card.flash')}
          {shortcut && <Kbd>{shortcut}</Kbd>}
        </button>
      ) : (
        <p className="note">
          {t('card.unsupported', {
            bootloader: build.bootloader ?? unknown,
            format: build.format,
          })}
        </p>
      )}
    </article>
  );
}
