import { BaseDatabase } from './base-database.ts';

type VoiceStatusSettings = Readonly<{ enabled: boolean; emoji: string | null }>;

export class VoiceChannelsDatabase extends BaseDatabase {
  public constructor(filepath: string) {
    super(
      filepath,
      `CREATE TABLE IF NOT EXISTS voiceChannels (
        guildId TEXT NOT NULL PRIMARY KEY,
        channelId TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS voiceChannelStatus (
        guildId TEXT NOT NULL PRIMARY KEY,
        enabled INTEGER NOT NULL,
        emoji TEXT
      ) STRICT`
    );
  }

  public getChannelId(guildId: string): string | undefined {
    return this.getRow<{ readonly channelId: string }>(
      'SELECT channelId FROM voiceChannels WHERE guildId = ?',
      guildId
    )?.channelId;
  }

  public getStatusSettings(guildId: string): VoiceStatusSettings {
    const row = this.getRow<{ readonly enabled: number; readonly emoji: string | null }>(
      'SELECT enabled, emoji FROM voiceChannelStatus WHERE guildId = ?',
      guildId
    );
    return { enabled: row?.enabled === 1, emoji: row?.emoji ?? null };
  }

  public saveSettings(
    guildId: string,
    channelId: string | undefined,
    status: VoiceStatusSettings
  ): void {
    this.databaseSync.exec('BEGIN');
    try {
      if (channelId === undefined)
        this.execute('DELETE FROM voiceChannels WHERE guildId = ?', guildId);
      else
        this.execute(
          `INSERT INTO voiceChannels (guildId, channelId) VALUES (?, ?)
          ON CONFLICT(guildId) DO UPDATE SET channelId = excluded.channelId`,
          guildId,
          channelId
        );
      this.execute(
        `INSERT INTO voiceChannelStatus (guildId, enabled, emoji) VALUES (?, ?, ?)
        ON CONFLICT(guildId) DO UPDATE SET enabled = excluded.enabled, emoji = excluded.emoji`,
        guildId,
        Number(status.enabled),
        status.emoji
      );
      this.databaseSync.exec('COMMIT');
    } catch (error) {
      this.databaseSync.exec('ROLLBACK');
      throw error;
    }
  }
}
