// Intel HEX parser for AVR firmware images.

export interface FirmwareImage {
  /** Bytes from address 0 up to the last programmed byte. Gaps are 0xFF. */
  data: Uint8Array;
}

const DATA = 0x00;
const EOF = 0x01;
const EXT_SEGMENT = 0x02;
const START_SEGMENT = 0x03;
const EXT_LINEAR = 0x04;
const START_LINEAR = 0x05;

export class HexError extends Error {}

export function parseIntelHex(text: string): FirmwareImage {
  const chunks: { addr: number; bytes: Uint8Array }[] = [];
  let base = 0;
  let end = 0;
  let sawEof = false;

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '') continue;
    const lineNo = i + 1;
    if (sawEof) throw new HexError(`${lineNo} 行目: 終端のあとにデータがあります`);
    if (line[0] !== ':' || line.length < 11 || line.length % 2 === 0) {
      throw new HexError(`${lineNo} 行目: Intel HEX の形式ではありません`);
    }

    const raw = new Uint8Array((line.length - 1) / 2);
    for (let j = 0; j < raw.length; j++) {
      const byte = Number.parseInt(line.substr(1 + j * 2, 2), 16);
      if (Number.isNaN(byte)) throw new HexError(`${lineNo} 行目: 16 進数でない文字があります`);
      raw[j] = byte;
    }

    const count = raw[0];
    if (raw.length !== count + 5) throw new HexError(`${lineNo} 行目: 長さが合いません`);
    let sum = 0;
    for (const b of raw) sum = (sum + b) & 0xff;
    if (sum !== 0) throw new HexError(`${lineNo} 行目: チェックサムが合いません`);

    const offset = (raw[1] << 8) | raw[2];
    const type = raw[3];
    const payload = raw.subarray(4, 4 + count);

    switch (type) {
      case DATA: {
        const addr = base + offset;
        chunks.push({ addr, bytes: payload.slice() });
        end = Math.max(end, addr + count);
        break;
      }
      case EOF:
        sawEof = true;
        break;
      case EXT_SEGMENT:
        base = ((payload[0] << 8) | payload[1]) << 4;
        break;
      case EXT_LINEAR:
        base = ((payload[0] << 8) | payload[1]) * 0x10000;
        break;
      case START_SEGMENT:
      case START_LINEAR:
        break;
      default:
        throw new HexError(`${lineNo} 行目: 未対応のレコード種別 ${type} です`);
    }
  }

  if (!sawEof) throw new HexError('ファイルが途中で切れています（終端レコードがありません）');
  if (chunks.length === 0) throw new HexError('書き込むデータがありません');

  const data = new Uint8Array(end).fill(0xff);
  for (const { addr, bytes } of chunks) data.set(bytes, addr);
  return { data };
}

/** Encodes bytes as Intel HEX (16 bytes per record). Used by tests. */
export function toIntelHex(data: Uint8Array, start = 0): string {
  const hex = (n: number) => n.toString(16).toUpperCase().padStart(2, '0');
  const record = (type: number, addr: number, bytes: Uint8Array) => {
    let sum = bytes.length + (addr >> 8) + (addr & 0xff) + type;
    let out = ':' + hex(bytes.length) + hex(addr >> 8) + hex(addr & 0xff) + hex(type);
    for (const b of bytes) {
      out += hex(b);
      sum += b;
    }
    return out + hex((0x100 - (sum & 0xff)) & 0xff);
  };
  const lines: string[] = [];
  for (let i = 0; i < data.length; i += 16) {
    lines.push(record(DATA, (start + i) & 0xffff, data.subarray(i, i + 16)));
  }
  lines.push(record(EOF, 0, new Uint8Array()));
  return lines.join('\n') + '\n';
}
