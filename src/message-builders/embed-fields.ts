import type { APIEmbedField } from 'discord.js';

/** Preserve full message text while respecting Discord's 1024-character field limit. */
export function textToEmbedFields(name: string, text: string): readonly Readonly<APIEmbedField>[] {
  const value = text || '-';
  const fields: Readonly<APIEmbedField>[] = [];
  for (let offset = 0; offset < value.length; offset += 1024) {
    fields.push({
      name: offset === 0 ? name : `${name} (continued)`,
      value: value.slice(offset, offset + 1024)
    });
  }
  return fields;
}
