import assert from 'node:assert';
import test from 'node:test';
import { BoardService, type BoardAnswerRow, type BoardItemRow, type BoardStore } from '../integrations/board';
import { AnswerWriter, answerJobStatus, startAnswerJob } from '../integrations/board-answers-job';
import { SyncTimeoutError } from '../integrations/board-threads-refresh';

type Run = ConstructorParameters<typeof AnswerWriter>[0];
const BOARD = { DOCK_BOARD_MODE: '1', DOCK_SYNC_TOKEN_FILE: '/invented/sync-token', PATH: '/usr/bin' };
const settle = () => new Promise((resolve) => setImmediate(resolve));
const NOT_CONFIGURED = { started: false, running: false, error: 'not configured' };

function fakeRun() {
  const calls: Array<{ cmd: string; args: string[]; env: NodeJS.ProcessEnv }> = [];
  const finish: Array<{ resolve: (value: { code: number; output: string }) => void; reject: (error: Error) => void }> = [];
  const run: Run = (cmd, args, env) => new Promise((resolve, reject) => {
    calls.push({ cmd, args, env });
    finish.push({ resolve, reject });
  });
  return { run, calls, finish };
}

function memoryStore(): BoardStore {
  const rows: BoardItemRow[] = [];
  const answerRows: BoardAnswerRow[] = [];
  return {
    items: async () => rows.map((row) => ({ ...row })),
    upsertItem: async (id, machine, payload, now) => {
      const row = rows.find((entry) => entry.id === id);
      if (row) Object.assign(row, { machine, payload, updatedAt: now, removedAt: null });
      else rows.push({ id, machine, payload, updatedAt: now, removedAt: null });
    },
    removeItems: async (ids, now) => { for (const row of rows) if (ids.includes(row.id)) row.removedAt = now; },
    answers: async (where) => answerRows.filter((row) => (!where.itemId || row.itemId === where.itemId) && (!where.machine || row.machine === where.machine) && (!where.pendingOnly || !row.appliedAt)),
    addAnswer: async (itemId, machine, payload, now) => {
      const id = answerRows.length + 1;
      answerRows.push({ id, itemId, machine, payload, createdAt: now, appliedAt: null, note: null });
      return id;
    },
    updateAnswer: async (id, payload, now) => { Object.assign(answerRows.find((row) => row.id === id)!, { payload, createdAt: now }); },
    markApplied: async (ids, note, now) => {
      let count = 0;
      for (const row of answerRows) if (ids.includes(row.id) && !row.appliedAt) { row.appliedAt = now; row.note = note; count += 1; }
      return count;
    },
  };
}

const decision = (n: number) => ({ id: `Sprint-1/Invented-Epic#D-${n}`, kind: 'decision', title: `Invented decision ${n}`, resolver: 'SHOV' });

test('AnswerWriter', async (t) => {
  await t.test('start runs `answer` once against this server', async () => {
    const fake = fakeRun();
    const writer = new AnswerWriter(fake.run, '/invented/bin/sous', 4123, BOARD);
    assert.deepStrictEqual(writer.start(), { started: true, running: true, error: null });
    assert.strictEqual(fake.calls.length, 1);
    assert.strictEqual(fake.calls[0].cmd, '/invented/bin/sous');
    assert.deepStrictEqual(fake.calls[0].args, ['answer']);
    assert.strictEqual(fake.calls[0].env.DOCK_SYNC_URL, 'http://127.0.0.1:4123');
    assert.strictEqual(fake.calls[0].env.DOCK_SYNC_TOKEN_FILE, '/invented/sync-token');
    assert.deepStrictEqual(writer.status(), { running: true, lastError: null });
    fake.finish[0].resolve({ code: 0, output: '' });
    await settle();
    assert.deepStrictEqual(writer.status(), { running: false, lastError: null });
  });

  await t.test('second start while running spawns nothing', async () => {
    const fake = fakeRun();
    const writer = new AnswerWriter(fake.run, '/invented/bin/sous', 4123, BOARD);
    writer.start();
    assert.deepStrictEqual(writer.start(), { started: false, running: true, error: null });
    assert.strictEqual(fake.calls.length, 1);
    fake.finish[0].resolve({ code: 0, output: '' });
    await settle();
    assert.strictEqual(writer.start().started, true);
    assert.strictEqual(fake.calls.length, 2);
  });

  await t.test('exit codes give short messages and never the output', async () => {
    const fake = fakeRun();
    const writer = new AnswerWriter(fake.run, '/invented/bin/sous', 4123, BOARD);
    for (const [code, message] of [[1, 'answers not fully written; unwritten ones stay in DOCK'], [7, 'answers failed (exit 7)']] as const) {
      writer.start();
      fake.finish.at(-1)!.resolve({ code, output: 'invented output with /invented/secret-token' });
      await settle();
      assert.deepStrictEqual(writer.status(), { running: false, lastError: message });
    }
    writer.start();
    fake.finish.at(-1)!.resolve({ code: 0, output: '' });
    await settle();
    assert.deepStrictEqual(writer.status(), { running: false, lastError: null });
  });

  await t.test('a spawn error or timeout gives a short message and frees the guard', async () => {
    const fake = fakeRun();
    const writer = new AnswerWriter(fake.run, '/invented/bin/sous', 4123, BOARD);
    writer.start();
    fake.finish[0].reject(Object.assign(new Error('spawn /invented/bin/sous ENOENT'), { code: 'ENOENT' }));
    await settle();
    assert.deepStrictEqual(writer.status(), { running: false, lastError: 'could not start sous answer' });
    writer.start();
    fake.finish[1].reject(new SyncTimeoutError());
    await settle();
    assert.deepStrictEqual(writer.status(), { running: false, lastError: 'answers timed out' });
  });

  await t.test('unset path or outside board mode refuses', () => {
    const fake = fakeRun();
    assert.deepStrictEqual(new AnswerWriter(fake.run, null, 4123, BOARD).start(), NOT_CONFIGURED);
    assert.deepStrictEqual(new AnswerWriter(fake.run, '/invented/bin/sous', 4123, { PATH: '/usr/bin' }).start(), NOT_CONFIGURED);
    assert.strictEqual(fake.calls.length, 0);
  });
});

test('pending answers', async (t) => {
  await t.test('count only answers sous has not applied', async () => {
    const store = memoryStore();
    const board = new BoardService(store);
    assert.strictEqual(await board.pendingAnswerCount(), 0);
    await board.ingest({ items: [decision(1), decision(2), decision(3)] }, 'invented-machine');
    await board.confirmAll([decision(1).id, decision(2).id, decision(3).id]);
    assert.strictEqual(await board.pendingAnswerCount(), 3);
    // Answering an item again replaces its answer; it is still one pending answer.
    await board.answer(decision(1).id, [{ ask: 0, text: 'Invented reply' }]);
    assert.strictEqual(await board.pendingAnswerCount(), 3);
    await board.ack({ ids: [1, 2] }, 'invented-machine');
    assert.strictEqual(await board.pendingAnswerCount(), 1);
  });
});

test('answer job in the API', async (t) => {
  const board = new BoardService(memoryStore());
  await board.ingest({ items: [decision(1), decision(2)] }, 'invented-machine');
  await board.confirmAll([decision(1).id, decision(2).id]);

  await t.test('status reports pending and the writer state in board mode', async () => {
    const fake = fakeRun();
    const writer = new AnswerWriter(fake.run, '/invented/bin/sous', 4123, BOARD);
    assert.deepStrictEqual(await answerJobStatus(board, writer, BOARD), { pending: 2, running: false, lastError: null });
    assert.deepStrictEqual(startAnswerJob(writer, BOARD), { started: true, running: true, error: null });
    assert.deepStrictEqual(await answerJobStatus(board, writer, BOARD), { pending: 2, running: true, lastError: null });
  });

  await t.test('outside board mode: nothing pending, not running, and start refuses without spawning', async () => {
    const fake = fakeRun();
    const writer = new AnswerWriter(fake.run, '/invented/bin/sous', 4123, BOARD);
    assert.deepStrictEqual(await answerJobStatus(board, writer, { PATH: '/usr/bin' }), { pending: 0, running: false, lastError: null });
    assert.deepStrictEqual(startAnswerJob(writer, { PATH: '/usr/bin' }), NOT_CONFIGURED);
    assert.strictEqual(fake.calls.length, 0);
  });
});
