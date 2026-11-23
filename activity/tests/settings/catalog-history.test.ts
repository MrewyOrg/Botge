// @vitest-environment jsdom

import { beforeEach, expect, test, vi } from 'vitest';

import html from '../../index.html?raw';
import { mountCatalogHistory } from '../../src/settings/catalog-history.ts';
import { requireValue } from '../../src/validation.ts';

beforeEach(() => {
  document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
});

const POLICY = { sevenTvSet: null, allowEveryone: false, allowedRoles: [] } as const;

test('shows a restore preview before committing and clears a stale confirmation', async () => {
  const load = vi
    .fn()
    .mockResolvedValue({
      currentRevision: 3,
      revisions: [{ revision: 1, recordedAt: 100, actorId: null, edit: { type: 'baseline' } }]
    });
  const preview = vi
    .fn()
    .mockResolvedValue({
      currentRevision: 3,
      targetRevision: 1,
      added: ['<emote>'],
      removed: [],
      updated: [],
      orderChanged: false,
      currentSettings: POLICY,
      restoredSettings: POLICY
    });
  const restore = vi
    .fn()
    .mockResolvedValueOnce({ message: 'The catalog changed. Open a new restore preview.' })
    .mockResolvedValueOnce({ currentRevision: 4 });
  const onRestore = vi.fn();
  mountCatalogHistory({ load, preview, restore, onRestore });

  const panel = requireValue(
    document.querySelector<HTMLDetailsElement>('#catalog-history'),
    'Missing panel.'
  );
  const button = (name: string): HTMLButtonElement =>
    requireValue(panel.querySelector<HTMLButtonElement>(`[name="${name}"]`), 'Missing button.');
  const open = button('history-preview');
  const confirm = button('history-restore');
  button('history-refresh').click();
  await vi.waitFor(() => {
    expect(open.disabled).toBe(false);
  });
  expect(confirm.hidden).toBe(true);
  open.click();
  await vi.waitFor(() => {
    expect(confirm.hidden).toBe(false);
  });
  expect(panel.querySelector('ul')?.textContent).toContain('Add <emote>');
  expect(panel.querySelector('ul emote')).toBeNull();
  expect(restore).not.toHaveBeenCalled();
  confirm.click();
  await vi.waitFor(() => {
    expect(panel.querySelector('[role="status"]')?.textContent).toContain('changed');
  });
  expect(confirm.hidden).toBe(true);
  expect(onRestore).not.toHaveBeenCalled();

  open.click();
  await vi.waitFor(() => {
    expect(confirm.hidden).toBe(false);
  });
  confirm.click();
  await vi.waitFor(() => {
    expect(onRestore).toHaveBeenCalledOnce();
  });
  expect(restore).toHaveBeenLastCalledWith(1, 3);
});

const HISTORY = {
  currentRevision: 1,
  revisions: [
    { revision: 1, recordedAt: 10, actorId: '22', edit: { type: 'restored', revision: 0 } },
    { revision: 0, recordedAt: 1, actorId: '22', edit: { type: 'added', name: 'Wave' } }
  ]
} as const;
const PREVIEW = {
  currentRevision: 1,
  targetRevision: 1,
  added: [],
  removed: [],
  updated: [],
  orderChanged: false,
  currentSettings: POLICY,
  restoredSettings: POLICY
} as const;

function mount(
  history: unknown,
  preview: unknown = PREVIEW
): {
  readonly panel: HTMLDetailsElement;
  readonly pick: HTMLButtonElement;
  readonly confirm: HTMLButtonElement;
  readonly status: Element;
  readonly restore: ReturnType<typeof vi.fn>;
} {
  const restore = vi.fn();
  mountCatalogHistory({
    load: vi.fn().mockResolvedValue(history),
    preview: vi.fn().mockResolvedValue(preview),
    restore,
    onRestore: vi.fn()
  });
  const panel = requireValue(
    document.querySelector<HTMLDetailsElement>('#catalog-history'),
    'Missing history panel'
  );
  const button = (action: string): HTMLButtonElement =>
    requireValue(
      panel.querySelector<HTMLButtonElement>(`[name="history-${action}"]`),
      'Missing history action'
    );
  return {
    panel,
    pick: button('preview'),
    confirm: button('restore'),
    status: requireValue(panel.querySelector('[role="status"]'), 'Missing history status'),
    restore
  } as const;
}

test('lists recorded changes and shows settings, details and ordering before a restore', async () => {
  const { panel, pick, confirm } = mount(HISTORY, {
    ...PREVIEW,
    removed: ['Wave'],
    updated: ['Clap'],
    orderChanged: true,
    restoredSettings: { sevenTvSet: 'set', allowEveryone: true, allowedRoles: ['22'] }
  } as const);
  panel.open = true;
  await vi.waitFor(() => {
    expect(pick.disabled).toBe(false);
  });
  expect(panel.querySelector('select')?.textContent).toContain('Catalog restored from #0');
  expect(panel.querySelector('select')?.textContent).toContain('Emote added · Wave');
  pick.click();
  await vi.waitFor(() => {
    expect(confirm.hidden).toBe(false);
  });
  const diff = panel.querySelector('ul')?.textContent;
  expect(diff).toContain('Remove Wave');
  expect(diff).toContain('Update Clap');
  expect(diff).toContain('previous catalog order');
  expect(diff).toContain('all members can edit · emote manager roles 22');
});

test.each([
  [null, 'Invalid catalog history response.'],
  [{ currentRevision: -1 }, 'Invalid catalog revision.'],
  [{ currentRevision: 0, revisions: false }, 'Invalid catalog history response.'],
  [{ currentRevision: 0, revisions: [] }, 'No catalog changes have been recorded.'],
  [
    { ...HISTORY, revisions: [{ ...HISTORY.revisions[0], edit: { type: true } }] },
    'Invalid catalog revision details.'
  ],
  [
    { ...HISTORY, revisions: [{ ...HISTORY.revisions[0], actorId: 42 }] },
    'Invalid catalog revision details.'
  ]
] as const)('reports unusable or empty histories %#', async (response, message) => {
  const { panel, pick, status } = mount(response);
  panel.open = true;
  await vi.waitFor(() => {
    expect(status.textContent).toBe(message);
  });
  expect(pick.disabled).toBe(true);
});

test.each([
  [PREVIEW, 'This revision already matches the saved catalog.'],
  [{ ...PREVIEW, targetRevision: 2 }, 'The preview changed.'],
  [{ ...PREVIEW, added: false }, 'Invalid catalog history response.'],
  [{ ...PREVIEW, updated: [42] }, 'Invalid catalog history response.'],
  [{ ...PREVIEW, currentSettings: null }, 'Invalid catalog settings in restore preview.'],
  [
    { ...PREVIEW, restoredSettings: { ...POLICY, allowEveryone: 1 } },
    'Invalid catalog settings in restore preview.'
  ],
  [{ ...PREVIEW, orderChanged: null }, 'Invalid catalog order.']
] as const)('keeps confirmation disabled for an unusable restore %#', async (response, message) => {
  const { panel, pick, confirm, status, restore } = mount(HISTORY, response);
  panel.open = true;
  await vi.waitFor(() => {
    expect(pick.disabled).toBe(false);
  });
  pick.click();
  await vi.waitFor(() => {
    expect(status.textContent).toBe(message);
  });
  expect(confirm.hidden).toBe(true);
  expect(restore).not.toHaveBeenCalled();
});
