// The UF2 check in the page (docs/plans/zmk.md), the same rules as scripts/uf2check.py. Blocks are
// built from the UF2 spec's constants (github.com/microsoft/uf2: magics 0x0A324655, 0x9E5D5157,
// 0x0AB16F30; flag 0x2000 = family ID present; family 0xADA52840 = nRF52840) and the Adafruit
// nRF52 bootloader's rules (family 0xd663823c replaces the bootloader). The application area,
// 0x27000 to 0xEC000, is Zephyr's nrf52840_partition_uf2_sdv7.dtsi for SoftDevice S140 v7.

import { describe, expect, it } from 'vitest';
import { checkUf2 } from './uf2';
import { uf2Block, uf2Image } from './uf2.testing';

const NRF52840 = 0xada52840;
const block = uf2Block;
const image = uf2Image;

const join = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

describe('checkUf2', () => {
  it('reads a well-formed nRF52840 application image', () => {
    expect(checkUf2(image(4, 0x27000))).toEqual({ ok: true, uf2: { family: NRF52840, blocks: 4, start: 0x27000, end: 0x27400 } });
  });

  it('refuses a file that is not whole blocks', () => {
    for (const data of [new Uint8Array(0), image().slice(0, -1), join(image(), new Uint8Array(1))]) {
      expect(checkUf2(data).ok).toBe(false);
    }
  });

  it('refuses wrong magic numbers', () => {
    for (const magic of [[0, 0x9e5d5157, 0x0ab16f30], [0x0a324655, 0, 0x0ab16f30], [0x0a324655, 0x9e5d5157, 0]] as [number, number, number][]) {
      expect(checkUf2(block(0, 1, 0x27000, { magic })).ok).toBe(false);
    }
  });

  it('refuses the bootloader family and every other family', () => {
    for (const family of [0xd663823c, 0xe48bff56, 0]) expect(checkUf2(image(4, 0x27000, { family })).ok).toBe(false);
  });

  it('refuses flags other than the family flag alone', () => {
    for (const flags of [0x2001, 0x3000, 0x6000, 0xa000, 0]) expect(checkUf2(image(4, 0x27000, { flags })).ok).toBe(false);
  });

  it('refuses payloads other than 256 bytes', () => {
    for (const size of [0, 128, 476]) expect(checkUf2(image(4, 0x27000, { size })).ok).toBe(false);
  });

  it('refuses writes outside the application area, and takes its edges', () => {
    for (const start of [0x0, 0x1000, 0x26000, 0x26f00, 0xec000, 0xf4000, 0xebf00 - 512]) expect(checkUf2(image(4, start)).ok, start.toString(16)).toBe(false);
    expect(checkUf2(image(1, 0x27000))).toMatchObject({ ok: true, uf2: { start: 0x27000 } });
    expect(checkUf2(image(1, 0xebf00))).toMatchObject({ ok: true, uf2: { end: 0xec000 } });
  });

  it('refuses misaligned addresses, wrong numbering and repeated addresses', () => {
    expect(checkUf2(image(2, 0x27080)).ok).toBe(false);
    expect(checkUf2(join(block(0, 2, 0x27000), block(1, 3, 0x27100))).ok).toBe(false);
    expect(checkUf2(join(block(0, 2, 0x27000), block(0, 2, 0x27100))).ok).toBe(false);
    expect(checkUf2(join(block(0, 3, 0x27000), block(1, 3, 0x27100))).ok).toBe(false);
    expect(checkUf2(join(block(0, 2, 0x27000), block(1, 2, 0x27000))).ok).toBe(false);
  });
});
