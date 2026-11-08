import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { REST, Routes } from 'discord.js';

import { getCommands } from './commands.ts';

export async function updateCommands(
  lockFilePath: string,
  activeSlashCommandNames: readonly string[],
  activeContextMenuCommandNames: readonly string[],
  applicationId: string,
  discordToken: string
): Promise<void> {
  if (discordToken.trim() === '' || applicationId.trim() === '')
    throw new Error('DISCORD_TOKEN and APP_ID required.');

  const commands = getCommands(activeSlashCommandNames, activeContextMenuCommandNames);

  const currentCommands = ((): string | undefined => {
    if (!existsSync(lockFilePath)) return undefined;
    return readFileSync(lockFilePath, 'utf8');
  })();
  const newCommands = createHash('sha256')
    .update(JSON.stringify({ applicationId, commands }))
    .digest('hex');

  if (currentCommands !== undefined && currentCommands === newCommands) {
    console.log('No commands change detected.');
    return;
  }

  console.log('Discord commands updating.');

  const rest: Readonly<REST> = new REST().setToken(discordToken);
  await rest.put(Routes.applicationCommands(applicationId), { body: commands });

  writeFileSync(lockFilePath, newCommands, { encoding: 'utf8', flag: 'w' });

  console.log('Discord commands updated.');
}
