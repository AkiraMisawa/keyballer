import type { Lang } from '../i18n/core';

const locale = (lang: Lang) => (lang === 'ja' ? 'ja-JP' : 'en-US');

export const shortSha = (sha: string) => sha.slice(0, 7);

export function formatDateTime(iso: string, lang: Lang): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(locale(lang), {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const formatBytes = (n: number, lang: Lang) => n.toLocaleString(locale(lang));

const PROCESSORS: Record<string, string> = {
  atmega32u4: 'ATmega32U4',
  RP2040: 'RP2040',
};

/** Product names; `fallback` is shown when the value is missing. */
export const processorLabel = (p: string | null, fallback: string) =>
  p ? (PROCESSORS[p] ?? p) : fallback;

const BOOTLOADERS: Record<string, string> = {
  caterina: 'Caterina',
  'atmel-dfu': 'Atmel DFU',
  rp2040: 'RP2040 UF2',
};

export const bootloaderLabel = (b: string | null, fallback: string) =>
  b ? (BOOTLOADERS[b] ?? b) : fallback;
