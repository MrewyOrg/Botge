const CDN_PREFIXES: ReadonlyMap<string, string> = new Map([
  ['https://cdn.7tv.app', '/7tv'],
  ['https://cdn.betterttv.net', '/bttv'],
  ['https://cdn.frankerfacez.com', '/ffz'],
  ['https://static-cdn.jtvnw.net', '/twitch']
]);

export class CachedUrl {
  readonly #base: string | undefined;

  public constructor(base: string | undefined) {
    const normalized = base?.trim().replace(/\/+$/u, '');
    this.#base = normalized === '' ? undefined : normalized;
  }

  // translate remote url like https://cdn.tv.app/xxx to a local one pointing to cached data on disk.
  // returns [localUrl, true]. if a url is not supported, returns [remoteUrl, false]
  public get(remoteUrl: string): readonly [string, boolean] {
    if (this.#base === undefined) return [remoteUrl, false];

    const url = URL.parse(remoteUrl);
    if (url === null) return [remoteUrl, false];
    if (url.username !== '' || url.password !== '') return [remoteUrl, false];

    const prefix = CDN_PREFIXES.get(url.origin);
    if (prefix === undefined) return [remoteUrl, false];

    return [this.#base + prefix + url.pathname + url.search, true];
  }
}
