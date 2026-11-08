import {
  ApplicationCommandType,
  ContextMenuCommandBuilder,
  InteractionContextType
} from 'discord.js';
import type { DeepReadonly } from 'ts-essentials';

import { CONTEXT_MENU_COMMAND_NAMES } from './command-names.ts';

export const contextMenuCommands: readonly DeepReadonly<ContextMenuCommandBuilder>[] =
  Object.values(CONTEXT_MENU_COMMAND_NAMES).map((name) =>
    new ContextMenuCommandBuilder()
      .setName(name)
      .setType(ApplicationCommandType.Message)
      .setContexts(InteractionContextType.Guild, InteractionContextType.PrivateChannel)
  );
