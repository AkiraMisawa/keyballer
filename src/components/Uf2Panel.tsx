// Flashing a ZMK keyboard (docs/plans/zmk.md, phase 1): the bootloader shows the keyboard as a USB
// drive, and copying a UF2 file onto it flashes it. A page cannot write to that drive yet (phase 2),
// so the panel offers the checked bytes as a download and says how to copy them, half by half, with
// the settings reset as a separate "fix pairing" step.

import { useEffect, useRef, useState } from 'react';
import { Kbd } from '../commands/keys';
import { useCommand } from '../commands/react';
import { msg } from '../i18n/core';
import { useI18n } from '../i18n/react';
import type { FirmwareSource } from '../lib/firmware';
import type { ZmkBuild } from '../lib/manifest';
import { SourceNote } from './SourceNote';

/** Saves bytes as a file through the browser's download. */
function saveFile(name: string, bytes: Uint8Array) {
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

interface Props {
  build: ZmkBuild;
  /** The UF2 file, checked against the build's record. */
  bytes: Uint8Array;
  source: FirmwareSource;
  /** The other builds of the same keyboard: the other half, the settings reset. */
  group: ZmkBuild[];
  /** Loads and checks another build of the group (the settings reset). */
  loadBuild: (build: ZmkBuild) => Promise<Uint8Array>;
  onClose: () => void;
}

export function Uf2Panel({ build, bytes, source, group, loadBuild, onClose }: Props) {
  const { t, err } = useI18n();
  const heading = useRef<HTMLHeadingElement>(null);
  const [downloaded, setDownloaded] = useState('');
  const [resetError, setResetError] = useState<unknown>(null);
  const [loadingReset, setLoadingReset] = useState(false);
  useEffect(() => heading.current?.focus(), []);

  const central = group.find((b) => b.role === 'central');
  const reset = group.find((b) => b.role === 'settings_reset');
  const split = build.role === 'central' || build.role === 'peripheral';

  const download = () => {
    saveFile(build.file, bytes);
    setDownloaded(build.file);
  };
  const downloadReset = async () => {
    if (!reset) return;
    setLoadingReset(true);
    setResetError(null);
    try {
      saveFile(reset.file, await loadBuild(reset));
      setDownloaded(reset.file);
    } catch (e) {
      setResetError(e);
    } finally {
      setLoadingReset(false);
    }
  };

  useCommand({ id: 'zmk.download', words: 'download firmware', title: msg('cmd.download'), group: 'group.flash', shortcut: 'd', run: download });
  useCommand({
    id: 'zmk.downloadReset',
    words: 'download reset',
    title: msg('cmd.downloadReset'),
    group: 'group.flash',
    unavailable: !reset ? msg('why.noReset') : loadingReset ? msg('why.loading') : undefined,
    run: () => void downloadReset(),
  });
  useCommand({ id: 'flash.close', words: 'close', title: msg('shortcut.back'), group: 'group.flash', shortcut: 'Escape', run: onClose });

  return (
    <section className="panel flash" aria-labelledby="uf2-title">
      <div className="panel-head">
        <h2 id="uf2-title" ref={heading} tabIndex={-1}>
          {t('flash.title', { name: build.name })}
        </h2>
        <button type="button" className="ghost" onClick={onClose} aria-keyshortcuts="Escape">
          {t('common.close')}
        </button>
      </div>

      <SourceNote source={source} />

      {split && central && <p className="note">{t('zmk.splitNote', { central: central.name })}</p>}

      <ol className="steps">
        <li>{t('zmk.step.connect', { name: build.name })}</li>
        <li>{t('zmk.step.bootloader')}</li>
        <li>
          <div className="stack">
            <span>{t('zmk.step.copy')}</span>
            <div className="row">
              <button type="button" className="primary" onClick={download} aria-keyshortcuts="D">
                {t('zmk.download', { file: build.file })}
                <Kbd>D</Kbd>
              </button>
            </div>
          </div>
        </li>
        <li>{t('zmk.step.restart')}</li>
      </ol>
      {downloaded && (
        <p className="note" role="status">
          {t('zmk.downloaded', { file: downloaded })}
        </p>
      )}

      {reset && (
        <details>
          <summary>{t('zmk.reset.summary')}</summary>
          <div className="stack">
            <p className="note">{t('zmk.reset.why')}</p>
            <ol className="steps">
              <li>{t('zmk.reset.step1')}</li>
              <li>{t('zmk.reset.step2')}</li>
              <li>{t('zmk.reset.step3')}</li>
            </ol>
            <div className="row">
              <button type="button" onClick={() => void downloadReset()} disabled={loadingReset}>
                {loadingReset ? t('card.loading') : t('zmk.reset.download')}
              </button>
            </div>
            {resetError !== null && (
              <p className="err" role="alert">
                {err(resetError)}
              </p>
            )}
          </div>
        </details>
      )}
    </section>
  );
}
