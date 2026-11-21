import { describe, expect, it } from 'vitest';
import { detectLang, errorText, LocalizedError, msg, translate } from './core';
import { en, ja, type MessageKey } from './messages';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('messages', () => {
  it('uses the same placeholders in Japanese and English', () => {
    for (const key of Object.keys(ja) as MessageKey[]) {
      expect(placeholders(en[key]), key).toEqual(placeholders(ja[key]));
    }
  });

  it('has no empty translations', () => {
    for (const key of Object.keys(ja) as MessageKey[]) {
      expect(ja[key].trim(), key).not.toBe('');
      expect(en[key].trim(), key).not.toBe('');
    }
  });
});

describe('translate', () => {
  it('fills placeholders, including nested messages', () => {
    const step = msg('step.write', { addr: '0x80' });
    expect(translate('en', 'flash.err.noResponse', { step })).toBe('Writing 0x80: no response');
    expect(translate('ja', 'flash.err.noResponse', { step })).toBe('書き込み（0x80）：応答がありません');
  });

  it('formats numbers for the language', () => {
    expect(translate('en', 'flash.log.written', { pages: 184, bytes: 23158 })).toBe(
      'Wrote 184 pages (23,158 bytes)',
    );
  });

  it('shows errors in the chosen language', () => {
    const e = new LocalizedError('gh.err.badToken');
    expect(e.message).toBe('The token is not valid');
    expect(errorText('ja', e)).toBe('トークンが無効です');
    expect(errorText('ja', new Error('plain'))).toBe('plain');
  });
});

describe('detectLang', () => {
  it('prefers the saved choice', () => {
    expect(detectLang('en', ['ja-JP'])).toBe('en');
  });

  it('falls back to the browser languages', () => {
    expect(detectLang('', ['ja-JP', 'en-US'])).toBe('ja');
    expect(detectLang('', ['en-GB', 'ja'])).toBe('ja');
    expect(detectLang('', ['fr-FR'])).toBe('en');
  });
});
