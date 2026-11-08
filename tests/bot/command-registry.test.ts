import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type ChatInputCommandInteraction, Client } from 'discord.js';
import { expect, test, vi } from 'vitest';

import { CachedUrl } from 'src/api/cached-url.ts';
import { ApiManager } from 'src/bot/api-manager.ts';
import { createCommandHandlers } from 'src/bot/create-command-handlers.ts';
import { DatabaseManager } from 'src/bot/database-manager.ts';
import { MessageBuilderManager } from 'src/bot/message-builder-manager.ts';
import { openDatabases } from 'src/database/open-databases.ts';
import { SLASH_COMMAND_NAMES } from 'src/discord/command-names.ts';
import type { Guild } from 'src/discord/guild.ts';
import { requireValue } from 'src/utils/validation.ts';

test('the real command registry wires optional integrations and stored media', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'botge-registry-'));
  const manager = new DatabaseManager(openDatabases(directory));
  try {
    manager.mediaDatabase.insert('owner', {
      name: 'saved',
      url: 'https://example.com/image.png',
      dateAdded: new Date()
    });
    const api = new ApiManager(
      undefined,
      undefined,
      new CachedUrl(undefined),
      undefined,
      undefined
    );
    expect(api.twitchApi).toBeUndefined();
    expect(api.twitchClipsMeilisearch).toBeUndefined();
    const registry = createCommandHandlers(
      [],
      new Client({ intents: [] }),
      new MessageBuilderManager(),
      manager,
      api
    );
    const reply = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      user: { id: 'owner' },
      options: { get: (): Readonly<{ value: string }> => ({ value: 'saved' }) },
      reply
    } as unknown as ChatInputCommandInteraction;
    for (const name of [
      SLASH_COMMAND_NAMES.media,
      SLASH_COMMAND_NAMES.translate,
      SLASH_COMMAND_NAMES.chatGpt
    ])
      await requireValue(registry.get(name), 'Expected registered handler.')(
        interaction,
        {} as Guild
      );
    expect(reply).toHaveBeenCalledWith('https://example.com/image.png');
    expect(reply).toHaveBeenCalledWith('Translate command is not available right now.');
    expect(reply).toHaveBeenCalledWith('ChatGPT command is not available right now.');
    expect(manager.usersDatabase.getAllUsers()).toEqual([]);
    expect(manager.permittedRoleIdsDatabase).toBe(manager.databases.permittedRoleIdsDatabase);
    expect(manager.broadcasterNameAndPersonalEmoteSetsDatabase).toBe(
      manager.databases.broadcasterNameAndPersonalEmoteSetsDatabase
    );
  } finally {
    manager.closeDatabases();
    rmSync(directory, { recursive: true, force: true });
  }
});
