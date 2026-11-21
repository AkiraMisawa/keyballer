import { useCallback, useEffect, useRef, useState } from 'react';
import { flashCaterina, type FlashPhase, type FlashProgress } from '../lib/caterina';
import { findGrantedBootloader, pickBootloader } from '../lib/serial';

type Step = 'ready' | 'waiting' | 'flashing' | 'done' | 'error';

const PHASES: { phase: FlashPhase; label: string; weight: number }[] = [
  { phase: 'connect', label: 'ブートローダーに接続', weight: 2 },
  { phase: 'erase', label: 'フラッシュを消去', weight: 5 },
  { phase: 'eeprom', label: 'EEPROM を消去', weight: 15 },
  { phase: 'write', label: '書き込み', weight: 50 },
  { phase: 'verify', label: '書き込んだ内容を確認', weight: 25 },
  { phase: 'finish', label: '再起動', weight: 3 },
];

function percent(p: FlashProgress | null, withEeprom: boolean): number {
  if (!p) return 0;
  const phases = PHASES.filter((x) => withEeprom || x.phase !== 'eeprom');
  const total = phases.reduce((s, x) => s + x.weight, 0);
  let sum = 0;
  for (const x of phases) {
    if (x.phase === p.phase) {
      sum += x.weight * (p.total ? p.done / p.total : 0);
      break;
    }
    sum += x.weight;
  }
  return Math.round((sum / total) * 100);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Props {
  title: string;
  image: Uint8Array;
  split: boolean;
  onClose: () => void;
}

export function FlashPanel({ title, image, split, onClose }: Props) {
  const [step, setStep] = useState<Step>('ready');
  const [eraseEeprom, setEraseEeprom] = useState(false);
  const [progress, setProgress] = useState<FlashProgress | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [doneCount, setDoneCount] = useState(0);
  const busy = useRef(false);

  const log = useCallback((m: string) => setLogs((l) => [...l, m]), []);

  const flash = useCallback(
    async (port: SerialPort) => {
      if (busy.current) return;
      busy.current = true;
      setStep('flashing');
      setProgress(null);
      setError('');
      log('ブートローダーが見つかりました');
      try {
        // The port can need a moment after the board resets.
        for (let attempt = 0; ; attempt++) {
          try {
            await flashCaterina(port, image, { eraseEeprom, onProgress: setProgress, onLog: log });
            break;
          } catch (e) {
            const retryable = e instanceof DOMException && e.name === 'NetworkError';
            if (!retryable || attempt >= 4) throw e;
            await sleep(300);
          }
        }
        setDoneCount((n) => n + 1);
        setStep('done');
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStep('error');
      } finally {
        busy.current = false;
      }
    },
    [eraseEeprom, image, log],
  );

  // While waiting, start as soon as an already-allowed bootloader appears.
  useEffect(() => {
    if (step !== 'waiting') return;
    let stopped = false;
    const poll = async () => {
      while (!stopped) {
        const port = await findGrantedBootloader().catch(() => null);
        if (stopped) return;
        if (port) {
          void flash(port);
          return;
        }
        await sleep(300);
      }
    };
    void poll();
    return () => {
      stopped = true;
    };
  }, [step, flash]);

  const choose = async (anyDevice: boolean) => {
    try {
      const port = await pickBootloader(anyDevice);
      if (port) await flash(port);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep('error');
    }
  };

  const halvesLeft = split ? 2 - doneCount : 1 - doneCount;
  const pct = step === 'done' ? 100 : percent(progress, eraseEeprom);
  const phaseLabel = progress ? PHASES.find((p) => p.phase === progress.phase)?.label : '準備中';

  return (
    <section className="panel flash" aria-labelledby="flash-title">
      <div className="panel-head">
        <h2 id="flash-title">{title} に書き込む</h2>
        <button type="button" className="ghost" onClick={onClose} disabled={step === 'flashing'}>
          閉じる
        </button>
      </div>

      {split && (
        <ol className="halves" aria-label="左右の書き込み状況">
          <li className={doneCount >= 1 ? 'done' : 'current'}>1台目</li>
          <li className={doneCount >= 2 ? 'done' : doneCount === 1 ? 'current' : ''}>2台目</li>
        </ol>
      )}

      {step === 'ready' && (
        <div className="stack">
          <ol className="steps">
            <li>
              USB ケーブルを{split ? '左右どちらか片方の' : ''}キーボードにつなぎます。
              {split && (
                <span className="note">
                  左右をつなぐケーブル（TRS / TRRS）はつないだままで大丈夫です。抜き差しするときは必ず先に USB を抜いてください。
                </span>
              )}
            </li>
            <li>「書き込みを始める」を押してから、キーボードのリセットボタンを押します。</li>
          </ol>
          <label className="check">
            <input
              id="erase-eeprom"
              type="checkbox"
              checked={eraseEeprom}
              onChange={(e) => setEraseEeprom(e.target.checked)}
            />
            <span>
              保存されている設定（EEPROM）も消す
              <span className="note">
                Keyball Link や REMAP など、別のファームウェアから書き換えるときはオンにしてください。
              </span>
            </span>
          </label>
          <div>
            <button type="button" className="primary" onClick={() => setStep('waiting')}>
              書き込みを始める
            </button>
          </div>
        </div>
      )}

      {step === 'waiting' && (
        <div className="stack">
          <p className="lead">
            リセットボタンを押してください。反応しないときは素早く2回押します。
          </p>
          <p className="note">
            押してから約8秒のあいだ、書き込みを受け付けます。押したら下のボタンでポートを選んでください。2回目以降は自動で始まることがあります。
          </p>
          <div className="row">
            <button type="button" className="primary" onClick={() => void choose(false)}>
              ポートを選ぶ
            </button>
            <button type="button" className="ghost" onClick={() => setStep('ready')}>
              やめる
            </button>
          </div>
          <button type="button" className="link" onClick={() => void choose(true)}>
            一覧に出てこないとき（すべてのデバイスから選ぶ）
          </button>
        </div>
      )}

      {(step === 'flashing' || step === 'done') && (
        <div className="stack">
          <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="bar" style={{ width: `${pct}%` }} />
          </div>
          <p className="lead">
            {step === 'flashing' ? `${phaseLabel}…（${pct}%）` : '書き込みが終わりました'}
          </p>
          {step === 'flashing' && (
            <p className="note">書き込みが終わるまで USB ケーブルを抜かないでください。</p>
          )}
        </div>
      )}

      {step === 'done' && (
        <div className="stack">
          {halvesLeft > 0 ? (
            <>
              <p>
                反対側も書き込みます。USB ケーブルを抜いて反対側につなぎ替えてください。左右とも同じファームウェアを書き込みます。
              </p>
              <div>
                <button type="button" className="primary" onClick={() => setStep('waiting')}>
                  反対側を書き込む
                </button>
              </div>
            </>
          ) : (
            <p className="ok">{split ? '左右とも書き込みました。' : '書き込みました。'}キーボードはそのまま使えます。</p>
          )}
        </div>
      )}

      {step === 'error' && (
        <div className="stack">
          <p className="err" role="alert">
            書き込めませんでした：{error}
          </p>
          <p className="note">
            キーボードのリセットボタンを押し直してから、もう一度試してください。ほかのアプリ（QMK Toolbox など）がポートを使っていると書き込めません。
          </p>
          <div>
            <button type="button" className="primary" onClick={() => setStep('waiting')}>
              もう一度試す
            </button>
          </div>
        </div>
      )}

      {logs.length > 0 && (
        <details className="log">
          <summary>詳しいログ</summary>
          <pre>{logs.join('\n')}</pre>
        </details>
      )}
    </section>
  );
}
