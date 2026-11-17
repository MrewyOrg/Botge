// @vitest-environment jsdom

import { beforeEach, expect, test, vi } from 'vitest';

import html from '../../index.html?raw';
import { requireValue } from '../../src/validation.ts';
import { mountVoiceSettings } from '../../src/settings/voice-settings.ts';

beforeEach(() => {
  document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
});

const defaults = { channelId: null, statusEnabled: false, statusEmoji: null } as const;

test.each([
  [null, 'Invalid settings response.'],
  [{ message: 'Access denied.' }, 'Access denied.'],
  [{ voice: null, channels: [] }, 'Invalid settings response.'],
  [{ voice: defaults, channels: null }, 'Invalid settings response.'],
  [{ voice: { ...defaults, channelId: 1 }, channels: [] }, 'Invalid settings response.'],
  [{ voice: { ...defaults, statusEnabled: 1 }, channels: [] }, 'Invalid settings response.'],
  [{ voice: { ...defaults, statusEmoji: 1 }, channels: [] }, 'Invalid settings response.'],
  [{ voice: defaults, channels: [{ id: '42' }] }, 'Invalid voice channel.']
])(
  'keeps settings disabled on rejected or invalid data %#',
  async (response: unknown, message: string) => {
    mountVoiceSettings(async () => await Promise.resolve(response));
    const panel = requireValue(
      document.querySelector<HTMLDetailsElement>('#voice-settings'),
      'Missing settings'
    );
    panel.open = true;
    await vi.waitFor(() => {
      expect(panel.querySelector('#voice-feedback')?.textContent).toBe(message);
    });
    expect(panel.querySelector('fieldset')?.disabled).toBe(true);
  }
);

test('ignores a save before the settings load and while another save is in flight', async () => {
  let finishSave: (value: unknown) => void = () => undefined;
  const pendingSave = new Promise((resolve: (value: unknown) => void) => {
    finishSave = resolve;
  });
  const loaded = {
    voice: { ...defaults, channelId: '42' },
    channels: [{ id: '42', name: 'Lobby' }]
  } as const;
  const request = vi.fn().mockResolvedValueOnce(loaded).mockReturnValueOnce(pendingSave);
  mountVoiceSettings(request);
  const panel = requireValue(
    document.querySelector<HTMLDetailsElement>('#voice-settings'),
    'Missing settings'
  );
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
  expect(request).toHaveBeenLastCalledWith({
    channelId: '42',
    statusEnabled: false,
    statusEmoji: null
  });
  expect(panel.getAttribute('aria-busy')).toBe('true');
  finishSave(loaded);
  await vi.waitFor(() => {
    expect(panel.querySelector('#voice-feedback')?.textContent).toBe(
      'Saved. Botge will apply the voice settings.'
    );
  });
  expect(panel.hasAttribute('aria-busy')).toBe(false);
});

test('shows a saved channel that is no longer available and lets the admin retry a failed save', async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce({ voice: { ...defaults, channelId: '42' }, channels: [] })
    .mockRejectedValueOnce(new Error('Save failed.'));
  mountVoiceSettings(request);
  const panel = requireValue(
    document.querySelector<HTMLDetailsElement>('#voice-settings'),
    'Missing settings'
  );
  const picker = requireValue(panel.querySelector('select'), 'Missing channel');
  panel.open = true;
  await vi.waitFor(() => {
    expect(picker.selectedOptions.item(0)?.textContent).toContain('unavailable');
  });
  picker.value = '';
  panel.querySelector('button')?.click();
  await vi.waitFor(() => {
    expect(panel.querySelector('#voice-feedback')?.textContent).toBe('Save failed.');
  });
  expect(panel.querySelector('fieldset')?.disabled).toBe(false);
});
