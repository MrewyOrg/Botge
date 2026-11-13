/* Validates complete emote settings responses before updating the editable guild form. */

import { isRecord, requireValue } from '../validation.ts';

type EmoteSettings = Readonly<{
  sevenTvSet: string | null;
  bttvTwitchId: string | null;
  ffzChannel: string | null;
  allowEveryone: boolean;
  allowedRoles: readonly string[];
}>;

type SettingsRequest = (emotes?: EmoteSettings) => Promise<unknown>;

function nullableText(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

type Role = Readonly<{ id: string; name: string }>;

/**
 * Validates a complete settings snapshot, including every selected and available role.
 *
 * @param payload - Untrusted API response.
 * @returns Editable settings and the available guild roles.
 * @throws `Error` if the API reports a failure or any required field is malformed.
 */
function parseSettings(
  payload: unknown
): Readonly<{ emotes: EmoteSettings; roles: readonly Role[] }> {
  if (isRecord(payload) && typeof payload['message'] === 'string')
    throw new Error(payload['message']);
  if (
    !isRecord(payload)
    || !nullableText(payload['sevenTvSet'])
    || !nullableText(payload['bttvTwitchId'])
    || !nullableText(payload['ffzChannel'])
    || typeof payload['allowEveryone'] !== 'boolean'
    || !Array.isArray(payload['allowedRoles'])
    || !Array.isArray(payload['roles'])
  )
    throw new Error('Invalid emote settings response.');
  return {
    emotes: {
      sevenTvSet: payload['sevenTvSet'],
      bttvTwitchId: payload['bttvTwitchId'],
      ffzChannel: payload['ffzChannel'],
      allowEveryone: payload['allowEveryone'],
      allowedRoles: payload['allowedRoles'].map((role: unknown) => {
        if (typeof role !== 'string') throw new Error('Invalid emote settings response.');
        return role;
      })
    },
    roles: payload['roles'].map((role: unknown) => {
      if (!isRecord(role) || typeof role['id'] !== 'string' || typeof role['name'] !== 'string')
        throw new Error('Invalid emote settings response.');
      return { id: role['id'], name: role['name'] };
    })
  };
}

/**
 * Mounts the guild emote-provider and management-policy form.
 *
 * @remarks
 * The first opening loads settings. Complete responses are validated before changing the
 * form, and saved roles missing from the picker remain visible until explicitly removed.
 * Async failures appear in the form's status message and preserve loaded inputs for retry.
 *
 * @param request - Reads with no argument or saves a complete replacement of emote settings.
 * @throws `Error` if required form markup is missing.
 */
export function mountEmoteSettings(request: SettingsRequest): void {
  const panel = requireValue(
    document.querySelector<HTMLDetailsElement>('#emote-settings'),
    'Missing emote settings.'
  );
  const form = requireValue(panel.querySelector('form'), 'Missing emote settings form.');
  const fields = requireValue(form.querySelector('fieldset'), 'Missing emote settings fields.');
  const feedback = requireValue(
    panel.querySelector('[role="status"]'),
    'Missing emote settings feedback.'
  );
  const input = (name: string): HTMLInputElement =>
    requireValue(
      form.querySelector<HTMLInputElement>(`input[name="${name}"]`),
      `Missing ${name} input.`
    );
  const seven = input('seven-tv-set');
  const bttv = input('bttv-twitch-id');
  const ffz = input('ffz-channel');
  const everyone = input('allow-everyone');
  const role = requireValue(form.querySelector('select'), 'Missing role picker.');
  const add = requireValue(
    form.querySelector<HTMLButtonElement>('[name="add-role"]'),
    'Missing add role button.'
  );
  const list = requireValue(form.querySelector('.selected-roles'), 'Missing role list.');
  let available: readonly Role[] = [];
  const selected = new Set<string>();

  function renderRoles(): void {
    role.replaceChildren(
      new Option('Choose a role', ''),
      ...available
        .filter((entry) => !selected.has(entry.id))
        .map((entry) => new Option(entry.name, entry.id))
    );
    role.disabled = selected.size >= 25 || role.options.length === 1;
    add.disabled = true;
    list.replaceChildren(
      ...[...selected].map((id) => {
        const item = document.createElement('li');
        const button = document.createElement('button');
        // A saved role can outlive its picker entry. Keep it visible so it can be removed.
        const name = available.find((entry) => entry.id === id)?.name ?? `Unavailable role (${id})`;
        button.type = 'button';
        button.textContent = `${name} ×`;
        button.setAttribute('aria-label', `Remove ${name}`);
        button.addEventListener('click', () => {
          selected.delete(id);
          renderRoles();
          role.focus();
        });
        item.append(button);
        return item;
      })
    );
  }

  role.addEventListener('change', () => {
    add.disabled = role.value === '';
  });
  add.addEventListener('click', () => {
    if (role.value === '' || selected.size >= 25) return;
    selected.add(role.value);
    renderRoles();
    role.focus();
  });
  let loaded = false;

  async function update(settings?: EmoteSettings): Promise<void> {
    if (panel.getAttribute('aria-busy') === 'true') return;
    panel.setAttribute('aria-busy', 'true');
    fields.disabled = true;
    feedback.textContent =
      settings === undefined ? 'Loading emote settings…' : 'Saving emote settings…';
    try {
      const { emotes: saved, roles } = parseSettings(await request(settings));
      seven.value = saved.sevenTvSet ?? '';
      bttv.value = saved.bttvTwitchId ?? '';
      ffz.value = saved.ffzChannel ?? '';
      everyone.checked = saved.allowEveryone;
      available = roles;
      selected.clear();
      for (const id of saved.allowedRoles) selected.add(id);
      renderRoles();
      loaded = true;
      feedback.textContent =
        settings === undefined ? '' : 'Saved. Refresh the catalog to see changes.';
    } catch (error) {
      feedback.textContent =
        error instanceof Error ? error.message : 'Could not load emote settings.';
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
      sevenTvSet: seven.value.trim() || null,
      bttvTwitchId: bttv.value.trim() || null,
      ffzChannel: ffz.value.trim().toLowerCase() || null,
      allowEveryone: everyone.checked,
      allowedRoles: [...selected]
    });
  });
  panel.hidden = false;
}
