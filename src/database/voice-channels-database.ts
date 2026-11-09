import { BaseDatabase } from './base-database.ts';

export class VoiceChannelsDatabase extends BaseDatabase {
  public constructor(filepath: string) {
    super(
      filepath,
      'CREATE TABLE IF NOT EXISTS voiceChannels (guildId TEXT NOT NULL PRIMARY KEY, channelId TEXT NOT NULL) STRICT'
    );
  }

  public getChannelId(guildId: string): string | undefined {
    return this.getRow<{ readonly channelId: string }>(
      'SELECT channelId FROM voiceChannels WHERE guildId = ?',
      guildId
    )?.channelId;
  }

  public setChannelId(guildId: string, channelId: string): void {
    this.execute(
      `INSERT INTO voiceChannels (guildId, channelId) VALUES (?, ?)
      ON CONFLICT(guildId) DO UPDATE SET channelId = excluded.channelId`,
      guildId,
      channelId
    );
  }

  public clearChannelId(guildId: string): void {
    this.execute('DELETE FROM voiceChannels WHERE guildId = ?', guildId);
  }
}
