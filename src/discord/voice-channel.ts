import { getVoiceConnection, joinVoiceChannel, VoiceConnectionStatus } from '@discordjs/voice';
import { type Guild, type REST, Routes } from 'discord.js';

import { logError } from '../utils/log-error.ts';

export function requestVoiceChannelJoin(
  channel: Readonly<{ id: string; guild: Readonly<Pick<Guild, 'id' | 'voiceAdapterCreator'>> }>
): void {
  const { guild } = channel;
  const settings = { channelId: channel.id, selfDeaf: false, selfMute: true };
  const existing = getVoiceConnection(guild.id);

  if (existing !== undefined) {
    if (existing.rejoin(settings)) return;
  } else {
    const connection = joinVoiceChannel({
      ...settings,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator
    });
    connection.on('error', (error: Readonly<Error>): void => {
      logError(error, `Voice connection failed for guild ${guild.id}`);
    });
    if (connection.state.status !== VoiceConnectionStatus.Disconnected) return;
  }

  throw new Error('Discord gateway could not send the voice join request.');
}

export async function setVoiceChannelStatus(
  rest: Readonly<Pick<REST, 'put'>>,
  channelId: string,
  emoji: string
): Promise<void> {
  await rest.put(Routes.channelVoiceStatus(channelId), { body: { status: emoji } });
}
