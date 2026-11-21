import { LANGS, type Lang } from '../i18n/core';
import { useI18n } from '../i18n/react';

// Each language is labelled in itself, so it can be found from either one.
const NAMES: Record<Lang, string> = { ja: '日本語', en: 'English' };

export function LanguageSwitch() {
  const { lang, setLang, t } = useI18n();
  return (
    <div className="seg" role="group" aria-label={t('app.language')}>
      {LANGS.map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          aria-pressed={lang === l}
          onClick={() => setLang(l)}
        >
          {NAMES[l]}
        </button>
      ))}
    </div>
  );
}
