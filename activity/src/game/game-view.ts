/* Renders the guessing game page from room states and sends the player's commands. */

import { requireValue } from '../validation.ts';
import type { ConnectGame, GameConnection, GameMessage, GameState } from './game-state.ts';

/** Blur at the start of a round, in pixels on the displayed image. */
const START_BLUR_PX = 28 as const;
/** Blur left when the round timer ends. */
const END_BLUR_PX = 3 as const;
const WRONG_FLASH_MS = 400 as const;
/** Guess length allowed when a round state carries no hint. */
const DEFAULT_GUESS_LENGTH = 100 as const;
/** Waits before each automatic reconnect; after the last one the page offers a button. */
const RECONNECT_DELAYS_MS: readonly number[] = [1000, 2000, 4000] as const;

/** Controls for the mounted game page. */
type GameView = {
  /** Connects on the first call; later calls do nothing while a connection is open or pending. */
  readonly open: () => void;
  /** Redraws player names after the participant list changes. */
  readonly refresh: () => void;
};

function element(selector: string): HTMLElement {
  return requireValue(document.querySelector<HTMLElement>(selector), `Missing ${selector}.`);
}

/**
 * Blur for a round with `remainingMs` left of `roundMs`.
 *
 * @returns Pixels between {@link START_BLUR_PX} at the start and {@link END_BLUR_PX} at the end.
 */
export function blurAt(remainingMs: number, roundMs: number): number {
  const left = roundMs <= 0 ? 0 : Math.min(1, Math.max(0, remainingMs / roundMs));
  return END_BLUR_PX + (START_BLUR_PX - END_BLUR_PX) * left;
}

/**
 * Connects the game page's markup to a room.
 *
 * @remarks
 * The page blurs the round image itself and sharpens it over the remaining time with one CSS
 * transition, restarted from each state's remaining time. The emote's name arrives only with
 * the reveal. During the ready beat the image loads while still hidden, so the round starts
 * fairly for a slow connection. A lost connection is retried three times with growing waits
 * while the last room state stays on screen; after that, or when the room gave a reason for
 * closing, the page offers a Reconnect button.
 *
 * @param options - `connect` opens a room; `playerName` resolves a player ID to a display name;
 * `onPlaying` reports when a match starts or stops, including a lost connection.
 * @returns Controls for opening the connection and redrawing names.
 * @throws `Error` if required game markup is missing.
 */
export function mountGame(options: {
  readonly connect: ConnectGame;
  readonly playerName: (id: string) => string | undefined;
  readonly onPlaying?: (playing: boolean) => void;
}): GameView {
  const page = element('#activity-game');
  const round = element('#game-round');
  // The image has no source until a round starts, so it is created here instead of in markup.
  const image = document.createElement('img');
  image.id = 'game-image';
  image.alt = 'Blurred emote';
  image.draggable = false;
  image.hidden = true;
  element('#game-art').replaceChildren(image);
  const timer = element('#game-timer');
  const status = element('#game-status');
  const form = element('#game-form');
  const guess = requireValue(
    document.querySelector<HTMLInputElement>('#game-guess'),
    'Missing #game-guess.'
  );
  const start = requireValue(
    document.querySelector<HTMLButtonElement>('#game-start'),
    'Missing #game-start.'
  );
  const players = element('#game-players');
  const hint = element('#game-hint');
  const guesses = element('#game-guesses');

  let connection: GameConnection | undefined;
  let connecting = false;
  let state: GameState | undefined;
  let shownImage: string | undefined;
  let wrongTimer: ReturnType<typeof setTimeout> | undefined;
  let failure: string | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let attempts = 0;

  let playing = false;
  function reportPlaying(now: boolean): void {
    if (now === playing) return;
    playing = now;
    options.onPlaying?.(now);
  }

  function name(id: string): string {
    if (id === connection?.userId) return 'You';
    return options.playerName(id) ?? `Player ${id.slice(-4)}`;
  }

  /** Restarts the image's blur or the timer bar's scale from `from` to `to` over `durationMs`. */
  function animate(
    property: 'filter' | 'transform',
    from: string,
    to: string,
    durationMs: number
  ): void {
    const target = property === 'filter' ? image : timer;
    target.style.transition = 'none';
    target.style[property] = from;
    // Reading layout commits the starting value before the transition is set.
    target.getBoundingClientRect();
    target.style.transition = `${property} ${Math.max(0, durationMs)}ms linear`;
    target.style[property] = to;
  }

  function drawImage(current: GameState): void {
    const loaded =
      current.phase === 'ready' || current.phase === 'round' || current.phase === 'reveal';
    if (!loaded || current.image === undefined || connection === undefined) {
      image.hidden = true;
      image.removeAttribute('src');
      shownImage = undefined;
      timer.hidden = true;
      return;
    }
    if (shownImage !== current.image) {
      shownImage = current.image;
      image.src = connection.imageUrl(current.image);
    }
    if (current.phase === 'ready') {
      // The picture loads now and appears, blurred, when the round timer starts.
      image.hidden = true;
      timer.hidden = true;
      return;
    }
    image.hidden = false;
    if (current.phase === 'reveal') {
      image.style.transition = 'filter 200ms ease-out';
      image.style.filter = 'none';
      timer.hidden = true;
      return;
    }
    const remaining = current.remainingMs ?? 0;
    animate(
      'filter',
      `blur(${blurAt(remaining, current.roundMs)}px)`,
      `blur(${END_BLUR_PX}px)`,
      remaining
    );
    timer.hidden = false;
    const left = current.roundMs <= 0 ? 0 : Math.min(1, remaining / current.roundMs);
    animate('transform', `scaleX(${left})`, 'scaleX(0)', remaining);
  }

  function drawPlayers(current: GameState): void {
    players.replaceChildren(
      ...current.players.map((player) => {
        const row = document.createElement('li');
        const label = document.createElement('span');
        label.textContent = name(player.id);
        const score = document.createElement('span');
        score.className = 'score';
        score.textContent = String(player.score);
        row.classList.toggle('self', player.id === connection?.userId);
        row.append(label, score);
        return row;
      })
    );
  }

  function drawGuesses(current: GameState): void {
    const shown = current.phase === 'round' || current.phase === 'reveal' ? current.guesses : [];
    guesses.replaceChildren(
      ...shown.map((entry) => {
        const row = document.createElement('li');
        const who = document.createElement('span');
        who.textContent = `${name(entry.id)}: `;
        row.append(who, entry.text);
        return row;
      })
    );
  }

  function describe(current: GameState): string {
    if (current.phase === 'lobby')
      return (
        current.notice
        ?? (current.players.length === 1 ?
          'You are the only player here. Start whenever you like.'
        : `${current.players.length} players are here. Anyone can start.`)
      );
    if (current.phase === 'loading') return 'Picking emotes…';
    if (current.phase === 'ready') return 'Get ready…';
    if (current.phase === 'round') return 'Type the name of this emote.';
    if (current.phase === 'reveal') {
      const answer = current.answer ?? '';
      if (current.winner === undefined) return `Time is up. It was ${answer}.`;
      const who = name(current.winner);
      const verb = who === 'You' ? 'You got it' : `${who} got it`;
      return `${verb}: ${answer} (+${current.points ?? 0}).`;
    }
    const [first, second] = current.players;
    if (first === undefined || first.score === 0) return 'Match over. Nobody scored.';
    if (second?.score === first.score) return 'Match over. It is a tie.';
    const who = name(first.id);
    return who === 'You' ? 'Match over. You win.' : `Match over. ${who} wins.`;
  }

  function draw(): void {
    if (state === undefined) return;
    const current = state;
    const guessing = current.phase === 'round';
    reportPlaying(current.phase !== 'lobby' && current.phase !== 'final');
    round.textContent =
      current.round > 0 && current.phase !== 'lobby' ?
        `Round ${current.round} of ${current.rounds}`
      : '';
    status.textContent = describe(current);
    drawImage(current);
    drawPlayers(current);
    drawGuesses(current);
    hint.hidden = !guessing || current.hint === undefined;
    hint.textContent = guessing ? (current.hint ?? '') : '';
    // The hint has one character per character of the name, so a longer guess cannot be right.
    guess.maxLength =
      guessing && current.hint !== undefined ? current.hint.length : DEFAULT_GUESS_LENGTH;
    const wasHidden = form.hidden !== false;
    form.hidden = !guessing;
    start.hidden = current.phase !== 'lobby' && current.phase !== 'final';
    start.disabled = false;
    start.textContent = current.phase === 'final' ? 'Play again' : 'Start match';
    if (guessing && wasHidden) {
      guess.value = '';
      if (page.hidden === false) guess.focus({ preventScroll: true });
    }
  }

  function receive(message: GameMessage): void {
    switch (message.type) {
      case 'state':
        ({ state } = message);
        attempts = 0;
        draw();
        break;
      case 'wrong':
        guess.classList.add('wrong');
        clearTimeout(wrongTimer);
        wrongTimer = setTimeout(() => {
          guess.classList.remove('wrong');
        }, WRONG_FLASH_MS);
        guess.select();
        break;
      case 'error':
        // The room closes the connection after an error; keep its reason on screen.
        failure = message.message;
        status.textContent = message.message;
        break;
    }
  }

  /** Leaves the page idle with a button that connects again. */
  function disconnected(feedback: string): void {
    connection = undefined;
    clearTimeout(retry);
    retry = undefined;
    attempts = 0;
    reportPlaying(false);
    state = undefined;
    shownImage = undefined;
    image.hidden = true;
    image.removeAttribute('src');
    timer.hidden = true;
    form.hidden = true;
    round.textContent = '';
    players.replaceChildren();
    guesses.replaceChildren();
    hint.hidden = true;
    status.textContent = feedback;
    start.hidden = false;
    start.disabled = false;
    start.textContent = 'Reconnect';
  }

  /** Schedules the next automatic reconnect, or gives up once every wait has been used. */
  function reconnectLater(rejoin: () => void): void {
    const delay = RECONNECT_DELAYS_MS[attempts];
    if (delay === undefined) {
      disconnected('The game connection closed.');
      return;
    }
    attempts += 1;
    form.hidden = true;
    start.hidden = true;
    status.textContent = 'Connection lost. Reconnecting…';
    retry = setTimeout(() => {
      retry = undefined;
      rejoin();
    }, delay);
  }

  /** Joins the room. A reconnect that fails is retried; a first join that fails is reported. */
  function join(reconnecting: boolean): void {
    const rejoin = (): void => {
      join(true);
    };
    connecting = true;
    failure = undefined;
    start.hidden = true;
    if (!reconnecting) status.textContent = 'Joining the game…';
    void options
      .connect({
        onMessage: receive,
        onClose(): void {
          connection = undefined;
          if (failure === undefined) reconnectLater(rejoin);
          else disconnected(failure);
        }
      })
      .then(
        (opened) => {
          connection = opened;
          // A state can arrive before the connection is returned; draw it with the player's ID.
          draw();
        },
        (error: unknown) => {
          if (reconnecting) reconnectLater(rejoin);
          else disconnected(error instanceof Error ? error.message : 'Could not join the game.');
        }
      )
      .finally(() => {
        connecting = false;
      });
  }

  function open(): void {
    if (connection !== undefined || connecting || retry !== undefined) return;
    join(false);
  }

  start.addEventListener('click', () => {
    if (connection === undefined) {
      open();
      return;
    }
    start.disabled = true;
    connection.send({ type: 'start' });
  });
  form.addEventListener('submit', (event: Readonly<Pick<Event, 'preventDefault'>>) => {
    event.preventDefault();
    const text = guess.value.trim();
    if (text !== '' && state?.phase === 'round') connection?.send({ type: 'guess', text });
  });

  return {
    open,
    refresh(): void {
      draw();
    }
  };
}
