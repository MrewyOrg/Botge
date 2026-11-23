// @vitest-environment jsdom

import { beforeEach, expect, test, vi } from 'vitest';

import html from '../../index.html?raw';
import { mountEmoteSettings } from '../../src/settings/emote-settings.ts';
import { requireValue } from '../../src/validation.ts';

beforeEach(() => {
  document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
});

function settingsPanel(): HTMLDetailsElement {
  return requireValue(
    document.querySelector<HTMLDetailsElement>('#emote-settings'),
    'Missing settings'
  );
}

const defaults = {
  sevenTvSet: null,
  allowEveryone: false,
  allowedRoles: [],
  roles: [
    { id: '42', name: 'Moderators' },
    { id: '77', name: 'Artists' }
  ]
} as const;

test('loads and submits the provider sets and added-emote access', async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce({ ...defaults, allowedRoles: ['123'] })
    .mockResolvedValueOnce({ ...defaults, allowedRoles: ['42', '77'] });
  mountEmoteSettings(request);
  const panel = settingsPanel();
  expect(panel.hidden).toBe(false);
  panel.open = true;
  await vi.waitFor(() => {
    expect(panel.querySelector('fieldset')?.disabled).toBe(false);
  });
  const field = (name: string): HTMLInputElement =>
    requireValue(panel.querySelector<HTMLInputElement>(`input[name="${name}"]`), 'Missing input');
  field('seven-tv-set').value = ' 01234567890123456789ABCDEF ';
  const role = requireValue(panel.querySelector('select'), 'Missing role picker');
  const add = requireValue(
    panel.querySelector<HTMLButtonElement>('[name="add-role"]'),
    'Missing add role'
  );
  panel.querySelector<HTMLButtonElement>('.selected-roles button')?.click();
  for (const id of ['42', '77'] as const) {
    role.value = id;
    role.dispatchEvent(new Event('change'));
    add.click();
  }
  expect(panel.querySelector('.selected-roles')?.textContent).toContain('Moderators');
  expect(panel.querySelector('.selected-roles')?.textContent).toContain('Artists');
  panel.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
  await vi.waitFor(() => {
    expect(panel.querySelector('[role="status"]')?.textContent).toContain('Saved.');
  });
  expect(request).toHaveBeenLastCalledWith({
    sevenTvSet: '01234567890123456789ABCDEF',
    allowEveryone: false,
    allowedRoles: ['42', '77']
  });
});

test.each([
  [null, 'Invalid emote settings response.'],
  [{ message: 'Access denied.' }, 'Access denied.'],
  [{ ...defaults, allowedRoles: null }, 'Invalid emote settings response.'],
  [{ ...defaults, allowedRoles: ['42', null] }, 'Invalid emote settings response.'],
  [{ ...defaults, roles: [defaults.roles[0], { id: '77' }] }, 'Invalid emote settings response.']
])(
  'reports settings errors and keeps fields disabled %#',
  async (response: unknown, message: string) => {
    mountEmoteSettings(async () => await Promise.resolve(response));
    const panel = settingsPanel();
    panel.open = true;
    await vi.waitFor(() => {
      expect(panel.querySelector('[role="status"]')?.textContent).toBe(message);
    });
    expect(panel.querySelector('fieldset')?.disabled).toBe(true);
  }
);

test('ignores a save before the settings load and while another save is in flight', async () => {
  let finishSave: (value: unknown) => void = () => undefined;
  const pendingSave = new Promise((resolve: (value: unknown) => void) => {
    finishSave = resolve;
  });
  const request = vi.fn().mockResolvedValueOnce(defaults).mockReturnValueOnce(pendingSave);
  mountEmoteSettings(request);
  const panel = settingsPanel();
  const form = requireValue(panel.querySelector('form'), 'Missing form');
  const submit = (): void => {
    form.dispatchEvent(new Event('submit', { cancelable: true }));
  };

  // Nothing is saved before the stored settings arrive, so defaults never overwrite them.
  submit();
  expect(request).not.toHaveBeenCalled();
  panel.open = true;
  await vi.waitFor(() => {
    expect(panel.querySelector('fieldset')?.disabled).toBe(false);
  });

  submit();
  submit();
  expect(request).toHaveBeenCalledTimes(2);
  expect(panel.querySelector('fieldset')?.disabled).toBe(true);
  finishSave(defaults);
  await vi.waitFor(() => {
    expect(panel.querySelector('[role="status"]')?.textContent).toContain('Saved.');
  });
  expect(panel.querySelector('fieldset')?.disabled).toBe(false);
});

test('protects an unsaved draft and blocks saves during catalog restore', async () => {
  const request = vi.fn().mockResolvedValue(defaults);
  const settings = mountEmoteSettings(request);
  const panel = settingsPanel();
  const form = requireValue(panel.querySelector('form'), 'Missing form');
  const field = requireValue(
    form.querySelector<HTMLInputElement>('input[name="seven-tv-set"]'),
    'Missing set field'
  );
  const fields = requireValue(form.querySelector('fieldset'), 'Missing settings fields');
  panel.open = true;
  await vi.waitFor(() => {
    expect(fields.disabled).toBe(false);
  });

  const send = vi.fn<() => Promise<unknown>>();
  field.value = '01234567890123456789ABCDEF';
  await expect(settings.restore(send)).rejects.toThrow('unsaved emote settings');
  expect(send).not.toHaveBeenCalled();
  expect(field.value).toBe('01234567890123456789ABCDEF');

  field.value = '';
  const everyone = requireValue(
    form.querySelector<HTMLInputElement>('input[name="allow-everyone"]'),
    'Missing manager policy switch'
  );
  everyone.checked = true;
  await expect(settings.restore(send)).rejects.toThrow('unsaved emote settings');
  expect(everyone.checked).toBe(true);
  everyone.checked = false;

  let complete: (result: unknown) => void = () => undefined;
  send.mockReturnValue(
    new Promise((resolve) => {
      complete = resolve;
    })
  );
  const restore = settings.restore(send);
  expect(fields.disabled).toBe(true);
  await expect(settings.restore(send)).rejects.toThrow('finish loading or saving');
  form.dispatchEvent(new Event('submit', { cancelable: true } as const));
  expect(request).toHaveBeenCalledOnce();
  complete({ currentRevision: 2 } as const);
  await expect(restore).resolves.toEqual({ currentRevision: 2 } as const);
  expect(fields.disabled).toBe(false);
});

test('loads the newly saved policy when settings are opened during a restore', async () => {
  const request = vi.fn().mockResolvedValue(defaults);
  const settings = mountEmoteSettings(request);
  let complete: (result: unknown) => void = () => undefined;
  const pending = new Promise<unknown>((resolve) => {
    complete = resolve;
  });
  const restore = settings.restore(async () => await pending);
  const panel = settingsPanel();
  panel.open = true;
  expect(request).not.toHaveBeenCalled();

  complete({ currentRevision: 2 } as const);
  await restore;
  await vi.waitFor(() => {
    expect(panel.querySelector('fieldset')?.disabled).toBe(false);
  });
  expect(request).toHaveBeenCalledOnce();

  settings.reload();
  await vi.waitFor(() => {
    expect(panel.querySelector('fieldset')?.disabled).toBe(false);
  });
  expect(request).toHaveBeenCalledTimes(2);
});

test('stops adding manager roles at the 25-role limit', async () => {
  const roles = Array.from({ length: 26 }, (_: unknown, index: number) => ({
    id: String(100 + index),
    name: `Role ${index}`
  }));
  const saved = roles.slice(0, 25).map((entry: Readonly<{ id: string }>) => entry.id);
  const request = vi
    .fn()
    .mockResolvedValueOnce({ ...defaults, roles, allowedRoles: saved })
    .mockResolvedValueOnce({ ...defaults, roles, allowedRoles: saved });
  mountEmoteSettings(request);
  const panel = settingsPanel();
  panel.open = true;
  await vi.waitFor(() => {
    expect(panel.querySelector('fieldset')?.disabled).toBe(false);
  });
  const role = requireValue(panel.querySelector('select'), 'Missing role picker');
  const add = requireValue(
    panel.querySelector<HTMLButtonElement>('[name="add-role"]'),
    'Missing add role'
  );
  expect(role.disabled).toBe(true);
  expect(panel.querySelectorAll('.selected-roles li')).toHaveLength(25);

  // A forced choice of the remaining role is still refused.
  role.value = '125';
  role.dispatchEvent(new Event('change'));
  add.click();
  expect(panel.querySelectorAll('.selected-roles li')).toHaveLength(25);
  panel.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
  await vi.waitFor(() => {
    expect(request).toHaveBeenCalledTimes(2);
  });
  expect(request).toHaveBeenLastCalledWith(
    expect.objectContaining({ allowedRoles: saved }) as unknown
  );
});

test('keeps selected roles editable after a malformed save response', async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce({ ...defaults, allowedRoles: ['42'] })
    .mockResolvedValueOnce({ ...defaults, allowedRoles: [null] })
    .mockResolvedValueOnce({ ...defaults, allowedRoles: ['42'] });
  mountEmoteSettings(request);
  const panel = settingsPanel();
  panel.open = true;
  await vi.waitFor(() => {
    expect(panel.querySelector('fieldset')?.disabled).toBe(false);
  });
  const save = requireValue(
    panel.querySelector<HTMLButtonElement>('button[type="submit"]'),
    'Missing save button.'
  );
  save.click();
  await vi.waitFor(() => {
    expect(panel.querySelector('[role="status"]')?.textContent).toBe(
      'Invalid emote settings response.'
    );
  });
  expect(panel.querySelector('.selected-roles')?.textContent).toContain('Moderators');
  expect(panel.querySelector('fieldset')?.disabled).toBe(false);
  save.click();
  await vi.waitFor(() => {
    expect(request).toHaveBeenCalledTimes(3);
  });
  expect(request).toHaveBeenLastCalledWith(
    expect.objectContaining({ allowedRoles: ['42'] }) as unknown
  );
});
