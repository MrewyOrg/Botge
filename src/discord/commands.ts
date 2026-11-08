import type {
  RESTPostAPIChatInputApplicationCommandsJSONBody,
  RESTPostAPIContextMenuApplicationCommandsJSONBody
} from 'discord.js';

import { contextMenuCommands } from './context-menu-commands.ts';
import { slashCommands } from './slash-commands.ts';

function validateCommandNames(
  active: readonly string[],
  available: readonly string[],
  kind: string
): void {
  for (const name of active) {
    if (!available.includes(name)) throw new Error(`Unknown ${kind} command: ${name}`);
  }
}

/** Serialize enabled commands in a stable order, rejecting misspelled configuration entries. */
export function getCommands(
  activeSlashCommandNames: readonly string[],
  activeContextMenuCommandNames: readonly string[]
): readonly (
  | Readonly<RESTPostAPIChatInputApplicationCommandsJSONBody>
  | Readonly<RESTPostAPIContextMenuApplicationCommandsJSONBody>
)[] {
  validateCommandNames(
    activeSlashCommandNames,
    slashCommands.map((command) => command.name),
    'slash'
  );
  validateCommandNames(
    activeContextMenuCommandNames,
    contextMenuCommands.map((command) => command.name),
    'context-menu'
  );
  const slash = new Set(activeSlashCommandNames);
  const context = new Set(activeContextMenuCommandNames);
  return [
    ...slashCommands
      .filter((command) => slash.has(command.name))
      .map((command) => command.toJSON()),
    ...contextMenuCommands
      .filter((command) => context.has(command.name))
      .map((command) => command.toJSON())
  ];
}
