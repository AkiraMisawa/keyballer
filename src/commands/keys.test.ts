import { describe, expect, it } from 'vitest';
import { isLineChord, keyLabel, shouldHandle } from './keys';

type Flags = 'isComposing' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'defaultPrevented';

const key = (k: string, extra: Partial<Record<Flags, boolean>> = {}) => ({
  key: k,
  isComposing: false,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
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

  it('does nothing while a modal is open', () => {
    expect(shouldHandle(key('Escape'), false, true)).toBe(false);
  });

  it('skips keys another handler already used', () => {
    expect(shouldHandle(key('r', { defaultPrevented: true }), false, false)).toBe(false);
  });
});

describe('isLineChord', () => {
  it('is Cmd+K or Ctrl+K', () => {
    expect(isLineChord(key('k', { metaKey: true }))).toBe(true);
    expect(isLineChord(key('K', { ctrlKey: true }))).toBe(true);
  });

  it('is not K alone, or with Shift or Alt, or while composing', () => {
    expect(isLineChord(key('k'))).toBe(false);
    expect(isLineChord(key('k', { metaKey: true, shiftKey: true }))).toBe(false);
    expect(isLineChord(key('k', { ctrlKey: true, altKey: true }))).toBe(false);
    expect(isLineChord(key('k', { metaKey: true, isComposing: true }))).toBe(false);
  });
});

describe('keyLabel', () => {
  it('prints keys the way keycaps do', () => {
    expect(keyLabel('Escape')).toBe('Esc');
    expect(keyLabel('p')).toBe('P');
    expect(keyLabel('/')).toBe('/');
  });
});
