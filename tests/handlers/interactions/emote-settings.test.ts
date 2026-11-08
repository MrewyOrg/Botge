import type { ModalSubmitInteraction } from 'discord.js';
import { beforeEach, expect, type Mock, test, vi } from 'vitest';

import type { ApiManager } from 'src/bot/api-manager.ts';
import type { DatabaseManager } from 'src/bot/database-manager.ts';
import { MessageBuilderManager } from 'src/bot/message-builder-manager.ts';
import type { Guild } from 'src/discord/guild.ts';
import {
  getBttvApiUrlFromBroadcasterName,
  getFfzApiUrlFromBroadcasterName,
  getSevenTvApiUrlFromSevenTvEmoteSetLink
} from 'src/emotes/provider-urls.ts';
import {
  ASSIGN_EMOTE_SETS_MODAL_CUSTOM_ID,
  BROADCASTER_NAME_TEXT_INPUT_CUSTOM_ID
} from 'src/handlers/interactions/component-ids.ts';
import { modalSubmitHandler } from 'src/handlers/interactions/modal-submit.ts';

const providerSettings = vi.hoisted(() => ({
  use7TVGlobalEmotes: true,
  use7TVPersonalEmotes: true,
  use7TVAddedEmotes: true,
  useBTTVEmotes: true,
  useFFZEmotes: true,
  useTwitchEmotes: true
}));
vi.mock('src/config/botge-config.ts', () => ({ botgeConfig: { general: providerSettings } }));

vi.mock('src/handlers/interactions/settings-permissions.ts', () => ({
  canManageSettings: vi.fn().mockResolvedValue(true)
}));
vi.mock('src/emotes/provider-urls.ts', () => ({
  getBttvApiUrlFromBroadcasterName: vi.fn(),
  getFfzApiUrlFromBroadcasterName: vi.fn(),
  getSevenTvApiUrlFromSevenTvEmoteSetLink: vi.fn()
}));
function setup(
  broadcaster = 'Streamer',
  set = 'https://7tv.app/emote-sets/id'
): Readonly<{
  handle: () => Promise<void>;
  editReply: Mock;
  changeSets: Mock;
  changeBroadcaster: Mock;
  writeSets: Mock;
  writeBroadcaster: Mock;
}> {
  const editReply = vi.fn().mockResolvedValue(undefined);
  const changeSets = vi.fn().mockResolvedValue(undefined);
  const changeBroadcaster = vi.fn().mockResolvedValue(undefined);
  const writeSets = vi.fn();
  const writeBroadcaster = vi.fn();
  const guild = {
    id: 'guild',
    broadcasterName: null,
    personalEmoteStore: { personalEmoteSets: { sevenTv: null, bttv: null, ffz: null } },
    changeBroadcasterNameAndRefreshClips: changeBroadcaster,
    changePersonalEmoteSets: changeSets
  } as unknown as Guild;
  const interaction = {
    customId: ASSIGN_EMOTE_SETS_MODAL_CUSTOM_ID,
    user: { id: 'owner' },
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply,
    fields: {
      getTextInputValue: (id: string): string =>
        id === BROADCASTER_NAME_TEXT_INPUT_CUSTOM_ID ? broadcaster : set
    }
  } as unknown as ModalSubmitInteraction;
  const handle = async (): Promise<void> =>
    modalSubmitHandler(
      [guild],
      [],
      guild,
      new MessageBuilderManager(),
      {
        broadcasterNameAndPersonalEmoteSetsDatabase: {
          changePersonalEmoteSets: writeSets,
          changeBroadcasterName: writeBroadcaster
        }
      } as unknown as DatabaseManager,
      {} as ApiManager
    )(interaction);
  return { handle, editReply, changeSets, changeBroadcaster, writeSets, writeBroadcaster };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSevenTvApiUrlFromSevenTvEmoteSetLink).mockResolvedValue({
    type: 'success',
    url: 'seven-set',
    ownerUsername: 'streamer'
  });
  vi.mocked(getBttvApiUrlFromBroadcasterName).mockResolvedValue({
    type: 'success',
    url: 'bttv-set'
  });
  vi.mocked(getFfzApiUrlFromBroadcasterName).mockResolvedValue({ type: 'success', url: 'ffz-set' });
});
test('valid provider settings refresh the guild and persist resolved URLs', async () => {
  const target = setup();
  await target.handle();
  expect(target.changeBroadcaster).toHaveBeenCalledWith(undefined, 'Streamer');
  expect(target.writeBroadcaster).toHaveBeenCalledWith('guild', 'Streamer');
  expect(target.writeSets).toHaveBeenCalledWith('guild', {
    sevenTv: 'seven-set',
    bttv: 'bttv-set',
    ffz: 'ffz-set'
  });
  expect(target.changeSets).toHaveBeenCalledWith({
    sevenTv: 'seven-set',
    bttv: 'bttv-set',
    ffz: 'ffz-set'
  });
  expect(target.editReply).toHaveBeenCalledWith(expect.stringContaining('Changed 7TV Emote set.'));
});
test('a mismatched 7TV owner leaves settings intact', async () => {
  const target = setup('other');
  await target.handle();
  expect(target.editReply).toHaveBeenCalledWith(
    'Broadcaster name and 7TV emote set owner does not match.'
  );
  expect(target.writeSets).not.toHaveBeenCalled();
  expect(target.changeBroadcaster).not.toHaveBeenCalled();
});
test.each(['seven', 'bttv', 'ffz'])(
  'provider errors abort settings changes: %s',
  async (provider) => {
    const request =
      provider === 'seven' ? getSevenTvApiUrlFromSevenTvEmoteSetLink
      : provider === 'bttv' ? getBttvApiUrlFromBroadcasterName
      : getFfzApiUrlFromBroadcasterName;
    vi.mocked(request).mockResolvedValue({ type: 'error', message: 'provider unavailable' });
    const target = setup();
    await target.handle();
    expect(target.editReply).toHaveBeenCalledWith('provider unavailable');
    expect(target.writeSets).not.toHaveBeenCalled();
    expect(target.writeBroadcaster).not.toHaveBeenCalled();
  }
);
test('empty settings are a no-op', async () => {
  const target = setup('', '');
  await target.handle();
  expect(target.editReply).toHaveBeenCalledWith('Nothing changed.');
  expect(target.writeSets).not.toHaveBeenCalled();
});
test('missing optional provider sets retain provider feedback', async () => {
  vi.mocked(getBttvApiUrlFromBroadcasterName).mockResolvedValue({
    type: 'feedback',
    message: 'no BTTV set'
  });
  vi.mocked(getFfzApiUrlFromBroadcasterName).mockResolvedValue({
    type: 'feedback',
    message: 'no FFZ set'
  });
  const target = setup();
  await target.handle();
  expect(target.writeSets).toHaveBeenCalledWith('guild', {
    sevenTv: 'seven-set',
    bttv: null,
    ffz: null
  });
  expect(target.editReply).toHaveBeenCalledWith(expect.stringContaining('no BTTV set'));
  expect(target.editReply).toHaveBeenCalledWith(expect.stringContaining('no FFZ set'));
});

test.each([
  ['use7TVPersonalEmotes', getSevenTvApiUrlFromSevenTvEmoteSetLink],
  ['useBTTVEmotes', getBttvApiUrlFromBroadcasterName],
  ['useFFZEmotes', getFfzApiUrlFromBroadcasterName]
] as const)('disabled %s cannot be re-enabled through server settings', async (setting, lookup) => {
  providerSettings[setting] = false;
  try {
    const target = setup();
    await target.handle();
    expect(lookup).not.toHaveBeenCalled();
    expect(target.writeSets).toHaveBeenCalledWith('guild', {
      sevenTv: setting === 'use7TVPersonalEmotes' ? null : 'seven-set',
      bttv: setting === 'useBTTVEmotes' ? null : 'bttv-set',
      ffz: setting === 'useFFZEmotes' ? null : 'ffz-set'
    });
  } finally {
    providerSettings[setting] = true;
  }
});
