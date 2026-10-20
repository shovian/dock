import assert from 'node:assert';
import test from 'node:test';
import { BoardInputError, BoardService, CONFIRM, keepsBuilt, parseAnswer, parseItem, type BoardAnswerRow, type BoardItemRow, type BoardStore } from '../integrations/board';

function memoryStore(): BoardStore & { rows: BoardItemRow[]; answerRows: BoardAnswerRow[] } {
  const rows: BoardItemRow[] = [];
  const answerRows: BoardAnswerRow[] = [];
  return {
    rows,
    answerRows,
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

const issue = {
  id: 'Sprint-25/Data-Table#I-31',
  kind: 'issue',
  title: 'QRD-1205 AC12: fungsi ikon arrow-up',
  tickets: ['QRD-1205', 'not a key'],
  type: 'QUESTION',
  resolver: 'OWNER',
  escalated: true,
  prs: ['https://github.com/qonekid/ms-client-dashboard-frontend/pull/1050', 'http://insecure.example/x'],
  source: 'Sprint-25/Data-Table/issues.md:173',
  asks: [{
    question: 'Apa fungsi ikon arrow-up?',
    options: [
      { key: 'a', label: 'Hiasan statis', effect: 'tidak ada perubahan', built: true },
      { key: 'b', label: 'Lipat/buka table', effect: 'S3 T8 saja' },
    ],
  }],
};
const shov = { id: 'Sprint-25/Data-Table#D-36', kind: 'decision', title: 'Tebakan ikon', status: 'SHOV — atas nama owner, perlu konfirmasi', tickets: ['QRD-1205'] };

test('an item is checked and cleaned before it is stored', () => {
  const item = parseItem(issue);
  assert.deepStrictEqual([item.ref, item.epic, item.tickets, item.prs], ['I-31', 'Sprint-25/Data-Table', ['QRD-1205'], ['https://github.com/qonekid/ms-client-dashboard-frontend/pull/1050']]);
  assert.strictEqual(item.asks[0].options[1].built, false);
  assert.throws(() => parseItem({ ...issue, id: 'no-hash' }), BoardInputError);
  assert.throws(() => parseItem({ ...issue, kind: 'decision' }), /an issue is I-n/);
  assert.throws(() => parseItem({ ...issue, asks: [{ question: 'q?', options: [{ key: 'a', label: 'x', built: true }] }] }), /2 to 4 options/);
  assert.throws(() => parseItem({ ...issue, asks: [{ question: 'q?', options: [{ key: 'a', label: 'x' }, { key: 'b', label: 'y' }] }] }), /exactly one option marked built/);
  assert.throws(() => parseItem({ ...issue, asks: [{ question: 'q?', options: [{ key: 'b', label: 'x', built: true }, { key: 'a', label: 'y' }] }] }), /lettered a, b, c, d/);
});

test('an answer picks an option or writes text for every ask; a decision without asks takes confirm or text', () => {
  const item = parseItem(issue);
  assert.deepStrictEqual(parseAnswer(item, [{ ask: 0, choice: 'B' }]), [{ ask: 0, choice: 'b', text: null }]);
  assert.deepStrictEqual(parseAnswer(item, [{ ask: 0, text: '  scroll ke atas  ' }]), [{ ask: 0, choice: null, text: 'scroll ke atas' }]);
  assert.throws(() => parseAnswer(item, [{ ask: 0, choice: 'z' }]), /one of a, b/);
  assert.throws(() => parseAnswer(item, [{ ask: 0 }]), /Pick an option/);
  assert.throws(() => parseAnswer(item, [{ ask: 0, choice: 'a', text: 'x' }]), /not both/);
  assert.throws(() => parseAnswer(item, [{ ask: 1, choice: 'a' }]), /ask must be 0 to 0/);
  const decision = parseItem(shov);
  assert.deepStrictEqual(parseAnswer(decision, [{ ask: 0, choice: CONFIRM }]), [{ ask: 0, choice: CONFIRM, text: null }]);
  assert.throws(() => parseAnswer(decision, [{ ask: 0, choice: 'a' }]), /one of confirm/);
});

test('keepsBuilt is true only when every part keeps what sous built', () => {
  const item = parseItem(issue);
  assert.strictEqual(keepsBuilt(item, [{ ask: 0, choice: 'a', text: null }]), true);
  assert.strictEqual(keepsBuilt(item, [{ ask: 0, choice: 'b', text: null }]), false);
  assert.strictEqual(keepsBuilt(item, [{ ask: 0, choice: null, text: 'lain' }]), false);
  assert.strictEqual(keepsBuilt(parseItem(shov), [{ ask: 0, choice: CONFIRM, text: null }]), true);
});

test('ingest is a full set per producer: items it stops sending are taken off', async () => {
  const store = memoryStore();
  const board = new BoardService(store);
  assert.deepStrictEqual(await board.ingest({ items: [issue, shov] }, 'sous'), { items: 2, removed: 0 });
  assert.deepStrictEqual(await board.ingest({ items: [issue] }, 'sous'), { items: 1, removed: 1 });
  assert.deepStrictEqual((await board.list()).map((item) => item.ref), ['I-31']);
  await assert.rejects(board.ingest({ items: [issue, issue] }, 'sous'), /unique/);
  await assert.rejects(board.ingest({}, 'sous'), /items/);
});

test('an answer waits, with no expiry, until the producer pulls and acknowledges it', async () => {
  const store = memoryStore();
  const board = new BoardService(store);
  await board.ingest({ items: [issue, shov] }, 'sous');
  await board.answer('Sprint-25/Data-Table#I-31', [{ ask: 0, choice: 'a' }]);
  await board.answer('Sprint-25/Data-Table#I-31', [{ ask: 0, choice: 'b' }]);
  assert.strictEqual(store.answerRows.length, 1, 'a second answer before it is applied replaces the first');
  const view = (await board.list()).find((item) => item.ref === 'I-31')!;
  assert.deepStrictEqual([view.pending, view.keepsBuilt], [[{ ask: 0, choice: 'b', text: null }], false]);

  assert.deepStrictEqual(await board.pull('someone-else'), [], 'only the producer that sent the items pulls their answers');
  const [pulled] = await board.pull('sous');
  assert.deepStrictEqual([pulled.item.ref, pulled.keepsBuilt], ['I-31', false]);
  assert.deepStrictEqual(await board.ack({ ids: [pulled.id], note: 'written to issues.md' }, 'someone-else'), { applied: 0 });
  assert.deepStrictEqual(await board.ack({ ids: [pulled.id], note: 'written to issues.md' }, 'sous'), { applied: 1 });
  assert.deepStrictEqual(await board.pull('sous'), []);
  await assert.rejects(board.answer('Sprint-25/Data-Table#I-99', [{ ask: 0, choice: 'a' }]), /no longer open/);
});

test('escalated items come first', async () => {
  const board = new BoardService(memoryStore());
  await board.ingest({ items: [shov, issue] }, 'sous');
  assert.deepStrictEqual((await board.list()).map((item) => item.ref), ['I-31', 'D-36']);
});
