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

function runState(run: WorkflowRun): { label: string; tone: 'busy' | 'ok' | 'err' | 'muted' } {
  if (run.status !== 'completed') return { label: 'ビルド中', tone: 'busy' };
  switch (run.conclusion) {
    case 'success':
      return { label: '成功', tone: 'ok' };
    case 'cancelled':
    case 'skipped':
      return { label: '中止', tone: 'muted' };
    default:
      return { label: '失敗', tone: 'err' };
  }
}

export function BuildStatus({ repoUrl, manifest, runs, refreshing, onRefresh }: Props) {
  const latest = runs[0];
  const state = latest ? runState(latest) : null;
  const newerThanFirmware = latest && manifest && latest.head_sha !== manifest.source.sha;

  return (
    <section className="panel" aria-labelledby="status-title">
      <div className="panel-head">
        <h2 id="status-title">ビルド</h2>
        <button type="button" className="ghost" onClick={onRefresh} disabled={refreshing}>
          {refreshing ? '確認中…' : '最新の状態にする'}
        </button>
      </div>

      {manifest ? (
        <p>
          いまのファームウェアは{' '}
          <a href={`${repoUrl}/commit/${manifest.source.sha}`} target="_blank" rel="noreferrer">
            <code>{shortSha(manifest.source.sha)}</code>
          </a>{' '}
          の設定から {formatDateTime(manifest.built_at)} にビルドしたものです。
        </p>
      ) : (
        <p>まだファームウェアがありません。設定リポジトリに push すると、GitHub Actions がビルドします。</p>
      )}

      {latest && state && (
        <p className="run">
          <span className={`badge ${state.tone}`}>{state.label}</span>
          <span>
            最新のビルド：
            <a href={latest.html_url} target="_blank" rel="noreferrer">
              {latest.display_title}
            </a>{' '}
            <span className="muted">
              （<code>{shortSha(latest.head_sha)}</code>、{formatDateTime(latest.created_at)}）
            </span>
          </span>
        </p>
      )}

      {latest && newerThanFirmware && state?.tone === 'busy' && (
        <p className="note">新しい設定をビルドしています。終わると自動でここに反映されます。</p>
      )}
      {latest && newerThanFirmware && state?.tone === 'err' && (
        <p className="note">
          新しい設定のビルドが失敗したため、下のファームウェアは1つ前のものです。リンク先でエラーを確認してください。
        </p>
      )}
    </section>
  );
}
