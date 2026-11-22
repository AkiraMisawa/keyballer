// Where checked firmware came from: the build run, the commit, and how it relates to the default
// branch and to the last firmware flashed. Shown before flashing a hex file or offering a UF2 file.

import { useI18n } from '../i18n/react';
import type { FirmwareSource } from '../lib/firmware';
import { formatDateTime, shortSha } from '../lib/format';

export function SourceNote({ source }: { source: FirmwareSource }) {
  const { t, lang } = useI18n();
  return (
    <div className="source stack" role="note" aria-label={t('flash.source')}>
      <p>
        <span className="badge ok">{t('flash.verified')}</span>{' '}
        <a href={source.runUrl} target="_blank" rel="noreferrer">
          {t('flash.run', { repo: source.repository, branch: source.branch })}
        </a>
      </p>
      <p>
        <a href={source.url} target="_blank" rel="noreferrer">
          <code>{shortSha(source.sha)}</code>
        </a>{' '}
        <span className="commit-line">{source.message.split('\n')[0]}</span>{' '}
        <span className="muted">{formatDateTime(source.date, lang)}</span>
      </p>
      {source.behindBy > 0 && (
        <p className="note">
          {t(source.behindBy === 1 ? 'flash.behindOne' : 'flash.behindMany', { n: source.behindBy, branch: source.branch })}
        </p>
      )}
      {source.sinceLast && source.sinceLast.older > 0 && (
        <p className="note">
          {t(source.sinceLast.older === 1 ? 'flash.olderOne' : 'flash.olderMany', {
            n: source.sinceLast.older,
            sha: shortSha(source.sinceLast.sha),
          })}
        </p>
      )}
      {source.sinceLast && source.sinceLast.newer > 0 && (
        <p>
          <a href={source.sinceLast.url} target="_blank" rel="noreferrer">
            {t(source.sinceLast.newer === 1 ? 'flash.sinceLastOne' : 'flash.sinceLastMany', {
              n: source.sinceLast.newer,
              sha: shortSha(source.sinceLast.sha),
            })}
          </a>
        </p>
      )}
      <p className="note">{t('flash.checkSource')}</p>
    </div>
  );
}
