import { DATABASE_DIR } from '../../config/directory-paths.ts';
import { checked, isArrayOf, isRecord } from '../../utils/validation.ts';
import { BearerApi } from '../bearer-api.ts';
import {
  getRedditAccessToken,
  REDDIT_API_ENDPOINTS,
  REDDIT_USER_AGENT
} from './get-reddit-access-token.ts';

type RedditLivestreamFails = {
  readonly data: {
    readonly children: readonly {
      readonly data: { readonly permalink: string; readonly over_18: boolean };
    }[];
  };
};
function isListing(value: unknown): value is RedditLivestreamFails {
  return (
    isRecord(value)
    && isRecord(value['data'])
    && isArrayOf(
      value['data']['children'],
      (child): child is RedditLivestreamFails['data']['children'][number] =>
        isRecord(child)
        && isRecord(child['data'])
        && typeof child['data']['permalink'] === 'string'
        && typeof child['data']['over_18'] === 'boolean'
    )
  );
}
export const REDDIT_ACCESS_TOKEN_PATH: 'data/redditAccessToken.txt' = `${DATABASE_DIR}/redditAccessToken.txt`;

export class RedditApi extends BearerApi {
  public constructor(
    clientId: string,
    secret: string,
    accessToken: string,
    tokenPath: string = REDDIT_ACCESS_TOKEN_PATH
  ) {
    super(
      accessToken,
      tokenPath,
      async () => getRedditAccessToken(clientId, secret),
      REDDIT_API_ENDPOINTS.accessTokenValidate,
      { 'User-Agent': REDDIT_USER_AGENT }
    );
  }

  public async getLivestreamFails(): Promise<RedditLivestreamFails> {
    return checked(
      await this.getJson(`${REDDIT_API_ENDPOINTS.livestreamFail}/hot.json?limit=5`),
      isListing,
      'Reddit listing'
    );
  }
}
