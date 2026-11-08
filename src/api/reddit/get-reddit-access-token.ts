import { parseAccessToken } from '../access-token.ts';
import { requestJson } from '../http.ts';

export const REDDIT_USER_AGENT = 'Botge (https://github.com/MrewyOrg/Botge)';

export const REDDIT_API_ENDPOINTS = {
  accessToken: 'https://www.reddit.com/api/v1/access_token',
  accessTokenValidate: 'https://oauth.reddit.com/api/v1/scopes', // there is no real validation path.
  livestreamFail: 'https://oauth.reddit.com/r/LivestreamFail'
} as const;

export async function getRedditAccessToken(
  clientId: string,
  clientSecret: string
): Promise<string> {
  const response = await requestJson(REDDIT_API_ENDPOINTS.accessToken, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': REDDIT_USER_AGENT
    },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'read' }).toString()
  });

  return parseAccessToken(response);
}
