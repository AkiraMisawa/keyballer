// An in-memory Caterina bootloader that answers AVR109 commands, for tests.

import type { SerialLike } from '../lib/caterina';

export interface FakeCaterinaOptions {
  signature?: number[];
  /** Drop the response to this command letter, to test timeouts. */
  silentOn?: string;
  /** Send one extra CR after this command, to test getting back in step. */
  extraCrAfter?: string;
  /** Return a damaged first byte on the first N flash reads. */
  badReads?: number;
}

export class FakeCaterina implements SerialLike {
  readonly flash = new Uint8Array(32768).fill(0xff);
  readonly eeprom = new Uint8Array(1024).fill(0x5a);
  readonly commands: string[] = [];
  opened = false;
  closed = false;
  exited = false;

  readable: ReadableStream<Uint8Array> | null = null;
  writable: WritableStream<Uint8Array> | null = null;

  private input: number[] = [];
  private address = 0; // byte address
  private out!: ReadableStreamDefaultController<Uint8Array>;
  private readonly signature: number[];

  constructor(private options: FakeCaterinaOptions = {}) {
    this.signature = options.signature ?? [0x87, 0x95, 0x1e];
    // Pretend an old sketch is present.
    this.flash.fill(0x11, 0, 4096);
  }

  async open(): Promise<void> {
    this.opened = true;
    this.readable = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.out = controller;
      },
    });
    this.writable = new WritableStream<Uint8Array>({
      write: (chunk) => {
        this.input.push(...chunk);
        this.process();
      },
    });
  }

  async close(): Promise<void> {
    if (this.readable?.locked || this.writable?.locked) {
      throw new TypeError('Cannot close a port with locked streams');
    }
    this.closed = true;
  }

  private reply(...bytes: number[]): void {
    const command = this.commands[this.commands.length - 1];
    if (command === this.options.silentOn) return;
    this.out.enqueue(Uint8Array.from(bytes));
  }

  /** Handles every complete command in the input buffer. */
  private process(): void {
    for (;;) {
      const c = this.input[0];
      if (c === undefined) return;
      const cmd = String.fromCharCode(c);
      let need = 1;
      if (cmd === 'A') need = 3;
      if (cmd === 'g') need = 4;
      if (cmd === 'B') {
        if (this.input.length < 4) return;
        need = 4 + ((this.input[1] << 8) | this.input[2]);
      }
      if (this.input.length < need) return;
      const bytes = this.input.splice(0, need);
      this.commands.push(cmd);
      this.handle(cmd, bytes);
      if (cmd === this.options.extraCrAfter) this.out.enqueue(Uint8Array.of(0x0d));
    }
  }

  private handle(cmd: string, bytes: number[]): void {
    const CR = 0x0d;
    switch (cmd) {
      case 'S':
        this.reply(...Array.from('CATERIN', (s) => s.charCodeAt(0)));
        break;
      case 's':
        this.reply(...this.signature);
        break;
      case 'P':
      case 'L':
        this.reply(CR);
        break;
      case 'E':
        this.exited = true;
        this.reply(CR);
        break;
      case 'e':
        this.flash.fill(0xff, 0, 28672);
        this.reply(CR);
        break;
      case 'A':
        this.address = (bytes[1] << 9) | (bytes[2] << 1);
        this.reply(CR);
        break;
      case 'B': {
        const size = (bytes[1] << 8) | bytes[2];
        const type = String.fromCharCode(bytes[3]);
        const data = bytes.slice(4, 4 + size);
        if (type === 'F') {
          const page = this.address - (this.address % 128);
          this.flash.fill(0xff, page, page + 128); // page erase
          this.flash.set(data, this.address);
          this.address += size;
        } else {
          this.eeprom.set(data, this.address >> 1);
          this.address += size * 2;
        }
        this.reply(CR);
        break;
      }
      case 'g': {
        const size = (bytes[1] << 8) | bytes[2];
        const data = this.flash.slice(this.address, this.address + size);
        this.address += size;
        if ((this.options.badReads ?? 0) > 0) {
          this.options.badReads!--;
          data[0] ^= 0xff;
        }
        this.reply(...data);
        break;
      }
      default:
        this.reply(0x3f); // '?'
    }
  }
}
