import { describe, expect, it } from 'vitest';
import { msg } from '../i18n/core';
import {
  CommandRefused,
  completionsOf,
  execute,
  finish,
  listed,
  rankCommands,
  readLine,
  signature,
  take,
  type Command,
} from './model';

const ran: string[] = [];
const cmd = (words: string, extra: Partial<Command> = {}): Command => ({
  id: words.replace(/ /g, '.'),
  words,
  title: msg('cmd.shortcuts'),
  group: 'group.app',
  run: (args) => void ran.push(`${words} ${JSON.stringify(args)}`),
  ...extra,
});

const connect = cmd('connect', {
  group: 'group.repo',
  args: [
    {
      name: 'repo',
      required: true,
      complete: () => [{ value: 'AkiraMisawa/keyballer-config' }, { value: 'someone/keyball-config' }],
      check: (v) => (v.includes('/') ? undefined : msg('repo.invalid')),
    },
    { name: 'branch', required: false },
  ],
});
const commands: Command[] = [
  connect,
  cmd('refresh', { group: 'group.repo', shortcut: 'r' }),
  cmd('flash keyballplus', { group: 'group.firmware' }),
  cmd('flash keyball39', { group: 'group.firmware', unavailable: msg('why.flashing') }),
  cmd('flash file', { group: 'group.firmware' }),
  cmd('port', { group: 'group.flash', page: true }),
];

describe('rankCommands', () => {
  const words = (q: string) => rankCommands(q, commands).map((c) => c.words);

  it('puts exact words first, then words that start with the query', () => {
    expect(words('flash file')[0]).toBe('flash file');
    expect(words('fla')).toEqual(['flash keyballplus', 'flash file', 'flash keyball39']);
  });

  it('matches the first letters of each word in order', () => {
    expect(words('fl k')).toEqual(['flash keyballplus', 'flash keyball39']);
  });

  it('finds commands by their description', () => {
    expect(rankCommands('書き込', commands, () => 0, (c) => (c.words === 'port' ? 'ポートを選ぶ 書き込み' : ''))[0].words).toBe('port');
  });

  it('ranks what the user runs most first among equal matches', () => {
    const usage = (id: string) => (id === 'flash.file' ? 5 : 0);
    expect(rankCommands('flash', commands, usage)[0].words).toBe('flash file');
  });
});

describe('listed', () => {
  it('lists the front panel first and what cannot run last, on the empty line', () => {
    const sections = listed('', commands);
    expect(sections.map((s) => s.heading)).toEqual(['group.flash', 'group.repo', 'group.firmware', 'line.notNow']);
    expect(sections.at(-1)!.commands.map((c) => c.words)).toEqual(['flash keyball39']);
  });

  it('lists everything that can run for ?, without the unavailable section', () => {
    expect(listed('?', commands).map((s) => s.heading)).not.toContain('line.notNow');
  });
});

describe('readLine', () => {
  it('is still choosing while the words have no space after them', () => {
    expect(readLine('flash', commands)).toEqual({ kind: 'choosing', query: 'flash' });
    expect(readLine('connect', commands).kind).toBe('choosing');
  });

  it('chooses the longest matching words once a space follows', () => {
    const r = readLine('flash file ', commands);
    expect(r.kind === 'arguments' && r.command.words).toBe('flash file');
  });

  it('places required values in order and options by name', () => {
    const r = readLine('connect a/b branch=dev ', commands);
    expect(r.kind === 'arguments' && r.given).toEqual({ repo: 'a/b', branch: 'dev' });
  });

  it('reports values it cannot place', () => {
    const r = readLine('connect a/b c/d nope=1 ', commands);
    expect(r.kind === 'arguments' && r.problems.map((p) => p.key)).toEqual(['line.tooMany', 'line.noOption']);
  });
});

describe('completionsOf and take', () => {
  it('offers the slot values that start with what is typed first', () => {
    const r = readLine('connect some', commands);
    expect(completionsOf(r).map((c) => c.value)).toEqual(['someone/keyball-config']);
  });

  it('offers options once the required values are given', () => {
    expect(completionsOf(readLine('connect a/b ', commands)).map((c) => c.value)).toEqual(['branch=']);
  });

  it('writes a command or a value onto the line', () => {
    expect(take('con', readLine('con', commands), connect)).toBe('connect ');
    const r = readLine('connect Aki', commands);
    expect(take('connect Aki', r, { value: 'AkiraMisawa/keyballer-config' })).toBe(
      'connect AkiraMisawa/keyballer-config ',
    );
  });
});

describe('finish', () => {
  it('says what is missing', () => {
    const r = readLine('connect ', commands);
    if (r.kind !== 'arguments') throw new Error('expected arguments');
    expect(finish(r)).toEqual({ problems: [msg('line.missing', { names: 'repo' })] });
  });

  it('says why a value is refused', () => {
    const r = readLine('connect nope', commands);
    if (r.kind !== 'arguments') throw new Error('expected arguments');
    const done = finish(r);
    expect('problems' in done && done.problems[0].key).toBe('line.argProblem');
  });

  it('returns the arguments when the line is complete', () => {
    const r = readLine('connect a/b', commands);
    if (r.kind !== 'arguments') throw new Error('expected arguments');
    expect(finish(r)).toEqual({ args: { repo: 'a/b' } });
  });
});

describe('execute', () => {
  it('runs an available command', () => {
    ran.length = 0;
    expect(execute(commands[1], {})).toBeUndefined();
    expect(ran).toEqual(['refresh {}']);
  });

  it('returns the reason instead of running an unavailable one', () => {
    ran.length = 0;
    expect(execute(commands[3], {})).toEqual(msg('why.flashing'));
    expect(ran).toEqual([]);
  });

  it('turns a refusal into its reason', () => {
    const refusing = cmd('language', {
      run: () => {
        throw new CommandRefused(msg('cmd.language.bad'));
      },
    });
    expect(execute(refusing, {})).toEqual(msg('cmd.language.bad'));
  });
});

describe('signature', () => {
  it('shows required values in angle brackets and options with =', () => {
    expect(signature(connect)).toBe('<repo> [branch=]');
  });
});
