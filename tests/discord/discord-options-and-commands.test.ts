import type {
  ChatInputCommandInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody
} from 'discord.js';
import { expect, expectTypeOf, test } from 'vitest';

import { CONTEXT_MENU_COMMAND_NAMES, SLASH_COMMAND_NAMES } from 'src/discord/command-names.ts';
import { getCommands } from 'src/discord/commands.ts';
import { getOptionValue, getOptionValueWithoutUndefined } from 'src/discord/get-option-value.ts';

function interaction(value?: string | number | boolean): ChatInputCommandInteraction {
  return {
    options: { get: () => (value === undefined ? undefined : { value }) }
  } as unknown as ChatInputCommandInteraction;
}

test.each([false, true])('native boolean option %s preserves its value', (value) => {
  const source = interaction(value);
  expect(getOptionValue(source, 'ephemeral', Boolean)).toBe(value);
  expect(getOptionValueWithoutUndefined(source, 'ephemeral', Boolean)).toBe(value);
  expectTypeOf(getOptionValue(source, 'ephemeral', Boolean)).toEqualTypeOf<boolean | undefined>();
});

test('option helpers trim text, transform values, and distinguish missing options', () => {
  expect(getOptionValue(interaction('  text  '), 'name')).toBe('text');
  expect(getOptionValue(interaction(0), 'size', Number)).toBe(0);
  expect(getOptionValue(interaction(' 12 '), 'size', Number)).toBe(12);
  expect(getOptionValue(interaction('  '), 'flag', Boolean)).toBe(false);
  expect(getOptionValue(interaction(), 'missing')).toBeUndefined();
  expect(() => getOptionValueWithoutUndefined(interaction(), 'required')).toThrow(
    'Undefined required option value.'
  );
  expectTypeOf(getOptionValueWithoutUndefined(interaction('text'), 'name')).toEqualTypeOf<string>();
});

test('every declared command serializes and is registered once in stable definition order', () => {
  const slash = Object.values(SLASH_COMMAND_NAMES);
  const context = Object.values(CONTEXT_MENU_COMMAND_NAMES);
  const commands = getCommands([...slash].reverse().concat(slash), [...context].reverse());
  expect(commands.map((command: { readonly name: string }) => command.name)).toEqual([
    ...slash,
    ...context
  ]);
  expect(getCommands([], [])).toEqual([]);
});

test('unknown command names fail before registration can silently omit them', () => {
  expect(() => getCommands(['typo'], [])).toThrow('Unknown slash command: typo');
  expect(() => getCommands([], ['typo'])).toThrow('Unknown context-menu command: typo');
});

function option(commandName: string, optionName: string): unknown {
  const command = getCommands(
    [commandName],
    []
  )[0] as Readonly<RESTPostAPIChatInputApplicationCommandsJSONBody>;
  return command.options?.find(
    (candidate: { readonly name: string }) => candidate.name === optionName
  );
}

test('numeric and message bounds match the existing handler limits', () => {
  for (const name of ['days', 'hours', 'minutes'])
    expect(option(SLASH_COMMAND_NAMES.pingMe, name)).toMatchObject({ min_value: 1 });
  expect(option(SLASH_COMMAND_NAMES.pingMe, 'message')).toMatchObject({ max_length: 1800 });
  expect(option(SLASH_COMMAND_NAMES.transient, 'duration')).toMatchObject({
    min_value: 0,
    max_value: 600
  });
  expect(option(SLASH_COMMAND_NAMES.findTheEmoji, 'size')).toMatchObject({
    min_value: 3,
    max_value: 7
  });
});
