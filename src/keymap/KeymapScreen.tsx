// The keymap screen: one firmware's keymap drawn on its board, read-only.
// See docs/plans/keymap-view.md.

import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { isMac, Kbd } from '../commands/keys';
import { CommandRefused } from '../commands/model';
import { useCommand } from '../commands/react';
import { msg, type Lang, type Localized } from '../i18n/core';
import { useI18n } from '../i18n/react';
import { EditBar, LeaveDialog } from '../edit/EditBar';
import { useEditSession, type EditSession } from '../edit/useEditSession';
import { getFirmwareText, repoName, type RepoRef, type WorkflowRun } from '../lib/github';
import type { FirmwareBuild, FirmwareManifest } from '../lib/manifest';
import { load, save } from '../lib/storage';
import { pointerLockBusy, TrackballPanel, type PadMode, type PadRequest } from '../trackball/TrackballPanel';
import { BALL_MM_MAX, BALL_MM_MIN, CPI_MAX, CPI_MIN, CPI_STEP, DIVIDER_MAX, DIVIDER_MIN } from '../trackball/speed';
import { Board, type Selection } from './Board';
import { LAYOUTS, OSES, type Layout, type Os } from './keycodes';
import {
  drawLayer,
  layerName,
  nextKey,
  parseView,
  type Direction,
  type Display,
  type DrawnKey,
  type DrawnLayer,
  type Legend,
  type ViewFile,
} from './view';

interface Props {
  build: FirmwareBuild;
  repo: RepoRef;
  firmwareSha: string;
  manifest: FirmwareManifest;
  token: string;
  /** The config repository's build runs on GitHub, for "build again". */
  buildsUrl: string;
  onClose: () => void;
  /** After saving to the config repository: the commit, whose build to watch for. */
  onSaved: (sha: string) => void;
  onToken: (token: string) => void;
  runFor: (sha: string) => WorkflowRun | undefined;
  /** Lets the app ask before it leaves or switches this screen (browser Back, another keymap). */
  setLeaveGuard: (guard: (go: () => void) => void) => void;
}

/** A layer tab: one layer, or all of them side by side. */
type Tab = number | 'all';

const OS_NAMES: Record<Os, string> = { mac: 'Mac', windows: 'Windows' };

function savedOs(): Os {
  const v = load('keyballer.display.os');
  return (OSES as string[]).includes(v) ? (v as Os) : isMac() ? 'mac' : 'windows';
}

function savedLayout(): Layout {
  const v = load('keyballer.display.layout');
  return (LAYOUTS as string[]).includes(v) ? (v as Layout) : 'us';
}

/** mac / windows / us / jis / uk as a display setting. */
function toDisplay(value: string): { os: Os } | { layout: Layout } | undefined {
  const v = value.trim().toLowerCase();
  if ((OSES as string[]).includes(v)) return { os: v as Os };
  if ((LAYOUTS as string[]).includes(v)) return { layout: v as Layout };
  return undefined;
}

export function KeymapScreen(props: Props) {
  const { build, repo, firmwareSha, manifest, token, buildsUrl, onClose, onSaved, onToken, runFor, setLeaveGuard } = props;
  const { t, err, lang } = useI18n();
  const [view, setView] = useState<ViewFile | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [tab, setTab] = useState<Tab>(0);
  const [selected, setSelected] = useState<Selection>(null);
  const [os, setOs] = useState<Os>(savedOs);
  const [layout, setLayout] = useState<Layout>(savedLayout);
  const edit = useEditSession(repo, token, build.id);
  /** What to do once the person agrees to leave with unsaved changes; null when not asking. */
  const [leaving, setLeaving] = useState<(() => void) | null>(null);
  const [padRequest, setPadRequest] = useState<PadRequest | null>(null);
  const padRequests = useRef(0);
  const guard = (go: () => void) => (edit.dirty ? setLeaving(() => go) : go());
  useEffect(() => setLeaveGuard(guard));
  useEffect(() => () => setLeaveGuard((go) => go()), [setLeaveGuard]);
  /** Close the keymap, asking first when there are unsaved changes. */
  const close = () => guard(onClose);
  const root = useRef<HTMLElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  const focusAfter = useRef(false);

  useEffect(() => {
    if (!build.view) return;
    let live = true;
    setView(null);
    setLoadError(null);
    getFirmwareText(repo, firmwareSha, build.view, token)
      .then((text) => live && setView(parseView(JSON.parse(text))))
      .catch((e: unknown) => live && setLoadError(e));
    return () => {
      live = false;
    };
  }, [build.view, repo, firmwareSha, token]);

  // Focus moves on (DESIGN.md §8): to the board once it is drawn, or to Back when there is nothing to see.
  const settled = view !== null || loadError !== null || !build.view;
  useEffect(() => {
    if (!settled) return;
    const firstKey = root.current?.querySelector<HTMLElement>('.cap[tabindex="0"]');
    (firstKey ?? backButton.current)?.focus();
  }, [settled]);

  const display: Display = { lang, os, layout };
  const shown = tab === 'all' ? 0 : tab;
  const drawn = useMemo(
    () => (view ? drawLayer(view, shown, { lang, os, layout }) : null),
    [view, shown, lang, os, layout],
  );
  const all = useMemo(
    () => (view && tab === 'all' ? view.layers.map((_, n) => drawLayer(view, n, { lang, os, layout })) : []),
    [view, tab, lang, os, layout],
  );

  // After a keyboard move, focus follows the selected key so it is announced.
  useEffect(() => {
    if (!focusAfter.current || selected === null) return;
    focusAfter.current = false;
    const target =
      selected === 'ball'
        ? root.current?.querySelector<HTMLElement>('.ball[tabindex="0"]')
        : root.current?.querySelector<HTMLElement>(`.cap[data-index="${selected}"]`);
    target?.focus();
  }, [selected, tab]);

  const chooseOs = (next: Os) => {
    setOs(next);
    save('keyballer.display.os', next);
  };
  const chooseLayout = (next: Layout) => {
    setLayout(next);
    save('keyballer.display.layout', next);
  };

  const noView: Localized | undefined = view ? undefined : msg('why.noView');
  const tabs: Tab[] = view ? [...view.layers.map((_, n) => n), 'all'] : [];
  const step = (by: number) => {
    const count = view?.layers.length ?? 0;
    if (count === 0) return;
    const from = tab === 'all' ? 0 : tab;
    setTab((((from + by) % count) + count) % count);
  };
  const move = (direction: Direction) => {
    if (!drawn || drawn.keys.length === 0) return;
    focusAfter.current = true;
    if (typeof selected === 'number') {
      const next = nextKey(drawn, selected, direction);
      if (next !== null) setSelected(next);
      return;
    }
    const ball = drawn.balls[0];
    if (selected === 'ball' && ball) {
      // From the ball, the nearest key.
      const near = [...drawn.keys].sort(
        (a, b) => Math.hypot(a.cx - ball.x, a.cy - ball.y) - Math.hypot(b.cx - ball.x, b.cy - ball.y),
      )[0];
      setSelected(near.index);
      return;
    }
    setSelected(drawn.keys[0].index);
  };

  // The tabs pattern: arrow keys, Home and End move between layer tabs while one has focus.
  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = tabs.indexOf(tab);
    const to =
      e.key === 'ArrowRight' ? (at + 1) % tabs.length
      : e.key === 'ArrowLeft' ? (at - 1 + tabs.length) % tabs.length
      : e.key === 'Home' ? 0
      : e.key === 'End' ? tabs.length - 1
      : -1;
    if (to < 0) return;
    e.preventDefault();
    setTab(tabs[to]);
    root.current?.querySelector<HTMLElement>(`#keymap-tab-${tabs[to]}`)?.focus();
  };

  useCommand({
    id: 'keymap.back',
    words: 'close keymap',
    title: msg('cmd.keymapBack'),
    group: 'group.keymap',
    page: true,
    shortcut: 'Escape',
    run: () => {
      // The Esc that ends the try-out pad's pointer lock is the browser's, not ours.
      if (pointerLockBusy()) return;
      if (selected !== null) setSelected(null);
      else close();
    },
  });
  useCommand({
    id: 'keymap.next',
    words: 'layer next',
    title: msg('cmd.layerNext'),
    group: 'group.keymap',
    page: true,
    shortcut: ']',
    unavailable: noView,
    run: () => step(1),
  });
  useCommand({
    id: 'keymap.previous',
    words: 'layer previous',
    title: msg('cmd.layerPrev'),
    group: 'group.keymap',
    page: true,
    shortcut: '[',
    unavailable: noView,
    run: () => step(-1),
  });
  useCommand({
    id: 'keymap.all',
    words: 'layers all',
    title: msg('cmd.layersAll'),
    group: 'group.keymap',
    page: true,
    shortcut: 'a',
    unavailable: noView,
    run: () => setTab('all'),
  });
  useCommand({
    id: 'keymap.ball',
    words: 'ball',
    title: msg('cmd.ball'),
    group: 'group.keymap',
    page: true,
    shortcut: 'b',
    unavailable: noView ?? (drawn && drawn.balls.length === 0 ? msg('why.noBall') : undefined),
    run: () => {
      focusAfter.current = true;
      setSelected('ball');
    },
  });
  const moves: [Direction, string, 'cmd.moveLeft' | 'cmd.moveRight' | 'cmd.moveUp' | 'cmd.moveDown'][] = [
    ['left', 'ArrowLeft', 'cmd.moveLeft'],
    ['right', 'ArrowRight', 'cmd.moveRight'],
    ['up', 'ArrowUp', 'cmd.moveUp'],
    ['down', 'ArrowDown', 'cmd.moveDown'],
  ];
  for (const [direction, key, title] of moves) {
    // The list is fixed, so these hooks run in the same order on every render.
    useCommand({
      id: `keymap.move.${direction}`,
      words: `select ${direction}`,
      title: msg(title),
      group: 'group.keymap',
      page: true,
      shortcut: key,
      unavailable: noView,
      run: () => move(direction),
    });
  }
  useCommand({
    id: 'keymap.display',
    words: 'display',
    title: msg('cmd.display'),
    group: 'group.keymap',
    page: true,
    args: [
      {
        name: 'as',
        required: true,
        hint: msg('cmd.display.hint'),
        complete: () => [
          ...OSES.map((v) => ({ value: v, detail: OS_NAMES[v] })),
          ...LAYOUTS.map((v) => ({ value: v, detail: v.toUpperCase() })),
        ],
        check: (value) => (toDisplay(value) ? undefined : msg('cmd.display.bad')),
      },
    ],
    run: ({ as }) => {
      const next = toDisplay(as);
      if (!next) throw new CommandRefused(msg('cmd.display.bad'));
      if ('os' in next) chooseOs(next.os);
      else chooseLayout(next.layout);
    },
  });

  useTrackballCommands(edit, () => {
    focusAfter.current = false;
    setSelected('ball');
  }, (mode) => setPadRequest({ mode, id: ++padRequests.current }));

  // Links to keymap.c lines: the view names its own source; older views fall back to the manifest.
  const sourceLink = (line: number) => {
    if (!view?.source) return undefined;
    const repository = view.source.repository ?? manifest.source.repository;
    const commit = view.source.commit ?? manifest.source.sha;
    return `https://github.com/${repository}/blob/${commit}/${view.source.path}#L${line}`;
  };

  return (
    <section className="keymap stack" aria-labelledby="keymap-title" ref={root}>
      <div className="panel-head">
        <div className="stack">
          <h2 id="keymap-title">{t('keymap.title', { name: build.name })}</h2>
          <code className="muted">
            {build.keyboard}:{build.keymap}
          </code>
        </div>
        <button type="button" ref={backButton} onClick={close} aria-keyshortcuts="Escape">
          {t('keymap.back')}
          <Kbd>Esc</Kbd>
        </button>
      </div>

      {!build.view && !build.view_error && (
        <div className="panel">
          <p className="muted">{t('keymap.missing')}</p>
          <a href={buildsUrl} target="_blank" rel="noreferrer">
            {t('keymap.openBuilds')}
          </a>
        </div>
      )}
      {!build.view && build.view_error && (
        <div className="banner err stack" role="alert">
          <p>{t('keymap.failed')}</p>
          <code>{build.view_error}</code>
          <a href={buildsUrl} target="_blank" rel="noreferrer">
            {t('keymap.openBuilds')}
          </a>
        </div>
      )}
      {build.view && !view && !loadError && (
        <div className="board-frame">
          <p className="muted">{t('keymap.loading')}</p>
        </div>
      )}
      {loadError !== null && (
        <p className="banner err" role="alert">
          {err(loadError)}
        </p>
      )}

      {view && drawn && (
        <>
          <div className="keymap-controls">
            <div className="seg layers" role="tablist" aria-label={t('keymap.layers')} onKeyDown={onTabKey}>
              {view.layers.map((_, n) => (
                <LayerTab key={n} view={view} n={n} current={tab === n} onPick={() => setTab(n)} />
              ))}
              <button
                type="button"
                role="tab"
                id="keymap-tab-all"
                aria-selected={tab === 'all'}
                aria-controls="keymap-panel"
                tabIndex={tab === 'all' ? 0 : -1}
                onClick={() => setTab('all')}
                aria-keyshortcuts="A"
              >
                {t('keymap.all')}
                <Kbd>A</Kbd>
              </button>
            </div>
            <div className="display">
              <div className="seg" role="group" aria-label={t('keymap.os')}>
                {OSES.map((v) => (
                  <button key={v} type="button" aria-pressed={os === v} onClick={() => chooseOs(v)}>
                    {OS_NAMES[v]}
                  </button>
                ))}
              </div>
              <div className="seg" role="group" aria-label={t('keymap.layout')}>
                {LAYOUTS.map((v) => (
                  <button key={v} type="button" aria-pressed={layout === v} onClick={() => chooseLayout(v)}>
                    {v.toUpperCase()}
                  </button>
                ))}
              </div>
              <p className="note">{t('keymap.displayOnly')}</p>
            </div>
          </div>

          <EditBar edit={edit} repoName={repoName(repo)} token={token} onToken={onToken} runFor={runFor} onSaved={onSaved} />

          <div className="keymap-body">
            <div className="boards" role="tabpanel" id="keymap-panel" aria-labelledby={`keymap-tab-${tab}`}>
              {tab === 'all' ? (
                <div className="all-layers">
                  {all.map((d, n) => (
                    <div key={n} className="stack">
                      <h3>
                        <button type="button" className="link" onClick={() => setTab(n)}>
                          {layerName(view, n, lang)}
                        </button>
                        {n < 10 && <Kbd>{n}</Kbd>}
                      </h3>
                      <Board
                        drawn={d}
                        label={t('keymap.board', { layer: layerName(view, n, lang) })}
                        selected={selected}
                        onSelect={setSelected}
                        maxUnit={44}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <Board
                  drawn={drawn}
                  label={t('keymap.board', { layer: layerName(view, shown, lang) })}
                  selected={selected}
                  onSelect={setSelected}
                />
              )}
            </div>
            <aside className="panel side" aria-live="polite">
              <Details
                view={view}
                drawn={drawn}
                all={tab === 'all' ? all : null}
                layer={shown}
                selected={selected}
                display={display}
                sourceLink={sourceLink}
                trackball={<TrackballPanel edit={edit} request={padRequest} />}
              />
            </aside>
          </div>
        </>
      )}

      {leaving && (
        <LeaveDialog
          onKeep={() => setLeaving(null)}
          onDiscard={() => {
            const go = leaving;
            setLeaving(null);
            edit.discard();
            go();
          }}
        />
      )}
    </section>
  );
}

/** Commands for the trackball settings; they select the ball so its panel shows. */
function useTrackballCommands(edit: EditSession, showBall: () => void, startPad: (mode: PadMode) => void) {
  const numberArg = (name: string, hint: Localized, ok: (n: number) => boolean, bad: Localized) => ({
    name,
    required: true,
    hint,
    check: (value: string) => (ok(Number(value)) ? undefined : bad),
  });
  const cpiOk = (n: number) => Number.isInteger(n) && n >= CPI_MIN && n <= CPI_MAX && n % CPI_STEP === 0;
  const dividerOk = (n: number) => Number.isInteger(n) && n >= DIVIDER_MIN && n <= DIVIDER_MAX;
  const mmOk = (n: number) => Number.isFinite(n) && n >= BALL_MM_MIN && n <= BALL_MM_MAX;
  const mmBad = msg('cmd.ballSize.bad', { min: BALL_MM_MIN, max: BALL_MM_MAX });
  useCommand({
    id: 'trackball.cpi',
    words: 'cursor speed',
    title: msg('cmd.cursorSpeed'),
    group: 'group.keymap',
    page: true,
    args: [numberArg('cpi', msg('cmd.cursorSpeed.hint'), cpiOk, msg('cmd.cursorSpeed.bad'))],
    run: ({ cpi }) => {
      if (!cpiOk(Number(cpi))) throw new CommandRefused(msg('cmd.cursorSpeed.bad'));
      showBall();
      edit.edit({ type: 'cpi', value: Number(cpi) });
    },
  });
  useCommand({
    id: 'trackball.divider',
    words: 'scroll speed',
    title: msg('cmd.scrollSpeed'),
    group: 'group.keymap',
    page: true,
    args: [numberArg('divider', msg('cmd.scrollSpeed.hint'), dividerOk, msg('cmd.scrollSpeed.bad'))],
    run: ({ divider }) => {
      if (!dividerOk(Number(divider))) throw new CommandRefused(msg('cmd.scrollSpeed.bad'));
      showBall();
      edit.edit({ type: 'divider', value: Number(divider) });
    },
  });
  useCommand({
    id: 'trackball.size',
    words: 'ball size',
    title: msg('cmd.ballSize'),
    group: 'group.keymap',
    page: true,
    args: [numberArg('mm', msg('cmd.ballSize.hint'), mmOk, mmBad)],
    run: ({ mm }) => {
      if (!mmOk(Number(mm))) throw new CommandRefused(mmBad);
      showBall();
      edit.edit({ type: 'ballMm', value: Number(mm) });
    },
  });
  useCommand({
    id: 'trackball.try',
    words: 'try speed',
    title: msg('cmd.tryBall'),
    group: 'group.keymap',
    page: true,
    run: () => {
      showBall();
      startPad('try');
    },
  });
  useCommand({
    id: 'trackball.measure',
    words: 'measure sensor',
    title: msg('cmd.measure'),
    group: 'group.keymap',
    page: true,
    run: () => {
      showBall();
      startPad('measure');
    },
  });
}

function LayerTab({ view, n, current, onPick }: { view: ViewFile; n: number; current: boolean; onPick: () => void }) {
  const { lang } = useI18n();
  const name = layerName(view, n, lang);
  const shortcut = n < 10 ? String(n) : undefined;
  // `layer 2` by number; `layer symbol` finds it by its title.
  useCommand({
    id: `keymap.layer.${n}`,
    words: `layer ${n}`,
    title: msg('cmd.layer', { name }),
    group: 'group.keymap',
    page: true,
    shortcut,
    run: onPick,
  });
  return (
    <button
      type="button"
      role="tab"
      id={`keymap-tab-${n}`}
      aria-selected={current}
      aria-controls="keymap-panel"
      tabIndex={current ? 0 : -1}
      onClick={onPick}
      aria-keyshortcuts={shortcut}
    >
      {name}
      {shortcut && <Kbd>{shortcut}</Kbd>}
    </button>
  );
}

/** A legend as one line of text: "Q, hold: ⌥", "Number (Toggle)". */
function legendLine(l: Legend, t: ReturnType<typeof useI18n>['t']): string {
  const main = l.top ? t('keymap.withNote', { main: l.tap, note: l.top }) : l.tap;
  return l.hold ? t('keymap.tapHold', { tap: main, hold: l.hold }) : main;
}

interface DetailsProps {
  view: ViewFile;
  drawn: DrawnLayer;
  all: DrawnLayer[] | null;
  layer: number;
  selected: Selection;
  display: Display;
  sourceLink: (line: number) => string | undefined;
  /** The trackball's settings, shown with its layer modes when the ball is selected. */
  trackball: ReactNode;
}

function Details({ view, drawn, all, layer, selected, display, sourceLink, trackball }: DetailsProps) {
  const { t } = useI18n();
  const base = drawLayer(view, 0, display);
  const nameAt = (index: number) => base.keys.find((k) => k.index === index)?.legend.tap ?? '?';
  const lang: Lang = display.lang;

  const combos = (only?: number) => {
    const list = base.combos.filter((c) => only === undefined || c.positions.includes(only));
    if (list.length === 0) return null;
    return (
      <div className="stack">
        <h3>{t('keymap.combos')}</h3>
        <ul className="combo-list">
          {list.map((c) => (
            <li key={c.line + c.positions.join()}>
              {c.positions.map((p, i) => (
                <Fragment key={p}>
                  {i > 0 && <span className="muted">+</span>}
                  <Kbd>{nameAt(p)}</Kbd>
                </Fragment>
              ))}
              <span className="out">
                <span className="muted">=</span>
                <Kbd>{c.output.tap}</Kbd>
                {sourceLink(c.line) && (
                  <a className="muted" href={sourceLink(c.line)} target="_blank" rel="noreferrer">
                    {t('keymap.line', { n: c.line })}
                  </a>
                )}
              </span>
            </li>
          ))}
        </ul>
        <p className="note">{t('keymap.comboNote', { layer: layerName(view, 0, lang) })}</p>
      </div>
    );
  };

  if (selected === null) {
    return (
      <>
        <p className="note">{t('keymap.choose')}</p>
        {combos()}
      </>
    );
  }

  if (selected === 'ball') {
    return (
      <>
        <h3>{t('keymap.ball')}</h3>
        <p className="note">{t('keymap.ballMode')}</p>
        <dl className="facts">
          {view.layers.map((_, n) => (
            <Fragment key={n}>
              <dt>{layerName(view, n, lang)}</dt>
              <dd>{drawLayer(view, n, display).balls[0]?.mode ?? t('keymap.ballUnset')}</dd>
            </Fragment>
          ))}
        </dl>
        {trackball}
      </>
    );
  }

  const key = drawn.keys.find((k) => k.index === selected);
  if (!key) return null;

  if (all) {
    return (
      <>
        <h3>{t('keymap.onLayers')}</h3>
        <dl className="facts">
          {all.map((d, n) => {
            const k = d.keys.find((x) => x.index === selected);
            if (!k) return null;
            return (
              <Fragment key={n}>
                <dt>{layerName(view, n, lang)}</dt>
                <dd>
                  {k.kind === 'transparent' && k.fallsTo ? `▽ ${legendLine(k.fallsTo, t)}` : legendLine(k.legend, t)}
                </dd>
              </Fragment>
            );
          })}
        </dl>
        {combos(selected)}
      </>
    );
  }

  return <KeyDetails view={view} k={key} layer={layer} sourceLink={sourceLink} combos={combos(selected)} />;
}

interface KeyDetailsProps {
  view: ViewFile;
  k: DrawnKey;
  layer: number;
  sourceLink: (line: number) => string | undefined;
  combos: ReactNode;
}

function KeyDetails({ view, k, layer, sourceLink, combos }: KeyDetailsProps) {
  const { t } = useI18n();
  const legend = k.kind === 'transparent' && k.fallsTo ? k.fallsTo : k.legend;
  const tap = legend.top ? t('keymap.withNote', { main: legend.tap, note: legend.top }) : legend.tap;
  return (
    <>
      <h3>{tap}</h3>
      <dl className="facts">
        <dt>{t('keymap.tap')}</dt>
        <dd>{tap}</dd>
        {legend.hold && (
          <>
            <dt>{t('keymap.hold')}</dt>
            <dd>{legend.hold}</dd>
          </>
        )}
        <dt>{t('keymap.keycode')}</dt>
        <dd>
          <code>{k.keycode}</code>
        </dd>
      </dl>
      {k.kind === 'transparent' && (
        <p className="note">
          {t('keymap.falls', { legend: k.fallsTo ? legendLine(k.fallsTo, t) : '—' })}
        </p>
      )}
      {k.kind === 'none' && <p className="note">{t('keymap.none')}</p>}
      {k.kind === 'unknown' && <p className="note">{t('keymap.unknown')}</p>}
      {k.held && layer > 0 && <p className="note">{t('keymap.held')}</p>}
      {k.code && view.source && (
        <div className="stack">
          <p className="note">{t('keymap.code', { path: view.source.path })}</p>
          <ul className="lines">
            {k.code.map((line) => (
              <li key={line}>
                <a href={sourceLink(line)} target="_blank" rel="noreferrer">
                  {t('keymap.line', { n: line })}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
      {combos}
    </>
  );
}
