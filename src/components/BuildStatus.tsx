import type { MessageKey } from '../i18n/messages';
import { useI18n } from '../i18n/react';
import { formatDateTime, shortSha } from '../lib/format';
import type { WorkflowRun } from '../lib/github';
import type { FirmwareManifest } from '../lib/manifest';

interface Props {
  repoUrl: string;
  manifest: FirmwareManifest | null;
  runs: WorkflowRun[];
  refreshing: boolean;
  onRefresh: () => void;
}

type Tone = 'busy' | 'ok' | 'err' | 'muted';

function runState(run: WorkflowRun): { label: MessageKey; tone: Tone } {
  if (run.status !== 'completed') return { label: 'run.busy', tone: 'busy' };
  switch (run.conclusion) {
    case 'success':
      return { label: 'run.ok', tone: 'ok' };
    case 'cancelled':
    case 'skipped':
      return { label: 'run.cancelled', tone: 'muted' };
    default:
      return { label: 'run.failed', tone: 'err' };
  }
}

export function BuildStatus({ repoUrl, manifest, runs, refreshing, onRefresh }: Props) {
  const { t, rich, lang } = useI18n();
  const latest = runs[0];
  const state = latest ? runState(latest) : null;
  const newerThanFirmware = latest && manifest && latest.head_sha !== manifest.source.sha;

  return (
    <section className="panel" aria-labelledby="status-title">
      <div className="panel-head">
        <h2 id="status-title">{t('status.title')}</h2>
        <button type="button" className="ghost" onClick={onRefresh} disabled={refreshing}>
          {refreshing ? t('status.refreshing') : t('status.refresh')}
        </button>
      </div>

      {manifest ? (
        <p>
          {rich('status.current', {
            commit: (
              <a href={`${repoUrl}/commit/${manifest.source.sha}`} target="_blank" rel="noreferrer">
                <code>{shortSha(manifest.source.sha)}</code>
              </a>
            ),
            date: formatDateTime(manifest.built_at, lang),
          })}
        </p>
      ) : (
        <p>{t('status.none')}</p>
      )}

      {latest && state && (
        <p className="run">
          <span className={`badge ${state.tone}`}>{t(state.label)}</span>
          <span>
            {rich('status.latest', {
              title: (
                <a href={latest.html_url} target="_blank" rel="noreferrer">
                  {latest.display_title}
                </a>
              ),
              commit: <code>{shortSha(latest.head_sha)}</code>,
              date: formatDateTime(latest.created_at, lang),
            })}
          </span>
        </p>
      )}

      {newerThanFirmware && state?.tone === 'busy' && <p className="note">{t('status.building')}</p>}
      {newerThanFirmware && state?.tone === 'err' && <p className="note">{t('status.failedNewer')}</p>}
    </section>
  );
}
