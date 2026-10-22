import type { PrismaClient } from '@prisma/client';
import { prisma } from '../storage/client';

/**
 * Board items: the blackboard entries that wait on the owner, sent by `sous dock-sync`.
 * An item is an issue I-n with Resolver OWNER or a decision D-n that sous made on the owner's behalf (SHOV).
 * The work already continued on the option marked `built`, so an answer never waits on a live session:
 * DOCK keeps it, with no expiry, until `sous answer` pulls it, writes the board and acknowledges it.
 */

export class BoardInputError extends Error {}

export const BOARD_KINDS = ['issue', 'decision'] as const;
export type BoardKind = typeof BOARD_KINDS[number];

export interface BoardOption { key: string; label: string; effect: string | null; built: boolean }
export interface BoardAsk { question: string; options: BoardOption[] }
export interface BoardItem {
  id: string;
  epic: string;
  kind: BoardKind;
  ref: string;
  title: string;
  tickets: string[];
  type: string | null;
  status: string | null;
  resolver: string | null;
  blocks: string | null;
  escalated: boolean;
  detail: string | null;
  asks: BoardAsk[];
  prs: string[];
  findings: string | null;
  source: string | null;
}
export interface BoardAnswerPart { ask: number; choice: string | null; text: string | null }
export interface BoardAnswer { id: number; itemId: string; parts: BoardAnswerPart[]; createdAt: string }

export const MAX_ITEMS = 500;
export const MAX_ASKS = 4;
export const MAX_OPTIONS = 4;
const OPTION_KEYS = ['a', 'b', 'c', 'd'];
/** The answer to a decision without asks: keep what sous built. */
export const CONFIRM = 'confirm';
const ITEM_ID = /^[A-Za-z0-9._/-]{1,120}#[DI]-[1-9]\d{0,4}$/;
const TICKET = /^[A-Z][A-Z0-9_]{0,31}-[1-9]\d{0,9}$/;
const MAX_TEXT = 2000;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const optional = (value: unknown, max: number) => text(value, max) || null;

function httpsUrl(value: unknown): string | null {
  const raw = text(value, 300);
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

export function parseAsks(value: unknown): BoardAsk[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_ASKS) throw new BoardInputError(`asks must be a list of at most ${MAX_ASKS}`);
  return value.map((raw, index): BoardAsk => {
    if (!isRecord(raw)) throw new BoardInputError(`ask ${index + 1} must be an object`);
    const question = text(raw.question, 300);
    if (!question) throw new BoardInputError(`ask ${index + 1} needs a question`);
    const options = Array.isArray(raw.options) ? raw.options : [];
    if (options.length < 2 || options.length > MAX_OPTIONS) throw new BoardInputError(`ask ${index + 1} needs 2 to ${MAX_OPTIONS} options`);
    const parsed = options.map((option, at): BoardOption => {
      if (!isRecord(option)) throw new BoardInputError(`ask ${index + 1} option ${at + 1} must be an object`);
      const key = text(option.key, 1).toLowerCase();
      const label = text(option.label, 120);
      if (key !== OPTION_KEYS[at]) throw new BoardInputError(`ask ${index + 1} options must be lettered a, b, c, d in order`);
      if (!label) throw new BoardInputError(`ask ${index + 1} option ${key} needs a label`);
      return { key, label, effect: optional(option.effect, 300), built: option.built === true };
    });
    if (parsed.filter((option) => option.built).length !== 1) throw new BoardInputError(`ask ${index + 1} needs exactly one option marked built`);
    return { question, options: parsed };
  });
}

export function parseItem(value: unknown): BoardItem {
  if (!isRecord(value)) throw new BoardInputError('A board item must be an object');
  const id = text(value.id, 130);
  if (!ITEM_ID.test(id)) throw new BoardInputError(`Board item id must look like <epic path>#I-12 or #D-3, got "${id}"`);
  const kind = text(value.kind, 10) as BoardKind;
  if (!BOARD_KINDS.includes(kind)) throw new BoardInputError(`${id}: kind must be issue or decision`);
  const ref = id.split('#')[1];
  if ((kind === 'issue') !== ref.startsWith('I-')) throw new BoardInputError(`${id}: an issue is I-n and a decision is D-n`);
  const tickets = (Array.isArray(value.tickets) ? value.tickets : []).map((ticket) => text(ticket, 40).toUpperCase()).filter((ticket) => TICKET.test(ticket));
  return {
    id,
    epic: text(value.epic, 120) || id.split('#')[0],
    kind,
    ref,
    title: text(value.title, 300) || ref,
    tickets: [...new Set(tickets)].slice(0, 10),
    type: optional(value.type, 20),
    status: optional(value.status, 200),
    resolver: optional(value.resolver, 20),
    blocks: optional(value.blocks, 300),
    escalated: value.escalated === true,
    detail: optional(value.detail, 1000),
    asks: parseAsks(value.asks),
    prs: (Array.isArray(value.prs) ? value.prs : []).map(httpsUrl).filter((url): url is string => Boolean(url)).slice(0, 10),
    findings: optional(value.findings, 300),
    source: optional(value.source, 200),
  };
}

/** Checks an owner's answer against the item: one part per ask (or one part for a decision without asks). */
export function parseAnswer(item: BoardItem, value: unknown): BoardAnswerPart[] {
  if (!Array.isArray(value) || value.length === 0) throw new BoardInputError('An answer needs at least one part');
  const asks = item.asks.length || 1;
  const seen = new Set<number>();
  const parts = value.map((raw): BoardAnswerPart => {
    if (!isRecord(raw)) throw new BoardInputError('Each answer part must be an object');
    const ask = Number(raw.ask);
    if (!Number.isInteger(ask) || ask < 0 || ask >= asks) throw new BoardInputError(`ask must be 0 to ${asks - 1}`);
    if (seen.has(ask)) throw new BoardInputError(`ask ${ask} is answered twice`);
    seen.add(ask);
    const choice = optional(raw.choice, 10)?.toLowerCase() ?? null;
    const answerText = typeof raw.text === 'string' ? raw.text.trim().slice(0, MAX_TEXT) || null : null;
    const allowed = item.asks.length ? item.asks[ask].options.map((option) => option.key) : [CONFIRM];
    if (choice && !allowed.includes(choice)) throw new BoardInputError(`choice must be one of ${allowed.join(', ')}`);
    if (!choice && !answerText) throw new BoardInputError('Pick an option or write an answer');
    if (choice && answerText) throw new BoardInputError('Pick an option or write an answer, not both');
    return { ask, choice, text: answerText };
  });
  if (seen.size !== asks) throw new BoardInputError(`Answer all ${asks} question${asks === 1 ? '' : 's'}`);
  return parts.sort((a, b) => a.ask - b.ask);
}

/** The answer that keeps what sous built: the built option of every ask, or confirm for a decision without asks. */
export function builtAnswer(item: BoardItem): BoardAnswerPart[] {
  if (!item.asks.length) return [{ ask: 0, choice: CONFIRM, text: null }];
  return item.asks.map((ask, index) => ({ ask: index, choice: ask.options.find((option) => option.built)!.key, text: null }));
}

/** True when the answer keeps everything sous built, so no revision is needed. */
export function keepsBuilt(item: BoardItem, parts: BoardAnswerPart[]): boolean {
  return parts.every((part) => (item.asks.length
    ? item.asks[part.ask]?.options.find((option) => option.key === part.choice)?.built === true
    : part.choice === CONFIRM));
}

export interface BoardItemRow { id: string; machine: string; payload: string; removedAt: Date | null; updatedAt: Date }
export interface BoardAnswerRow { id: number; itemId: string; machine: string; payload: string; createdAt: Date; appliedAt: Date | null; note: string | null }

export interface BoardStore {
  items(): Promise<BoardItemRow[]>;
  upsertItem(id: string, machine: string, payload: string, now: Date): Promise<void>;
  removeItems(ids: string[], now: Date): Promise<void>;
  answers(where: { itemId?: string; pendingOnly?: boolean; machine?: string }): Promise<BoardAnswerRow[]>;
  addAnswer(itemId: string, machine: string, payload: string, now: Date): Promise<number>;
  updateAnswer(id: number, payload: string, now: Date): Promise<void>;
  markApplied(ids: number[], note: string | null, now: Date): Promise<number>;
}

export interface BoardItemView extends BoardItem { pending: BoardAnswerPart[] | null; keepsBuilt: boolean | null; answeredAt: string | null }

export class BoardService {
  constructor(private readonly store: BoardStore) {}

  /** A full set from one producer: items it no longer sends are taken off. Returns the counts. */
  async ingest(input: unknown, machine: string, now = new Date()) {
    if (!isRecord(input) || !Array.isArray(input.items)) throw new BoardInputError('Send { items: [...] }');
    if (input.items.length > MAX_ITEMS) throw new BoardInputError(`At most ${MAX_ITEMS} board items`);
    const items = input.items.map(parseItem);
    const ids = new Set(items.map((item) => item.id));
    if (ids.size !== items.length) throw new BoardInputError('Board item ids must be unique');
    for (const item of items) await this.store.upsertItem(item.id, machine, JSON.stringify(item), now);
    const gone = (await this.store.items()).filter((row) => row.machine === machine && !row.removedAt && !ids.has(row.id)).map((row) => row.id);
    if (gone.length) await this.store.removeItems(gone, now);
    return { items: items.length, removed: gone.length };
  }

  async list(): Promise<BoardItemView[]> {
    const rows = (await this.store.items()).filter((row) => !row.removedAt);
    const pending = await this.store.answers({ pendingOnly: true });
    return rows.map((row) => {
      const item = JSON.parse(row.payload) as BoardItem;
      const answer = pending.filter((entry) => entry.itemId === row.id).at(-1);
      const parts = answer ? (JSON.parse(answer.payload) as BoardAnswerPart[]) : null;
      return { ...item, pending: parts, keepsBuilt: parts ? keepsBuilt(item, parts) : null, answeredAt: answer?.createdAt.toISOString() ?? null };
    }).sort((a, b) => Number(b.escalated) - Number(a.escalated) || a.epic.localeCompare(b.epic) || a.id.localeCompare(b.id, undefined, { numeric: true }));
  }

  /** The owner's answer. A later answer before sous applied it replaces the earlier one. */
  async answer(itemId: string, value: unknown, now = new Date()) {
    const row = (await this.store.items()).find((entry) => entry.id === itemId && !entry.removedAt);
    if (!row) throw new BoardInputError('This board item is no longer open');
    const item = JSON.parse(row.payload) as BoardItem;
    const payload = JSON.stringify(parseAnswer(item, value));
    const [pending] = (await this.store.answers({ itemId, pendingOnly: true })).slice(-1);
    if (pending) await this.store.updateAnswer(pending.id, payload, now);
    else await this.store.addAnswer(itemId, row.machine, payload, now);
    return true;
  }

  /**
   * "Confirm all except": keeps what sous built for every listed item. Every id is checked before anything is written.
   * An item the owner already answered is left as it is and reported as skipped.
   */
  async confirmAll(ids: unknown, now = new Date()) {
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_ITEMS || !ids.every((id) => typeof id === 'string')) throw new BoardInputError('Send the ids to confirm');
    const unique = [...new Set(ids as string[])];
    const open = new Map((await this.store.items()).filter((row) => !row.removedAt).map((row) => [row.id, row]));
    const missing = unique.filter((id) => !open.has(id));
    if (missing.length) throw new BoardInputError(`No longer open: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ` and ${missing.length - 5} more` : ''}`);
    const answered = new Set((await this.store.answers({ pendingOnly: true })).map((row) => row.itemId));
    const skipped = unique.filter((id) => answered.has(id));
    for (const id of unique.filter((entry) => !answered.has(entry))) {
      const row = open.get(id)!;
      await this.store.addAnswer(id, row.machine, JSON.stringify(builtAnswer(JSON.parse(row.payload) as BoardItem)), now);
    }
    return { confirmed: unique.length - skipped.length, skipped };
  }

  /** What `sous answer` applies: each pending answer with its item, for the producer that owns the items. */
  async pull(machine: string) {
    const items = new Map((await this.store.items()).map((row) => [row.id, JSON.parse(row.payload) as BoardItem]));
    return (await this.store.answers({ pendingOnly: true, machine }))
      .filter((row) => items.has(row.itemId))
      .map((row) => {
        const item = items.get(row.itemId)!;
        const parts = JSON.parse(row.payload) as BoardAnswerPart[];
        return { id: row.id, createdAt: row.createdAt.toISOString(), item, parts, keepsBuilt: keepsBuilt(item, parts) };
      });
  }

  async ack(input: unknown, machine: string, now = new Date()) {
    if (!isRecord(input) || !Array.isArray(input.ids) || !input.ids.every((id) => Number.isInteger(id))) throw new BoardInputError('Send { ids: [numbers], note? }');
    const mine = new Set((await this.store.answers({ pendingOnly: true, machine })).map((row) => row.id));
    const ids = (input.ids as number[]).filter((id) => mine.has(id));
    return { applied: ids.length ? await this.store.markApplied(ids, optional(input.note, 500), now) : 0 };
  }
}

export function prismaBoardStore(db: PrismaClient): BoardStore {
  return {
    items: () => db.boardItem.findMany(),
    upsertItem: async (id, machine, payload, now) => {
      await db.boardItem.upsert({ where: { id }, create: { id, machine, payload, updatedAt: now }, update: { machine, payload, updatedAt: now, removedAt: null } });
    },
    removeItems: async (ids, now) => { await db.boardItem.updateMany({ where: { id: { in: ids } }, data: { removedAt: now } }); },
    answers: (where) => db.boardAnswer.findMany({
      where: { ...(where.itemId ? { itemId: where.itemId } : {}), ...(where.machine ? { machine: where.machine } : {}), ...(where.pendingOnly ? { appliedAt: null } : {}) },
      orderBy: { id: 'asc' },
    }),
    addAnswer: async (itemId, machine, payload, now) => (await db.boardAnswer.create({ data: { itemId, machine, payload, createdAt: now } })).id,
    updateAnswer: async (id, payload, now) => { await db.boardAnswer.update({ where: { id }, data: { payload, createdAt: now } }); },
    markApplied: async (ids, note, now) => (await db.boardAnswer.updateMany({ where: { id: { in: ids }, appliedAt: null }, data: { appliedAt: now, note } })).count,
  };
}

export const boardService = new BoardService(prismaBoardStore(prisma));
