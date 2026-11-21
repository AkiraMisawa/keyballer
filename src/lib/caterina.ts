// Flashing an ATmega32U4 running the Caterina bootloader (Pro Micro and
// friends) over Web Serial. Caterina speaks the AVR109 ("butterfly")
// protocol on its USB CDC serial port for about 8 seconds after a reset.

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
  onLog?: (message: string) => void;
}

export class FlashError extends Error {}

const CR = 0x0d;
const ch = (c: string) => c.charCodeAt(0);
const hex = (bytes: ArrayLike<number>) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');

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

  async read(count: number, timeoutMs: number, what: string): Promise<Uint8Array> {
    const deadline = Date.now() + timeoutMs;
    while (this.buffer.length < count) {
      const left = deadline - Date.now();
      if (left <= 0) break;
      this.pending ??= this.reader.read();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), left);
      });
      const result = await Promise.race([this.pending, timeout]);
      clearTimeout(timer);
      if (result === 'timeout') break;
      this.pending = null;
      if (result.done) throw new FlashError(`${what}: 接続が切れました`);
      this.buffer.push(...result.value);
    }
    if (this.buffer.length < count) {
      throw new FlashError(`${what}: 応答がありません`);
    }
    return Uint8Array.from(this.buffer.splice(0, count));
  }

  async expectCR(timeoutMs: number, what: string): Promise<void> {
    const [b] = await this.read(1, timeoutMs, what);
    if (b !== CR) throw new FlashError(`${what}: 想定外の応答 0x${b.toString(16)} です`);
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
  await link.expectCR(1000, 'アドレス設定');
}

function isBlank(page: Uint8Array): boolean {
  return page.every((b) => b === 0xff);
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
    throw new FlashError(
      `ファームウェアが大きすぎます（${image.length} バイト、上限 ${appSize} バイト）`,
    );
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
    throw new FlashError('シリアルポートを開けませんでした');
  }
  const link = new Link(port.readable.getReader(), port.writable.getWriter());

  try {
    await link.send('S');
    const id = new TextDecoder().decode(await link.read(7, 2000, 'ブートローダーの確認'));
    log(`ブートローダー: ${id}`);

    await link.send('s');
    const sig = await link.read(3, 1000, 'マイコンの確認');
    if (sig.some((b, i) => b !== signature[i])) {
      throw new FlashError(
        `ATmega32U4 ではないマイコンです（signature ${hex(sig)}）。書き込みを中止しました`,
      );
    }
    log(`マイコン: ATmega32U4 (${hex(sig)})`);

    await link.send('P');
    await link.expectCR(1000, '書き込みモードへの切り替え');
    progress('connect', 1, 1);

    // Erasing the application also stops Caterina's 8 second timeout,
    // because it only counts down while a sketch is present.
    progress('erase', 0, 1);
    await link.send('e');
    await link.expectCR(10000, 'フラッシュの消去');
    progress('erase', 1, 1);
    log('フラッシュを消去しました');

    if (options.eraseEeprom) {
      const blank = new Uint8Array(pageSize).fill(0xff);
      const blocks = eepromSize / pageSize;
      for (let i = 0; i < blocks; i++) {
        progress('eeprom', i, blocks);
        await setAddress(link, i * pageSize);
        await link.send('B', 0, pageSize, 'E', blank);
        await link.expectCR(5000, 'EEPROM の消去');
      }
      progress('eeprom', blocks, blocks);
      log('EEPROM を消去しました');
    }

    for (let i = 0; i < pages.length; i++) {
      progress('write', i, pages.length);
      const { addr, data } = pages[i];
      await setAddress(link, addr >> 1);
      await link.send('B', 0, pageSize, 'F', data);
      await link.expectCR(2000, `書き込み (0x${addr.toString(16)})`);
    }
    progress('write', pages.length, pages.length);
    log(`${pages.length} ページ（${image.length} バイト）を書き込みました`);

    for (let i = 0; i < pages.length; i++) {
      progress('verify', i, pages.length);
      const { addr, data } = pages[i];
      await setAddress(link, addr >> 1);
      await link.send('g', 0, pageSize, 'F');
      const read = await link.read(pageSize, 2000, `読み出し (0x${addr.toString(16)})`);
      const bad = read.findIndex((b, j) => b !== data[j]);
      if (bad >= 0) {
        throw new FlashError(
          `0x${(addr + bad).toString(16)} の内容が一致しません。もう一度書き込んでください`,
        );
      }
    }
    progress('verify', pages.length, pages.length);
    log('書き込んだ内容を確認しました');

    progress('finish', 0, 1);
    await link.send('L');
    await link.expectCR(1000, '書き込みモードの終了');
    await link.send('E');
    await link.expectCR(1000, 'ブートローダーの終了');
    progress('finish', 1, 1);
    log('キーボードを再起動しました');
  } finally {
    await link.release();
    await port.close().catch(() => {});
  }
}
