export const shortSha = (sha: string) => sha.slice(0, 7);

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ja-JP', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const formatBytes = (n: number) => n.toLocaleString('ja-JP');

const PROCESSORS: Record<string, string> = {
  atmega32u4: 'ATmega32U4',
  RP2040: 'RP2040',
};

export const processorLabel = (p: string | null) => (p ? (PROCESSORS[p] ?? p) : '不明');

const BOOTLOADERS: Record<string, string> = {
  caterina: 'Caterina',
  'atmel-dfu': 'Atmel DFU',
  'rp2040': 'RP2040 UF2',
};

export const bootloaderLabel = (b: string | null) => (b ? (BOOTLOADERS[b] ?? b) : '不明');
