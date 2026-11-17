/* Renders the guessing game page from room states and sends the player's commands. */

import { requireValue } from '../validation.ts';
import type {
  ConnectGame,
  GameConnection,
  GameMessage,
  GamePhase,
  GameState
} from './game-state.ts';

/** Blur at the start of a round, in pixels on the displayed image. */
const START_BLUR_PX = 28 as const;
/** Blur left when the round timer ends. */
const END_BLUR_PX = 3 as const;
const WRONG_FLASH_MS = 400 as const;
/** Guess length allowed when a round state carries no hint. */
const DEFAULT_GUESS_LENGTH = 100 as const;
/** Devices whose text input opens an on-screen keyboard; matches the top bar's touch padding. */
const TOUCH_SCREEN = '(hover: none) and (pointer: coarse)' as const;
/** Space left between the top bar and the stage when a match scrolls it into view. */
const REVEAL_GAP_PX = 8 as const;
/** Waits before each automatic reconnect; after the last one the page offers a button. */
const RECONNECT_DELAYS_MS: readonly number[] = [1000, 2000, 4000] as const;

/** Controls for the mounted game page. */
type GameView = {
  /**
   * Call each time the page is shown. Connects on the first call; later calls do nothing to the
   * connection while it is open or pending. Brings the start button to the middle of the screen
   * once it shows, or a running match's stage just below the top bar.
   */
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
  const stage = element('.game-stage');
  const masthead = document.querySelector<HTMLElement>('.masthead');
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
  let lastPhase: GamePhase | undefined;
  /** Set when the page is shown; the start button is centered once it appears. */
  let centerPending = false;

  /** Measures the height below the top bar that the stage may fill during a match. */
  function fit(): void {
    const visible = window.visualViewport?.height ?? window.innerHeight;
    // Viewport sizes differ by platform (iOS shrinks only the visual viewport, Android's web view
    // usually resizes the page, desktop zoom shrinks it too), so a focused input on a touch screen
    // is the signal that the on-screen keyboard is up.
    const keyboard =
      page.classList.contains('playing')
      && document.activeElement === guess
      && typeof window.matchMedia === 'function'
      && window.matchMedia(TOUCH_SCREEN).matches;
    document.documentElement.classList.toggle('game-keyboard', keyboard);
    const bar = masthead?.offsetHeight ?? 0;
    page.style.setProperty('--game-bar', `${bar}px`);
    page.style.setProperty('--game-space', `${Math.max(0, visible - bar)}px`);
  }

  /** Scrolls the start button to the middle of the space below the top bar. */
  function centerStart(): void {
    if (page.hidden !== false || start.hidden !== false) return;
    const box = start.getBoundingClientRect();
    const visible = window.visualViewport?.height ?? window.innerHeight;
    const bar = masthead?.offsetHeight ?? 0;
    const offset = box.top + box.height / 2 - (bar + (visible - bar) / 2);
    if (Math.abs(offset) > 1) window.scrollBy({ top: offset, behavior: 'instant' });
  }

  /** Scrolls the stage to just below the top bar while a match runs. */
  function reveal(): void {
    if (page.hidden !== false || !page.classList.contains('playing')) return;
    const offset =
      stage.getBoundingClientRect().top - (masthead?.offsetHeight ?? 0) - REVEAL_GAP_PX;
    if (Math.abs(offset) > 1) window.scrollBy({ top: offset, behavior: 'instant' });
  }

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
    // During a match the list is one scrolling line; keep the newest guess in view.
    guesses.scrollLeft = guesses.scrollWidth;
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
    // The input stays on screen between rounds so the keyboard a tap opened on mobile stays up.
    const typing = current.phase !== 'lobby' && current.phase !== 'final';
    const wasGuessing = lastPhase === 'round';
    lastPhase = current.phase;
    form.hidden = !typing;
    const wasTyping = page.classList.contains('playing');
    page.classList.toggle('playing', typing);
    page.dataset['phase'] = current.phase;
    if (typing !== wasTyping) fit();
    start.hidden = current.phase !== 'lobby' && current.phase !== 'final';
    start.disabled = false;
    start.textContent = current.phase === 'final' ? 'Play again' : 'Start match';
    if (centerPending && !start.hidden) {
      centerPending = false;
      centerStart();
    }
    // Clear what was typed as soon as the round ends, so the reveal and the next round start empty.
    if (!guessing) guess.value = '';
    if (typing && !wasTyping) reveal();
    if (guessing && !wasGuessing) {
      if (page.hidden === false) guess.focus({ preventScroll: true });
      reveal();
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
    // Mobile browsers only open the keyboard for focus requested inside a tap, so focus the
    // input now; the round later reuses it.
    form.hidden = false;
    guess.focus({ preventScroll: true });
    connection.send({ type: 'start' });
  });
  form.addEventListener('submit', (event: Readonly<Pick<Event, 'preventDefault'>>) => {
    event.preventDefault();
    const text = guess.value.trim();
    if (text !== '' && state?.phase === 'round') {
      connection?.send({ type: 'guess', text });
      guess.value = '';
    }
    // Tapping Guess must not close the mobile keyboard.
    guess.focus({ preventScroll: true });
  });
  // Pressing the button would move focus off the input and dismiss the mobile keyboard.
  form
    .querySelector('button')
    ?.addEventListener('pointerdown', (event: Readonly<Pick<Event, 'preventDefault'>>) => {
      event.preventDefault();
    });

  // The on-screen keyboard shrinks only the visual viewport, so a resize of it refits the stage.
  // It is absent in some embedded browsers and test environments.
  const viewport: VisualViewport | null | undefined = window.visualViewport;
  (viewport ?? window).addEventListener('resize', () => {
    fit();
    reveal();
  });
  guess.addEventListener('focus', fit);
  guess.addEventListener('blur', fit);
  fit();

  return {
    open(): void {
      if (page.classList.contains('playing')) reveal();
      else if (start.hidden !== false) centerPending = true;
      else centerStart();
      open();
    },
    refresh(): void {
      draw();
    }
  };
}
