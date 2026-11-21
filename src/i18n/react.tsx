import { createContext, Fragment, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { load, save } from '../lib/storage';
import { detectLang, errorText, translate, type Lang, type Localized, type Params } from './core';
import type { MessageKey } from './messages';

interface I18n {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: MessageKey, params?: Params) => string;
  /** Like t, but placeholders can be React elements such as links. */
  rich: (key: MessageKey, nodes: Record<string, ReactNode>) => ReactNode;
  show: (m: Localized) => string;
  err: (e: unknown) => string;
}

const Ctx = createContext<I18n | null>(null);

const STORAGE_KEY = 'keyballer.lang';

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() =>
    detectLang(load(STORAGE_KEY), typeof navigator === 'undefined' ? [] : navigator.languages),
  );

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const value = useMemo<I18n>(() => {
    const t = (key: MessageKey, params?: Params) => translate(lang, key, params);
    return {
      lang,
      setLang: (next) => {
        save(STORAGE_KEY, next);
        setLangState(next);
      },
      t,
      rich: (key, nodes) => {
        const parts = translate(lang, key).split(/\{(\w+)\}/);
        return parts.map((part, i) => (
          <Fragment key={i}>{i % 2 === 1 ? (nodes[part] ?? `{${part}}`) : part}</Fragment>
        ));
      },
      show: (m) => t(m.key, m.params),
      err: (e) => errorText(lang, e),
    };
  }, [lang]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const value = useContext(Ctx);
  if (!value) throw new Error('useI18n must be used inside I18nProvider');
  return value;
}
