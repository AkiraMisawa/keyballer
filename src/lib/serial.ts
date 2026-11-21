// Finding the bootloader's serial port with Web Serial.

import { CATERINA_USB_IDS } from './caterina';

export const isWebSerialSupported = () =>
  typeof navigator !== 'undefined' && 'serial' in navigator;

function isCaterina(port: SerialPort): boolean {
  const { usbVendorId, usbProductId } = port.getInfo();
  return CATERINA_USB_IDS.some(
    (id) => id.usbVendorId === usbVendorId && id.usbProductId === usbProductId,
  );
}

/** A bootloader port the user already allowed this site to use, if one is connected. */
export async function findGrantedBootloader(): Promise<SerialPort | null> {
  const ports = await navigator.serial.getPorts();
  return ports.find(isCaterina) ?? null;
}

/**
 * Shows the browser's port picker. Must run inside a click handler.
 * With `anyDevice`, unknown Pro Micro clones are listed too.
 */
export async function pickBootloader(anyDevice = false): Promise<SerialPort | null> {
  try {
    return await navigator.serial.requestPort(anyDevice ? {} : { filters: CATERINA_USB_IDS });
  } catch (e) {
    // NotFoundError: the user closed the picker without choosing.
    if (e instanceof DOMException && e.name === 'NotFoundError') return null;
    throw e;
  }
}
