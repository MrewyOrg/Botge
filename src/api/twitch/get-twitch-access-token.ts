import { parseAccessToken } from '../access-token.ts';
import { requestJson } from '../http.ts';

export const TWITCH_API_ENDPOINTS = {
  accessToken: 'https://id.twitch.tv/oauth2/token',
  accessTokenValidate: 'https://id.twitch.tv/oauth2/validate',
  users: 'https://api.twitch.tv/helix/users',
  games: 'https://api.twitch.tv/helix/games',
  clips: 'https://api.twitch.tv/helix/clips',
  emotesGlobal: 'https://api.twitch.tv/helix/chat/emotes/global'
} as const;

export async function getTwitchAccessToken(
  clientId: string,
  clientSecret: string
): Promise<string> {
  const response = await requestJson(TWITCH_API_ENDPOINTS.accessToken, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials'
    }).toString()
  });

  return parseAccessToken(response);
}
