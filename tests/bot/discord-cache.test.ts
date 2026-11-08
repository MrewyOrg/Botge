import {
  type CacheConstructors,
  type ClientUser,
  GuildMember,
  GuildMemberManager,
  Message,
  MessageManager,
  type User
} from 'discord.js';
import { expect, test } from 'vitest';

import { createDiscordClient } from 'src/bot/create-discord-client.ts';
import { requireValue } from 'src/utils/validation.ts';

test('Discord caches bound members and users and retain no message history', async () => {
  const client = createDiscordClient();
  try {
    client.user = { id: 'bot' } as unknown as ClientUser;
    const makeCache = requireValue(client.options.makeCache, 'Expected cache factory.');
    const messages = makeCache(
      MessageManager as CacheConstructors['MessageManager'],
      Message,
      MessageManager as CacheConstructors['MessageManager']
    );
    messages.set('message', {});
    expect(messages.size).toBe(0);
    const members = makeCache(
      GuildMemberManager as CacheConstructors['GuildMemberManager'],
      GuildMember,
      GuildMemberManager as CacheConstructors['GuildMemberManager']
    );
    const self = { id: 'bot', client } as unknown as GuildMember;
    members.set(self.id, self);
    client.users.cache.set('bot', { id: 'bot', client } as unknown as User);
    for (let index = 0; index < 1200; index++) {
      const id = String(index);
      members.set(id, { id, client });
      client.users.cache.set(id, { id, client } as unknown as User);
    }
    expect(members.size).toBeLessThanOrEqual(201);
    expect(client.users.cache.size).toBeLessThanOrEqual(1001);
    expect(members.get('bot')).toBe(self);
    expect(client.users.cache.has('bot')).toBe(true);
  } finally {
    await client.destroy();
  }
});
