// The trackball's side panel: its speeds as settings and as physical figures,
// a try-out pad and the sensor measurement. See docs/plans/trackball-settings.md.

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useI18n } from '../i18n/react';
import { savedTrackball, trackball } from '../edit/session';
import type { EditSession } from '../edit/useEditSession';
import {
  BALL_MM_MAX,
  BALL_MM_MIN,
  calibrate,
  countsPerCm,
  CPI_MAX,
  CPI_MIN,
  CPI_STEP,
  DIVIDER_MAX,
  DIVIDER_MIN,
  ROLLS,
  scrollStepsPerCm,
} from './speed';

/** When pointer lock last ended, so that the Esc which ended it does not also close the keymap. */
let unlockedAt = 0;
/** True while the pad holds the pointer, and just after: Esc then belongs to the pad. */
export const pointerLockBusy = () =>
  (typeof document !== 'undefined' && document.pointerLockElement !== null) || Date.now() - unlockedAt < 400;

/** What the pad does once started: let a speed be tried, or measure the sensor. */
export type PadMode = 'try' | 'measure';

/** A request from the command line to start the pad; a new id is a new request. */
export interface PadRequest {
  mode: PadMode;
  id: number;
}

interface Props {
  edit: EditSession;
  request: PadRequest | null;
}

/**
 * Chromium (Chrome, Edge) honours `unadjustedMovement`; other browsers may ignore the option
 * silently and give movement with the OS's acceleration in it.
 */
function honoursRawMovement(): boolean {
  const brands = (navigator as Navigator & { userAgentData?: { brands?: { brand: string }[] } }).userAgentData?.brands;
  return !!brands?.some((b) => /Chromium|Google Chrome|Microsoft Edge/.test(b.brand));
}

export function TrackballPanel({ edit, request }: Props) {
  const { t, err, lang } = useI18n();
  const number = (n: number) => n.toLocaleString(lang === 'ja' ? 'ja-JP' : 'en-US', { maximumFractionDigits: 1 });

  // The panel is the first thing that needs the files.
  useEffect(() => edit.ensure());

  if (edit.state.status === 'idle' || edit.state.status === 'loading') return <p className="note">{t('edit.loading')}</p>;
  if (edit.state.status === 'failed') {
    return (
      <div className="stack">
        <p className="err">{t('edit.failed')}</p>
        <p className="note">{err(edit.state.error)}</p>
        <button type="button" onClick={() => edit.reload()}>
          {t('edit.retry')}
        </button>
      </div>
    );
  }

  const { session, keymapC, sharedBy } = edit.state;
  const now = trackball(session);
  const saved = savedTrackball(session);
  const stamp = keymapC?.includes('KEYBALLER_DEFAULTS_STAMP') ?? false;
  const scrollText = t('tb.scrollValue', { div: now.divider, perCm: number(scrollStepsPerCm(now.cpi, now.divider)) });

  return (
    <div className="stack trackball">
      <div className="field">
        <label htmlFor="tb-cpi">{t('tb.cursor')}</label>
        <div className="range">
          <span className="note" aria-hidden="true">
            {t('tb.slower')}
          </span>
          <input
            id="tb-cpi"
            type="range"
            min={CPI_MIN}
            max={CPI_MAX}
            step={CPI_STEP}
            value={now.cpi}
            disabled={edit.saving}
            aria-valuetext={t('unit.cpi', { n: now.cpi })}
            onChange={(e) => edit.edit({ type: 'cpi', value: Number(e.target.value) })}
          />
          <span className="note" aria-hidden="true">
            {t('tb.faster')}
          </span>
        </div>
        <p className="note">{t('tb.cursorValue', { cpi: now.cpi, perCm: number(countsPerCm(now.cpi)) })}</p>
      </div>

      <div className="field">
        <label htmlFor="tb-div">{t('tb.scroll')}</label>
        <div className="range">
          <span className="note" aria-hidden="true">
            {t('tb.slower')}
          </span>
          {/* Faster to the right: the slider shows the divider reversed. */}
          <input
            id="tb-div"
            type="range"
            min={DIVIDER_MIN}
            max={DIVIDER_MAX}
            step={1}
            value={DIVIDER_MAX + DIVIDER_MIN - now.divider}
            disabled={edit.saving}
            aria-valuetext={scrollText}
            onChange={(e) => edit.edit({ type: 'divider', value: DIVIDER_MAX + DIVIDER_MIN - Number(e.target.value) })}
          />
          <span className="note" aria-hidden="true">
            {t('tb.faster')}
          </span>
        </div>
        <p className="note">{scrollText}</p>
      </div>

      <BallSize value={now.ballMm} disabled={edit.saving} onChange={(mm) => edit.edit({ type: 'ballMm', value: mm })} />

      <p className="note">{t('tb.osNote')}</p>
      <p className="note">{t(stamp ? 'tb.applyStamp' : 'tb.applyNoStamp')}</p>
      {sharedBy.length > 1 && (
        <p className="note">
          {t('tb.shared', { names: new Intl.ListFormat(lang, { type: 'conjunction' }).format(sharedBy) })}
        </p>
      )}

      <Pad cpi={now.cpi} divider={now.divider} keyboardCpi={saved.cpi} ballMm={now.ballMm} request={request} />
    </div>
  );
}

/** The ball diameter: typed freely, taken when it is a size the settings accept. */
function BallSize({ value, disabled, onChange }: { value: number; disabled: boolean; onChange: (mm: number) => void }) {
  const { t } = useI18n();
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const mm = Number(text);
  const ok = text.trim() !== '' && Number.isFinite(mm) && mm >= BALL_MM_MIN && mm <= BALL_MM_MAX;
  return (
    <div className="field">
      <label htmlFor="tb-mm">{t('tb.ball')}</label>
      <input
        id="tb-mm"
        type="number"
        min={BALL_MM_MIN}
        max={BALL_MM_MAX}
        step={0.5}
        value={text}
        disabled={disabled}
        aria-invalid={!ok}
        aria-describedby={ok ? undefined : 'tb-mm-help'}
        onChange={(e) => {
          setText(e.target.value);
          const next = Number(e.target.value);
          if (e.target.value.trim() !== '' && next >= BALL_MM_MIN && next <= BALL_MM_MAX && next !== value) onChange(next);
        }}
        onBlur={() => !ok && setText(String(value))}
      />
      {!ok && (
        <p id="tb-mm-help" className="note">
          {t('cmd.ballSize.bad', { min: BALL_MM_MIN, max: BALL_MM_MAX })}
        </p>
      )}
    </div>
  );
}

interface PadProps {
  cpi: number;
  divider: number;
  /** The CPI the keyboard runs at now, unless a measurement says otherwise. */
  keyboardCpi: number;
  ballMm: number;
  request: PadRequest | null;
}

function Pad({ cpi, divider, keyboardCpi, ballMm, request }: PadProps) {
  const { t } = useI18n();
  const pad = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<PadMode>('try');
  const [locked, setLocked] = useState(false);
  /** Whether the pad gets the counts the ball sends (no OS acceleration); null until locked once. */
  const [raw, setRaw] = useState<boolean | null>(null);
  const [lockFailed, setLockFailed] = useState(false);
  const [measured, setMeasured] = useState<number | null>(null);
  const [rolls, setRolls] = useState<number[]>([]);
  const [again, setAgain] = useState<number | null>(null);
  const [dot, setDot] = useState({ x: 0, y: 0, steps: 0 });
  const roll = useRef({ x: 0, y: 0 });
  const [rolled, setRolled] = useState(0);

  // A measured CPI is what the keyboard really does, so speeds are compared with it.
  const base = measured ?? keyboardCpi;
  const scale = cpi / base;
  const live = useRef({ scale, divider, mode });
  live.current = { scale, divider, mode };

  useEffect(() => {
    const onChange = () => {
      const on = document.pointerLockElement === pad.current;
      if (!on) unlockedAt = Date.now();
      setLocked(on);
    };
    const onError = () => setLockFailed(true);
    document.addEventListener('pointerlockchange', onChange);
    document.addEventListener('pointerlockerror', onError);
    return () => {
      document.removeEventListener('pointerlockchange', onChange);
      document.removeEventListener('pointerlockerror', onError);
    };
  }, []);

  useEffect(() => {
    if (!locked) return;
    const el = pad.current!;
    let scroll = 0;
    const onMove = (e: MouseEvent) => {
      const { scale: s, divider: d, mode: m } = live.current;
      if (m === 'measure') {
        roll.current.x += e.movementX;
        roll.current.y += e.movementY;
        setRolled(Math.round(Math.hypot(roll.current.x, roll.current.y)));
        return;
      }
      const w = el.clientWidth / 2 - 8;
      const h = el.clientHeight / 2 - 8;
      scroll += (e.movementY * s) / 2 ** (d - 1);
      setDot((p) => ({
        x: Math.max(-w, Math.min(w, p.x + e.movementX * s)),
        y: Math.max(-h, Math.min(h, p.y + e.movementY * s)),
        steps: Math.trunc(scroll),
      }));
    };
    document.addEventListener('mousemove', onMove);
    return () => document.removeEventListener('mousemove', onMove);
  }, [locked]);

  const start = async (next: PadMode) => {
    const el = pad.current;
    if (!el) return;
    setMode(next);
    setLockFailed(false);
    roll.current = { x: 0, y: 0 };
    setRolled(0);
    if (next === 'measure') {
      setRolls([]);
      setAgain(null);
    }
    el.focus();
    try {
      await el.requestPointerLock({ unadjustedMovement: true });
      const honoured = honoursRawMovement();
      setRaw(honoured);
      // Counts with acceleration in them would measure the OS, not the sensor.
      if (!honoured && next === 'measure') void document.exitPointerLock();
    } catch (e) {
      if (e instanceof DOMException && e.name === 'NotSupportedError') {
        setRaw(false);
        if (next === 'try') {
          // The pad still works, with the OS's acceleration in it.
          await el.requestPointerLock().catch(() => setLockFailed(true));
        }
      } else {
        setLockFailed(true);
      }
    }
  };

  // The command line asks for the pad; only a request made after the pad appeared starts it.
  const handled = useRef(request?.id);
  useEffect(() => {
    if (!request || request.id === handled.current) return;
    handled.current = request.id;
    void start(request.mode);
    // Only when a new request arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.id]);

  /** Ends one roll of the measurement and checks the rolls once there are enough. */
  const endRoll = () => {
    const counts = Math.hypot(roll.current.x, roll.current.y);
    roll.current = { x: 0, y: 0 };
    setRolled(0);
    const next = [...rolls, counts];
    const result = calibrate(next, ballMm);
    if ('retry' in result) {
      setAgain(result.retry + 1);
      setRolls(next.filter((_, i) => i !== result.retry));
    } else if ('more' in result) {
      setAgain(null);
      setRolls(next);
    } else {
      setRolls([]);
      setMeasured(result.cpi);
      void document.exitPointerLock();
    }
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!locked && e.key === 'Enter') {
      e.preventDefault();
      void start(mode);
    } else if (locked && mode === 'measure' && (e.key === ' ' || e.key === 'Enter')) {
      e.preventDefault();
      endRoll();
    }
  };

  return (
    <div className="stack">
      <div className="row">
        <button type="button" aria-pressed={mode === 'try'} onClick={() => void start('try')}>
          {t('tb.try')}
        </button>
        <button type="button" aria-pressed={mode === 'measure'} onClick={() => void start('measure')}>
          {t('tb.measure')}
        </button>
      </div>
      <p className="note">{t(mode === 'try' ? 'tb.tryNote' : 'tb.measureSteps')}</p>
      {raw === false && <p className="note">{t(mode === 'measure' ? 'tb.noRawMeasure' : 'tb.noRawTry')}</p>}
      {lockFailed && <p className="note">{t('tb.lockFailed')}</p>}
      <div
        ref={pad}
        className={`pad${locked ? ' on' : ''}`}
        role="application"
        aria-label={t('tb.padLabel')}
        tabIndex={0}
        onClick={() => (locked ? mode === 'measure' && endRoll() : void start(mode))}
        onKeyDown={onKey}
      >
        {mode === 'try' ? (
          <>
            <span className="dot" style={{ transform: `translate(${dot.x}px, ${dot.y}px)` }} aria-hidden="true" />
            <span className="steps" aria-hidden="true">
              {dot.steps}
            </span>
            <span className="pad-hint note">{locked ? t('tb.padActive') : t('tb.padIdle')}</span>
          </>
        ) : (
          <>
            <svg className="roll-arrow" viewBox="0 0 120 20" aria-hidden="true">
              <line x1="4" y1="10" x2="112" y2="10" />
              <polyline points="104,3 114,10 104,17" />
            </svg>
            <span className="pad-hint note" aria-live="polite">
              {locked ? t('tb.roll', { n: rolls.length + 1, total: ROLLS, counts: rolled }) : t('tb.padIdle')}
            </span>
          </>
        )}
      </div>
      {mode === 'try' && <p className="note">{t(measured === null ? 'tb.reference' : 'tb.referenceMeasured', { cpi: base })}</p>}
      {again !== null && <p className="note">{t('tb.rollAgain', { n: again })}</p>}
      {measured !== null && <p>{t('tb.measured', { cpi: measured, set: keyboardCpi })}</p>}
    </div>
  );
}
