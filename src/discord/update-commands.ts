import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { ApplicationCommandType, REST, Routes } from 'discord.js';

import { isArrayOf, isRecord } from '../utils/validation.ts';
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
  const route = Routes.applicationCommands(applicationId);
  // Discord creates this command when Activities are enabled. Bulk updates must include it.
  const registered: unknown = await rest.get(route, {
    query: new URLSearchParams({ with_localizations: 'true' })
  });
  if (!isArrayOf(registered, isRecord)) throw new Error('Invalid registered commands response.');
  const launch = registered.find(
    (command: Readonly<Record<string, unknown>>) =>
      command['type'] === ApplicationCommandType.PrimaryEntryPoint
  );
  if (launch !== undefined) {
    const entryPoint = { ...launch };
    delete entryPoint['application_id'];
    delete entryPoint['version'];
    await rest.put(route, { body: [...commands, entryPoint] });
  } else {
    await rest.put(route, { body: commands });
  }

  writeFileSync(lockFilePath, newCommands, { encoding: 'utf8', flag: 'w' });

  console.log('Discord commands updated.');
}
