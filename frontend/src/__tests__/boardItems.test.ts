import assert from 'node:assert';
import test from 'node:test';
import { CONFIRM, answerOf, confirmPlan, draftKeepsBuilt, draftOf, groupItems, pendingNote, questionsOf, type BoardItem } from '../lib/boardItems';

const base = (overrides: Partial<BoardItem>): BoardItem => ({
  id: 'Sprint-25/Data-Table#I-31', epic: 'Sprint-25/Data-Table', kind: 'issue', ref: 'I-31', title: 'Ikon arrow-up', tickets: ['QRD-1205'],
  type: 'QUESTION', status: null, resolver: 'OWNER', blocks: null, escalated: false, detail: null, prs: [], findings: null, source: null,
  asks: [{ question: 'Fungsi ikon?', options: [{ key: 'a', label: 'Hiasan', effect: 'tidak ada perubahan', built: true }, { key: 'b', label: 'Lipat', effect: 'S3 T8', built: false }] }],
  pending: null, keepsBuilt: null, answeredAt: null, ...overrides,
});

test('a decision without asks becomes one confirm question', () => {
  const decision = base({ kind: 'decision', ref: 'D-36', asks: [] });
  assert.deepStrictEqual(questionsOf(decision).map((q) => q.options.map((o) => o.key)), [[CONFIRM]]);
  assert.deepStrictEqual(answerOf(decision, [{ choice: CONFIRM, other: false, text: '' }]), { parts: [{ ask: 0, choice: CONFIRM, text: null }] });
});

test('a draft needs a choice or text for every question', () => {
  const item = base({});
  assert.deepStrictEqual(answerOf(item, draftOf(item)), { error: 'The question: pick an option or write your own' });
  assert.deepStrictEqual(answerOf(item, [{ choice: null, other: true, text: '   ' }]), { error: 'The question: write your answer, or pick an option' });
  assert.deepStrictEqual(answerOf(item, [{ choice: 'b', other: false, text: '' }]), { parts: [{ ask: 0, choice: 'b', text: null }] });
  assert.deepStrictEqual(answerOf(item, [{ choice: 'a', other: true, text: ' scroll ' }]), { parts: [{ ask: 0, choice: null, text: 'scroll' }] }, 'Other wins over a stale choice');
});

test('keeps-built tells a confirmation from a revision', () => {
  const item = base({});
  assert.strictEqual(draftKeepsBuilt(item, [{ choice: 'a', other: false, text: '' }]), true);
  assert.strictEqual(draftKeepsBuilt(item, [{ choice: 'b', other: false, text: '' }]), false);
  assert.strictEqual(draftKeepsBuilt(item, [{ choice: null, other: true, text: 'x' }]), false);
});

test('a pending answer refills the draft and says what happens next', () => {
  const item = base({ pending: [{ ask: 0, choice: null, text: 'scroll ke atas' }], keepsBuilt: false });
  assert.deepStrictEqual(draftOf(item), [{ choice: null, other: true, text: 'scroll ke atas' }]);
  assert.match(pendingNote(item)!, /revision/);
  assert.match(pendingNote(base({ pending: [{ ask: 0, choice: 'a', text: null }], keepsBuilt: true }))!, /keeps what sous built/);
  assert.strictEqual(pendingNote(base({})), null);
});

test('items group by ticket, escalated groups first', () => {
  const groups = groupItems([
    base({ id: 'E#D-1', ref: 'D-1', tickets: ['QRD-1'] }),
    base({ id: 'E#I-2', ref: 'I-2', tickets: ['QRD-2'], escalated: true }),
    base({ id: 'E#D-3', ref: 'D-3', tickets: ['QRD-1'] }),
    base({ id: 'E#D-4', ref: 'D-4', tickets: [], epic: 'Sprint-25/Sous-Kit' }),
  ]);
  assert.deepStrictEqual(groups.map((group) => [group.key, group.items.map((item) => item.ref)]), [['QRD-2', ['I-2']], ['QRD-1', ['D-1', 'D-3']], ['Sprint-25/Sous-Kit', ['D-4']]]);
});

test('confirm all except leaves excepted and already answered items out', () => {
  const items = [
    base({ id: 'E#D-1', ref: 'D-1' }),
    base({ id: 'E#D-2', ref: 'D-2' }),
    base({ id: 'E#D-3', ref: 'D-3', pending: [{ ask: 0, choice: 'b', text: null }], keepsBuilt: false }),
  ];
  assert.deepStrictEqual(confirmPlan(items, new Set(['E#D-2'])), { ids: ['E#D-1'], kept: 1, answered: 1 });
  assert.deepStrictEqual(confirmPlan(items, new Set()), { ids: ['E#D-1', 'E#D-2'], kept: 0, answered: 1 });
});

test('an issue without asks asks to accept the current approach', () => {
  const [question] = questionsOf(base({ asks: [] }));
  assert.deepStrictEqual([question.question, question.options[0].label], ['Accept the approach sous built or assumed?', 'Accept']);
});
