import type { AutocompleteInteraction, ChatInputCommandInteraction } from 'discord.js';

type OptionInteraction = Readonly<{
  options: Readonly<
    Pick<(ChatInputCommandInteraction | AutocompleteInteraction)['options'], 'get'>
  >;
}>;

export function getOptionValue(
  interaction: OptionInteraction,
  optionName: string
): string | undefined;
export function getOptionValue<T>(
  interaction: OptionInteraction,
  optionName: string,
  transformFunction: (param: string) => T
): T | undefined;
export function getOptionValue(
  interaction: OptionInteraction,
  optionName: string,
  transformFunction?: (param: string) => unknown
): unknown {
  const value = interaction.options.get(optionName)?.value;
  if (value === undefined) return undefined;
  // Boolean('false') is true: native boolean options must bypass string conversion.
  if (transformFunction === Boolean && typeof value === 'boolean') return value;
  const text = String(value).trim();
  return transformFunction === undefined ? text : transformFunction(text);
}

export function getOptionValueWithoutUndefined(
  interaction: OptionInteraction,
  optionName: string
): string;
export function getOptionValueWithoutUndefined<T>(
  interaction: OptionInteraction,
  optionName: string,
  transformFunction: (param: string) => T
): T;
export function getOptionValueWithoutUndefined(
  interaction: OptionInteraction,
  optionName: string,
  transformFunction?: (param: string) => unknown
): unknown {
  const value =
    transformFunction === undefined ?
      getOptionValue(interaction, optionName)
    : getOptionValue(interaction, optionName, transformFunction);
  if (value === undefined) throw new Error(`Undefined ${optionName} option value.`);
  return value;
}
