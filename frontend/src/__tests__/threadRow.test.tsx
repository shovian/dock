import assert from 'node:assert';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThreadRow } from '../components/ThreadRow';
import type { BoardThread } from '../lib/boardThreads';

const thread = (overrides: Partial<BoardThread>): BoardThread => ({
  id: '1', forum: 'pull-request', title: 'Invented PR thread', url: 'https://discord.example/channels/1/1', state: 'REVIEW_ASKED', why: 'Sample row',
  needsYou: true, older: false, createdAt: '2026-10-01T00:00:00.000Z', lastActivity: '2026-10-01T00:00:00.000Z', tags: [], tickets: [], prs: [],
  approvals: null, slots: null, lastMessage: '', dismissed: false, ...overrides,
});
// React separates adjacent text nodes with <!-- --> in server markup; drop them so a label reads as its text.
const html = (row: BoardThread) => renderToStaticMarkup(<ThreadRow thread={row} now={Date.parse('2026-10-02T00:00:00.000Z')} dismissing={false} onDismiss={() => undefined} />).replace(/<!-- -->/g, '');

test('approvals and slots show as two separate labels', () => {
  const out = html(thread({ approvals: { have: 1, need: 2 }, slots: { have: 0, need: 2 } }));
  assert.match(out, />approvals 1\/2</);
  assert.match(out, />slots 0\/2</);
});

test('each label shows only when its count is there', () => {
  const onlySlots = html(thread({ slots: { have: 2, need: 2 } }));
  assert.match(onlySlots, />slots 2\/2</);
  assert.doesNotMatch(onlySlots, /approvals/);
  const onlyApprovals = html(thread({ approvals: { have: 1, need: 1 } }));
  assert.match(onlyApprovals, />approvals 1\/1</);
  assert.doesNotMatch(onlyApprovals, />slots/);
  const none = html(thread({}));
  assert.doesNotMatch(none, />approvals|>slots/);
});

test('a row from an older backend without slots still renders', () => {
  const { slots: _slots, ...older } = thread({ approvals: { have: 0, need: 1 } });
  const out = html(older as BoardThread);
  assert.match(out, />approvals 0\/1</);
  assert.doesNotMatch(out, />slots/);
});
