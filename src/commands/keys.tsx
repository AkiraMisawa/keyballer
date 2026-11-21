// Deciding which key presses belong to the app, and drawing key names.

import type { ReactNode } from 'react';

/** True while the user is typing into a field, where letters must stay letters. */
export function isTyping(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) {
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'range', 'color'].includes(target.type);
  }
  return false;
}

type KeyInfo = Pick<KeyboardEvent, 'key' | 'isComposing' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'defaultPrevented'>;

/** Whether a keydown should be handled as a single-key shortcut at all. */
export function shouldHandle(e: KeyInfo, typing: boolean, modalOpen: boolean): boolean {
  if (e.defaultPrevented || e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return false;
  // A modal (the command line, the shortcut list) handles its own keys.
  if (modalOpen) return false;
  return e.key === 'Escape' || !typing;
}

/** ⌘K on Mac, Ctrl+K elsewhere: opens the command line, even from a text field. */
export function isLineChord(e: KeyInfo): boolean {
  return (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && !e.isComposing && e.key.toLowerCase() === 'k';
}

export function isMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform ??
    '';
  return /mac|iphone|ipad/i.test(platform);
}

/** The chord that opens the command line, as printed for this computer. */
export const lineChord = () => (isMac() ? '⌘K' : 'Ctrl+K');

/** A key as printed on keycaps: Esc, not Escape; P, not p. */
export const keyLabel = (key: string) =>
  key === 'Escape' ? 'Esc' : key.length === 1 ? key.toUpperCase() : key;

/** A key name drawn like a small keycap (DESIGN.md §5, §8). */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="key">{children}</kbd>;
}
