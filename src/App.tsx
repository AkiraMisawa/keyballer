import { useCallback, useEffect, useRef, useState } from 'react';
import { BuildStatus } from './components/BuildStatus';
import { FirmwareCard } from './components/FirmwareCard';
import { FlashPanel } from './components/FlashPanel';
import { LanguageSwitch } from './components/LanguageSwitch';
import { LocalFirmware } from './components/LocalFirmware';
import { KeymapScreen } from './keymap/KeymapScreen';
import { Kbd, lineChord } from './commands/keys';
import { CommandRefused } from './commands/model';
import { useCommand, useCommandLine } from './commands/react';
import { LocalizedError, msg, type Lang, type Localized } from './i18n/core';
import { useI18n } from './i18n/react';
import {
  checkRepo,
  getBuildRuns,
  getFirmwareHead,
  getManifest,
  parseRepo,
  repoName,
  type RepoRef,
  type WorkflowRun,
} from './lib/github';
import { loadVerifiedFirmware, type FirmwareSource } from './lib/firmware';
import type { FirmwareBuild, FirmwareManifest } from './lib/manifest';
import { isWebSerialSupported } from './lib/serial';
import { load, save } from './lib/storage';

interface FlashTarget {
  title: string;
  image: Uint8Array;
  split: boolean;
  source?: FirmwareSource;
}

interface RepoState {
  ref: RepoRef;
  firmwareSha: string | null;
  manifest: FirmwareManifest | null;
  runs: WorkflowRun[];
}

const POLL_MS = 30_000;
/** After a save, how often and how long to look for the build it started. */
const AWAIT_RUN_POLL_MS = 5_000;
const AWAIT_RUN_MS = 180_000;

/** english / japanese (and en, ja, 英語, 日本語) as a language. */
function toLang(value: string): Lang | undefined {
  const v = value.trim().toLowerCase();
  if (['english', 'en', '英語'].includes(v)) return 'en';
  if (['japanese', 'ja', '日本語'].includes(v)) return 'ja';
  return undefined;
}

const KEYMAP_HASH = /^#keymap-([A-Za-z0-9_-]+)$/;

/** The build whose keymap the address shows (#keymap-<id>), if any. */
const keymapInHash = () => KEYMAP_HASH.exec(location.hash)?.[1] ?? null;

/** V opens the first firmware's keymap; the others are `keymap <id>` on the command line. */
const KEYMAP_SHORTCUT = 'v';

/** Offers `keymap <id>` for one build. */
function KeymapCommand({ build, shortcut, onOpen }: { build: FirmwareBuild; shortcut?: string; onOpen: () => void }) {
  useCommand({
    id: `keymap:${build.id}`,
    words: `keymap ${build.id}`,
    title: msg('cmd.keymap', { name: build.name }),
    group: 'group.keymap',
    shortcut,
    run: onOpen,
  });
  return null;
}

const sameRepo = (a: string, b: string) => {
  const x = parseRepo(a);
  const y = parseRepo(b);
  return !!x && !!y && repoName(x).toLowerCase() === repoName(y).toLowerCase();
};

/**
 * A repository named in the address (`?repo=`) that is not the remembered one. It is not opened
 * until the person agrees: firmware from it would run on their keyboard, and anyone can make a link.
 */
function linkedRepo(): string | null {
  const ref = parseRepo(new URLSearchParams(location.search).get('repo')?.trim() ?? '');
  // Shown and opened in its canonical form only, so the prompt names exactly what would open.
  if (!ref) return null;
  const linked = repoName(ref);
  const saved = load('keyballer.repo');
  return saved && sameRepo(linked, saved) ? null : linked;
}

/** Where the source commit of the last firmware flashed from a repository is remembered. */
const flashedKey = (ref: RepoRef) => `keyballer.flashed.${repoName(ref).toLowerCase()}`;

/** The address without `?repo=`, once the link has been answered. */
function dropRepoParam() {
  const url = new URL(location.href);
  url.searchParams.delete('repo');
  history.replaceState(history.state, '', url);
}

export function App() {
  const { t, rich, err, setLang } = useI18n();
  const { openLine, openHelp } = useCommandLine();
  const serialOk = isWebSerialSupported();
  const [askRepo, setAskRepo] = useState(linkedRepo);
  // The safe answer has focus, so Enter does not open a stranger's repository.
  const keepRepoButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (askRepo) keepRepoButton.current?.focus();
  }, [askRepo]);
  const [repoInput, setRepoInput] = useState(() => load('keyballer.repo'));
  const [token, setToken] = useState(() => load('keyballer.token'));
  const [repo, setRepo] = useState<RepoState | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [loadingBuild, setLoadingBuild] = useState('');
  const [target, setTarget] = useState<FlashTarget | null>(null);
  const [keymapId, setKeymapId] = useState<string | null>(keymapInHash);
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const repoField = useRef<HTMLInputElement>(null);
  // Where focus goes back to when the flash panel closes.
  const returnFocus = useRef<HTMLElement | null>(null);

  const fetchState = useCallback(async (ref: RepoRef): Promise<RepoState> => {
    const tk = tokenRef.current;
    const [firmwareSha, runs] = await Promise.all([getFirmwareHead(ref, tk), getBuildRuns(ref, tk)]);
    const manifest = firmwareSha ? await getManifest(ref, firmwareSha, tk) : null;
    return { ref, firmwareSha, manifest, runs };
  }, []);

  const connect = useCallback(
    async (input: string) => {
      const ref = parseRepo(input);
      if (!ref) {
        setError(new LocalizedError('repo.invalid'));
        return;
      }
      setConnecting(true);
      setError(null);
      try {
        await checkRepo(ref, tokenRef.current);
        setRepo(await fetchState(ref));
        save('keyballer.repo', repoName(ref));
      } catch (e) {
        setRepo(null);
        setError(e);
      } finally {
        setConnecting(false);
      }
    },
    [fetchState],
  );

  const refresh = useCallback(async () => {
    if (!repo) return;
    setRefreshing(true);
    setError(null);
    try {
      setRepo(await fetchState(repo.ref));
    } catch (e) {
      setError(e);
    } finally {
      setRefreshing(false);
    }
  }, [repo, fetchState]);

  // Connect on load when a repository is remembered or given in ?repo=.
  const autoConnected = useRef(false);
  useEffect(() => {
    if (autoConnected.current || !repoInput) return;
    autoConnected.current = true;
    void connect(repoInput);
  }, [connect, repoInput]);

  // While a build is running, check on it every 30 seconds.
  const building = repo?.runs[0] && repo.runs[0].status !== 'completed';
  useEffect(() => {
    if (!building) return;
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [building, refresh]);

  /**
   * Asked before leaving or switching the keymap screen: it runs `go` at once, or after asking when
   * there are unsaved changes. The keymap screen sets it while it is open.
   */
  const leaveGuard = useRef<(go: () => void) => void>((go) => go());
  const shownKeymap = useRef(keymapId);
  shownKeymap.current = keymapId;

  // The keymap screen follows the address, so Back closes it and a link opens it. Leaving a keymap
  // with unsaved changes asks first: the address is put back until the person agrees, and then
  // the history step is taken again (the guard's history.back, which this handler ignores).
  const skipNextPop = useRef(false);
  useEffect(() => {
    const sync = () => {
      if (skipNextPop.current) {
        skipNextPop.current = false;
        return;
      }
      const next = keymapInHash();
      const now = shownKeymap.current;
      if (next === now) return;
      if (now === null) {
        returnFocus.current = null;
        setKeymapId(next);
        return;
      }
      history.pushState({ keymap: now }, '', `#keymap-${now}`);
      leaveGuard.current(() => {
        skipNextPop.current = true;
        history.back();
        returnFocus.current = null;
        setKeymapId(next);
      });
    };
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

  const openKeymap = (id: string) => {
    if (keymapId !== null && keymapId !== id) {
      leaveGuard.current(() => showKeymap(id));
      return;
    }
    showKeymap(id);
  };

  const showKeymap = (id: string) => {
    if (keymapId === null) {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    // One history entry for the keymap screen: switching to another keymap replaces it, so Back
    // and Esc both return to the firmware list.
    if (keymapInHash() === null) history.pushState({ keymap: id }, '', `#keymap-${id}`);
    else history.replaceState(history.state, '', `#keymap-${id}`);
    shownKeymap.current = id;
    setKeymapId(id);
    window.scrollTo({ top: 0 });
  };

  const closeKeymap = () => {
    const id = keymapId;
    // Before history.back(): its popstate must see the keymap already closed.
    shownKeymap.current = null;
    if ((history.state as { keymap?: string } | null)?.keymap) history.back();
    else history.replaceState(null, '', location.pathname + location.search);
    setKeymapId(null);
    const el = returnFocus.current;
    requestAnimationFrame(() => {
      // Back to what opened it, or, when it was opened from a link, that firmware's keymap button.
      if (el?.isConnected) el.focus();
      else document.querySelector<HTMLElement>(`[data-keymap="${id}"]`)?.focus();
    });
  };

  // After saving from the keymap screen, look for the build it started until GitHub lists it.
  const [awaitingRun, setAwaitingRun] = useState<string | null>(null);
  const awaitedListed = !!awaitingRun && !!repo?.runs.some((r) => r.head_sha === awaitingRun);
  useEffect(() => {
    if (!awaitingRun || awaitedListed) return;
    const startedAt = Date.now();
    void refresh();
    const timer = setInterval(() => {
      if (Date.now() - startedAt > AWAIT_RUN_MS) setAwaitingRun(null);
      else void refresh();
    }, AWAIT_RUN_POLL_MS);
    return () => clearInterval(timer);
    // refresh changes with each repository state; the timer only needs to start once per save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awaitingRun, awaitedListed]);

  const openTarget = (next: FlashTarget) => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setTarget(next);
  };

  const closeTarget = () => {
    setTarget(null);
    const el = returnFocus.current;
    if (el?.isConnected) requestAnimationFrame(() => el.focus());
  };

  const repoUrl = repo ? `https://github.com/${repoName(repo.ref)}` : '';
  const keymapBuild = (keymapId && repo?.manifest?.builds.find((b) => b.id === keymapId)) || null;
  const noRepo: Localized | undefined = repo ? undefined : msg('why.noRepo');
  const latestRun = repo?.runs[0];
  // Why a firmware cannot be flashed right now, if it cannot.
  const flashBlocked: Localized | undefined = !serialOk
    ? msg('app.noSerial')
    : target
      ? msg('why.flashing')
      : undefined;

  useCommand({
    id: 'repo.connect',
    words: 'connect',
    title: msg('cmd.connect'),
    group: 'group.repo',
    args: [
      {
        name: 'repo',
        required: true,
        hint: msg('cmd.connect.hint'),
        complete: () =>
          [...new Set([load('keyballer.repo'), repoInput.trim()])].filter(Boolean).map((value) => ({ value })),
        check: (value) => (parseRepo(value) ? undefined : msg('repo.invalid')),
      },
    ],
    run: ({ repo: value }) => {
      setRepoInput(value);
      void connect(value);
    },
  });
  useCommand({
    id: 'repo.field',
    words: 'repo',
    title: msg('shortcut.focusRepo'),
    group: 'group.repo',
    unavailable: keymapBuild ? msg('why.onKeymap') : undefined,
    run: () => repoField.current?.focus(),
  });
  useCommand({
    id: 'repo.refresh',
    words: 'refresh',
    title: msg('shortcut.refresh'),
    group: 'group.repo',
    shortcut: 'r',
    unavailable: noRepo,
    run: () => void refresh(),
  });
  useCommand({
    id: 'repo.open',
    words: 'open repo',
    title: msg('cmd.openRepo'),
    group: 'group.repo',
    unavailable: noRepo,
    run: () => window.open(repoUrl, '_blank', 'noopener'),
  });
  useCommand({
    id: 'build.open',
    words: 'open build',
    title: msg('cmd.openBuild'),
    group: 'group.repo',
    unavailable: noRepo ?? (latestRun ? undefined : msg('why.noRun')),
    run: () => window.open(latestRun!.html_url, '_blank', 'noopener'),
  });
  useCommand({
    id: 'app.language',
    words: 'language',
    title: msg('cmd.language'),
    group: 'group.app',
    args: [
      {
        name: 'language',
        required: true,
        hint: msg('cmd.language.hint'),
        complete: () => [
          { value: 'english', detail: 'English' },
          { value: 'japanese', detail: '日本語' },
        ],
        check: (value) => (toLang(value) ? undefined : msg('cmd.language.bad')),
      },
    ],
    run: ({ language }) => {
      const next = toLang(language);
      if (!next) throw new CommandRefused(msg('cmd.language.bad'));
      setLang(next);
    },
  });
  useCommand({
    id: 'app.shortcuts',
    words: 'shortcuts',
    title: msg('cmd.shortcuts'),
    group: 'group.app',
    run: openHelp,
  });

  const openBuild = async (build: FirmwareBuild) => {
    if (!repo?.firmwareSha) return;
    setLoadingBuild(build.id);
    setError(null);
    try {
      // Only firmware that GitHub Actions built from the default branch, checked byte for byte.
      const lastFlashed = load(flashedKey(repo.ref));
      const verified = await loadVerifiedFirmware(repo.ref, repo.firmwareSha, build.id, tokenRef.current, lastFlashed);
      openTarget({ title: verified.build.name, image: verified.image, split: verified.build.split, source: verified.source });
    } catch (e) {
      setError(e);
    } finally {
      setLoadingBuild('');
    }
  };

  return (
    <div className={keymapBuild ? 'app wide' : 'app'}>
      <header className="top">
        <div className="stack">
          <div className="brand">
            <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true">
              <rect x="2" y="9" width="20" height="14" rx="3" fill="var(--text)" />
              <circle cx="24" cy="16" r="7" fill="var(--ball)" />
            </svg>
            <h1>Keyballer</h1>
          </div>
          <p className="tagline">{t('app.tagline')}</p>
        </div>
        <div className="top-links">
          <button type="button" onClick={openLine} aria-keyshortcuts="Meta+K Control+K /">
            {t('line.open')}
            <Kbd>{lineChord()}</Kbd>
          </button>
          <LanguageSwitch />
          <a className="muted" href="https://github.com/AkiraMisawa/keyballer" target="_blank" rel="noreferrer">
            GitHub
          </a>
        </div>
      </header>

      {!serialOk && (
        <p className="banner err" role="alert">
          {t('app.noSerial')}
        </p>
      )}

      {!keymapBuild && (
        <section className="panel" aria-labelledby="repo-title">
          <h2 id="repo-title">{t('repo.title')}</h2>
          {askRepo && (
            <div className="banner stack" role="alertdialog" aria-labelledby="link-repo-title" aria-describedby="link-repo-body">
              <p id="link-repo-title">
                {t('repo.linkAsk', { repo: askRepo })}
              </p>
              <p id="link-repo-body" className="note">
                {t('repo.linkWhy')}
              </p>
              <div className="row">
                <button
                  type="button"
                  onClick={() => {
                    const next = askRepo;
                    setAskRepo(null);
                    dropRepoParam();
                    setRepoInput(next);
                    void connect(next);
                  }}
                >
                  {t('repo.linkOpen', { repo: askRepo })}
                </button>
                <button
                  type="button"
                  className="primary"
                  ref={keepRepoButton}
                  onClick={() => {
                    setAskRepo(null);
                    dropRepoParam();
                  }}
                >
                  {repoInput ? t('repo.linkKeep', { repo: repoInput }) : t('repo.linkIgnore')}
                </button>
              </div>
            </div>
          )}
          <form
            className="repo-form"
            onSubmit={(e) => {
              e.preventDefault();
              void connect(repoInput);
            }}
          >
            <label htmlFor="repo" className="sr-only">
              {t('repo.title')}
            </label>
            <input
              ref={repoField}
              id="repo"
              type="text"
              value={repoInput}
              onChange={(e) => setRepoInput(e.target.value)}
              placeholder={t('repo.placeholder')}
              autoComplete="off"
              spellCheck={false}
            />
            <button type="submit" className="primary" disabled={connecting}>
              {connecting ? t('repo.connecting') : t('repo.connect')}
            </button>
          </form>
          <details className="token">
            <summary>{t('token.summary')}</summary>
            <div className="stack">
              <p className="note">{t('token.note')}</p>
              <input
                id="token"
                type="password"
                value={token}
                onChange={(e) => {
                  setToken(e.target.value.trim());
                  save('keyballer.token', e.target.value.trim());
                }}
                placeholder="github_pat_…"
                autoComplete="off"
              />
            </div>
          </details>
          {error !== null && (
            <p className="err" role="alert">
              {err(error)}
            </p>
          )}
        </section>
      )}

      {repo?.manifest &&
        repo.manifest.builds.map((b, i) => (
          <KeymapCommand
            key={b.id}
            build={b}
            shortcut={i === 0 && !keymapBuild ? KEYMAP_SHORTCUT : undefined}
            onOpen={() => openKeymap(b.id)}
          />
        ))}

      {repo && keymapBuild && repo.manifest && repo.firmwareSha && (
        <KeymapScreen
          key={keymapBuild.id}
          build={keymapBuild}
          repo={repo.ref}
          firmwareSha={repo.firmwareSha}
          manifest={repo.manifest}
          token={token}
          buildsUrl={`${repoUrl}/actions/workflows/build.yml`}
          onClose={closeKeymap}
          onSaved={(sha) => setAwaitingRun(sha)}
          onToken={(next) => {
            setToken(next);
            save('keyballer.token', next);
          }}
          runFor={(sha) => repo.runs.find((r) => r.head_sha === sha)}
          setLeaveGuard={(guard) => {
            leaveGuard.current = guard;
          }}
        />
      )}

      {repo && !keymapBuild && (
        <>
          <BuildStatus
            repoUrl={repoUrl}
            manifest={repo.manifest}
            runs={repo.runs}
            refreshing={refreshing}
            onRefresh={() => void refresh()}
          />

          {repo.manifest && (
            <section aria-labelledby="fw-title" className="stack">
              <h2 id="fw-title">{t('firmware.title')}</h2>
              <div className="cards">
                {repo.manifest.builds.map((b, i) => (
                  <FirmwareCard
                    key={b.id}
                    build={b}
                    index={i}
                    blocked={flashBlocked}
                    loading={loadingBuild === b.id}
                    onFlash={() => void openBuild(b)}
                    onKeymap={() => openKeymap(b.id)}
                    keymapShortcut={i === 0 ? KEYMAP_SHORTCUT : undefined}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {target && (
        <FlashPanel
          key={target.title}
          title={target.title}
          image={target.image}
          split={target.split}
          source={target.source}
          onFlashed={() => {
            // Remembered so the next flash can show what changed since (not a secret).
            if (target.source && repo) save(flashedKey(repo.ref), target.source.sha);
          }}
          onClose={closeTarget}
        />
      )}

      {serialOk && !keymapBuild && (
        <LocalFirmware
          disabled={!!target}
          onReady={(name, image, split) => openTarget({ title: name, image, split })}
        />
      )}

      <footer className="muted stack">
        <p>
          {rich('shortcut.hint', {
            slash: <Kbd>/</Kbd>,
            chord: <Kbd>{lineChord()}</Kbd>,
            key: <Kbd>?</Kbd>,
          })}
        </p>
        <p>{t('app.footer')}</p>
      </footer>
    </div>
  );
}
