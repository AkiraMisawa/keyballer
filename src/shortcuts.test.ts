import { describe, expect, it } from 'vitest';
import { keyLabel, shouldHandle } from './shortcuts';

const key = (k: string, extra: Partial<KeyboardEvent> = {}) => ({
  key: k,
  isComposing: false,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  defaultPrevented: false,
  ...extra,
});

describe('shouldHandle', () => {
  it('handles a plain key outside text fields', () => {
    expect(shouldHandle(key('r'), false, false)).toBe(true);
  });

  it('leaves letters alone while typing in a field', () => {
    expect(shouldHandle(key('r'), true, false)).toBe(false);
  });

  it('still handles Esc while typing', () => {
    expect(shouldHandle(key('Escape'), true, false)).toBe(true);
  });

  it('ignores keys during IME composition', () => {
    expect(shouldHandle(key('r', { isComposing: true }), false, false)).toBe(false);
  });

  it('leaves browser and OS shortcuts alone', () => {
    expect(shouldHandle(key('r', { metaKey: true }), false, false)).toBe(false);
    expect(shouldHandle(key('r', { ctrlKey: true }), false, false)).toBe(false);
    expect(shouldHandle(key('r', { altKey: true }), false, false)).toBe(false);
  });

  it('does nothing while the help dialog is open', () => {
    expect(shouldHandle(key('Escape'), false, true)).toBe(false);
  });

  it('skips keys another handler already used', () => {
    expect(shouldHandle(key('r', { defaultPrevented: true }), false, false)).toBe(false);
  });
});

describe('keyLabel', () => {
  it('prints keys the way keycaps do', () => {
    expect(keyLabel('Escape')).toBe('Esc');
    expect(keyLabel('p')).toBe('P');
    expect(keyLabel('/')).toBe('/');
  });
});
