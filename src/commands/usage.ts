// How often and how lately this browser ran each command, so that what is used
// comes first and a few letters find it. A run counts for less as it ages.

import { load, save } from '../lib/storage';

const KEY = 'keyballer.commandUsage';
const HALF_LIFE_DAYS = 14;

interface Use {
  count: number;
  last: number;
}

let uses: Record<string, Use> | undefined;

function all(): Record<string, Use> {
  if (!uses) {
    try {
      const parsed: unknown = JSON.parse(load(KEY) || '{}');
      uses = parsed && typeof parsed === 'object' ? (parsed as Record<string, Use>) : {};
    } catch {
      uses = {};
    }
  }
  return uses;
}

export function usageScore(commandId: string, now = Date.now()): number {
  const use = all()[commandId];
  if (!use) return 0;
  return use.count * 0.5 ** ((now - use.last) / (HALF_LIFE_DAYS * 86_400_000));
}

export function recordUse(commandId: string, now = Date.now()): void {
  const before = all()[commandId];
  uses = { ...all(), [commandId]: { count: (before?.count ?? 0) + 1, last: now } };
  save(KEY, JSON.stringify(uses));
}
