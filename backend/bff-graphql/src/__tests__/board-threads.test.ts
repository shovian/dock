import assert from 'node:assert';
import http from 'node:http';
import os from 'node:os';
import test from 'node:test';
import express from 'express';
import { PinRateLimiter } from '../auth/session';
import { OrchestratorService } from '../integrations/orchestrator';
import { MAX_ROWS, THREAD_STATES, ThreadInputError, ThreadService, parseThread, prismaThreadStore, type ThreadRow, type ThreadRecord, type ThreadStore } from '../integrations/board-threads';
import { createOrchestratorIngestRouter } from '../routes/orchestrator';

function memoryStore(): ThreadStore & { records: ThreadRecord[]; dismissals: Map<string, Date> } {
  const records: ThreadRecord[] = [];
  const dismissals = new Map<string, Date>();
  return {
    records,
    dismissals,
    // The store contract: rows() lists open rows (removedAt null) only; a removed row is reached again only through upsertRow.
    rows: async () => records.filter((row) => !row.removedAt).map((row) => ({ ...row })),
    upsertRow: async (id, machine, payload, lastActivity, now) => {
      const row = records.find((entry) => entry.id === id);
      if (row) Object.assign(row, { machine, payload, lastActivity, updatedAt: now, removedAt: null });
      else records.push({ id, machine, payload, lastActivity, updatedAt: now, removedAt: null });
    },
    removeRows: async (ids, now) => { for (const row of records) if (ids.includes(row.id)) row.removedAt = now; },
    dismissed: async () => new Map(dismissals),
    addDismissal: async (threadId, lastActivity) => { dismissals.set(threadId, lastActivity); },
  };
}

const row = (id: string, extra: Partial<ThreadRow> = {}) => ({
  id,
  forum: 'bugreport',
  title: `Invented bug ${id}`,
  url: `https://discord.com/channels/1/${id}`,
  state: 'YOUR_TURN',
  why: 'the reporter answered',
  needsYou: true,
  older: false,
  createdAt: '2026-10-01T08:00:00+00:00',
  lastActivity: '2026-10-02T09:00:00+00:00',
  tags: ['bug'],
  tickets: [{ key: 'ABC-12', status: 'In Progress', assignee: null }],
  prs: ['https://github.com/example/repo/pull/7'],
  approvals: { have: 1, need: 2 },
  lastMessage: 'It still fails on step 3',
  ...extra,
});
const payload = (rows: unknown[], extra: Record<string, unknown> = {}) => ({ syncedAt: '2026-10-22T10:00:00+00:00', jiraSnapshotAt: null, rows, ...extra });

test('parseThread keeps the row the sync sends, with nullable fields as null', () => {
  const parsed = parseThread(row('101', { approvals: null, tickets: [{ key: 'abc-12', status: null, assignee: null }] }));
  assert.deepStrictEqual([parsed.id, parsed.state, parsed.approvals, parsed.tickets], ['101', 'YOUR_TURN', null, [{ key: 'ABC-12', status: null, assignee: null }]]);
  assert.strictEqual(THREAD_STATES.length, 14);
});

test('parseThread rejects an unknown state', () => {
  assert.throws(() => parseThread(row('101', { state: 'BOGUS' as never })), ThreadInputError);
});

test('parseThread rejects a non-discord url', () => {
  assert.throws(() => parseThread(row('101', { url: 'https://example.com/channels/1/2' })), ThreadInputError);
  assert.throws(() => parseThread(row('101', { url: 'http://discord.com/channels/1/2' })), ThreadInputError);
  assert.throws(() => parseThread(row('101', { prs: ['http://github.com/example/repo/pull/7'] })), /https/);
});

test('a thread linking more than MAX_PRS pull requests keeps the first ones and the sync goes through', async () => {
  const service = new ThreadService(memoryStore());
  const prs = Array.from({ length: 11 }, (_, index) => `https://github.com/example/repo/pull/${index + 1}`);
  assert.deepStrictEqual(await service.ingest(payload([row('1', { prs })]), 'sous'), { rows: 1, removed: 0 });
  assert.deepStrictEqual((await service.list()).rows[0].prs, prs.slice(0, 10));
});

test('ingest replaces the full set and marks missing rows removed', async () => {
  const store = memoryStore();
  const service = new ThreadService(store);
  assert.deepStrictEqual(await service.ingest(payload([row('1'), row('2')]), 'sous'), { rows: 2, removed: 0 });
  assert.deepStrictEqual(await service.ingest(payload([row('2')]), 'sous'), { rows: 1, removed: 1 });
  assert.deepStrictEqual((await service.list()).rows.map((entry) => entry.id), ['2']);
  assert.ok(store.records.find((entry) => entry.id === '1')!.removedAt, 'the missing row is kept, marked removed');
  await service.ingest(payload([row('1'), row('2')]), 'sous');
  assert.deepStrictEqual((await service.list()).rows.map((entry) => entry.id).sort(), ['1', '2'], 'a row that comes back is listed again');
});

test('ingest only removes rows of its own machine', async () => {
  const service = new ThreadService(memoryStore());
  await service.ingest(payload([row('1')]), 'sous');
  await service.ingest(payload([row('2')]), 'other');
  assert.deepStrictEqual((await service.list()).rows.map((entry) => entry.id).sort(), ['1', '2']);
});

test('ingest over MAX_ROWS is refused', async () => {
  const service = new ThreadService(memoryStore());
  const rows = Array.from({ length: MAX_ROWS + 1 }, (_, index) => row(String(index + 1)));
  await assert.rejects(service.ingest(payload(rows), 'sous'), ThreadInputError);
});

test('a rejected payload changes nothing', async () => {
  const store = memoryStore();
  const service = new ThreadService(store);
  await service.ingest(payload([row('1'), row('2')]), 'sous');
  const before = JSON.stringify(store.records);
  await assert.rejects(service.ingest(payload([row('1', { title: 'changed' }), row('3', { state: 'BOGUS' as never })]), 'sous'), ThreadInputError);
  await assert.rejects(service.ingest(payload([row('1'), row('1')]), 'sous'), /unique/);
  await assert.rejects(service.ingest({ rows: [row('1')] }, 'sous'), ThreadInputError);
  await assert.rejects(service.ingest(payload([row('1')], { syncedAt: 'yesterday' }), 'sous'), ThreadInputError);
  assert.strictEqual(JSON.stringify(store.records), before, 'rows, removals and sync times are untouched');
  assert.strictEqual((await service.list()).syncedAt, '2026-10-22T10:00:00.000Z');
});

test('dismiss hides a row until its lastActivity changes', async () => {
  const service = new ThreadService(memoryStore());
  await service.ingest(payload([row('1'), row('2')]), 'sous');
  assert.strictEqual(await service.dismiss('1', '2026-10-02T09:00:00+00:00', new Date('2026-10-22T11:00:00Z')), true);
  assert.strictEqual(await service.dismiss('999', '2026-10-02T09:00:00+00:00'), false, 'an unknown thread cannot be dismissed');
  const dismissedOf = async (id: string) => (await service.list()).rows.find((entry) => entry.id === id)!.dismissed;
  assert.deepStrictEqual([await dismissedOf('1'), await dismissedOf('2')], [true, false]);
  await service.ingest(payload([row('1'), row('2')]), 'sous');
  assert.strictEqual(await dismissedOf('1'), true, 'the same lastActivity keeps it dismissed');
  await service.ingest(payload([row('1', { lastActivity: '2026-10-22T10:30:00+00:00' }), row('2')]), 'sous');
  assert.strictEqual(await dismissedOf('1'), false, 'a new message brings it back');
});

test('dismiss binds to the lastActivity the owner saw, not the one the server has now', async () => {
  const service = new ThreadService(memoryStore());
  await service.ingest(payload([row('1')]), 'sous');            // the page shows lastActivity 2026-10-02T09:00
  await service.ingest(payload([row('1', { lastActivity: '2026-10-02T09:30:00+00:00' })]), 'sous');   // a sync lands before the click
  assert.strictEqual(await service.dismiss('1', '2026-10-02T09:00:00.000Z'), true, 'the thread is open, so the dismissal is accepted');
  const [entry] = (await service.list()).rows;
  assert.strictEqual(entry.dismissed, false, 'but the unseen message keeps the thread visible');
  assert.strictEqual(await service.dismiss('1', entry.lastActivity), true);
  assert.strictEqual((await service.list()).rows[0].dismissed, true, 'dismissing what was seen works');
});

test('dismiss refuses a lastActivity that is not a timestamp and stores nothing', async () => {
  const store = memoryStore();
  const service = new ThreadService(store);
  await service.ingest(payload([row('1')]), 'sous');
  for (const bad of ['', 'yesterday', undefined, 42, null]) {
    await assert.rejects(service.dismiss('1', bad as never), ThreadInputError);
  }
  assert.strictEqual(store.dismissals.size, 0);
  assert.strictEqual((await service.list()).rows[0].dismissed, false);
});

test('the store lists open rows only, so list, ingest and dismiss never load removed ones', async () => {
  const asked: unknown[] = [];
  const store = prismaThreadStore({ boardThread: { findMany: async (args: unknown) => { asked.push(args); return []; } } } as never);
  await store.rows();
  assert.deepStrictEqual(asked, [{ where: { removedAt: null } }]);
});

test('a removed row that comes back is listed again and can be dismissed', async () => {
  const service = new ThreadService(memoryStore());
  await service.ingest(payload([row('1'), row('2')]), 'sous');
  await service.ingest(payload([row('2')]), 'sous');
  assert.strictEqual(await service.dismiss('1', '2026-10-02T09:00:00+00:00'), false, 'a removed row is not open');
  assert.deepStrictEqual(await service.ingest(payload([row('1'), row('2')]), 'sous'), { rows: 2, removed: 0 });
  assert.strictEqual(await service.dismiss('1', '2026-10-02T09:00:00+00:00'), true);
});

test('list returns syncedAt and jiraSnapshotAt from the last ingest, and never the meta row', async () => {
  const service = new ThreadService(memoryStore());
  assert.deepStrictEqual(await service.list(), { rows: [], syncedAt: null, jiraSnapshotAt: null });
  await service.ingest(payload([row('1')], { jiraSnapshotAt: '2026-10-22T09:30:00+00:00' }), 'sous');
  const first = await service.list();
  assert.deepStrictEqual([first.rows.length, first.syncedAt, first.jiraSnapshotAt], [1, '2026-10-22T10:00:00.000Z', '2026-10-22T09:30:00.000Z']);
  await service.ingest(payload([], { syncedAt: '2026-10-22T10:05:00+00:00' }), 'sous');
  assert.deepStrictEqual(await service.list(), { rows: [], syncedAt: '2026-10-22T10:05:00.000Z', jiraSnapshotAt: null });
});

test('the thread route needs an ingest token, board mode, and answers 400 to a bad payload', async (t) => {
  const store = memoryStore();
  const orchestrator = new OrchestratorService(undefined as never, os.tmpdir());
  t.mock.method(orchestrator, 'authenticateMachine', async (token: string) => (token === 'dock_ing_ws' ? 'sous' : null));
  const app = express();
  app.use('/ingest/orchestrator', createOrchestratorIngestRouter(orchestrator, new PinRateLimiter(5, 60_000), undefined, undefined, undefined, undefined, undefined, new ThreadService(store)));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const post = (body: unknown, token = 'dock_ing_ws') => fetch(`http://127.0.0.1:${address.port}/ingest/orchestrator/board/threads`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body),
  });
  const saved = process.env.DOCK_BOARD_MODE;
  t.after(() => { if (saved === undefined) delete process.env.DOCK_BOARD_MODE; else process.env.DOCK_BOARD_MODE = saved; });

  process.env.DOCK_BOARD_MODE = '1';
  assert.strictEqual((await post(payload([row('1')]), 'nope')).status, 401);
  const ok = await post(payload([row('1')]));
  assert.deepStrictEqual([ok.status, await ok.json()], [200, { ok: true, result: { rows: 1, removed: 0 } }]);
  assert.strictEqual((await post(payload([row('2', { state: 'BOGUS' as never })]))).status, 400);
  assert.deepStrictEqual(store.records.map((entry) => entry.id).sort(), ['1', '__meta__'], 'the bad payload stored nothing');

  delete process.env.DOCK_BOARD_MODE;
  assert.strictEqual((await post(payload([row('3')]))).status, 404, 'outside board mode the route is off');
  assert.strictEqual(store.records.length, 2);
});
