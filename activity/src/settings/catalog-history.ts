/* Shows retained catalog revisions and requires a fresh preview before restoring one. */

import { isRecord, requireValue } from '../validation.ts';

type HistoryRequests = {
  readonly load: () => Promise<unknown>;
  readonly preview: (revision: number) => Promise<unknown>;
  readonly restore: (revision: number, expectedRevision: number) => Promise<unknown>;
  readonly onRestore: () => void;
};

const ACTIONS: Readonly<Record<string, string>> = {
  baseline: 'Starting catalog',
  added: 'Emote added',
  removed: 'Emote removed',
  settings: 'Settings changed',
  restored: 'Catalog restored'
} as const;

function revision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error('Invalid catalog revision.');
  return value;
}

function body(value: unknown): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) throw new Error('Invalid catalog history response.');
  if (typeof value['message'] === 'string') throw new Error(value['message']);
  return value;
}

function texts(value: unknown): readonly string[] {
  if (!Array.isArray(value)) throw new Error('Invalid catalog history response.');
  return value.map((entry: unknown) => {
    if (typeof entry !== 'string') throw new Error('Invalid catalog history response.');
    return entry;
  });
}

function policy(value: unknown): string {
  if (!isRecord(value)) throw new Error('Invalid catalog settings in restore preview.');
  const set = value['sevenTvSet'];
  const everyone = value['allowEveryone'];
  const roles = texts(value['allowedRoles']);
  if ((typeof set !== 'string' && set !== null) || typeof everyone !== 'boolean')
    throw new Error('Invalid catalog settings in restore preview.');
  return [
    `7TV set ${set ?? 'off'}`,
    `all members ${everyone ? 'can' : 'cannot'} edit`,
    `emote manager roles ${roles.length === 0 ? 'none' : roles.join(', ')}`
  ].join(' · ');
}

function changes(value: Readonly<Record<string, unknown>>): readonly string[] {
  const added = texts(value['added']);
  const removed = texts(value['removed']);
  const updated = texts(value['updated']);
  const current = policy(value['currentSettings']);
  const restored = policy(value['restoredSettings']);
  if (typeof value['orderChanged'] !== 'boolean') throw new Error('Invalid catalog order.');
  return [
    ...(added.length === 0 ? [] : [`Add ${added.join(', ')}`]),
    ...(removed.length === 0 ? [] : [`Remove ${removed.join(', ')}`]),
    ...(updated.length === 0 ? [] : [`Update ${updated.join(', ')}`]),
    ...(value['orderChanged'] ? ['Restore the previous catalog order'] : []),
    ...(current === restored ?
      []
    : [`Current settings · ${current}`, `Restore settings · ${restored}`])
  ];
}

function row(value: unknown): HTMLOptionElement {
  const entry = body(value);
  const number = revision(entry['revision']);
  const edit = body(entry['edit']);
  const { name, type } = edit;
  const label = typeof type === 'string' ? ACTIONS[type] : undefined;
  const actor = entry['actorId'];
  const date = new Date(revision(entry['recordedAt']) * 1000).toLocaleString();
  if (typeof label !== 'string' || (actor !== null && typeof actor !== 'string'))
    throw new Error('Invalid catalog revision details.');
  const detail =
    type === 'restored' ? ` from #${revision(edit['revision'])}`
    : typeof name === 'string' ? ` · ${name}`
    : '';
  return new Option(
    `#${number} · ${label}${detail} · ${date}${actor === null ? '' : ` · User ${actor}`}`,
    String(number)
  );
}

/**
 * Mounts the administrator's catalog history and two-step restore controls.
 *
 * @param requests - Guild-scoped history operations.
 * @throws `Error` if the required panel markup is missing.
 */
export function mountCatalogHistory(requests: HistoryRequests): void {
  const panel = requireValue(
    document.querySelector<HTMLDetailsElement>('#catalog-history'),
    'Missing catalog history.'
  );
  const select = requireValue(panel.querySelector('select'), 'Missing revision picker.');
  const button = (name: string): HTMLButtonElement =>
    requireValue(
      panel.querySelector<HTMLButtonElement>(`[name="${name}"]`),
      'Missing history action.'
    );
  const refresh = button('history-refresh');
  const preview = button('history-preview');
  const restore = button('history-restore');
  const diff = requireValue(panel.querySelector('ul'), 'Missing restore preview.');
  const status = requireValue(panel.querySelector('[role="status"]'), 'Missing history status.');
  let confirmation: { readonly revision: number; readonly expectedRevision: number } | undefined;

  function updateControls(): void {
    const busy = panel.getAttribute('aria-busy') === 'true';
    refresh.disabled = busy;
    select.disabled = busy || select.options.length === 0;
    preview.disabled = select.disabled;
    restore.disabled = busy || confirmation === undefined;
    restore.hidden = confirmation === undefined;
  }

  function clearPreview(): void {
    confirmation = undefined;
    diff.replaceChildren();
    updateControls();
  }

  async function run(message: string, action: () => Promise<void>): Promise<void> {
    if (panel.getAttribute('aria-busy') === 'true') return;
    panel.setAttribute('aria-busy', 'true');
    updateControls();
    status.textContent = message;
    try {
      await action();
    } catch (error) {
      clearPreview();
      status.textContent =
        error instanceof Error ? error.message : 'Could not open catalog history.';
    } finally {
      panel.removeAttribute('aria-busy');
      updateControls();
    }
  }

  async function load(): Promise<void> {
    clearPreview();
    select.replaceChildren();
    const data = body(await requests.load());
    const current = revision(data['currentRevision']);
    const entries = data['revisions'];
    if (!Array.isArray(entries)) throw new Error('Invalid catalog history response.');
    select.replaceChildren(...entries.map(row));
    status.textContent =
      entries.length === 0 ?
        'No catalog changes have been recorded.'
      : `Current revision #${current}.`;
  }

  panel.addEventListener('toggle', () => {
    if (panel.open) void run('Loading catalog history…', load);
  });
  refresh.addEventListener('click', () => void run('Loading catalog history…', load));
  select.addEventListener('change', clearPreview);
  preview.addEventListener('click', () => {
    void run('Preparing restore preview…', async () => {
      clearPreview();
      const selected = revision(Number(select.value));
      const data = body(await requests.preview(selected));
      if (revision(data['targetRevision']) !== selected) throw new Error('The preview changed.');
      const lines = changes(data);
      diff.replaceChildren(
        ...lines.map((line) => {
          const item = document.createElement('li');
          item.textContent = line;
          return item;
        })
      );
      if (lines.length === 0) {
        status.textContent = 'This revision already matches the saved catalog.';
        return;
      }
      confirmation = { revision: selected, expectedRevision: revision(data['currentRevision']) };
      status.textContent = `Review the changes before restoring revision #${selected}.`;
    });
  });
  restore.addEventListener('click', () => {
    const selected = confirmation;
    if (selected === undefined) return;
    void run('Restoring catalog…', async () => {
      clearPreview();
      const restored = body(await requests.restore(selected.revision, selected.expectedRevision));
      const current = revision(restored['currentRevision']);
      requests.onRestore();
      status.textContent = `Restore saved as revision #${current}. Refresh to see the new history.`;
    });
  });
  updateControls();
  panel.hidden = false;
}
