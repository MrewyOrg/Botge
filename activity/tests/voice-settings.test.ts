// @vitest-environment jsdom

import { beforeEach, expect, test, vi } from 'vitest';

import html from '../index.html?raw';
import { requireValue } from '../src/validation.ts';
import { mountVoiceSettings } from '../src/voice-settings.ts';

beforeEach(() => {
  document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
});

const defaults = { channelId: null, statusEnabled: false, statusEmoji: null };

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
