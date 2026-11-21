import { describe, expect, it } from 'vitest';
import { HexError, parseIntelHex, toIntelHex } from './ihex';

describe('parseIntelHex', () => {
  it('round-trips data written by toIntelHex', () => {
    const data = Uint8Array.from({ length: 300 }, (_, i) => i & 0xff);
    expect(Array.from(parseIntelHex(toIntelHex(data)).data)).toEqual(Array.from(data));
  });

  it('fills gaps with 0xFF', () => {
    const text = [':020000000102FB', ':02000600030AEB', ':00000001FF'].join('\n');
    expect(Array.from(parseIntelHex(text).data)).toEqual([1, 2, 0xff, 0xff, 0xff, 0xff, 3, 10]);
  });

  it('applies extended linear addresses', () => {
    const text = [':020000040001F9', ':0100000042BD', ':00000001FF'].join('\n');
    const { data } = parseIntelHex(text);
    expect(data.length).toBe(0x10001);
    expect(data[0x10000]).toBe(0x42);
  });

  it('rejects a bad checksum', () => {
    expect(() => parseIntelHex(':020000000102FC\n:00000001FF\n')).toThrow(HexError);
  });

  it('rejects a file without an end record', () => {
    expect(() => parseIntelHex(':020000000102FB\n')).toThrow(expect.objectContaining({ key: 'hex.err.noEof' }));
  });

  it('rejects text that is not Intel HEX', () => {
    expect(() => parseIntelHex('hello\n')).toThrow(HexError);
  });
});
