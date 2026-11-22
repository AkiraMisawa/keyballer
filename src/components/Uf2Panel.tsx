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
import { shortSha } from '../lib/format';
import type { ZmkBuild } from '../lib/manifest';
import { PanelHead } from './PanelHead';
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
  /** All builds of this keyboard, in flashing order (manifest.ts, keyboardOf). */
  keyboard: ZmkBuild[];
  /** Where the build's resolved west manifest, with every pin, can be read. */
  pinsUrl: string;
  /** Loads and checks another build of the keyboard (the settings reset), from the same firmware. */
  loadBuild: (build: ZmkBuild) => Promise<Uint8Array>;
  onClose: () => void;
}

export function Uf2Panel({ build, bytes, source, keyboard, pinsUrl, loadBuild, onClose }: Props) {
  const { t, err } = useI18n();
  const downloadButton = useRef<HTMLButtonElement>(null);
  const [downloaded, setDownloaded] = useState('');
  const [resetError, setResetError] = useState<unknown>(null);
  const [loadingReset, setLoadingReset] = useState(false);
  // Focus moves on (DESIGN.md §8): to the download, the panel's next step.
  useEffect(() => downloadButton.current?.focus(), []);

  const halves = keyboard.filter((b) => b.role === 'central' || b.role === 'peripheral');
  const central = halves.find((b) => b.role === 'central');
  const reset = keyboard.find((b) => b.role === 'settings_reset');

  /** Says what was saved; cleared first, so saving the same file again is announced again. */
  const saved = (file: string) => {
    setDownloaded('');
    requestAnimationFrame(() => setDownloaded(file));
  };
  const download = () => {
    saveFile(build.file, bytes);
    saved(build.file);
  };
  const downloadReset = async () => {
    if (!reset) return;
    setLoadingReset(true);
    setResetError(null);
    try {
      saveFile(reset.file, await loadBuild(reset));
      saved(reset.file);
    } catch (e) {
      setResetError(e);
    } finally {
      setLoadingReset(false);
    }
  };

  useCommand({
    id: 'zmk.download',
    words: 'download firmware',
    title: msg('cmd.download'),
    group: 'group.flash',
    page: true,
    shortcut: 'd',
    run: download,
  });
  useCommand({
    id: 'zmk.downloadReset',
    words: 'download reset',
    title: msg('cmd.downloadReset'),
    group: 'group.flash',
    page: true,
    unavailable: !reset ? msg('why.noReset') : loadingReset ? msg('why.loading') : undefined,
    run: () => void downloadReset(),
  });
  useCommand({ id: 'flash.close', words: 'close', title: msg('shortcut.back'), group: 'group.flash', page: true, shortcut: 'Escape', run: onClose });

  return (
    <section className="panel flash" aria-labelledby="uf2-title">
      <PanelHead id="uf2-title" title={t('flash.title', { name: build.name })} onClose={onClose} />

      <SourceNote source={source} />
      <p className="note">
        {t('zmk.pins', { zmk: build.zmk_sha ? shortSha(build.zmk_sha) : '?', zephyr: build.zephyr_sha ? shortSha(build.zephyr_sha) : '?' })}{' '}
        <a href={pinsUrl} target="_blank" rel="noreferrer">
          {t('zmk.allPins')}
        </a>
      </p>

      {halves.length > 1 && central && (
        <>
          <ol className="halves" aria-label={t('flash.halves')}>
            {halves.map((b) => (
              <li key={b.id} className={b.id === build.id ? 'current' : ''}>
                {b.name}
              </li>
            ))}
          </ol>
          <p className="note">{t('zmk.splitNote', { central: central.name })}</p>
        </>
      )}

      <ol className="steps">
        <li>{t('zmk.step.connect', { name: build.name })}</li>
        <li>{t('zmk.step.bootloader')}</li>
        <li>
          <div className="stack">
            <span>{t('zmk.step.copy')}</span>
            <div className="row">
              <button ref={downloadButton} type="button" className="primary" onClick={download} aria-keyshortcuts="D">
                {t('zmk.download', { file: build.file })}
                <Kbd>D</Kbd>
              </button>
            </div>
          </div>
        </li>
        <li>{t('zmk.step.restart')}</li>
      </ol>
      <p className="note" role="status">
        {downloaded && t('zmk.downloaded', { file: downloaded })}
      </p>

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
              <button type="button" onClick={() => void downloadReset()} disabled={loadingReset} aria-busy={loadingReset}>
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
