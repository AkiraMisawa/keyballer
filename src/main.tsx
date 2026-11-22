import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { FramedNotice } from './components/FramedNotice';
import { I18nProvider } from './i18n/react';
import { CommandProvider } from './commands/react';
import { forgetStoredToken } from './lib/token';
import './styles.css';

// Inside a frame, any click could be someone else's: flashing, saving and signing in can all be
// clickjacked, and GitHub Pages cannot send frame-ancestors. So a framed Keyballer renders only a
// way out. window.top cannot be faked by the framing page.
const framed = window.top !== window.self;

/** localStorage, or nothing where the browser blocks it (reading the property itself can throw). */
function browserStorage(): Storage | undefined {
  try {
    return localStorage;
  } catch {
    return undefined;
  }
}

// Older versions saved the token in localStorage. Delete it once, before anything renders, and
// say so on the page: only the owner can revoke it. Not when framed, where no one would see it.
const forgottenToken = framed ? null : forgetStoredToken(browserStorage());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      {framed ? (
        <FramedNotice />
      ) : (
        <CommandProvider>
          <App forgottenToken={forgottenToken} />
        </CommandProvider>
      )}
    </I18nProvider>
  </StrictMode>,
);
