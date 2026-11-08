import { loadAccessToken } from '../access-token.ts';
import { getRedditAccessToken } from './get-reddit-access-token.ts';
import { REDDIT_ACCESS_TOKEN_PATH, RedditApi } from './reddit-api.ts';

export async function newRedditApi(
  clientId: string,
  secret: string,
  tokenPath: string = REDDIT_ACCESS_TOKEN_PATH
): Promise<Readonly<RedditApi>> {
  const { token, cached } = await loadAccessToken(tokenPath, async () =>
    getRedditAccessToken(clientId, secret)
  );
  const api = new RedditApi(clientId, secret, token, tokenPath);
  if (cached) await api.validateAndGetNewAccessTokenIfInvalid();
  return api;
}
