import assert from 'node:assert';
import test from 'node:test';
import { CONFIRM_WINDOW_MS, pressWrite, writeButton } from '../lib/writeAnswers';

test('the button counts the pending answers and is off with none or while writing', () => {
  assert.deepStrictEqual(writeButton({ pending: 3, running: false, configured: true, armedAt: null, now: 0 }), { label: 'Write answers to board (3)', disabled: false });
  assert.deepStrictEqual(writeButton({ pending: 0, running: false, configured: true, armedAt: null, now: 0 }), { label: 'Write answers to board (0)', disabled: true });
  assert.deepStrictEqual(writeButton({ pending: 3, running: true, configured: true, armedAt: null, now: 0 }), { label: 'Writing…', disabled: true });
  assert.deepStrictEqual(writeButton({ pending: 0, running: true, configured: true, armedAt: null, now: 0 }), { label: 'Writing…', disabled: true });
});

test('the first click arms the button and the second within 5 s runs', () => {
  assert.deepStrictEqual(pressWrite(null, 1000), { run: false, armedAt: 1000 });
  assert.deepStrictEqual(writeButton({ pending: 3, running: false, configured: true, armedAt: 1000, now: 2000 }), { label: 'Confirm: no sous run is active', disabled: false });
  assert.deepStrictEqual(pressWrite(1000, 1000 + CONFIRM_WINDOW_MS - 1), { run: true, armedAt: null });
});

test('after 5 s the button resets and a click arms it again', () => {
  assert.strictEqual(CONFIRM_WINDOW_MS, 5000);
  assert.deepStrictEqual(writeButton({ pending: 3, running: false, configured: true, armedAt: 1000, now: 1000 + CONFIRM_WINDOW_MS }), { label: 'Write answers to board (3)', disabled: false });
  assert.deepStrictEqual(pressWrite(1000, 1000 + CONFIRM_WINDOW_MS), { run: false, armedAt: 1000 + CONFIRM_WINDOW_MS });
});

test('an armed button whose answers all went away or that started running is not armed any more', () => {
  assert.deepStrictEqual(writeButton({ pending: 0, running: false, configured: true, armedAt: 1000, now: 2000 }), { label: 'Write answers to board (0)', disabled: true });
  assert.deepStrictEqual(writeButton({ pending: 2, running: true, configured: true, armedAt: 1000, now: 2000 }), { label: 'Writing…', disabled: true });
});

test('without DOCK_ANSWER_SYNC the button is off and says why', () => {
  assert.deepStrictEqual(writeButton({ pending: 3, running: false, configured: false, armedAt: null, now: 0 }), { label: 'Write answers to board (not configured)', disabled: true });
  assert.deepStrictEqual(writeButton({ pending: 3, running: false, configured: false, armedAt: 1000, now: 2000 }), { label: 'Write answers to board (not configured)', disabled: true });
});
