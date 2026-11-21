import { describe, expect, it } from 'vitest';
import { FakeCaterina } from '../test/fakeCaterina';
import { flashCaterina, FlashError, type FlashProgress } from './caterina';

function sampleImage(size: number): Uint8Array {
  const data = new Uint8Array(size);
  for (let i = 0; i < size; i++) data[i] = (i * 31 + 7) & 0xff;
  // A blank page in the middle must still read back as 0xFF.
  data.fill(0xff, 1024, 1152);
  return data;
}

describe('flashCaterina', () => {
  it('writes the image, verifies it and leaves the bootloader', async () => {
    const board = new FakeCaterina();
    const image = sampleImage(23532);
    const phases = new Set<string>();
    let last: FlashProgress | undefined;

    await flashCaterina(board, image, {
      onProgress: (p) => {
        phases.add(p.phase);
        last = p;
      },
    });

    expect(Array.from(board.flash.subarray(0, image.length))).toEqual(Array.from(image));
    // The old sketch beyond the new image is erased.
    expect(board.flash.subarray(image.length, 28672).every((b) => b === 0xff)).toBe(true);
    expect(board.exited).toBe(true);
    expect(board.closed).toBe(true);
    expect([...phases]).toEqual(['connect', 'erase', 'write', 'verify', 'finish']);
    expect(last).toEqual({ phase: 'finish', done: 1, total: 1 });
    // The blank page is skipped.
    expect(board.commands.filter((c) => c === 'B')).toHaveLength(Math.ceil(23532 / 128) - 1);
  });

  it('leaves the EEPROM alone unless asked', async () => {
    const board = new FakeCaterina();
    await flashCaterina(board, sampleImage(300));
    expect(board.eeprom.every((b) => b === 0x5a)).toBe(true);
  });

  it('erases the EEPROM when asked', async () => {
    const board = new FakeCaterina();
    await flashCaterina(board, sampleImage(300), { eraseEeprom: true });
    expect(board.eeprom.every((b) => b === 0xff)).toBe(true);
  });

  it('refuses a board that is not an ATmega32U4', async () => {
    const board = new FakeCaterina({ signature: [0x82, 0x95, 0x1e] });
    await expect(flashCaterina(board, sampleImage(300))).rejects.toThrow(FlashError);
    expect(board.commands).not.toContain('e');
    expect(board.closed).toBe(true);
  });

  it('refuses an image larger than the application area', async () => {
    const board = new FakeCaterina();
    await expect(flashCaterina(board, new Uint8Array(28673))).rejects.toThrow(/大きすぎます/);
    expect(board.opened).toBe(false);
  });

  it('gets back in step when the bootloader sends an extra byte', async () => {
    const board = new FakeCaterina({ extraCrAfter: 'e' });
    const logs: string[] = [];
    const image = sampleImage(2000);
    await flashCaterina(board, image, { onLog: (m) => logs.push(m) });
    expect(Array.from(board.flash.subarray(0, image.length))).toEqual(Array.from(image));
    expect(logs.some((m) => m.includes('読み捨てました'))).toBe(true);
  });

  it('rewrites a page once when it reads back wrong', async () => {
    const board = new FakeCaterina({ badReads: 1 });
    const logs: string[] = [];
    await flashCaterina(board, sampleImage(2000), { onLog: (m) => logs.push(m) });
    expect(logs.some((m) => m.includes('書き直します'))).toBe(true);
    expect(board.exited).toBe(true);
  });

  it('reports expected and actual bytes when a page keeps reading back wrong', async () => {
    const board = new FakeCaterina({ badReads: 2 });
    await expect(flashCaterina(board, sampleImage(2000))).rejects.toThrow(/期待 .+、実際 /);
    expect(board.closed).toBe(true);
  });

  it('times out and closes the port when the bootloader stops answering', async () => {
    const board = new FakeCaterina({ silentOn: 'P' });
    await expect(flashCaterina(board, sampleImage(300))).rejects.toThrow(/応答がありません/);
    expect(board.closed).toBe(true);
  });
});
