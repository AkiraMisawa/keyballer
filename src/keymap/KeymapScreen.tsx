// The keymap screen: one firmware's keymap drawn on its board, and editing it.
// See docs/plans/keymap-view.md and docs/plans/keymap-editor.md.

import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { isMac, Kbd } from '../commands/keys';
import { CommandRefused } from '../commands/model';
import { useCommand } from '../commands/react';
import { msg, type Lang, type Localized } from '../i18n/core';
import { useI18n } from '../i18n/react';
import { ConfirmDialog, EditBar, LeaveDialog, SessionState } from '../edit/EditBar';
import { ballModeEditable, editedView, keymapProblem, keyProblem, ownKeycodes } from '../edit/session';
import { zmkKeymapOf } from '../edit/zmk';
import { useEditSession, type EditSession } from '../edit/useEditSession';
import { getFirmwareText, repoName, type RepoRef, type WorkflowRun } from '../lib/github';
import { isZmk, type FirmwareBuild, type FirmwareManifest } from '../lib/manifest';
import { load, save } from '../lib/storage';
import type { TokenField } from '../components/TokenInput';
import type { SignIn } from '../auth/useSignIn';
import { pointerLockBusy, TrackballPanel, type PadMode, type PadRequest } from '../trackball/TrackballPanel';
import { BALL_MM_MAX, BALL_MM_MIN, CPI_MAX, CPI_MIN, CPI_STEP, DIVIDER_MAX, DIVIDER_MIN } from '../trackball/speed';
import { Board, type Selection } from './Board';
import { checkKeycode, compose, decompose, makeCatalogue, type Hold } from './catalogue';
import { ComboPanel, EditPanel, leadingTo } from './EditPanel';
import { KeyPicker, type PickerContext } from './KeyPicker';
import { LAYOUTS, OSES, type Layout, type Mod, type Os } from './keycodes';
import {
  drawLayer,
  layerName,
  legendOf,
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
  /** The token to send: pasted, or from the local sign-in. */
  token: string;
  tokenField: TokenField;
  signIn: SignIn | null;
  /** The config repository's build runs on GitHub, for "build again". */
  buildsUrl: string;
  onClose: () => void;
  /** After saving to the config repository: the commit, whose build to watch for. */
  onSaved: (sha: string) => void;
  runFor: (sha: string) => WorkflowRun | undefined;
  /** Lets the app ask before it leaves or switches this screen (browser Back, another keymap). */
  setLeaveGuard: (guard: (go: () => void) => void) => void;
}

/** A layer tab: one layer, or all of them side by side. */
type Tab = number | 'all';

const OS_NAMES: Record<Os, string> = { mac: 'Mac', windows: 'Windows' };
const TRANSPARENT_KEY = '_______';

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
  const { build, repo, firmwareSha, manifest, token, tokenField, signIn, buildsUrl, onClose, onSaved, runFor, setLeaveGuard } = props;
  const { t, err, lang } = useI18n();
  const [builtView, setView] = useState<ViewFile | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [tab, setTab] = useState<Tab>(0);
  const [selected, setSelected] = useState<Selection>(null);
  const [os, setOs] = useState<Os>(savedOs);
  const [layout, setLayout] = useState<Layout>(savedLayout);
  // A ZMK build's view says what its .keymap file means, so the session waits for it.
  const edit = useEditSession(repo, token, build.id, isZmk(build) ? builtView : null);
  const [editing, setEditing] = useState(false);
  /**
   * What the board draws: the built firmware's keymap, or, while editing or with unsaved
   * changes, that keymap with the changes over it.
   */
  const showEdits = editing || edit.dirty;
  const view = useMemo(
    () => (builtView && showEdits ? editedView(builtView, edit.session) : builtView),
    [builtView, edit.session, showEdits],
  );
  /** Keys picked for a new combo; null when not making one. */
  const [comboPick, setComboPick] = useState<number[] | null>(null);
  /** The combo whose output is being changed, by name; null when not changing one. */
  const [comboChange, setComboChange] = useState<string | null>(null);
  const [removingLayer, setRemovingLayer] = useState(false);
  /** Requests to the key picker: wait for a key press, or take focus. */
  const [listen, setListen] = useState(0);
  const [pickerFocus, setPickerFocus] = useState(0);
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
  const settled = builtView !== null || loadError !== null || !build.view;
  useEffect(() => {
    if (!settled) return;
    const firstKey = root.current?.querySelector<HTMLElement>('.cap[tabindex="0"]');
    (firstKey ?? backButton.current)?.focus();
  }, [settled]);

  // A removed layer (or undoing an added one) takes its tab with it.
  const layerCount = view?.layers.length ?? 0;
  useEffect(() => {
    if (typeof tab === 'number' && layerCount > 0 && tab >= layerCount) setTab(layerCount - 1);
  }, [tab, layerCount]);

  const display: Display = { lang, os, layout };
  const shown = tab === 'all' ? 0 : Math.min(tab, Math.max(0, layerCount - 1));
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
  /** Combos are made from the base layer's keys, so the base layer stays shown meanwhile. */
  const noLayerSwitch: Localized | undefined = noView ?? (comboPick !== null ? msg('why.pickingCombo') : undefined);
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
    if (noLayerSwitch) return;
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
      const inPanel = !!root.current?.querySelector('.side')?.contains(document.activeElement);
      if (comboPick !== null || comboChange !== null) {
        setComboPick(null);
        setComboChange(null);
      } else if (inPanel && typeof selected === 'number') {
        // From the key picker, Esc goes back to the key on the board.
        root.current?.querySelector<HTMLElement>(`.cap[data-index="${selected}"]`)?.focus();
      } else if (selected !== null) setSelected(null);
      else if (editing) setEditing(false);
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
    unavailable: noLayerSwitch,
    run: () => step(1),
  });
  useCommand({
    id: 'keymap.previous',
    words: 'layer previous',
    title: msg('cmd.layerPrev'),
    group: 'group.keymap',
    page: true,
    shortcut: '[',
    unavailable: noLayerSwitch,
    run: () => step(-1),
  });
  useCommand({
    id: 'keymap.all',
    words: 'layers all',
    title: msg('cmd.layersAll'),
    group: 'group.keymap',
    page: true,
    shortcut: 'a',
    unavailable: noLayerSwitch,
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

  // ---- editing (docs/plans/keymap-editor.md) ----
  const editProblem = edit.session && builtView ? keymapProblem(edit.session, builtView.layout) : undefined;
  const canEdit = editing && !!edit.session && !editProblem;
  const own = useMemo(() => (edit.session && !editProblem ? ownKeycodes(edit.session) : []), [edit.session, editProblem]);
  const catalogue = useMemo(
    () =>
      makeCatalogue({
        layers: view?.layers.map((l) => l.name) ?? [],
        custom: own,
        defines: view?.defines ?? {},
        labels: view?.labels ?? {},
        zmk: isZmk(build),
      }),
    [view, own, build],
  );
  // A ZMK build that did not record its .keymap file cannot be edited (docs/plans/zmk.md, phase 4).
  const noZmkEdit: Localized | undefined = isZmk(build) && builtView && !zmkKeymapOf(builtView) ? msg('why.zmkNoEdit') : undefined;
  const pickerContext: PickerContext | null = view
    ? { view, display, catalogue, layerNames: view.layers.map((_, n) => layerName(view, n, lang)) }
    : null;
  const changed = useMemo(
    () => new Set((edit.pending?.keys ?? []).filter((k) => k.layer === shown).map((k) => k.index)),
    [edit.pending, shown],
  );
  const sharedBy = edit.state.status === 'ready' ? edit.state.sharedBy : [];
  const keyIndex = typeof selected === 'number' && tab !== 'all' ? selected : null;
  const notEditing: Localized | undefined = !editing
    ? msg('why.notEditing')
    : !edit.session
      ? msg('edit.notLoaded')
      : editProblem
        ? msg(editProblem)
        : undefined;
  const noKey = notEditing ?? (keyIndex === null ? msg('why.noKeySelected') : undefined);

  const startEditing = () => {
    edit.ensure();
    setEditing(true);
    if (tab === 'all') setTab(0);
  };
  /** Why a keycode cannot go on the selected key, if it cannot. */
  const assignProblem = (keycode: string) =>
    keyIndex === null || !edit.session ? undefined : keyProblem(edit.session, shown, keyIndex, keycode);
  /**
   * Puts a keycode on the selected key, then moves to the next key so a row can be filled. Focus
   * stays in the key picker when the change came from there, else follows the selection.
   */
  const assign = (keycode: string) => {
    if (keyIndex === null || !drawn || assignProblem(keycode)) return;
    const fromPicker = !!root.current?.querySelector('.picker')?.contains(document.activeElement);
    edit.edit({ type: 'key', layer: shown, index: keyIndex, keycode });
    const order = drawn.keys.map((k) => k.index).sort((a, b) => a - b);
    const next = order[order.indexOf(keyIndex) + 1];
    if (next !== undefined) {
      focusAfter.current = !fromPicker;
      setSelected(next);
    }
  };
  const onBoardSelect = (sel: Selection) => {
    if (comboPick !== null && typeof sel === 'number') {
      setComboPick(comboPick.includes(sel) ? comboPick.filter((p) => p !== sel) : [...comboPick, sel]);
      return;
    }
    // Enter or a second click on the selected key, while editing, goes to the key picker.
    if (canEdit && sel !== null && sel === selected) setPickerFocus((n) => n + 1);
    setSelected(sel);
  };
  const startCombo = () => {
    setSelected(null);
    setComboChange(null);
    setTab(0);
    setComboPick([]);
  };
  const leading = pickerContext && view ? leadingTo(pickerContext, view.layers.length - 1) : [];

  useCommand({
    id: 'keymap.edit',
    words: 'edit',
    title: msg('cmd.edit'),
    group: 'group.keymap',
    page: true,
    shortcut: 'e',
    unavailable: noView ?? noZmkEdit,
    run: () => (editing ? setEditing(false) : startEditing()),
  });
  const holdOf = (text: string): Hold | null | undefined => {
    if (/^\d+$/.test(text)) return { layer: Number(text) };
    const mods = text.toLowerCase().split('+');
    return mods.every((m) => m === 'ctrl' || m === 'shift' || m === 'alt' || m === 'gui') ? { mods: mods as Mod[] } : undefined;
  };
  useCommand({
    id: 'keymap.assign',
    words: 'assign',
    title: msg('cmd.assign'),
    group: 'group.edit',
    page: true,
    unavailable: noKey,
    args: [
      { name: 'keycode', required: true, hint: msg('cmd.assign.hint'), check: (v) => { const p = checkKeycode(v); return p ? msg(p) : undefined; } },
      { name: 'hold', required: false, hint: msg('cmd.assign.holdHint'), check: (v) => (holdOf(v) ? undefined : msg('cmd.assign.holdBad')) },
    ],
    run: ({ keycode, hold }) => {
      const typed = checkKeycode(keycode);
      if (typed) throw new CommandRefused(msg(typed));
      // Typed without spaces on the line (LT(1,KC_A)); written as keymap.c writes them.
      let code = keycode.trim().replace(/\s*,\s*/g, ', ');
      if (hold) {
        const h = holdOf(hold);
        if (!h) throw new CommandRefused(msg('cmd.assign.holdBad'));
        const result = compose({ ...decompose(code), hold: h });
        if ('refused' in result) throw new CommandRefused(msg(result.refused));
        code = result.keycode;
      }
      const problem = assignProblem(code);
      if (problem) throw new CommandRefused(msg(problem));
      assign(code);
    },
  });
  useCommand({
    id: 'keymap.transparent',
    words: 'transparent',
    title: msg('cmd.transparent'),
    group: 'group.edit',
    page: true,
    shortcut: ['Backspace', 'Delete'],
    unavailable: noKey ?? (assignProblem(TRANSPARENT_KEY) ? msg(assignProblem(TRANSPARENT_KEY)!) : undefined),
    run: () => assign(TRANSPARENT_KEY),
  });
  useCommand({
    id: 'keymap.none',
    words: 'none',
    title: msg('cmd.none'),
    group: 'group.edit',
    page: true,
    unavailable: noKey ?? (assignProblem('KC_NO') ? msg(assignProblem('KC_NO')!) : undefined),
    run: () => assign('KC_NO'),
  });
  useCommand({
    id: 'keymap.pressKey',
    words: 'press key',
    title: msg('cmd.pressKey'),
    group: 'group.edit',
    page: true,
    shortcut: 'k',
    unavailable: noKey,
    run: () => setListen((n) => n + 1),
  });
  useCommand({
    id: 'keymap.comboAdd',
    words: 'combo add',
    title: msg('cmd.comboAdd'),
    group: 'group.edit',
    page: true,
    unavailable: notEditing,
    run: startCombo,
  });
  const comboAt = (v: string) => view?.combos[Number(v) - 1];
  useCommand({
    id: 'keymap.comboRemove',
    words: 'combo remove',
    title: msg('cmd.comboRemove'),
    group: 'group.edit',
    page: true,
    unavailable: notEditing,
    args: [
      {
        name: 'number',
        required: true,
        hint: msg('cmd.comboRemove.hint'),
        check: (v) => (comboAt(v)?.name ? undefined : msg('cmd.comboRemove.bad')),
      },
    ],
    run: ({ number }) => {
      const name = comboAt(number)?.name;
      if (!name) throw new CommandRefused(msg('cmd.comboRemove.bad'));
      edit.edit({ type: 'comboRemove', name });
    },
  });
  useCommand({
    id: 'keymap.layerAdd',
    words: 'layer add',
    title: msg('cmd.layerAdd'),
    group: 'group.edit',
    page: true,
    unavailable: notEditing,
    run: () => edit.edit({ type: 'layerAdd' }),
  });
  useCommand({
    id: 'keymap.layerRemove',
    words: 'layer remove',
    title: msg('cmd.layerRemove'),
    group: 'group.edit',
    page: true,
    unavailable: notEditing ?? ((view?.layers.length ?? 0) < 2 ? msg('why.oneLayer') : undefined),
    run: () => setRemovingLayer(true),
  });
  useCommand({
    id: 'keymap.layerRename',
    words: 'layer rename',
    title: msg('cmd.layerRename'),
    group: 'group.edit',
    page: true,
    unavailable: notEditing,
    args: [{ name: 'name', required: true, rest: true, hint: msg('cmd.layerRename.hint') }],
    run: ({ name }) => edit.edit({ type: 'layerName', layer: shown, name: name.trim() }),
  });
  useCommand({
    id: 'keymap.ballMode',
    words: 'ball mode',
    title: msg('cmd.ballMode'),
    group: 'group.edit',
    page: true,
    unavailable: notEditing ?? (edit.session && !ballModeEditable(edit.session) ? msg('why.ballInCode') : undefined),
    args: [
      {
        name: 'mode',
        required: true,
        hint: msg('cmd.ballMode.hint'),
        complete: () => [{ value: 'cursor' }, { value: 'scroll' }],
        check: (v) => (v === 'cursor' || v === 'scroll' ? undefined : msg('cmd.ballMode.bad')),
      },
    ],
    run: ({ mode }) => {
      if (mode !== 'cursor' && mode !== 'scroll') throw new CommandRefused(msg('cmd.ballMode.bad'));
      edit.edit({ type: 'ballMode', layer: shown, mode });
    },
  });

  // Links to keymap.c lines: the view names its own source; older views fall back to the manifest.
  const sourceLink = (line: number) => {
    if (!view?.source || line <= 0) return undefined;
    const repository = view.source.repository ?? manifest.source.repository;
    const commit = view.source.commit ?? manifest.source.sha;
    return `https://github.com/${repository}/blob/${commit}/${view.source.path}#L${line}`;
  };

  return (
    <section className="keymap stack" aria-labelledby="keymap-title" ref={root}>
      <div className="panel-head">
        <div className="stack">
          <h2 id="keymap-title">{t('keymap.title', { name: build.name })}</h2>
          <code className="muted">{isZmk(build) ? `${build.board} ${build.shield}` : `${build.keyboard}:${build.keymap}`}</code>
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
                <LayerTab key={n} view={view} n={n} current={tab === n} disabled={!!noLayerSwitch} onPick={() => setTab(n)} />
              ))}
              <button
                type="button"
                role="tab"
                id="keymap-tab-all"
                aria-selected={tab === 'all'}
                aria-controls="keymap-panel"
                tabIndex={tab === 'all' ? 0 : -1}
                disabled={!!noLayerSwitch}
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
            {noZmkEdit ? (
              <p className="note">{t('why.zmkNoEdit')}</p>
            ) : (
              <button type="button" className={editing ? 'primary' : ''} onClick={() => (editing ? setEditing(false) : startEditing())} aria-keyshortcuts="E">
                {editing ? t('edit.leave') : t('edit.enter')}
                <Kbd>E</Kbd>
              </button>
            )}
          </div>

          <EditBar
            edit={edit}
            repoName={repoName(repo)}
            token={token}
            tokenField={tokenField}
            signIn={signIn}
            runFor={runFor}
            onSaved={onSaved}
            note={isZmk(build) && build.studio ? t('save.zmkStudio', { name: build.name }) : undefined}
            describe={{
              legend: (k) => {
                const l = legendOf(view, k, display);
                return [l.tap, l.hold].filter(Boolean).join(' / ');
              },
              layer: (n) => layerName(view, n, lang),
            }}
          />

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
                  selected={comboPick !== null ? null : selected}
                  onSelect={onBoardSelect}
                  changed={changed}
                  picked={comboPick !== null ? new Set(comboPick) : undefined}
                />
              )}
            </div>
            <aside className="panel side" aria-live="polite">
              {editing && editProblem ? (
                <div className="stack">
                  <p className="note">
                    {t('edit.cannotEdit')} {t(editProblem)}
                  </p>
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
                </div>
              ) : editing && !edit.session ? (
                <SessionState edit={edit} />
              ) : pickerContext && (comboPick !== null || comboChange !== null) ? (
                <ComboPanel
                  edit={edit}
                  context={pickerContext}
                  picked={comboPick ?? undefined}
                  change={comboChange ?? undefined}
                  onDone={() => {
                    setComboPick(null);
                    setComboChange(null);
                  }}
                />
              ) : pickerContext && canEdit && keyIndex !== null ? (
                <KeyPicker
                  context={pickerContext}
                  keyId={`${shown}:${keyIndex}`}
                  keycode={view.layers[shown]?.keys[keyIndex] ?? 'KC_NO'}
                  title={t('edit.keyTitle', { layer: layerName(view, shown, lang), n: keyIndex + 1 })}
                  problem={assignProblem}
                  pressShortcut
                  listenRequest={listen}
                  focusRequest={pickerFocus}
                  onAssign={assign}
                />
              ) : pickerContext && canEdit && selected === null ? (
                <EditPanel
                  edit={edit}
                  context={pickerContext}
                  layer={shown}
                  sharedBy={sharedBy}
                  onAddCombo={startCombo}
                  onChangeCombo={(name) => {
                    setSelected(null);
                    setComboChange(name);
                  }}
                  onRemoveLayer={() => setRemovingLayer(true)}
                />
              ) : (
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
              )}
            </aside>
          </div>
        </>
      )}

      {removingLayer && view && (
        <ConfirmDialog
          title={t('edit.removeLayer', { n: view.layers.length - 1 })}
          body={
            leading.length > 0
              ? t('edit.removeLayerRefs', { n: view.layers.length - 1, keys: leading.join(', ') })
              : t('edit.removeLayerPlain', { n: view.layers.length - 1 })
          }
          confirm={t('edit.removeLayer', { n: view.layers.length - 1 })}
          cancel={t('edit.cancel')}
          onConfirm={() => {
            setRemovingLayer(false);
            edit.edit({ type: 'layerRemove' });
          }}
          onCancel={() => setRemovingLayer(false)}
        />
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

interface LayerTabProps {
  view: ViewFile;
  n: number;
  current: boolean;
  /** While a combo's keys are picked, the base layer stays shown. */
  disabled: boolean;
  onPick: () => void;
}

function LayerTab({ view, n, current, disabled, onPick }: LayerTabProps) {
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
    unavailable: disabled ? msg('why.pickingCombo') : undefined,
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
      disabled={disabled && !current}
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
