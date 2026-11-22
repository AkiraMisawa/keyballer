"""The UF2 check (docs/plans/zmk.md). Blocks are built from the UF2 spec's constants
(github.com/microsoft/uf2: magics 0x0A324655, 0x9E5D5157, 0x0AB16F30; flag 0x2000 = family ID
present; family 0xADA52840 = nRF52840) and the Adafruit nRF52 bootloader's rules (family
0xd663823c replaces the bootloader)."""

import struct
import unittest

from uf2check import UF2Error, check_uf2

NRF52840 = 0xADA52840
BOOTLOADER_FAMILY = 0xD663823C


def block(index, total, addr, flags=0x2000, family=NRF52840, size=256, magics=(0x0A324655, 0x9E5D5157, 0x0AB16F30)):
    head = struct.pack("<IIIIIIII", magics[0], magics[1], flags, addr, size, index, total, family)
    return head + bytes(476) + struct.pack("<I", magics[2])


def image(total=4, start=0x27000, **kw):
    return b"".join(block(i, total, start + 256 * i, **kw) for i in range(total))


class CheckUf2(unittest.TestCase):
    def test_reads_a_well_formed_application_image(self):
        self.assertEqual(
            check_uf2(image(4, 0x27000)),
            {"family": NRF52840, "blocks": 4, "start": 0x27000, "end": 0x27400},
        )

    def test_refuses_a_file_that_is_not_whole_blocks(self):
        for data in (b"", image()[:-1], image() + b"\0"):
            with self.assertRaises(UF2Error):
                check_uf2(data)

    def test_refuses_wrong_magic_numbers(self):
        for magics in ((0, 0x9E5D5157, 0x0AB16F30), (0x0A324655, 0, 0x0AB16F30), (0x0A324655, 0x9E5D5157, 0)):
            with self.assertRaises(UF2Error):
                check_uf2(block(0, 1, 0x27000, magics=magics))

    def test_refuses_the_bootloader_family_and_other_families(self):
        for family in (BOOTLOADER_FAMILY, 0xE48BFF56, 0):
            with self.assertRaises(UF2Error):
                check_uf2(image(family=family))

    def test_refuses_other_flags(self):
        # 0x1 not main flash, 0x1000 file container, 0x4000 MD5, 0x8000 extension tags, or none.
        for flags in (0x2001, 0x3000, 0x6000, 0xA000, 0):
            with self.assertRaises(UF2Error):
                check_uf2(image(flags=flags))

    def test_refuses_payloads_other_than_256_bytes(self):
        for size in (0, 128, 476):
            with self.assertRaises(UF2Error):
                check_uf2(image(size=size))

    def test_refuses_writes_outside_the_application_area(self):
        # Below 0x26000 is the MBR and SoftDevice; from 0xEC000 the settings, bonds and bootloader.
        for start in (0x0, 0x1000, 0x25F00, 0xEC000, 0xF4000, 0xEBF00 - 256 * 2):
            with self.subTest(start=hex(start)):
                with self.assertRaises(UF2Error):
                    check_uf2(image(4, start))

    def test_accepts_the_edges_of_the_application_area(self):
        self.assertEqual(check_uf2(image(1, 0x26000))["start"], 0x26000)
        self.assertEqual(check_uf2(image(1, 0xEBF00))["end"], 0xEC000)

    def test_refuses_misaligned_addresses(self):
        with self.assertRaises(UF2Error):
            check_uf2(image(2, 0x27080))

    def test_refuses_wrong_numbering(self):
        bad_count = block(0, 2, 0x27000) + block(1, 3, 0x27100)
        bad_index = block(0, 2, 0x27000) + block(0, 2, 0x27100)
        too_few = block(0, 3, 0x27000) + block(1, 3, 0x27100)
        for data in (bad_count, bad_index, too_few):
            with self.assertRaises(UF2Error):
                check_uf2(data)

    def test_refuses_two_blocks_for_one_address(self):
        with self.assertRaises(UF2Error):
            check_uf2(block(0, 2, 0x27000) + block(1, 2, 0x27000))


if __name__ == "__main__":
    unittest.main()
