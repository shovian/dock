/**
 * The "Write answers to board" button. `sous answer` edits the board files and the board has no lock, so a click only
 * arms the button; a second click within CONFIRM_WINDOW_MS, after the owner checked that no sous run is active, runs it.
 */

export const CONFIRM_WINDOW_MS = 5000;

interface ButtonState { pending: number; running: boolean; armedAt: number | null; now: number }

const armed = (armedAt: number | null, now: number) => armedAt !== null && now - armedAt < CONFIRM_WINDOW_MS;

export function writeButton({ pending, running, armedAt, now }: ButtonState): { label: string; disabled: boolean } {
  if (running) return { label: 'Writing…', disabled: true };
  if (pending === 0) return { label: 'Write answers to board (0)', disabled: true };
  if (armed(armedAt, now)) return { label: 'Confirm: no sous run is active', disabled: false };
  return { label: `Write answers to board (${pending})`, disabled: false };
}

/** What a click does: run now (second click in time), or arm the button. */
export function pressWrite(armedAt: number | null, now: number): { run: boolean; armedAt: number | null } {
  return armed(armedAt, now) ? { run: true, armedAt: null } : { run: false, armedAt: now };
}
