import { useCallback, useEffect, useRef, useState } from 'react';
import { BuildStatus } from './components/BuildStatus';
import { FirmwareCard } from './components/FirmwareCard';
import { FlashPanel } from './components/FlashPanel';
import { LanguageSwitch } from './components/LanguageSwitch';
import { LocalFirmware } from './components/LocalFirmware';
import { LocalizedError, msg } from './i18n/core';
import { useI18n } from './i18n/react';
import {
  checkRepo,
  getBuildRuns,
  getFirmwareHead,
  getFirmwareText,
  getManifest,
  parseRepo,
  repoName,
  type RepoRef,
  type WorkflowRun,
} from './lib/github';
import { parseIntelHex } from './lib/ihex';
import type { FirmwareBuild, FirmwareManifest } from './lib/manifest';
import { isWebSerialSupported } from './lib/serial';
import { load, save } from './lib/storage';
import { Kbd, useShortcut } from './shortcuts';

interface FlashTarget {
  title: string;
  image: Uint8Array;
  split: boolean;
}

interface RepoState {
  ref: RepoRef;
  firmwareSha: string | null;
  manifest: FirmwareManifest | null;
  runs: WorkflowRun[];
}

const POLL_MS = 30_000;

function initialRepo(): string {
  const fromUrl = new URLSearchParams(location.search).get('repo');
  return fromUrl ?? load('keyballer.repo');
}

export function App() {
  const { t, rich, err } = useI18n();
  const serialOk = isWebSerialSupported();
  const [repoInput, setRepoInput] = useState(initialRepo);
  const [token, setToken] = useState(() => load('keyballer.token'));
  const [repo, setRepo] = useState<RepoState | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [loadingBuild, setLoadingBuild] = useState('');
  const [target, setTarget] = useState<FlashTarget | null>(null);
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

  const openTarget = (next: FlashTarget) => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setTarget(next);
  };

  const closeTarget = () => {
    setTarget(null);
    const el = returnFocus.current;
    if (el?.isConnected) requestAnimationFrame(() => el.focus());
  };

  useShortcut('/', msg('shortcut.focusRepo'), () => repoField.current?.focus());
  useShortcut('r', msg('shortcut.refresh'), () => void refresh(), !!repo && !refreshing && !target);

  const openBuild = async (build: FirmwareBuild) => {
    if (!repo?.firmwareSha) return;
    setLoadingBuild(build.id);
    setError(null);
    try {
      const text = await getFirmwareText(repo.ref, repo.firmwareSha, build.file, tokenRef.current);
      const { data } = parseIntelHex(text);
      openTarget({ title: build.name, image: data, split: build.split });
    } catch (e) {
      setError(e);
    } finally {
      setLoadingBuild('');
    }
  };

  const repoUrl = repo ? `https://github.com/${repoName(repo.ref)}` : '';

  return (
    <div className="app">
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

      <section className="panel" aria-labelledby="repo-title">
        <h2 id="repo-title">{t('repo.title')}</h2>
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

      {repo && (
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
                    canStart={serialOk && !target}
                    loading={loadingBuild === b.id}
                    onFlash={() => void openBuild(b)}
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
          onClose={closeTarget}
        />
      )}

      {serialOk && (
        <LocalFirmware
          disabled={!!target}
          onReady={(name, image, split) => openTarget({ title: name, image, split })}
        />
      )}

      <footer className="muted stack">
        <p>{rich('shortcut.hint', { key: <Kbd>?</Kbd> })}</p>
        <p>{t('app.footer')}</p>
      </footer>
    </div>
  );
}
