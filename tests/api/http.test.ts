import { afterEach, expect, test, vi } from 'vitest';

import { requestJson, requestResponse } from 'src/api/http.ts';
import { requireValue } from 'src/utils/validation.ts';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test('successful responses preserve request options and remain readable', async () => {
  const response = Response.json({ value: 42 });
  const fetch = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetch);
  const options = { method: 'POST', headers: { Authorization: 'Bearer test' }, body: '{}' };
  expect(await requestResponse('https://example.com/api', options)).toBe(response);
  const request = requireValue(
    fetch.mock.calls[0],
    'Expected indexed test value.'
  )[1] as Readonly<RequestInit>;
  expect(request).toMatchObject(options);
  expect(request.signal).toBeInstanceOf(AbortSignal);
  expect(await response.json()).toEqual({ value: 42 });
});

test('allowed error statuses remain available to authentication callers', async () => {
  const response = Response.json({ reason: 'expired' }, { status: 401 });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
  expect(await requestResponse('https://example.com', {}, [401])).toBe(response);
  expect(await response.json()).toEqual({ reason: 'expired' });
});

test('rejected status releases the response body before throwing', async () => {
  const cancel = vi.fn();
  const response = new Response(new ReadableStream({ cancel }), { status: 503 });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
  await expect(requestResponse('https://example.com')).rejects.toMatchObject({ status: 503 });
  expect(cancel).toHaveBeenCalledOnce();
});

test('network failures propagate without being misreported as HTTP errors', async () => {
  const error = new TypeError('Connection failed');
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error));
  await expect(requestJson('https://example.com')).rejects.toBe(error);
});

test('malformed JSON is rejected instead of returned as successful data', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not JSON')));
  await expect(requestJson('https://example.com')).rejects.toBeInstanceOf(SyntaxError);
});

test('request timeout aborts the actual fetch signal', async () => {
  const controller = new AbortController();
  const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
  const fetch = vi
    .fn()
    .mockImplementation(
      async (
        _url: string,
        options: Readonly<{ signal: Readonly<Pick<AbortSignal, 'addEventListener'>> }>
      ) => {
        return await new Promise<Response>((_resolve, reject) => {
          options.signal.addEventListener(
            'abort',
            () => {
              reject(new DOMException('Timed out', 'TimeoutError'));
            },
            { once: true }
          );
        });
      }
    );
  vi.stubGlobal('fetch', fetch);
  const pending = requestResponse('https://example.com');
  const rejected = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
  controller.abort(new DOMException('Timed out', 'TimeoutError'));
  await rejected;
  expect(timeout).toHaveBeenCalledWith(expect.any(Number));
});
