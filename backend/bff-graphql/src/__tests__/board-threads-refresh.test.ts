import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SyncTimeoutError, ThreadRefresher, execRun } from '../integrations/board-threads-refresh';

type Run = ConstructorParameters<typeof ThreadRefresher>[0];
const BOARD = { DOCK_BOARD_MODE: '1', DOCK_SYNC_TOKEN_FILE: '/invented/sync-token', PATH: '/usr/bin' };
const settle = () => new Promise((resolve) => setImmediate(resolve));

/** A fake run that records its calls and finishes when the test says so. */
function fakeRun() {
  const calls: Array<{ cmd: string; args: string[]; env: NodeJS.ProcessEnv }> = [];
  const finish: Array<{ resolve: (value: { code: number; output: string }) => void; reject: (error: Error) => void }> = [];
  const run: Run = (cmd, args, env) => new Promise((resolve, reject) => {
    calls.push({ cmd, args, env });
    finish.push({ resolve, reject });
  });
  return { run, calls, finish };
}

test('ThreadRefresher', async (t) => {
  await t.test('start runs the fixed command once', async () => {
    const fake = fakeRun();
    const refresher = new ThreadRefresher(fake.run, '/invented/bin/sous', 4123, BOARD);
    assert.deepStrictEqual(refresher.start(), { started: true, running: true, error: null });
    assert.strictEqual(fake.calls.length, 1);
    assert.strictEqual(fake.calls[0].cmd, '/invented/bin/sous');
    assert.deepStrictEqual(fake.calls[0].args, ['discord-sync']);
    assert.strictEqual(fake.calls[0].env.DOCK_SYNC_URL, 'http://127.0.0.1:4123');
    assert.strictEqual(fake.calls[0].env.DOCK_SYNC_TOKEN_FILE, '/invented/sync-token');
    assert.strictEqual(fake.calls[0].env.PATH, '/usr/bin');
    assert.deepStrictEqual(refresher.status(), { running: true, lastError: null });
    fake.finish[0].resolve({ code: 0, output: '' });
    await settle();
    assert.deepStrictEqual(refresher.status(), { running: false, lastError: null });
  });

  await t.test('a DOCK_SYNC_URL already in DOCK\'s env does not win over this server\'s port', () => {
    const fake = fakeRun();
    new ThreadRefresher(fake.run, '/invented/bin/sous', 4123, { ...BOARD, DOCK_SYNC_URL: 'http://elsewhere.invalid' }).start();
    assert.strictEqual(fake.calls[0].env.DOCK_SYNC_URL, 'http://127.0.0.1:4123');
  });

  await t.test('second start while running does not spawn again', async () => {
    const fake = fakeRun();
    const refresher = new ThreadRefresher(fake.run, '/invented/bin/sous', 4123, BOARD);
    refresher.start();
    assert.deepStrictEqual(refresher.start(), { started: false, running: true, error: null });
    assert.deepStrictEqual(refresher.start(), { started: false, running: true, error: null });
    assert.strictEqual(fake.calls.length, 1);
    fake.finish[0].resolve({ code: 0, output: '' });
    await settle();
    // Once the sync is over, the next press runs it again.
    assert.strictEqual(refresher.start().started, true);
    assert.strictEqual(fake.calls.length, 2);
  });

  await t.test('non-zero exit is reported as lastError, success clears it', async () => {
    const fake = fakeRun();
    const refresher = new ThreadRefresher(fake.run, '/invented/bin/sous', 4123, BOARD);
    for (const [code, message] of [[2, 'fetch failed, list unchanged'], [1, 'DOCK refused the update'], [3, 'a sync is already running'], [7, 'sync failed (exit 7)']] as const) {
      refresher.start();
      fake.finish.at(-1)!.resolve({ code, output: 'invented output with /invented/secret-token' });
      await settle();
      assert.deepStrictEqual(refresher.status(), { running: false, lastError: message });
    }
    refresher.start();
    fake.finish.at(-1)!.resolve({ code: 0, output: '' });
    await settle();
    assert.deepStrictEqual(refresher.status(), { running: false, lastError: null });
  });

  await t.test('a spawn error or timeout gives a short message and frees the guard', async () => {
    const fake = fakeRun();
    const refresher = new ThreadRefresher(fake.run, '/invented/bin/sous', 4123, BOARD);
    refresher.start();
    fake.finish[0].reject(Object.assign(new Error('spawn /invented/bin/sous ENOENT'), { code: 'ENOENT' }));
    await settle();
    assert.deepStrictEqual(refresher.status(), { running: false, lastError: 'could not start the sync' });
    refresher.start();
    fake.finish[1].reject(new SyncTimeoutError());
    await settle();
    assert.deepStrictEqual(refresher.status(), { running: false, lastError: 'sync timed out' });
  });

  await t.test('a run that throws at once still frees the guard', async () => {
    const refresher = new ThreadRefresher(() => { throw new Error('boom'); }, '/invented/bin/sous', 4123, BOARD);
    assert.strictEqual(refresher.start().started, true);
    await settle();
    assert.deepStrictEqual(refresher.status(), { running: false, lastError: 'could not start the sync' });
  });

  await t.test('unset script path refuses', () => {
    const fake = fakeRun();
    const refresher = new ThreadRefresher(fake.run, null, 4123, BOARD);
    assert.deepStrictEqual(refresher.start(), { started: false, running: false, error: 'refresh not configured' });
    assert.strictEqual(fake.calls.length, 0);
  });

  await t.test('outside board mode refuses', () => {
    const fake = fakeRun();
    const refresher = new ThreadRefresher(fake.run, '/invented/bin/sous', 4123, { PATH: '/usr/bin' });
    assert.deepStrictEqual(refresher.start(), { started: false, running: false, error: 'refresh not configured' });
    assert.strictEqual(fake.calls.length, 0);
  });
});

test('execRun', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dock-refresh-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const script = path.join(dir, 'fake-sous');
  fs.writeFileSync(script, '#!/bin/sh\necho "$1 $DOCK_SYNC_URL"\nexit "${FAKE_EXIT:-0}"\n', { mode: 0o755 });

  await t.test('resolves with the exit code and passes args and env to the child', async () => {
    assert.deepStrictEqual(await execRun(script, ['discord-sync'], { DOCK_SYNC_URL: 'http://127.0.0.1:1' }), { code: 0, output: 'discord-sync http://127.0.0.1:1\n' });
    assert.strictEqual((await execRun(script, ['discord-sync'], { FAKE_EXIT: '2' })).code, 2);
  });

  await t.test('rejects when the script cannot start', async () => {
    await assert.rejects(execRun(path.join(dir, 'missing'), ['discord-sync'], {}));
  });
});
