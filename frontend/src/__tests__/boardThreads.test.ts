import assert from 'node:assert';
import test from 'node:test';
import { STATE_LABEL, STATE_ORDER, groupThreads, type BoardThread } from '../lib/boardThreads';

let n = 0;
const row = (overrides: Partial<BoardThread>): BoardThread => ({
  id: `t${++n}`, forum: 'bugreport', title: `Thread ${n}`, url: `https://discord.example/channels/1/${n}`, state: 'FLOW_1', why: 'Sample row',
  needsYou: true, older: false, createdAt: '2026-10-01T00:00:00.000Z', lastActivity: '2026-10-01T00:00:00.000Z', tags: [], tickets: [], prs: [],
  approvals: null, lastMessage: '', dismissed: false, ...overrides,
});
const ids = (rows: BoardThread[]) => rows.map((r) => r.id);

test('needs tab puts needs-you rows first in state order', () => {
  const rows = [
    row({ id: 'review', state: 'REVIEW_ASKED', lastActivity: '2026-10-05T00:00:00.000Z' }),
    row({ id: 'new-old', state: 'FLOW_1', lastActivity: '2026-10-02T00:00:00.000Z' }),
    row({ id: 'turn', state: 'YOUR_TURN', forum: 'pull-request' }),
    row({ id: 'new-recent', state: 'FLOW_1', lastActivity: '2026-10-04T00:00:00.000Z' }),
    row({ id: 'quiet', state: 'QUIET', needsYou: false }),
  ];
  const { main, folded } = groupThreads(rows, 'needs');
  assert.deepStrictEqual(ids(main), ['new-recent', 'new-old', 'turn', 'review']);
  assert.deepStrictEqual(ids(folded), ['quiet']);
});

test('unknown states sort last and do not crash', () => {
  const rows = [row({ id: 'odd', state: 'SOMETHING_NEW' }), row({ id: 'known', state: 'REVIEW_ASKED' })];
  assert.deepStrictEqual(ids(groupThreads(rows, 'needs').main), ['known', 'odd']);
});

test('grouping leaves the input array alone', () => {
  const rows = [row({ id: 'b', state: 'REVIEW_ASKED' }), row({ id: 'a', state: 'FLOW_1' })];
  const copy = [...rows];
  groupThreads(rows, 'needs');
  assert.deepStrictEqual(rows, copy);
});

test('older rows leave main', () => {
  const rows = [row({ id: 'fresh' }), row({ id: 'stale', older: true }), row({ id: 'stale-quiet', older: true, needsYou: false })];
  const { main, older, folded } = groupThreads(rows, 'needs');
  assert.deepStrictEqual(ids(main), ['fresh']);
  assert.deepStrictEqual(ids(older), ['stale']);
  assert.deepStrictEqual(ids(folded), ['stale-quiet']);
});

test('dismissed rows fold', () => {
  const rows = [row({ id: 'shown' }), row({ id: 'hidden', dismissed: true }), row({ id: 'hidden-old', dismissed: true, older: true })];
  const { main, older, folded } = groupThreads(rows, 'needs');
  assert.deepStrictEqual(ids(main), ['shown']);
  assert.deepStrictEqual(ids(older), []);
  assert.deepStrictEqual(ids(folded).sort(), ['hidden', 'hidden-old']);
});

test('review tab holds only REVIEW_ASKED', () => {
  const rows = [
    row({ id: 'ask', state: 'REVIEW_ASKED', forum: 'pull-request' }),
    row({ id: 'ask-old', state: 'REVIEW_ASKED', older: true }),
    row({ id: 'ask-done', state: 'REVIEW_ASKED', needsYou: false }),
    row({ id: 'other', state: 'YOUR_TURN' }),
  ];
  const { main, older, folded } = groupThreads(rows, 'review');
  assert.deepStrictEqual(ids(main), ['ask']);
  assert.deepStrictEqual(ids(older), ['ask-old']);
  assert.deepStrictEqual(ids(folded), ['ask-done']);
});

test('forum tab filters by forum', () => {
  const rows = [
    row({ id: 'bug', forum: 'bugreport' }),
    row({ id: 'bug-old', forum: 'bugreport', older: true }),
    row({ id: 'bug-quiet', forum: 'bugreport', needsYou: false }),
    row({ id: 'uat', forum: 'uat-bug-report' }),
    row({ id: 'uat-old', forum: 'uat-bug-report', older: true }),
    row({ id: 'pr', forum: 'pull-request' }),
  ];
  const { main, older, folded } = groupThreads(rows, 'uat-bug-report');
  assert.deepStrictEqual(ids(main), ['uat']);
  assert.deepStrictEqual(ids(older), ['uat-old']);
  assert.deepStrictEqual(ids(folded), []);
  assert.deepStrictEqual(ids(groupThreads(rows, 'bugreport').folded), ['bug-quiet']);
});

test('every state has a label', () => {
  assert.strictEqual(STATE_ORDER.length, 14);
  for (const state of STATE_ORDER) assert.ok(STATE_LABEL[state], state);
});
