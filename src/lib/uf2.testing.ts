// UF2 files for tests, built from the UF2 spec's constants (github.com/microsoft/uf2: magics
// 0x0A324655, 0x9E5D5157, 0x0AB16F30; flag 0x2000 = family ID present; family 0xADA52840 = nRF52840).

export interface BlockOptions {
  flags?: number;
  family?: number;
  size?: number;
  magic?: [number, number, number];
}

export function uf2Block(index: number, total: number, addr: number, over: BlockOptions = {}): Uint8Array {
  const b = new Uint8Array(512);
  const v = new DataView(b.buffer);
  const [m0, m1, m2] = over.magic ?? [0x0a324655, 0x9e5d5157, 0x0ab16f30];
  [m0, m1, over.flags ?? 0x2000, addr, over.size ?? 256, index, total, over.family ?? 0xada52840].forEach((x, i) => v.setUint32(i * 4, x, true));
  v.setUint32(508, m2, true);
  return b;
}

/** `total` blocks at consecutive 256-byte addresses from `start`. */
export function uf2Image(total = 4, start = 0x27000, over: BlockOptions = {}): Uint8Array {
  const out = new Uint8Array(512 * total);
  for (let i = 0; i < total; i++) out.set(uf2Block(i, total, start + 256 * i, over), 512 * i);
  return out;
}
