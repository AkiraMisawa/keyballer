import { bootloaderLabel, formatBytes, processorLabel } from '../lib/format';
import { flashSupport, type FirmwareBuild } from '../lib/manifest';

interface Props {
  build: FirmwareBuild;
  canFlash: boolean;
  loading: boolean;
  onFlash: () => void;
}

export function FirmwareCard({ build, canFlash, loading, onFlash }: Props) {
  const support = flashSupport(build);
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

      <ul className="chips" aria-label="仕様">
        <li>{processorLabel(build.processor)}</li>
        <li>{bootloaderLabel(build.bootloader)}</li>
        {build.split && <li>左右分割</li>}
      </ul>

      {ratio !== null && (
        <div className="size">
          <div className={`meter ${level}`} aria-hidden="true">
            <div style={{ width: `${Math.min(100, ratio * 100)}%` }} />
          </div>
          <span className="num">
            {formatBytes(build.size!)} / {formatBytes(build.max_size!)} バイト（残り{' '}
            {formatBytes(build.max_size! - build.size!)}）
          </span>
        </div>
      )}

      {support.ok ? (
        <button type="button" className="primary" onClick={onFlash} disabled={!canFlash || loading}>
          {loading ? '読み込み中…' : '書き込む'}
        </button>
      ) : (
        <p className="note">{support.reason}</p>
      )}
    </article>
  );
}
