import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { I18nProvider } from './i18n/react';
import { CommandProvider } from './commands/react';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <CommandProvider>
        <App />
      </CommandProvider>
    </I18nProvider>
  </StrictMode>,
);
