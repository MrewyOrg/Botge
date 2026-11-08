import type { SevenTVEmotes } from '../../types.ts';
import { isArrayOf, isRecord } from '../../utils/validation.ts';
import { isSevenTVEmoteInSet } from '../provider-data.ts';

type Change = {
  readonly key: string;
  readonly index?: number;
  readonly nested?: boolean;
  readonly value?: unknown;
  readonly old_value?: unknown;
};
export type SetUpdate = {
  readonly id?: string;
  readonly pushed?: readonly Change[];
  readonly pulled?: readonly Change[];
  readonly updated?: readonly Change[];
};

function isChange(value: unknown): value is Change {
  return (
    isRecord(value)
    && typeof value['key'] === 'string'
    && (value['index'] === undefined
      || (typeof value['index'] === 'number' && Number.isInteger(value['index'])))
    && (value['nested'] === undefined || typeof value['nested'] === 'boolean')
  );
}

export function isSetUpdate(value: unknown): value is SetUpdate {
  return (
    isRecord(value)
    && (value['id'] === undefined || typeof value['id'] === 'string')
    && ['pushed', 'pulled', 'updated'].every(
      (key) => value[key] === undefined || isArrayOf(value[key], isChange)
    )
  );
}

/** Apply complete v3 emote changes; unknown/nested patches request a fresh snapshot. */
export function applySetUpdate(
  snapshot: SevenTVEmotes,
  update: SetUpdate
): SevenTVEmotes | undefined {
  const emotes = [...snapshot.emotes];
  for (const change of update.pushed ?? []) {
    if (change.key !== 'emotes') continue;
    if (!isSevenTVEmoteInSet(change.value)) return undefined;
    const { value } = change;
    const existing = emotes.findIndex((emote) => emote.id === value.id);
    if (existing === -1) emotes.push(change.value);
    else emotes[existing] = change.value;
  }
  for (const change of update.updated ?? []) {
    if (change.key !== 'emotes') continue;
    if (change.nested === true || !isSevenTVEmoteInSet(change.value)) return undefined;
    const { value } = change;
    const existing = emotes.findIndex((emote) => emote.id === value.id);
    if (existing === -1) return undefined;
    emotes[existing] = change.value;
  }
  for (const change of update.pulled ?? []) {
    if (change.key !== 'emotes') continue;
    const id =
      isRecord(change.old_value) && typeof change.old_value['id'] === 'string' ?
        change.old_value['id']
      : undefined;
    if (id === undefined) return undefined;
    const existing = emotes.findIndex((emote) => emote.id === id);
    if (existing !== -1) emotes.splice(existing, 1);
  }
  return { ...snapshot, emotes };
}
