import { isRecord, requireValue } from './validation.ts';

type VoiceSettings = Readonly<{
  channelId: string | null;
  statusEnabled: boolean;
  statusEmoji: string | null;
}>;

type VoiceChannel = Readonly<{ id: string; name: string }>;

type SettingsRequest = (voice?: VoiceSettings) => Promise<unknown>;

function parseSettings(
  response: unknown
): Readonly<{ voice: VoiceSettings; channels: readonly VoiceChannel[] }> {
  if (!isRecord(response)) throw new Error('Invalid settings response.');
  if (typeof response['message'] === 'string') throw new Error(response['message']);
  const { voice, channels } = response;
  if (
    !isRecord(voice)
    || !Array.isArray(channels)
    || (voice['channelId'] !== null && typeof voice['channelId'] !== 'string')
    || typeof voice['statusEnabled'] !== 'boolean'
    || (voice['statusEmoji'] !== null && typeof voice['statusEmoji'] !== 'string')
  )
    throw new Error('Invalid settings response.');
  return {
    voice: {
      channelId: voice['channelId'],
      statusEnabled: voice['statusEnabled'],
      statusEmoji: voice['statusEmoji']
    },
    channels: channels.map((channel: unknown) => {
      if (
        !isRecord(channel)
        || typeof channel['id'] !== 'string'
        || typeof channel['name'] !== 'string'
      )
        throw new Error('Invalid voice channel.');
      return { id: channel['id'], name: channel['name'] };
    })
  };
}

export function mountVoiceSettings(request: SettingsRequest): void {
  const panel = requireValue(
    document.querySelector<HTMLDetailsElement>('#voice-settings'),
    'Missing voice settings.'
  );
  const form = requireValue(panel.querySelector('form'), 'Missing voice settings form.');
  const channel = requireValue(form.querySelector('select'), 'Missing voice channel picker.');
  const toggle = requireValue(
    form.querySelector<HTMLInputElement>('#voice-status-enabled'),
    'Missing voice status toggle.'
  );
  const emoji = requireValue(
    form.querySelector<HTMLInputElement>('#voice-status-emoji'),
    'Missing voice status text.'
  );
  const fields = requireValue(form.querySelector('fieldset'), 'Missing voice settings fields.');
  const feedback = requireValue(
    panel.querySelector('#voice-feedback'),
    'Missing voice settings feedback.'
  );
  let loaded = false;

  async function update(voice?: VoiceSettings): Promise<void> {
    if (panel.getAttribute('aria-busy') === 'true') return;
    panel.setAttribute('aria-busy', 'true');
    fields.disabled = true;
    feedback.textContent =
      voice === undefined ? 'Loading voice settings…' : 'Saving voice settings…';
    try {
      const settings = parseSettings(await request(voice));
      channel.replaceChildren(
        new Option('Stay disconnected', ''),
        ...settings.channels.map((entry) => new Option(entry.name, entry.id))
      );
      const selected = settings.voice.channelId;
      // Preserve the saved selection when Discord no longer lists the channel as joinable.
      if (selected !== null && !settings.channels.some((entry) => entry.id === selected))
        channel.add(new Option('Previously selected channel (unavailable)', selected));
      channel.value = selected ?? '';
      toggle.checked = settings.voice.statusEnabled;
      emoji.value = settings.voice.statusEmoji ?? '';
      loaded = true;
      feedback.textContent =
        voice === undefined ? '' : 'Saved. Botge will apply the voice settings.';
    } catch (error) {
      feedback.textContent =
        error instanceof Error ? error.message : 'Could not load voice settings.';
    } finally {
      fields.disabled = !loaded;
      panel.removeAttribute('aria-busy');
    }
  }

  panel.addEventListener('toggle', () => {
    if (panel.open && !loaded) void update();
  });
  form.addEventListener('submit', (event: Readonly<Pick<Event, 'preventDefault'>>) => {
    event.preventDefault();
    if (!loaded) return;
    void update({
      channelId: channel.value || null,
      statusEnabled: toggle.checked,
      statusEmoji: emoji.value.trim() || null
    });
  });
  panel.hidden = false;
}
