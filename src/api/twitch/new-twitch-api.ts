import { loadAccessToken } from '../access-token.ts';
import { getTwitchAccessToken } from './get-twitch-access-token.ts';
import { TWITCH_ACCESS_TOKEN_PATH, TwitchApi } from './twitch-api.ts';

export async function newTwitchApi(
  clientId: string,
  secret: string,
  tokenPath: string = TWITCH_ACCESS_TOKEN_PATH
): Promise<Readonly<TwitchApi>> {
  const { token, cached } = await loadAccessToken(tokenPath, async () =>
    getTwitchAccessToken(clientId, secret)
  );
  const api = new TwitchApi(clientId, secret, token, tokenPath);
  if (cached) await api.validateAndGetNewAccessTokenIfInvalid();
  return api;
}
