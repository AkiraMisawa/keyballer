"""Checks a UF2 file for the Adafruit nRF52 bootloader before it is published (docs/plans/zmk.md).

The bootloader flashes any valid UF2 block it is given, wherever it points, including blocks of
the family that replaces the bootloader itself; UF2 has no signatures. So Keyballer accepts only
an application image for the nRF52840: every block well formed, of the nRF52840 family, with a
256-byte payload, numbered in order, at distinct 256-aligned addresses between the end of the
SoftDevice and the start of the settings area. src/lib/uf2.ts applies the same rules in the page.

Runs on Python 3.9.
"""

import struct

BLOCK = 512
MAGIC_START0 = 0x0A324655
MAGIC_START1 = 0x9E5D5157
MAGIC_END = 0x0AB16F30
FLAG_FAMILY_ID = 0x2000
NRF52840 = 0xADA52840
PAYLOAD = 256
# Application flash with SoftDevice S140 v6 or v7: code from 0x26000 (v6) or 0x27000 (v7), and
# settings, bonds and the bootloader from 0xEC000 (Zephyr's nrf52840_partition_uf2_sdv7.dtsi).
APP_START = 0x26000
APP_END = 0xEC000

_HEAD = struct.Struct("<IIIIIIII")
_TAIL = struct.Struct("<I")


class UF2Error(Exception):
    pass


def check_uf2(data):
    """Returns {family, blocks, start, end} for a valid nRF52840 application image; raises UF2Error."""
    if not data or len(data) % BLOCK:
        raise UF2Error("not a whole number of 512-byte UF2 blocks")
    total = len(data) // BLOCK
    seen = set()
    start, end = None, None
    for index in range(total):
        chunk = data[index * BLOCK:(index + 1) * BLOCK]
        magic0, magic1, flags, addr, size, number, count, family = _HEAD.unpack_from(chunk, 0)
        (magic_end,) = _TAIL.unpack_from(chunk, BLOCK - 4)
        where = "block {}".format(index)
        if (magic0, magic1, magic_end) != (MAGIC_START0, MAGIC_START1, MAGIC_END):
            raise UF2Error("{}: not a UF2 block".format(where))
        if flags != FLAG_FAMILY_ID:
            raise UF2Error("{}: flags 0x{:x}, expected only the family flag".format(where, flags))
        if family != NRF52840:
            raise UF2Error("{}: family 0x{:08x} is not the nRF52840 application family".format(where, family))
        if size != PAYLOAD:
            raise UF2Error("{}: payload of {} bytes, expected 256".format(where, size))
        if number != index or count != total:
            raise UF2Error("{}: numbered {} of {}, expected {} of {}".format(where, number, count, index, total))
        if addr % PAYLOAD or addr < APP_START or addr + PAYLOAD > APP_END:
            raise UF2Error("{}: address 0x{:x} is outside the application area".format(where, addr))
        if addr in seen:
            raise UF2Error("{}: address 0x{:x} is written twice".format(where, addr))
        seen.add(addr)
        start = addr if start is None else min(start, addr)
        end = addr + PAYLOAD if end is None else max(end, addr + PAYLOAD)
    return {"family": NRF52840, "blocks": total, "start": start, "end": end}
