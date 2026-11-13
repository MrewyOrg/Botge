import { afterEach, beforeEach, expect, type Mock, vi } from 'vitest';

import html from '../../index.html?raw';
import { requireValue } from '../../src/validation.ts';
import type { BrowserEmote } from '../../src/catalog/catalog.ts';

type MockDiscordSDK = {
  readonly guildId: string;
  readonly ready: Mock<() => Promise<void>>;
  readonly commands: {
    readonly authorize: Mock<() => Promise<{ readonly code: string }>>;
    readonly authenticate: Mock<() => Promise<unknown>>;
    readonly openExternalLink: Mock<() => Promise<void>>;
  };
};

const mockSdk: MockDiscordSDK = vi.hoisted(() => ({
  guildId: '123456789012345678',
  ready: vi.fn<() => Promise<void>>(),
  commands: {
    authorize: vi.fn<() => Promise<{ code: string }>>(),
    authenticate: vi.fn<() => Promise<unknown>>(),
    openExternalLink: vi.fn<() => Promise<void>>()
  }
}));

export const sdk: MockDiscordSDK = mockSdk;

vi.mock('@discord/embedded-app-sdk', () => ({
  DiscordSDK: vi.fn(function () {
    return sdk;
  })
}));

export const emoteId = '01234567890123456789012345';
export const discoveryId = '01234567890123456789012346';
export const publicEmote: BrowserEmote = {
  name: 'Wave',
  source: '7TV',
  image: 'emotes/wave.webp',
  animated: false,
  tags: ['Greeting']
};
export const serverEmote: BrowserEmote = {
  ...publicEmote,
  image: `/7tv-cdn/emote/${emoteId}/2x.webp`,
  composeToken: 'Wave',
  sevenTVId: emoteId,
  overlaying: true,
  added: true
};

export function element(selector: string): HTMLElement {
  return requireValue(document.querySelector<HTMLElement>(selector), `Missing ${selector}`);
}

export function input(selector: string): HTMLInputElement {
  return requireValue(document.querySelector<HTMLInputElement>(selector), `Missing ${selector}`);
}

export function previewDialog(): HTMLDialogElement {
  return requireValue(document.querySelector<HTMLDialogElement>('#preview'), 'Missing preview');
}

export function click(selector: string): void {
  element(selector).click();
}

export async function waitForText(selector: string, expected: string): Promise<void> {
  await vi.waitFor(() => {
    expect(element(selector).textContent).toContain(expected);
  });
}

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  sdk.commands.authenticate.mockResolvedValue({});
  vi.stubEnv('VITE_ENABLE_ACTIVITY_ADDS', 'false');
  vi.stubEnv('VITE_ENABLE_ACTIVITY_CATALOG', 'false');
  vi.stubEnv('VITE_ENABLE_7TV_DISCOVERY', 'false');
  vi.stubEnv('VITE_ENABLE_ACTIVITY_SETTINGS', 'false');
  document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
  // jsdom does not implement modal dialog methods.
  const dialog = previewDialog();
  dialog.showModal = (): void => {
    dialog.open = true;
  };
  dialog.close = (): void => {
    dialog.open = false;
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  document.head.querySelector('link[rel="icon"]')?.remove();
});
