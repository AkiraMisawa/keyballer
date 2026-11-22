// Draws one layer on the board's real shape (DESIGN.md §5, §6). Keys are
// buttons placed in key units; rotated thumb keys turn about their KLE origin.
// The board is one tab stop (roving tabindex); arrow keys move between keys by
// position on the drawing, through the keymap screen's commands (DESIGN.md §11).

import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useI18n } from '../i18n/react';
import { SPOKEN_SYMBOLS } from './keycodes';
import { rotate, type DrawnKey, type DrawnLayer, type Legend } from './view';

/** What is selected on the board: a key's layout index, or the trackball. */
export type Selection = number | 'ball' | null;

interface Props {
  drawn: DrawnLayer;
  label: string;
  selected: Selection;
  onSelect: (selection: Selection) => void;
  /** Largest key unit in px; the board shrinks to fit its frame down to 36px keycaps, then scrolls. */
  maxUnit?: number;
}

const MIN_UNIT = 40; // a 36px keycap plus the gap around it (DESIGN.md §7)
const GAP = 0.05; // space between keycaps, in key units
const BAND = 0.3; // how far above a key's centre combo lines and chips sit, in key units

interface Bounds {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

function corners(k: DrawnKey): [number, number][] {
  return [
    [k.x, k.y],
    [k.x + k.w, k.y],
    [k.x, k.y + k.h],
    [k.x + k.w, k.y + k.h],
  ].map(([x, y]) => rotate(x, y, k.r, k.rx, k.ry));
}

function boundsOf(drawn: DrawnLayer): Bounds {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const k of drawn.keys) {
    for (const [x, y] of corners(k)) {
      xs.push(x);
      ys.push(y);
    }
  }
  for (const b of drawn.balls) {
    xs.push(b.x - b.d / 2, b.x + b.d / 2);
    ys.push(b.y - b.d / 2, b.y + b.d / 2);
  }
  if (xs.length === 0) return { minX: 0, minY: 0, width: 1, height: 1 };
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { minX, minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

let measurer: CanvasRenderingContext2D | null | undefined;
const widths = new Map<string, number>();

/** Width of text at 1px, measured with canvas once per string; a rough guess without canvas. */
function textWidth(text: string, font: string): number {
  const id = `${font} ${text}`;
  const known = widths.get(id);
  if (known !== undefined) return known;
  if (measurer === undefined) measurer = document.createElement('canvas').getContext('2d');
  let w = 0;
  if (measurer) {
    measurer.font = font.replace('{size}', '100px');
    w = measurer.measureText(text).width / 100;
  } else {
    for (const ch of text) w += ch.codePointAt(0)! >= 0x2e80 ? 1 : 0.65;
  }
  widths.set(id, w);
  return w;
}

/** A canvas font with a size placeholder, from the page's own font stacks. */
function font(weight: number, family: 'body' | 'mono'): string {
  const stack =
    family === 'mono'
      ? getComputedStyle(document.documentElement).getPropertyValue('--mono')
      : getComputedStyle(document.body).fontFamily;
  return `${weight} {size} ${stack}`;
}

/**
 * The largest of three sizes at which the text fits on one line. Past the smallest it wraps, so a
 * long name is never cut off (DESIGN.md §5).
 */
function fit(text: string, room: number, steps: [number, number, number], fontSpec: string) {
  const w = textWidth(text, fontSpec) || 1;
  for (const size of steps) if (w * size <= room) return { fontSize: size };
  return { fontSize: steps[2], whiteSpace: 'normal' as const };
}

interface LegendsProps {
  legend: Legend;
  unit: number;
  w: number;
  muted?: boolean;
  /** An unknown keycode: its name in small monospace. */
  code?: boolean;
}

function Legends({ legend, unit, w, muted, code }: LegendsProps) {
  // The keycap's inner width: less the gap, padding and border.
  const room = (w - GAP * 2) * unit - 12;
  const side = (text: string) => fit(text, room, [0.2 * unit, 0.17 * unit, 0.15 * unit], font(400, 'body'));
  const tap = code
    ? fit(legend.tap, room, [0.2 * unit, 0.17 * unit, 0.14 * unit], font(400, 'mono'))
    : fit(legend.tap, room, [0.3 * unit, 0.23 * unit, 0.18 * unit], font(600, 'body'));
  return (
    <>
      {legend.top && (
        <span className="leg-top" style={side(legend.top)}>
          {legend.top}
        </span>
      )}
      <span className={`leg-tap${muted ? ' muted' : ''}`} style={tap}>
        {legend.tap}
      </span>
      {legend.hold && (
        <span className="leg-hold" style={side(legend.hold)}>
          {legend.hold}
        </span>
      )}
    </>
  );
}

/** What a screen reader hears for a key: its legends in reading order, Mac symbols spelled out. */
function spoken(k: DrawnKey): string {
  const parts = [k.legend.top, k.legend.tap, k.legend.hold];
  if (k.kind === 'transparent' && k.fallsTo) parts.push(k.fallsTo.tap, k.fallsTo.hold);
  return parts
    .filter(Boolean)
    .join(', ')
    .replace(/[⌃⌥⇧⌘]/g, (s) => SPOKEN_SYMBOLS[s])
    .replace(/ ,/g, ',')
    .trim();
}

export function Board({ drawn, label, selected, onSelect, maxUnit = 64 }: Props) {
  const { t } = useI18n();
  const frame = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(0);
  const bounds = boundsOf(drawn);
  const pad = 0.1;
  const span = bounds.width + pad * 2;

  useLayoutEffect(() => {
    const el = frame.current;
    if (!el) return;
    const measure = () => setRoom(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const unit = Math.max(MIN_UNIT, Math.min(maxUnit, room ? Math.floor(room / span) : maxUnit));
  const width = span * unit;
  const height = (bounds.height + pad * 2) * unit;
  const px = (x: number) => (pad - bounds.minX + x) * unit;
  const py = (y: number) => (pad - bounds.minY + y) * unit;
  const byIndex = new Map(drawn.keys.map((k) => [k.index, k]));
  const firstStop = selected === null || (selected === 'ball' && drawn.balls.length === 0) ? drawn.keys[0] : undefined;

  // Each combo: its trigger keys and the point between them, in the keys' top band (clear of their
  // tap legends and of the keys above).
  const combos = drawn.combos.flatMap((c) => {
    const keys = c.positions.map((p) => byIndex.get(p)).filter((k): k is DrawnKey => !!k);
    if (keys.length < 2) return [];
    const cx = keys.reduce((s, k) => s + k.cx, 0) / keys.length;
    const cy = keys.reduce((s, k) => s + k.cy, 0) / keys.length - BAND;
    return [{ id: c.line + c.positions.join(), keys, cx, cy, output: c.output.tap }];
  });

  return (
    <div className="board-frame" ref={frame}>
      <div className="board" role="group" aria-label={label} style={{ width, height, '--u': `${unit}px` } as CSSProperties}>
        {drawn.keys.map((k) => {
          const isSelected = selected === k.index;
          const style: CSSProperties = {
            left: px(k.x + GAP),
            top: py(k.y + GAP),
            width: (k.w - GAP * 2) * unit,
            height: (k.h - GAP * 2) * unit,
            ...(k.r
              ? {
                  transformOrigin: `${(k.rx - k.x - GAP) * unit}px ${(k.ry - k.y - GAP) * unit}px`,
                  transform: `rotate(${k.r}deg)`,
                }
              : {}),
          };
          return (
            <button
              key={k.index}
              type="button"
              className={`cap ${k.kind}${k.held ? ' held' : ''}${k.code ? ' coded' : ''}`}
              style={style}
              aria-pressed={isSelected}
              aria-label={spoken(k)}
              tabIndex={isSelected || k === firstStop ? 0 : -1}
              data-index={k.index}
              onClick={() => onSelect(k.index)}
            >
              {k.kind === 'transparent' ? (
                <>
                  <span className="leg-top muted">▽</span>
                  {k.fallsTo && <Legends legend={k.fallsTo} unit={unit} w={k.w} muted />}
                </>
              ) : (
                <Legends
                  legend={k.legend}
                  unit={unit}
                  w={k.w}
                  muted={k.kind === 'none' || k.kind === 'unknown'}
                  code={k.kind === 'unknown'}
                />
              )}
            </button>
          );
        })}

        {combos.length > 0 && (
          <svg className="combo-lines" width={width} height={height} aria-hidden="true">
            {combos.flatMap((c) =>
              c.keys.map((k) => (
                <line key={`${c.id}:${k.index}`} x1={px(k.cx)} y1={py(k.cy - BAND)} x2={px(c.cx)} y2={py(c.cy)} />
              )),
            )}
          </svg>
        )}
        {combos.map((c) => (
          <span key={c.id} className="combo" aria-hidden="true" style={{ left: px(c.cx), top: py(c.cy) }}>
            {c.output}
          </span>
        ))}

        {drawn.balls.map((b, i) => (
          <button
            key={i}
            type="button"
            className="ball"
            aria-pressed={selected === 'ball'}
            aria-label={b.mode ? `${t('keymap.ball')}, ${b.mode}` : t('keymap.ball')}
            tabIndex={selected === 'ball' && i === 0 ? 0 : -1}
            style={{ left: px(b.x - b.d / 2), top: py(b.y - b.d / 2), width: b.d * unit, height: b.d * unit }}
            onClick={() => onSelect('ball')}
          >
            {b.mode && <span style={{ fontSize: Math.max(11, 0.22 * unit) }}>{b.mode}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
