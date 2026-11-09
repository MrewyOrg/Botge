import { ActivityType, Client, GatewayIntentBits, Options } from 'discord.js';

type CacheEntry = {
  readonly id: string;
  readonly client: { readonly user: { readonly id: string } };
};

/** Message handlers work with gateway payloads and explicit fetches, so history need not be cached. */
export function createDiscordClient(): Client {
  return new Client({
    presence: {
      status: 'online',
      activities: [
        { type: ActivityType.Watching, name: 'https://github.com/MrewyOrg/Botge', state: '⚡' }
      ]
    },
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.MessageContent
    ],
    makeCache: Options.cacheWithLimits({
      ...Options.DefaultMakeCacheSettings,
      MessageManager: 0,
      GuildMemberManager: {
        maxSize: 200,
        keepOverLimit: (member: CacheEntry): boolean => member.id === member.client.user.id
      },
      UserManager: {
        maxSize: 1000,
        keepOverLimit: (user: CacheEntry): boolean => user.id === user.client.user.id
      }
    })
  });
}
