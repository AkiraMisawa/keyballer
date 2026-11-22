// The command model: what a command is, how the command line reads what is
// typed, ranks commands and completes arguments. No React here.
//
// Ported from qube (client/src/platform/commands/commands.ts), without its
// server-read commands. One declaration serves the command line, the
// single-key shortcut and the "?" list (DESIGN.md §8).

import { msg, type Localized } from '../i18n/core';
import type { MessageKey } from '../i18n/messages';

export interface Completion {
  readonly value: string;
  readonly detail?: string;
}

export interface CommandArgument {
  /** The slot's name, shown in the signature (`<repo>`); an optional one is typed `name=value`. */
  readonly name: string;
  /** Required arguments are typed in order; optional ones by name, anywhere after the command. */
  readonly required: boolean;
  /** What the slot takes, shown while it is typed. */
  readonly hint?: Localized;
  /** The values this slot offers, given the arguments before it. */
  readonly complete?: (given: Readonly<Record<string, string>>) => readonly Completion[];
  /** Why a value is refused; undefined when the slot takes it. */
  readonly check?: (value: string, given: Readonly<Record<string, string>>) => Localized | undefined;
}

export interface Command {
  readonly id: string;
  /** English words that name it, lower case: a verb and its object (`flash keyballplus`, `refresh`). */
  readonly words: string;
  /** What it does, in the current language. */
  readonly title: Localized;
  /** The heading it is listed under on the empty line. */
  readonly group: MessageKey;
  /** It belongs to the panel in front (the flash panel): the empty line lists these first. */
  readonly page?: boolean;
  readonly args?: readonly CommandArgument[];
  /** A single key that runs it when nothing is being typed (`r`, `1`, `Escape`). */
  readonly shortcut?: string;
  /** Editing chords that run it, ⌘ on Mac and Ctrl elsewhere (`z`, `shift+z`): undo, redo, save only (DESIGN.md §8). */
  readonly chords?: readonly string[];
  /** Why it cannot run now; absent when it can. */
  readonly unavailable?: Localized;
  /**
   * Does it. Reads its arguments first and throws CommandRefused when it cannot, so a refusal changes
   * nothing and the line stays open with what was typed.
   */
  readonly run: (args: Readonly<Record<string, string>>) => void;
}

/** Thrown by a command's run when it cannot do what was asked. */
export class CommandRefused extends Error {
  constructor(readonly reason: Localized) {
    super(reason.key);
  }
}

/** Runs a command; returns why it refused, or undefined when it ran. */
export function execute(command: Command, args: Readonly<Record<string, string>>): Localized | undefined {
  if (command.unavailable) return command.unavailable;
  try {
    command.run(args);
  } catch (error) {
    if (error instanceof CommandRefused) return error.reason;
    throw error;
  }
  return undefined;
}

/** How often and how lately the user ran a command: higher first among equal matches. */
export type UsageScore = (commandId: string) => number;

/** Everything a command can be found by besides its words (titles in every language, group). */
export type Describe = (command: Command) => string;

function inOrder(typed: readonly string[], words: readonly string[]): boolean {
  let at = 0;
  for (const t of typed) {
    while (at < words.length && !words[at].startsWith(t)) at++;
    if (at === words.length) return false;
    at++;
  }
  return true;
}

/**
 * The commands a query matches, best first: the words typed in full, then words that start with the
 * query, then commands whose words each start with the query's words in order (`fl k` → `flash
 * keyballplus`), then those whose words, titles or group contain every typed word. Within a tier, what
 * the user runs most comes first, then what can run now, then the order registered.
 */
export function rankCommands(
  query: string,
  commands: readonly Command[],
  usage: UsageScore = () => 0,
  describe: Describe = () => '',
): Command[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ');
  const typed = q.split(' ');
  const tier = (c: Command): number => {
    if (c.words === q) return 0;
    if (c.words.startsWith(q)) return 1;
    if (inOrder(typed, c.words.split(' '))) return 2;
    const haystack = `${c.words} ${describe(c)}`.toLowerCase();
    return typed.every((t) => haystack.includes(t)) ? 3 : -1;
  };
  return commands
    .map((command, index) => ({ command, index, tier: tier(command) }))
    .filter((r) => r.tier >= 0)
    .sort(
      (a, b) =>
        a.tier - b.tier ||
        usage(b.command.id) - usage(a.command.id) ||
        Number(!!a.command.unavailable) - Number(!!b.command.unavailable) ||
        a.index - b.index,
    )
    .map((r) => r.command);
}

/** A part of the list: its commands, under a heading where it has one. */
export interface ListSection {
  readonly heading: MessageKey | undefined;
  readonly commands: readonly Command[];
}

export const NOT_AVAILABLE_NOW: MessageKey = 'line.notNow';

/**
 * What the line lists while a command is being chosen. On the empty line and for `?`: the front
 * panel's commands first, then a heading per group in the order groups were registered, and on the
 * empty line the commands that cannot run now, last, each with its reason. A typed query is one
 * ranked list with no heading.
 */
export function listed(
  query: string,
  commands: readonly Command[],
  usage: UsageScore = () => 0,
  describe: Describe = () => '',
): readonly ListSection[] {
  const q = query.trim();
  if (q !== '' && q !== '?') {
    const ranked = rankCommands(query, commands, usage, describe);
    return ranked.length === 0 ? [] : [{ heading: undefined, commands: ranked }];
  }
  const byUse = (list: readonly Command[]) =>
    list
      .map((command, index) => ({ command, index }))
      .sort((a, b) => usage(b.command.id) - usage(a.command.id) || a.index - b.index)
      .map((r) => r.command);
  const can = commands.filter((c) => !c.unavailable);
  const groups = new Map<MessageKey, Command[]>();
  for (const c of [...can.filter((c) => c.page), ...can.filter((c) => !c.page)]) {
    const group = groups.get(c.group);
    if (group) group.push(c);
    else groups.set(c.group, [c]);
  }
  const sections: ListSection[] = [...groups].map(([heading, list]) => ({ heading, commands: byUse(list) }));
  const cannot = commands.filter((c) => c.unavailable);
  if (q === '' && cannot.length > 0) sections.push({ heading: NOT_AVAILABLE_NOW, commands: byUse(cannot) });
  return sections;
}

/** The words of the first few commands the empty line offers, for the placeholder. */
export function examples(sections: readonly ListSection[], count = 3): string[] {
  return sections
    .flatMap((s) => s.commands)
    .filter((c) => !c.unavailable)
    .slice(0, count)
    .map((c) => c.words);
}

/** What the line holds: a command still being chosen, or a chosen command and its arguments so far. */
export type LineReading =
  | { readonly kind: 'choosing'; readonly query: string }
  | {
      readonly kind: 'arguments';
      readonly command: Command;
      /** The arguments typed in full, by name. */
      readonly given: Readonly<Record<string, string>>;
      /** The slot being typed now; undefined once every required slot is filled. */
      readonly slot: CommandArgument | undefined;
      readonly typed: string;
      /** Values the line cannot place: more than the command takes, or an option it does not have. */
      readonly problems: readonly Localized[];
    };

/**
 * Reads the line. A command is chosen once its words are typed in full and followed by a space; what
 * follows is its arguments: required ones in order, optional ones as `name=value`. A line that is
 * exactly a command's words, with no space yet, is still being chosen, so a longer command that starts
 * with a shorter one's words (`flash`, `flash file`) can still be picked.
 */
export function readLine(text: string, commands: readonly Command[]): LineReading {
  const lead = text.replace(/^\s+/, '');
  const tokens = lead.split(/\s+/).filter((t) => t !== '');
  const lower = tokens.map((t) => t.toLowerCase());
  const closed = /\s$/.test(lead);
  const whole = lower.join(' ');
  let chosen: { command: Command; length: number } | undefined;
  for (const command of commands) {
    if (!closed && command.words === whole) return { kind: 'choosing', query: lead };
    const words = command.words.split(' ');
    if (words.length > lower.length || (words.length === lower.length && !closed)) continue;
    if (words.every((w, i) => lower[i] === w) && (!chosen || words.length > chosen.length)) {
      chosen = { command, length: words.length };
    }
  }
  if (!chosen) return { kind: 'choosing', query: lead };

  const { command } = chosen;
  const args = command.args ?? [];
  const rest = tokens.slice(chosen.length);
  const done = closed ? rest : rest.slice(0, -1);
  const typedNow = closed ? '' : (rest.at(-1) ?? '');
  const given: Record<string, string> = {};
  const problems: Localized[] = [];
  const required = args.filter((a) => a.required);
  let next = 0;

  for (const token of done) {
    const eq = token.indexOf('=');
    if (eq > 0) {
      const name = token.slice(0, eq).toLowerCase();
      const arg = args.find((a) => !a.required && a.name === name);
      if (arg) given[arg.name] = token.slice(eq + 1);
      else problems.push(msg('line.noOption', { command: command.words, name }));
      continue;
    }
    const arg = required[next++];
    if (arg) given[arg.name] = token;
    else problems.push(msg('line.tooMany', { command: command.words, value: token }));
  }

  let slot: CommandArgument | undefined;
  let typed = typedNow;
  const eq = typedNow.indexOf('=');
  if (eq > 0) {
    slot = args.find((a) => !a.required && a.name === typedNow.slice(0, eq).toLowerCase());
    typed = typedNow.slice(eq + 1);
  } else {
    slot = required[next];
  }
  return { kind: 'arguments', command, given, slot, typed, problems };
}

/** The values the slot being typed offers: those starting with what is typed first, then those containing it. */
export function completionsOf(reading: LineReading): readonly Completion[] {
  if (reading.kind === 'choosing') return [];
  const { command, given, slot, typed } = reading;
  const options: readonly Completion[] =
    slot === undefined
      ? (command.args ?? [])
          .filter((a) => !a.required && given[a.name] === undefined)
          .map((a) => ({ value: `${a.name}=` }))
      : (slot.complete?.(given) ?? []);
  const t = typed.toLowerCase();
  const starts = options.filter((o) => o.value.toLowerCase().startsWith(t));
  const contains = options.filter(
    (o) =>
      !o.value.toLowerCase().startsWith(t) &&
      (o.value.toLowerCase().includes(t) || (o.detail ?? '').toLowerCase().includes(t)),
  );
  return [...starts, ...contains];
}

/** What Enter would run, or every reason it would not. */
export function finish(
  reading: Extract<LineReading, { kind: 'arguments' }>,
): { readonly args: Readonly<Record<string, string>> } | { readonly problems: readonly Localized[] } {
  const { command, slot, typed } = reading;
  const args: Record<string, string> = { ...reading.given };
  if (slot !== undefined && typed !== '') args[slot.name] = typed;
  const problems = [...reading.problems];
  if (slot === undefined && typed !== '') {
    problems.push(msg('line.tooMany', { command: command.words, value: typed }));
  }
  const missing = (command.args ?? []).filter((a) => a.required && (args[a.name] ?? '') === '').map((a) => a.name);
  if (missing.length > 0) problems.push(msg('line.missing', { names: missing.join(', ') }));
  for (const arg of command.args ?? []) {
    const value = args[arg.name];
    if (value === undefined || value === '') continue;
    const refused = arg.check?.(value, args);
    if (refused) problems.push(msg('line.argProblem', { name: arg.name, reason: refused }));
  }
  return problems.length > 0 ? { problems } : { args };
}

/** The line once a completion is taken: the command's words, or the slot's value, then a space. */
export function take(text: string, reading: LineReading, item: Command | Completion): string {
  if ('words' in item) return `${item.words} `;
  if (reading.kind === 'choosing') return text;
  const keep = text.replace(/\S*$/, '');
  const named = reading.slot !== undefined && !reading.slot.required ? `${reading.slot.name}=` : '';
  return item.value.endsWith('=') ? `${keep}${item.value}` : `${keep}${named}${item.value} `;
}

/** A command's arguments as the line shows them: `<repo> [eeprom=]`. */
export function signature(command: Command): string {
  return (command.args ?? []).map((a) => (a.required ? `<${a.name}>` : `[${a.name}=]`)).join(' ');
}
