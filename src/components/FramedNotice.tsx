// What Keyballer shows when another page has put it in a frame (see main.tsx).

import { useI18n } from '../i18n/react';

export function FramedNotice() {
  const { t } = useI18n();
  return (
    <main className="app">
      <section className="panel stack">
        <h1>Keyballer</h1>
        <p>{t('framed.body')}</p>
        <p>
          <a href={location.href} target="_blank" rel="noopener noreferrer">
            {t('framed.open')}
          </a>
        </p>
      </section>
    </main>
  );
}
