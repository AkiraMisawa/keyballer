// Checks a UF2 file for the Adafruit nRF52 bootloader before the page offers it (docs/plans/zmk.md).
// The same rules as scripts/uf2check.py, which the build applies first.
//
// The bootloader flashes any valid UF2 block it is given, wherever it points, including blocks of
// the family that replaces the bootloader itself; UF2 has no signatures. So only an nRF52840
// application image passes: every block well formed, of the nRF52840 family, with a 256-byte
// payload, numbered in order, at distinct 256-aligned addresses between the end of the SoftDevice
// v7 and the start of the settings area.

const BLOCK = 512;
const MAGIC_START0 = 0x0a324655;
const MAGIC_START1 = 0x9e5d5157;
const MAGIC_END = 0x0ab16f30;
const FLAG_FAMILY_ID = 0x2000;
export const NRF52840_FAMILY = 0xada52840;
const PAYLOAD = 256;
/**
 * Application flash with SoftDevice S140 v7 (the XIAO nRF52840): code from 0x27000; settings, bonds
 * and the bootloader from 0xEC000 (Zephyr's nrf52840_partition_uf2_sdv7.dtsi).
 */
const APP_START = 0x27000;
const APP_END = 0xec000;

export interface Uf2Summary {
  family: number;
  blocks: number;
  start: number;
  end: number;
}

export type Uf2Check = { ok: true; uf2: Uf2Summary } | { ok: false; why: string };

export function checkUf2(data: Uint8Array): Uf2Check {
  if (data.length === 0 || data.length % BLOCK) return { ok: false, why: 'not whole 512-byte UF2 blocks' };
  const total = data.length / BLOCK;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const seen = new Set<number>();
  let start = Infinity;
  let end = -Infinity;
  for (let index = 0; index < total; index++) {
    const at = index * BLOCK;
    const u32 = (offset: number) => view.getUint32(at + offset, true);
    const where = `block ${index}`;
    if (u32(0) !== MAGIC_START0 || u32(4) !== MAGIC_START1 || u32(508) !== MAGIC_END) return { ok: false, why: `${where}: not a UF2 block` };
    if (u32(8) !== FLAG_FAMILY_ID) return { ok: false, why: `${where}: unexpected flags` };
    if (u32(28) !== NRF52840_FAMILY) return { ok: false, why: `${where}: not the nRF52840 application family` };
    if (u32(16) !== PAYLOAD) return { ok: false, why: `${where}: payload is not 256 bytes` };
    if (u32(20) !== index || u32(24) !== total) return { ok: false, why: `${where}: numbered out of order` };
    const addr = u32(12);
    if (addr % PAYLOAD || addr < APP_START || addr + PAYLOAD > APP_END) return { ok: false, why: `${where}: outside the application area` };
    if (seen.has(addr)) return { ok: false, why: `${where}: an address is written twice` };
    seen.add(addr);
    start = Math.min(start, addr);
    end = Math.max(end, addr + PAYLOAD);
  }
  return { ok: true, uf2: { family: NRF52840_FAMILY, blocks: total, start, end } };
}
