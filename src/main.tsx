import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { FramedNotice } from './components/FramedNotice';
import { I18nProvider } from './i18n/react';
import { CommandProvider } from './commands/react';
import './styles.css';

// Inside a frame, any click could be someone else's: flashing, saving and signing in can all be
// clickjacked, and GitHub Pages cannot send frame-ancestors. So a framed Keyballer renders only a
// way out. window.top cannot be faked by the framing page.
const framed = window.top !== window.self;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      {framed ? (
        <FramedNotice />
      ) : (
        <CommandProvider>
          <App />
        </CommandProvider>
      )}
    </I18nProvider>
  </StrictMode>,
);
