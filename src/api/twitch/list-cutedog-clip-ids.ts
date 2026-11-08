import { requireValue } from '../../utils/validation.ts';
import { requestResponse } from '../http.ts';

const url =
  'https://docs.google.com/spreadsheets/u/0/d/e/2PACX-1vSWIkcAv-1T59HWffSdJwn1P4m5Kp4hjIahweIbinW2uO1TPbv2AoYH4QJL5hXL339ll3xua8ir9E8g/pubhtml/sheet?headers=false&gid=1208720498' as const;
const clipPattern1 = /https:\/\/clips\.twitch\.tv\/(?<id>[A-Za-z0-9_-]+)/gu;
const clipPattern2 = /https:\/\/www\.twitch\.tv\/cutedog_\/clip\/(?<id>[A-Za-z0-9_-]+)/gu;

export async function listCutedogClipIds(): Promise<readonly string[]> {
  const html = await (await requestResponse(url)).text();

  const ids = new Set<string>();
  for (const pattern of [clipPattern1, clipPattern2]) {
    for (const match of html.matchAll(pattern)) {
      ids.add(requireValue(match.groups?.['id'], 'Clip URL pattern must capture an ID.'));
    }
  }
  return [...ids];
}
