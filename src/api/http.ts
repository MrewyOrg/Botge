type RequestOptions = {
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
};

const REQUEST_TIMEOUT_MS = 300_000;

export class HttpError extends Error {
  public readonly status: number;

  public constructor(url: string, status: number) {
    const parsed = URL.parse(url);
    super(
      `HTTP ${status} from ${parsed === null ? 'API endpoint' : parsed.origin + parsed.pathname}`
    );
    this.name = 'HttpError';
    this.status = status;
  }
}

/** Bound requests and reject HTTP errors before decoding their bodies as successful data. */
export async function requestResponse(
  url: string,
  init: RequestOptions = {},
  allowedStatuses: readonly number[] = []
): Promise<Response> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok && !allowedStatuses.includes(response.status)) {
    await response.body?.cancel();
    throw new HttpError(url, response.status);
  }
  return response;
}

export async function requestJson(url: string, init?: RequestOptions): Promise<unknown> {
  return (await requestResponse(url, init)).json();
}
