import { useCallback, useEffect, useRef, useState } from 'react';
import { BuildStatus } from './components/BuildStatus';
import { FirmwareCard } from './components/FirmwareCard';
import { FlashPanel } from './components/FlashPanel';
import { LocalFirmware } from './components/LocalFirmware';
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
  const serialOk = isWebSerialSupported();
  const [repoInput, setRepoInput] = useState(initialRepo);
  const [token, setToken] = useState(() => load('keyballer.token'));
  const [repo, setRepo] = useState<RepoState | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [loadingBuild, setLoadingBuild] = useState('');
  const [target, setTarget] = useState<FlashTarget | null>(null);
  const tokenRef = useRef(token);
  tokenRef.current = token;

  const fetchState = useCallback(async (ref: RepoRef): Promise<RepoState> => {
    const t = tokenRef.current;
    const [firmwareSha, runs] = await Promise.all([getFirmwareHead(ref, t), getBuildRuns(ref, t)]);
    const manifest = firmwareSha ? await getManifest(ref, firmwareSha, t) : null;
    return { ref, firmwareSha, manifest, runs };
  }, []);

  const connect = useCallback(
    async (input: string) => {
      const ref = parseRepo(input);
      if (!ref) {
        setError('「owner/repo」の形で入力してください（例：AkiraMisawa/keyballer-config）');
        return;
      }
      setConnecting(true);
      setError('');
      try {
        await checkRepo(ref, tokenRef.current);
        setRepo(await fetchState(ref));
        save('keyballer.repo', repoName(ref));
      } catch (e) {
        setRepo(null);
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setConnecting(false);
      }
    },
    [fetchState],
  );

  const refresh = useCallback(async () => {
    if (!repo) return;
    setRefreshing(true);
    setError('');
    try {
      setRepo(await fetchState(repo.ref));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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

  const openBuild = async (build: FirmwareBuild) => {
    if (!repo?.firmwareSha) return;
    setLoadingBuild(build.id);
    setError('');
    try {
      const text = await getFirmwareText(repo.ref, repo.firmwareSha, build.file, tokenRef.current);
      const { data } = parseIntelHex(text);
      setTarget({ title: build.name, image: data, split: build.split });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingBuild('');
    }
  };

  const repoUrl = repo ? `https://github.com/${repoName(repo.ref)}` : '';

  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>
            Keyballer
          </h1>
          <p className="tagline">GitHub でビルドしたキーボードのファームウェアを、ブラウザから書き込みます。</p>
        </div>
        <a className="muted" href="https://github.com/AkiraMisawa/keyballer" target="_blank" rel="noreferrer">
          GitHub
        </a>
      </header>

      {!serialOk && (
        <p className="banner err" role="alert">
          このブラウザは USB での書き込みに対応していません。パソコンの Chrome か Edge で開いてください。
        </p>
      )}

      <section className="panel" aria-labelledby="repo-title">
        <h2 id="repo-title">設定リポジトリ</h2>
        <form
          className="repo-form"
          onSubmit={(e) => {
            e.preventDefault();
            void connect(repoInput);
          }}
        >
          <label htmlFor="repo" className="sr-only">
            設定リポジトリ
          </label>
          <input
            id="repo"
            type="text"
            value={repoInput}
            onChange={(e) => setRepoInput(e.target.value)}
            placeholder="owner/repo（例：AkiraMisawa/keyballer-config）"
            autoComplete="off"
            spellCheck={false}
          />
          <button type="submit" className="primary" disabled={connecting}>
            {connecting ? '接続中…' : '接続'}
          </button>
        </form>
        <details className="token">
          <summary>非公開リポジトリを使う（トークン）</summary>
          <div className="stack">
            <p className="note">
              対象のリポジトリだけを選び、Contents と Actions を「読み取り」にした fine-grained token を貼り付けてください。このブラウザの中にだけ保存されます。
            </p>
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
        {error && (
          <p className="err" role="alert">
            {error}
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
              <h2 id="fw-title">ファームウェア</h2>
              <div className="cards">
                {repo.manifest.builds.map((b) => (
                  <FirmwareCard
                    key={b.id}
                    build={b}
                    canFlash={serialOk && !target}
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
          onClose={() => setTarget(null)}
        />
      )}

      {serialOk && (
        <LocalFirmware
          disabled={!!target}
          onReady={(name, image, split) => setTarget({ title: name, image, split })}
        />
      )}

      <footer className="muted">
        書き込みには Chrome / Edge の Web Serial を使います。ファームウェアはこのページから直接キーボードに送られ、外部には送信されません。
      </footer>
    </div>
  );
}
