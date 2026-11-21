// Flashing an ATmega32U4 running the Caterina bootloader (Pro Micro and
// friends) over Web Serial. Caterina speaks the AVR109 ("butterfly")
// protocol on its USB CDC serial port for about 8 seconds after a reset.

import { LocalizedError, msg, type Localized, type Params } from '../i18n/core';
import type { MessageKey } from '../i18n/messages';

/** USB IDs of Caterina bootloaders, from QMK's udev rules. */
export const CATERINA_USB_IDS: { usbVendorId: number; usbProductId: number }[] = [
  { usbVendorId: 0x2341, usbProductId: 0x0036 }, // Arduino Leonardo
  { usbVendorId: 0x2341, usbProductId: 0x0037 }, // Arduino Micro
  { usbVendorId: 0x2a03, usbProductId: 0x0036 }, // dog hunter Leonardo
  { usbVendorId: 0x2a03, usbProductId: 0x0037 }, // dog hunter Micro
  { usbVendorId: 0x1b4f, usbProductId: 0x9203 }, // SparkFun Pro Micro 3.3V
  { usbVendorId: 0x1b4f, usbProductId: 0x9205 }, // SparkFun Pro Micro 5V
  { usbVendorId: 0x1b4f, usbProductId: 0x9207 }, // SparkFun LilyPad / some Pro Micro clones
  { usbVendorId: 0x1ffb, usbProductId: 0x0101 }, // Pololu A-Star 32U4
  { usbVendorId: 0x239a, usbProductId: 0x000c }, // Adafruit Feather 32U4
  { usbVendorId: 0x239a, usbProductId: 0x000d }, // Adafruit ItsyBitsy 32U4 3V
  { usbVendorId: 0x239a, usbProductId: 0x000e }, // Adafruit ItsyBitsy 32U4 5V
  { usbVendorId: 0x1209, usbProductId: 0x2302 }, // Keyboardio Atreus 2 bootloader
];

export const ATMEGA32U4 = {
  /** Signature as Caterina returns it (lowest byte first). */
  signature: [0x87, 0x95, 0x1e],
  pageSize: 128,
  /** Flash below the 4KB Caterina bootloader. */
  appSize: 28672,
  eepromSize: 1024,
};

/** The parts of the Web Serial SerialPort this module uses. */
export interface SerialLike {
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
}

export type FlashPhase = 'connect' | 'erase' | 'eeprom' | 'write' | 'verify' | 'finish';

export interface FlashProgress {
  phase: FlashPhase;
  done: number;
  total: number;
}

export interface FlashOptions {
  /** Fill the whole EEPROM with 0xFF, which QMK treats as "not initialised". */
  eraseEeprom?: boolean;
  onProgress?: (progress: FlashProgress) => void;
  onLog?: (message: Localized) => void;
}

export class FlashError extends LocalizedError {
  constructor(key: MessageKey, params?: Params) {
    super(key, params);
  }
}

const CR = 0x0d;
const ch = (c: string) => c.charCodeAt(0);
const hex = (bytes: ArrayLike<number>) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');
const addrText = (addr: number) => `0x${addr.toString(16)}`;

/** Byte-oriented reads with timeouts on top of a ReadableStream. */
class Link {
  private buffer: number[] = [];
  private pending: Promise<ReadableStreamReadResult<Uint8Array>> | null = null;

  constructor(
    private reader: ReadableStreamDefaultReader<Uint8Array>,
    private writer: WritableStreamDefaultWriter<Uint8Array>,
  ) {}

  async send(...parts: (number | string | ArrayLike<number>)[]): Promise<void> {
    const bytes: number[] = [];
    for (const part of parts) {
      if (typeof part === 'number') bytes.push(part);
      else if (typeof part === 'string') for (const c of part) bytes.push(ch(c));
      else bytes.push(...Array.from(part));
    }
    await this.writer.write(Uint8Array.from(bytes));
  }

  /** Waits up to `ms` for the next chunk. Returns null on timeout. */
  private async next(ms: number): Promise<ReadableStreamReadResult<Uint8Array> | null> {
    this.pending ??= this.reader.read();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), ms);
    });
    const result = await Promise.race([this.pending, timeout]);
    clearTimeout(timer);
    if (result) this.pending = null;
    return result;
  }

  async read(count: number, timeoutMs: number, step: Localized): Promise<Uint8Array> {
    const deadline = Date.now() + timeoutMs;
    while (this.buffer.length < count) {
      const left = deadline - Date.now();
      if (left <= 0) break;
      const result = await this.next(left);
      if (!result) break;
      if (result.done) throw new FlashError('flash.err.disconnected', { step });
      this.buffer.push(...result.value);
    }
    if (this.buffer.length < count) throw new FlashError('flash.err.noResponse', { step });
    return Uint8Array.from(this.buffer.splice(0, count));
  }

  /**
   * Discards everything already received plus whatever arrives within
   * `waitMs`, and returns how many bytes were dropped. Used to get back in
   * step if the bootloader sent more than the protocol says.
   */
  async drain(waitMs: number): Promise<number> {
    let dropped = this.buffer.length;
    this.buffer = [];
    const deadline = Date.now() + waitMs;
    for (;;) {
      const left = deadline - Date.now();
      if (left <= 0) break;
      const result = await this.next(left);
      if (!result || result.done) break;
      dropped += result.value.length;
    }
    return dropped;
  }

  async expectCR(timeoutMs: number, step: Localized): Promise<void> {
    const [b] = await this.read(1, timeoutMs, step);
    if (b !== CR) throw new FlashError('flash.err.unexpected', { step, byte: `0x${b.toString(16)}` });
  }

  /** Stops reading and unlocks both streams so the port can be closed. */
  async release(): Promise<void> {
    // A read left over from a timeout settles when the reader is cancelled.
    this.pending?.catch(() => {});
    await this.reader.cancel().catch(() => {});
    try {
      this.reader.releaseLock();
    } catch {
      // already released
    }
    try {
      this.writer.releaseLock();
    } catch {
      // already released
    }
  }
}

async function setAddress(link: Link, wordOrByteAddress: number): Promise<void> {
  await link.send('A', (wordOrByteAddress >> 8) & 0xff, wordOrByteAddress & 0xff);
  await link.expectCR(1000, msg('step.address'));
}

function isBlank(page: Uint8Array): boolean {
  return page.every((b) => b === 0xff);
}

async function writePage(link: Link, addr: number, data: Uint8Array): Promise<void> {
  await setAddress(link, addr >> 1);
  await link.send('B', 0, data.length, 'F', data);
  await link.expectCR(2000, msg('step.write', { addr: addrText(addr) }));
}

async function readPage(link: Link, addr: number, size: number): Promise<Uint8Array> {
  await setAddress(link, addr >> 1);
  await link.send('g', 0, size, 'F');
  return link.read(size, 2000, msg('step.read', { addr: addrText(addr) }));
}

function firstDifference(a: Uint8Array, b: Uint8Array): number {
  return a.findIndex((x, i) => x !== b[i]);
}

/**
 * Writes `image` to flash and verifies it. The port must belong to a board
 * that is currently in the Caterina bootloader. The port is opened here and
 * closed before returning, and the board then starts the new firmware.
 */
export async function flashCaterina(
  port: SerialLike,
  image: Uint8Array,
  options: FlashOptions = {},
): Promise<void> {
  const { pageSize, appSize, eepromSize, signature } = ATMEGA32U4;
  const log = options.onLog ?? (() => {});
  const progress = (phase: FlashPhase, done: number, total: number) =>
    options.onProgress?.({ phase, done, total });

  if (image.length > appSize) {
    throw new FlashError('flash.err.tooLarge', { size: image.length, max: appSize });
  }

  const pages: { addr: number; data: Uint8Array }[] = [];
  for (let addr = 0; addr < image.length; addr += pageSize) {
    const data = new Uint8Array(pageSize).fill(0xff);
    data.set(image.subarray(addr, addr + pageSize));
    if (!isBlank(data)) pages.push({ addr, data });
  }

  progress('connect', 0, 1);
  await port.open({ baudRate: 57600 });
  if (!port.readable || !port.writable) {
    await port.close().catch(() => {});
    throw new FlashError('flash.err.openFailed');
  }
  const link = new Link(port.readable.getReader(), port.writable.getWriter());

  try {
    const stale = await link.drain(50);
    if (stale > 0) log(msg('flash.log.stale', { count: stale }));

    await link.send('S');
    const id = new TextDecoder().decode(await link.read(7, 2000, msg('step.identify')));
    log(msg('flash.log.bootloader', { id }));

    await link.send('s');
    const sig = await link.read(3, 1000, msg('step.signature'));
    if (sig.some((b, i) => b !== signature[i])) {
      throw new FlashError('flash.err.wrongMcu', { sig: hex(sig) });
    }
    log(msg('flash.log.mcu', { sig: hex(sig) }));

    await link.send('P');
    await link.expectCR(1000, msg('step.progMode'));
    progress('connect', 1, 1);

    // Erasing the application also stops Caterina's 8 second timeout,
    // because it only counts down while a sketch is present.
    progress('erase', 0, 1);
    await link.send('e');
    await link.expectCR(10000, msg('step.erase'));
    progress('erase', 1, 1);
    log(msg('flash.log.erased'));

    if (options.eraseEeprom) {
      const blank = new Uint8Array(pageSize).fill(0xff);
      const blocks = eepromSize / pageSize;
      for (let i = 0; i < blocks; i++) {
        progress('eeprom', i, blocks);
        await setAddress(link, i * pageSize);
        await link.send('B', 0, pageSize, 'E', blank);
        await link.expectCR(5000, msg('step.eeprom'));
      }
      progress('eeprom', blocks, blocks);
      log(msg('flash.log.eepromErased'));
    }

    for (let i = 0; i < pages.length; i++) {
      progress('write', i, pages.length);
      await writePage(link, pages[i].addr, pages[i].data);
    }
    progress('write', pages.length, pages.length);
    log(msg('flash.log.written', { pages: pages.length, bytes: image.length }));

    // Every response so far was one CR. Anything still waiting would shift
    // every read below by that many bytes.
    const extra = await link.drain(100);
    if (extra > 0) log(msg('flash.log.drained', { count: extra }));

    for (let i = 0; i < pages.length; i++) {
      progress('verify', i, pages.length);
      const { addr, data } = pages[i];
      let read = await readPage(link, addr, pageSize);
      let bad = firstDifference(read, data);
      if (bad >= 0) {
        log(
          msg('flash.log.rewrite', {
            addr: addrText(addr + bad),
            expected: hex(data.subarray(bad, bad + 8)),
            actual: hex(read.subarray(bad, bad + 8)),
          }),
        );
        const dropped = await link.drain(50);
        if (dropped > 0) log(msg('flash.log.drained', { count: dropped }));
        await writePage(link, addr, data);
        read = await readPage(link, addr, pageSize);
        bad = firstDifference(read, data);
      }
      if (bad >= 0) {
        throw new FlashError('flash.err.mismatch', {
          addr: addrText(addr + bad),
          expected: hex(data.subarray(bad, bad + 8)),
          actual: hex(read.subarray(bad, bad + 8)),
        });
      }
    }
    progress('verify', pages.length, pages.length);
    log(msg('flash.log.verified'));

    progress('finish', 0, 1);
    await link.send('L');
    await link.expectCR(1000, msg('step.leave'));
    await link.send('E');
    await link.expectCR(1000, msg('step.exit'));
    progress('finish', 1, 1);
    log(msg('flash.log.restarted'));
  } finally {
    await link.release();
    await port.close().catch(() => {});
  }
}
