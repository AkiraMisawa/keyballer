import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { I18nProvider } from './i18n/react';
import { ShortcutProvider } from './shortcuts';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <ShortcutProvider>
        <App />
      </ShortcutProvider>
    </I18nProvider>
  </StrictMode>,
);
