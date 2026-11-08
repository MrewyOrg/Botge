import { DEFAULT_EMOTE_BORDER_COLOR } from '../database/users-database.ts';
import type { Guild } from './guild.ts';

export class User {
  readonly #id: string;
  #guild: Readonly<Guild> | undefined;
  #guildId: string | undefined;
  #enableEmoteBorder: boolean | undefined;
  #emoteBorderColor: string;

  public constructor(
    id: string,
    guild?: Readonly<Guild>,
    enableEmoteBorder?: boolean,
    emoteBorderColor: string = DEFAULT_EMOTE_BORDER_COLOR
  ) {
    this.#id = id;
    this.#guild = guild;
    this.#guildId = guild?.id;
    this.#enableEmoteBorder = enableEmoteBorder;

    this.#emoteBorderColor = emoteBorderColor;
  }

  public get id(): string {
    return this.#id;
  }
  public get guild(): Readonly<Guild> | undefined {
    return this.#guild;
  }
  public get guildId(): string | undefined {
    return this.#guildId;
  }
  public get enableEmoteBorder(): boolean | undefined {
    return this.#enableEmoteBorder;
  }
  public get emoteBorderColor(): string {
    return this.#emoteBorderColor;
  }

  public changeGuild(guild: Readonly<Guild>): void {
    this.#guild = guild;
    this.#guildId = guild.id;
  }

  /** Drop runtime resources while retaining the saved assignment for a later rejoin. */
  public releaseGuild(): void {
    this.#guild = undefined;
  }

  public changeEnableEmoteBorder(enableEmoteBorder: boolean): void {
    this.#enableEmoteBorder = enableEmoteBorder;
  }
  public changeEmoteBorderColor(emoteBorderColor: string): void {
    this.#emoteBorderColor = emoteBorderColor;
  }
}
