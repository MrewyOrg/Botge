// Copyright (c) 2026 MrewyOrg. Licensed under the MIT license.
// See LICENSE.txt in the project root for license information.

/**
 * Botge's Discord Activity for browsing emotes, composing previews, and editing settings.
 *
 * @remarks
 * This browser entry resolves the enabled features, then creates and connects the catalog,
 * composer, and settings modules. Discord-only features follow the build flags and the current
 * guild context; outside Discord, the demo flag runs them against in-memory placeholders.
 * The package also includes the Cloudflare Worker that authenticates HTML requests.
 *
 * @see {@link https://github.com/MrewyOrg/Botge/wiki/Activity | Activity guide}
 * @packageDocumentation
 */

import { DiscordSDK } from '@discord/embedded-app-sdk';

import demoEmoteUrl from '../../assets/botge-emoji.png';
import iconUrl from '../../assets/botge-icon.png';
import { type ActivityOperation, createActivityApi, waitForDiscord } from './activity-api.ts';
import { parseCatalog } from './catalog/catalog.ts';
import { createEmoteAccess } from './catalog/emote-access.ts';
import { createEmoteActions } from './catalog/emote-actions.ts';
import { createEmotePreview } from './catalog/emote-preview.ts';
import {
  type BrowseMode,
  createEmoteResults,
  type DiscoveryPage
} from './catalog/emote-results.ts';
import { createEmoteSelection } from './catalog/emote-selection.ts';
import { createEmoteTiles } from './catalog/emote-tiles.ts';
import { createFilterPanel } from './catalog/filter-panel.ts';
import { fetchDiscoveryPage } from './catalog/seventv.ts';
import { createComposer } from './composer/composer.ts';
import type { DemoServer } from './demo/demo-server.ts';
import { resolveFeatures } from './features.ts';
import { trackInputModality } from './input-modality.ts';
import { createPageNavigation } from './page-navigation.ts';
import { mountEmoteBorderSettings } from './settings/emote-border-settings.ts';
import { mountEmoteSettings } from './settings/emote-settings.ts';
import { mountVoiceSettings } from './settings/voice-settings.ts';
import { requireValue } from './validation.ts';
import './style.scss';

trackInputModality();

const favicon = document.createElement('link');
favicon.rel = 'icon';
favicon.href = iconUrl;
document.head.append(favicon);

const appId = /^(?<appId>\d+)\.discordsays\.com$/u.exec(location.hostname)?.groups?.['appId'];
const discord =
  appId === undefined ? undefined : new DiscordSDK(appId, { disableConsoleLogOverride: true });
const activityApi =
  discord === undefined || appId === undefined ?
    undefined
  : createActivityApi({
      authorize: async () =>
        await discord.commands.authorize({
          client_id: appId,
          response_type: 'code',
          state: '',
          prompt: 'none',
          scope: ['identify']
        }),
      authenticate: async (token) => await discord.commands.authenticate({ access_token: token })
    });
const features = resolveFeatures(import.meta.env, {
  embedded: discord !== undefined,
  guildId: discord?.guildId ?? undefined
});

/**
 * Loads the demo backend and notice as a separate chunk.
 *
 * @remarks
 * Production builds replace the dot-access flag with a constant, so this branch and both demo
 * modules are left out of their bundle entirely.
 */
async function loadDemo(): Promise<DemoServer> {
  const [{ createDemoServer }, { mountDemoNotice }] = await Promise.all([
    import('./demo/demo-server.ts'),
    import('./demo/demo-notice.ts')
  ]);
  mountDemoNotice();
  return createDemoServer();
}
const demo =
  import.meta.env.VITE_ENABLE_ACTIVITY_DEMO === 'true' && features.demo ?
    await loadDemo()
  : undefined;

async function requestServer(...operation: ActivityOperation): Promise<unknown> {
  if (demo !== undefined) return await demo.request(...operation);
  if (activityApi === undefined) throw new Error('Open Botge inside Discord.');
  return await activityApi(...operation);
}

const message = requireValue(document.querySelector('#message'), 'Missing status message.');
function report(feedback: string): void {
  message.textContent = feedback;
}

const composer = createComposer();
const access = createEmoteAccess(features.adds);
const filters = createFilterPanel();
const navigation = createPageNavigation();
const selection = createEmoteSelection({
  composer,
  canChange: access.canChange,
  isBusy: access.isBusy
});
const preview = createEmotePreview({
  composer,
  canChange: access.canChange,
  isBusy: access.isBusy,
  onCompose(): void {
    selection.refresh();
  },
  linkSevenTV: !features.demo,
  openExternal:
    discord === undefined ? undefined : (
      async (url): Promise<unknown> => await discord.commands.openExternalLink({ url })
    )
});
const tiles = createEmoteTiles({ composer, access, selection, preview, report });
const results = createEmoteResults({
  tile: tiles.make,
  discover: async (mode, page, query, signal): Promise<DiscoveryPage> =>
    demo === undefined ?
      await fetchDiscoveryPage(
        mode,
        page,
        query.query,
        query.motion,
        discord !== undefined,
        signal,
        query.overlay,
        query.tags
      )
    : await demo.discover(mode, page, query.query, query.motion, query.overlay, query.tags),
  access,
  composeAnyDiscovery: discord === undefined,
  filters,
  report,
  onCatalog(): void {
    selection.refresh();
  }
});
const actions = createEmoteActions({
  request: requestServer,
  guildId: features.guildId,
  catalogGuildId: features.catalogGuildId,
  access,
  results,
  selection,
  preview,
  report
});

function element(selector: string): HTMLElement {
  return requireValue(document.querySelector<HTMLElement>(selector), `Missing ${selector}.`);
}

/** Shows the catalog, Trending, and Top tabs and switches the controls each mode supports. */
function mountBrowseModes(): void {
  const buttons = [
    ['catalog', element('#catalog-mode')],
    ['trending', element('#trending-mode')],
    ['top', element('#top-mode')]
  ] as const;
  const serverOnly = [element('#added-filter'), element('#refresh-catalog')];
  for (const [value, button] of buttons) {
    button.addEventListener('click', () => {
      if (results.mode() !== value) selection.clear();
      const catalogMode = value === 'catalog';
      element('#source-filter').hidden = !catalogMode;
      for (const control of serverOnly)
        control.hidden = !catalogMode || features.catalogGuildId === undefined;
      for (const [key, tab] of buttons) tab.setAttribute('aria-pressed', String(key === value));
      results.setMode(value satisfies BrowseMode);
      if (catalogMode) void actions.refreshCatalog();
    });
  }
  element('#browse-modes').hidden = false;
}

/**
 * Mounts the settings panels for a guild, loading the border at once so the composer preview
 * matches the bot's rendered image.
 */
function mountSettings(guildId: string): void {
  navigation.enableSettings();
  void mountEmoteBorderSettings(async (color) => {
    if (color === undefined) return await requestServer('settings/border/read', guildId);
    return await requestServer('settings/border', guildId, { color });
  }, composer.setBorder).load();
  mountVoiceSettings(async (voice) => {
    if (voice === undefined) return await requestServer('settings', guildId);
    return await requestServer('settings/voice', guildId, { voice });
  });
  mountEmoteSettings(async (emotes) => {
    if (emotes === undefined) return await requestServer('settings/emotes/read', guildId);
    return await requestServer('settings/emotes', guildId, { emotes });
  });
}

/** Loads the curated preview catalog, or a single Botge emote when it is empty. */
async function loadLocalCatalog(): Promise<void> {
  const response = await fetch('./catalog.json', { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error('Could not fetch the emote catalog.');
  const loaded = parseCatalog((await response.json()) as unknown);
  const entries =
    loaded.length === 0 ?
      [
        {
          name: 'Botge',
          source: 'Demo',
          image: demoEmoteUrl,
          animated: false,
          composeToken: 'Botge'
        }
      ]
    : loaded;
  access.setCatalog(entries);
  results.setCatalog(entries);
}

async function loadActivity(): Promise<void> {
  if (discord !== undefined)
    await waitForDiscord(async () => {
      await discord.ready();
    });
  if (features.settingsGuildId !== undefined) mountSettings(features.settingsGuildId);

  preview.connectChanges(actions.change);
  tiles.connectChanges((emote, removing, feedback) => {
    void actions.change(emote, removing, feedback);
  });
  selection.connectChanges((removing) => {
    void actions.changeSelection(removing);
  });
  filters.connectClear(() => {
    results.update();
  });
  for (const [selector, delay] of [
    ['#search', 300],
    ['#tag-search', 300]
  ] as const) {
    element(selector).addEventListener('input', () => {
      results.update(delay);
    });
  }
  for (const selector of ['#source', '#motion', '#overlay-filter'] as const) {
    element(selector).addEventListener('change', () => {
      results.update();
    });
  }
  element('#more').addEventListener('click', () => {
    results.showMore();
  });
  if (features.discovery) mountBrowseModes();

  if (features.catalogGuildId === undefined) {
    await loadLocalCatalog();
    return;
  }
  const addedFilter = element('#added-filter');
  const refresh = element('#refresh-catalog');
  refresh.hidden = false;
  addedFilter.hidden = false;
  addedFilter.addEventListener('click', () => {
    addedFilter.setAttribute(
      'aria-pressed',
      String(addedFilter.getAttribute('aria-pressed') !== 'true')
    );
    results.update();
  });
  refresh.addEventListener('click', () => {
    void actions.refreshCatalog();
  });
  await actions.refreshCatalog();
}

void loadActivity().catch((error: unknown) => {
  if (results.mode() === 'catalog')
    report('Could not load emotes. Reopen the Activity to try again.');
  console.error(error);
});
