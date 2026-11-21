// Translation core without React, so library code can raise translatable
// errors and log lines that the UI renders in the current language.

import { en, ja, type MessageKey } from './messages';

export type Lang = 'ja' | 'en';
export const LANGS: Lang[] = ['en', 'ja'];

export const isLang = (value: string | null | undefined): value is Lang =>
  value === 'en' || value === 'ja';

export type Param = string | number | Localized;
export type Params = Record<string, Param>;

/** A message that is translated when shown. */
export interface Localized {
  key: MessageKey;
  params?: Params;
}

export const msg = (key: MessageKey, params?: Params): Localized => ({ key, params });

const catalogs: Record<Lang, Record<MessageKey, string>> = { ja, en };

const isLocalized = (p: Param): p is Localized => typeof p === 'object' && p !== null;

export function translate(lang: Lang, key: MessageKey, params?: Params): string {
  const template = catalogs[lang][key] ?? key;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params?.[name];
    if (value === undefined) return whole;
    if (isLocalized(value)) return translate(lang, value.key, value.params);
    return typeof value === 'number' ? value.toLocaleString(lang === 'ja' ? 'ja-JP' : 'en-US') : value;
  });
}

/** An error whose text is chosen at display time. `message` is the English text. */
export class LocalizedError extends Error {
  constructor(
    readonly key: MessageKey,
    readonly params?: Params,
  ) {
    super(translate('en', key, params));
  }
}

export function errorText(lang: Lang, e: unknown): string {
  if (e instanceof LocalizedError) return translate(lang, e.key, e.params);
  if (e instanceof Error) return e.message;
  return String(e);
}

/** English unless `?lang=` or a saved choice says otherwise. */
export function detectLang(fromUrl: string | null, saved: string): Lang {
  if (isLang(fromUrl)) return fromUrl;
  if (isLang(saved)) return saved;
  return 'en';
}
