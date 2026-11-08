import type { ChatInputCommandInteraction } from 'discord.js';
import { beforeEach, expect, type Mock, test, vi } from 'vitest';

import type { AddedEmotesDatabase } from 'src/database/added-emotes-database.ts';
import type { Guild } from 'src/discord/guild.ts';
import { globalAdministrator, owner, permitted } from 'src/discord/permissions.ts';
import { sevenTVUrlToSevenTVNotInSet } from 'src/emotes/provider-urls.ts';
import { addEmoteHandler } from 'src/handlers/commands/add-emote.ts';

const providerSettings = vi.hoisted(() => ({
  use7TVGlobalEmotes: true,
  use7TVPersonalEmotes: true,
  use7TVAddedEmotes: true,
  useBTTVEmotes: true,
  useFFZEmotes: true,
  useTwitchEmotes: true
}));
vi.mock('src/config/botge-config.ts', () => ({ botgeConfig: { general: providerSettings } }));

vi.mock('src/discord/permissions.ts', () => ({
  globalAdministrator: vi.fn(),
  owner: vi.fn(),
  permitted: vi.fn()
}));
vi.mock('src/emotes/provider-urls.ts', () => ({
  SEVEN_TV_EMOTES_URL: 'https://7tv.app/emotes',
  sevenTVUrlToSevenTVNotInSet: vi.fn()
}));
function setup(
  alias?: string
): Readonly<{
  interaction: ChatInputCommandInteraction;
  guild: Readonly<Guild>;
  database: Readonly<AddedEmotesDatabase>;
  editReply: Mock;
  insert: Mock;
  add: Mock;
  getAll: Mock;
  match: Mock;
}> {
  const editReply = vi.fn().mockResolvedValue(undefined);
  const insert = vi.fn();
  const add = vi.fn();
  const getAll = vi.fn().mockReturnValue([]);
  const match = vi.fn();
  const interaction = {
    user: { id: 'owner' },
    member: {},
    guild: { members: { fetch: vi.fn().mockResolvedValue({ roles: { cache: new Map() } }) } },
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply,
    options: {
      get: (name: string): Readonly<{ value: string }> | null =>
        name === 'url' ? { value: 'https://7tv.app/emotes/id' }
        : alias === undefined ? null
        : { value: alias }
    }
  } as unknown as ChatInputCommandInteraction;
  return {
    interaction,
    editReply,
    insert,
    add,
    getAll,
    match,
    database: { insert, getAll } as unknown as AddedEmotesDatabase,
    guild: {
      id: 'guild',
      allowEveryoneToAddEmote: false,
      addEmotePermittedRoleIds: [],
      emoteCatalog: { matchSingleExact: match },
      personalEmoteStore: { addSevenTVEmoteNotInSet: add }
    } as unknown as Guild
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(permitted).mockReturnValue(true);
  vi.mocked(sevenTVUrlToSevenTVNotInSet).mockResolvedValue({
    id: 'id',
    name: 'Original',
    flags: 0,
    animated: false,
    host: { url: '//cdn.example.com', files: [] }
  });
});
test.each([undefined, 'Alias'])(
  'persists and publishes an added emote with alias %s',
  async (alias) => {
    const target = setup(alias);
    await addEmoteHandler(target.database)(target.interaction, target.guild);
    expect(target.insert).toHaveBeenCalledWith(
      { url: 'https://7tv.app/emotes/id', alias: alias ?? null },
      'guild'
    );
    expect(target.add).toHaveBeenCalledWith(
      expect.objectContaining({ name: alias ?? 'Original', id: 'id' })
    );
  }
);
test('unauthorized users cannot fetch or add emotes', async () => {
  const target = setup();
  vi.mocked(permitted).mockReturnValue(false);
  vi.mocked(owner).mockReturnValue(false);
  vi.mocked(globalAdministrator).mockReturnValue(false);
  await addEmoteHandler(target.database)(target.interaction, target.guild);
  expect(target.editReply).toHaveBeenCalledWith(
    'You do not have the necessary permissions to use this command.'
  );
  expect(sevenTVUrlToSevenTVNotInSet).not.toHaveBeenCalled();
  expect(target.insert).not.toHaveBeenCalled();
});
test.each(['invalid', 'name', 'url'])(
  'rejects %s emotes without updating live state',
  async (reason) => {
    const target = setup();
    if (reason === 'invalid') vi.mocked(sevenTVUrlToSevenTVNotInSet).mockResolvedValue(undefined);
    if (reason === 'name') target.match.mockReturnValue({ name: 'Original' });
    if (reason === 'url')
      target.getAll.mockReturnValue([{ url: 'https://7tv.app/emotes/id', alias: null }]);
    await addEmoteHandler(target.database)(target.interaction, target.guild);
    expect(target.insert).not.toHaveBeenCalled();
    expect(target.add).not.toHaveBeenCalled();
    expect(target.editReply).toHaveBeenCalledWith(
      reason === 'invalid' ? 'Invalid URL.'
      : reason === 'name' ? 'There is already an emote with the same name.'
      : 'There is already an emote with the same URL.'
    );
  }
);

test('disabled 7TV rejects additions before any provider lookup or database change', async () => {
  const target = setup();
  providerSettings.use7TVAddedEmotes = false;
  try {
    await addEmoteHandler(target.database)(target.interaction, target.guild);
    expect(target.editReply).toHaveBeenCalledWith('Added 7TV emotes are disabled by the operator.');
    expect(sevenTVUrlToSevenTVNotInSet).not.toHaveBeenCalled();
    expect(target.insert).not.toHaveBeenCalled();
    expect(target.add).not.toHaveBeenCalled();
  } finally {
    providerSettings.use7TVAddedEmotes = true;
  }
});
