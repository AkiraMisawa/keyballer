import { useCallback, useEffect, useRef, useState } from 'react';
import { msg, type Localized } from '../i18n/core';
import type { MessageKey } from '../i18n/messages';
import { useI18n } from '../i18n/react';
import { flashCaterina, type FlashPhase, type FlashProgress } from '../lib/caterina';
import { findGrantedBootloader, pickBootloader } from '../lib/serial';
import { Kbd, useShortcut } from '../shortcuts';

type Step = 'ready' | 'waiting' | 'flashing' | 'done' | 'error';

const PHASES: { phase: FlashPhase; label: MessageKey; weight: number }[] = [
  { phase: 'connect', label: 'phase.connect', weight: 2 },
  { phase: 'erase', label: 'phase.erase', weight: 5 },
  { phase: 'eeprom', label: 'phase.eeprom', weight: 15 },
  { phase: 'write', label: 'phase.write', weight: 50 },
  { phase: 'verify', label: 'phase.verify', weight: 25 },
  { phase: 'finish', label: 'phase.finish', weight: 3 },
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
  const { t, show, err } = useI18n();
  const [step, setStep] = useState<Step>('ready');
  const [eraseEeprom, setEraseEeprom] = useState(false);
  const [progress, setProgress] = useState<FlashProgress | null>(null);
  const [logs, setLogs] = useState<Localized[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [doneCount, setDoneCount] = useState(0);
  const busy = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const startRef = useRef<HTMLButtonElement>(null);
  const pickRef = useRef<HTMLButtonElement>(null);
  const otherRef = useRef<HTMLButtonElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);

  const log = useCallback((m: Localized) => setLogs((l) => [...l, m]), []);

  const flash = useCallback(
    async (port: SerialPort) => {
      if (busy.current) return;
      busy.current = true;
      setStep('flashing');
      setProgress(null);
      setError(null);
      log(msg('flash.log.found'));
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
        setError(e);
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
      setError(e);
      setStep('error');
    }
  };

  const halvesLeft = split ? 2 - doneCount : 1 - doneCount;

  // Each step focuses the action that usually comes next, so Enter keeps
  // the whole flow going without the mouse.
  useEffect(() => {
    const next = {
      ready: startRef,
      waiting: pickRef,
      flashing: headingRef,
      done: halvesLeft > 0 ? otherRef : headingRef,
      error: retryRef,
    }[step];
    next.current?.focus();
  }, [step, halvesLeft]);

  useShortcut('p', msg('shortcut.pickPort'), () => void choose(false), step === 'waiting');
  useShortcut(
    'Escape',
    msg('shortcut.back'),
    () => (step === 'waiting' ? setStep('ready') : onClose()),
    step !== 'flashing',
  );
  const pct = step === 'done' ? 100 : percent(progress, eraseEeprom);
  const phase = progress ? PHASES.find((p) => p.phase === progress.phase)?.label : undefined;

  return (
    <section className="panel flash" aria-labelledby="flash-title">
      <div className="panel-head">
        <h2 id="flash-title" ref={headingRef} tabIndex={-1}>
          {t('flash.title', { name: title })}
        </h2>
        <button
          type="button"
          className="ghost"
          onClick={onClose}
          disabled={step === 'flashing'}
          aria-keyshortcuts="Escape"
        >
          {t('common.close')}
        </button>
      </div>

      {split && (
        <ol className="halves" aria-label={t('flash.halves')}>
          <li className={doneCount >= 1 ? 'done' : 'current'}>{t('flash.first')}</li>
          <li className={doneCount >= 2 ? 'done' : doneCount === 1 ? 'current' : ''}>
            {t('flash.second')}
          </li>
        </ol>
      )}

      {step === 'ready' && (
        <div className="stack">
          <ol className="steps">
            <li>
              {t(split ? 'flash.plugSplit' : 'flash.plug')}
              {split && <span className="note">{t('flash.trsNote')}</span>}
            </li>
            <li>{t('flash.pressReset')}</li>
          </ol>
          <label className="check">
            <input
              id="erase-eeprom"
              type="checkbox"
              checked={eraseEeprom}
              onChange={(e) => setEraseEeprom(e.target.checked)}
            />
            <span>
              {t('flash.eeprom')}
              <span className="note">{t('flash.eepromNote')}</span>
            </span>
          </label>
          <div>
            <button ref={startRef} type="button" className="primary" onClick={() => setStep('waiting')}>
              {t('flash.start')}
            </button>
          </div>
        </div>
      )}

      {step === 'waiting' && (
        <div className="stack">
          <p className="lead">{t('flash.waiting')}</p>
          <p className="note">{t('flash.waitingNote')}</p>
          <div className="row">
            <button
              ref={pickRef}
              type="button"
              className="primary"
              onClick={() => void choose(false)}
              aria-keyshortcuts="p"
            >
              {t('flash.pickPort')}
              <Kbd>P</Kbd>
            </button>
            <button type="button" className="ghost" onClick={() => setStep('ready')}>
              {t('common.cancel')}
            </button>
          </div>
          <button type="button" className="link" onClick={() => void choose(true)}>
            {t('flash.pickAny')}
          </button>
        </div>
      )}

      {(step === 'flashing' || step === 'done') && (
        <div className="stack">
          <div
            className="progress"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="bar" style={{ width: `${pct}%` }} />
          </div>
          <p className="lead">
            {step === 'flashing'
              ? t('flash.progress', { phase: t(phase ?? 'phase.preparing'), percent: String(pct) })
              : t('flash.finished')}
          </p>
          {step === 'flashing' && <p className="note">{t('flash.dontUnplug')}</p>}
        </div>
      )}

      {step === 'done' && (
        <div className="stack">
          {halvesLeft > 0 ? (
            <>
              <p>{t('flash.otherHalf')}</p>
              <div>
                <button ref={otherRef} type="button" className="primary" onClick={() => setStep('waiting')}>
                  {t('flash.flashOther')}
                </button>
              </div>
            </>
          ) : (
            <p className="ok">{t(split ? 'flash.doneSplit' : 'flash.doneSingle')}</p>
          )}
        </div>
      )}

      {step === 'error' && (
        <div className="stack">
          <p className="err" role="alert">
            {t('flash.failed', { error: err(error) })}
          </p>
          <p className="note">{t('flash.failedNote')}</p>
          <div>
            <button ref={retryRef} type="button" className="primary" onClick={() => setStep('waiting')}>
              {t('flash.retry')}
            </button>
          </div>
        </div>
      )}

      {logs.length > 0 && (
        <details className="log">
          <summary>{t('flash.log')}</summary>
          <pre>{logs.map(show).join('\n')}</pre>
        </details>
      )}
    </section>
  );
}
