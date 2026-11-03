/** @format */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { createHash } from 'node:crypto';

import { REST, Routes } from 'discord.js';

import { getCommands } from '../../../modules/discord/commands.ts';

export async function updateCommands(
  lockFilePath: string,
  activeSlashCommandNames: readonly string[],
  activeContextMenuCommandNames: readonly string[]
): Promise<void> {
  const { APP_ID, DISCORD_TOKEN } = process.env;

  delete process.env['APP_ID'];
  delete process.env['DISCORD_TOKEN'];

  if (DISCORD_TOKEN === undefined || APP_ID === undefined || DISCORD_TOKEN === '' || APP_ID === '')
    throw new Error('DISCORD_TOKEN and APP_ID required.');

  const commands = getCommands(activeSlashCommandNames, activeContextMenuCommandNames);

  const currentCommands = ((): string | undefined => {
    if (!existsSync(lockFilePath)) return undefined;
    return readFileSync(lockFilePath, 'utf8');
  })();
  const newCommands = createHash('md5').update(JSON.stringify(commands)).digest('hex');

  if (currentCommands !== undefined && currentCommands === newCommands) {
    console.log('No commands change detected.');
    return;
  }

  console.log('Discord commands updating.');

  const rest: Readonly<REST> = new REST().setToken(DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(APP_ID), { body: commands });

  writeFileSync(lockFilePath, newCommands, { encoding: 'utf8', flag: 'w' });

  console.log('Discord commands updated.');
}
