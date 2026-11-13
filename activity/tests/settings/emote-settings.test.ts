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
  bttvTwitchId: null,
  ffzChannel: null,
  allowEveryone: false,
  allowedRoles: [],
  roles: [
    { id: '42', name: 'Moderators' },
    { id: '77', name: 'Artists' }
  ]
};

test('loads and submits the provider sets and added-emote access', async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce({ ...defaults, allowedRoles: ['123'] })
    .mockResolvedValueOnce({ ...defaults, ffzChannel: 'streamer', allowedRoles: ['42', '77'] });
  mountEmoteSettings(request);
  const panel = settingsPanel();
  expect(panel.hidden).toBe(false);
  panel.open = true;
  await vi.waitFor(() => {
    expect(panel.querySelector('fieldset')?.disabled).toBe(false);
  });
  const field = (name: string): HTMLInputElement =>
    requireValue(panel.querySelector<HTMLInputElement>(`input[name="${name}"]`), 'Missing input');
  field('ffz-channel').value = 'Streamer';
  const role = requireValue(panel.querySelector('select'), 'Missing role picker');
  const add = requireValue(
    panel.querySelector<HTMLButtonElement>('[name="add-role"]'),
    'Missing add role'
  );
  panel.querySelector<HTMLButtonElement>('.selected-roles button')?.click();
  for (const id of ['42', '77']) {
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
    sevenTvSet: null,
    bttvTwitchId: null,
    allowEveryone: false,
    ffzChannel: 'streamer',
    allowedRoles: ['42', '77']
  });
});

test.each([
  [null, 'Invalid emote settings response.'],
  [{ message: 'Access denied.' }, 'Access denied.'],
  [{ ...defaults, ffzChannel: 42 }, 'Invalid emote settings response.'],
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
