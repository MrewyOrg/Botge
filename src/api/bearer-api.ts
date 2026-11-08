import { AccessToken } from './access-token.ts';
import { requestResponse } from './http.ts';

/** Common token validation and one retry after an expired bearer token. */
export abstract class BearerApi {
  readonly #token: AccessToken;
  readonly #validationUrl: string;
  readonly #headers: Readonly<Record<string, string>>;

  protected constructor(
    token: string,
    tokenPath: string,
    acquire: () => Promise<string>,
    validationUrl: string,
    headers: Readonly<Record<string, string>> = {}
  ) {
    this.#token = new AccessToken(token, tokenPath, acquire);
    this.#validationUrl = validationUrl;
    this.#headers = headers;
  }

  public async validateAndGetNewAccessTokenIfInvalid(): Promise<void> {
    const token = this.#token.value;
    const response = await requestResponse(
      this.#validationUrl,
      { headers: { ...this.#headers, Authorization: `Bearer ${token}` } },
      [401]
    );
    await response.body?.cancel();
    if (response.status === 401) await this.#token.refresh(token);
  }

  protected async getJson(url: string): Promise<unknown> {
    const token = this.#token.value;
    let response = await requestResponse(
      url,
      { headers: { ...this.#headers, Authorization: `Bearer ${token}` } },
      [401]
    );
    if (response.status === 401) {
      await response.body?.cancel();
      await this.#token.refresh(token);
      response = await requestResponse(url, {
        headers: { ...this.#headers, Authorization: `Bearer ${this.#token.value}` }
      });
    }
    return response.json();
  }
}
