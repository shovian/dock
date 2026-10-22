import type { PrismaClient } from '@prisma/client';
import { prisma } from '../storage/client';

/**
 * Discord forum threads for the Bug Reports page, sent by `sous discord-sync` (it holds the Discord token, DOCK never does).
 * Each sync is the full set: a thread that is no longer sent is taken off. A dismissal holds only while the thread's
 * lastActivity is unchanged, so a new message brings the thread back.
 */

export class ThreadInputError extends Error {}

export const THREAD_STATES = [
  'FLOW_1', 'FLOW_2', 'FLOW_3', 'FLOW_4', 'YOUR_TURN', 'FLOW_5', 'REVIEW_ASKED',
  'YOURS_IN_PROGRESS', 'TAKEN', 'WAITING_ON_REPORTER', 'HANDLED', 'QUIET', 'CLOSED', 'NOT_YOURS',
] as const;
export type ThreadState = typeof THREAD_STATES[number];

export interface ThreadTicket { key: string; status: string | null; assignee: string | null }
export interface ThreadRow {
  id: string;
  forum: string;
  title: string;
  url: string;
  state: ThreadState;
  why: string;
  needsYou: boolean;
  older: boolean;
  createdAt: string;
  lastActivity: string;
  tags: string[];
  tickets: ThreadTicket[];
  prs: string[];
  approvals: { have: number; need: number } | null;
  lastMessage: string;
}
export interface ThreadView extends ThreadRow { dismissed: boolean }

export const MAX_ROWS = 2000;
const MAX_TEXT = 2000;
const MAX_TAGS = 20;
const MAX_TICKETS = 20;
const MAX_PRS = 10;
/** A Discord snowflake. Digits only, so a thread id can never collide with the meta row. */
const THREAD_ID = /^\d{1,30}$/;
const TICKET = /^[A-Z][A-Z0-9_]{0,31}-[1-9]\d{0,9}$/;
const DISCORD_URL = /^https:\/\/discord\.com\/channels\/[\w/-]+$/;
const META_ID = '__meta__';

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

function instant(value: unknown, what: string): Date {
  const date = typeof value === 'string' ? new Date(value) : new Date(NaN);
  if (Number.isNaN(date.getTime())) throw new ThreadInputError(`${what} must be a timestamp`);
  return date;
}

function count(value: unknown, what: string): number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 100) throw new ThreadInputError(`${what} must be a whole number from 0 to 100`);
  return value as number;
}

export function parseThread(value: unknown): ThreadRow {
  if (!isRecord(value)) throw new ThreadInputError('A thread must be an object');
  const id = text(value.id, 40);
  if (!THREAD_ID.test(id)) throw new ThreadInputError(`Thread id must be a Discord id, got "${id}"`);
  const state = text(value.state, 30) as ThreadState;
  if (!THREAD_STATES.includes(state)) throw new ThreadInputError(`${id}: unknown state "${state}"`);
  const url = httpsUrl(value.url);
  if (!url || !DISCORD_URL.test(url)) throw new ThreadInputError(`${id}: url must be https://discord.com/channels/...`);
  const forum = text(value.forum, 60);
  if (!forum) throw new ThreadInputError(`${id}: needs a forum`);
  // The classifier sends every PR link of the thread: keep the first ones rather than refuse the whole sync.
  const prs = (Array.isArray(value.prs) ? value.prs : []).slice(0, MAX_PRS);
  const tickets = (Array.isArray(value.tickets) ? value.tickets : []).map((raw): ThreadTicket | null => {
    if (!isRecord(raw)) return null;
    const key = text(raw.key, 40).toUpperCase();
    return TICKET.test(key) ? { key, status: optional(raw.status, 100), assignee: optional(raw.assignee, 100) } : null;
  }).filter((ticket): ticket is ThreadTicket => ticket !== null);
  let approvals: ThreadRow['approvals'] = null;
  if (value.approvals !== undefined && value.approvals !== null) {
    if (!isRecord(value.approvals)) throw new ThreadInputError(`${id}: approvals must be { have, need } or null`);
    approvals = { have: count(value.approvals.have, `${id}: approvals.have`), need: count(value.approvals.need, `${id}: approvals.need`) };
  }
  return {
    id,
    forum,
    title: text(value.title, 300) || id,
    url,
    state,
    why: text(value.why, MAX_TEXT),
    needsYou: value.needsYou === true,
    older: value.older === true,
    createdAt: instant(value.createdAt, `${id}: createdAt`).toISOString(),
    lastActivity: instant(value.lastActivity, `${id}: lastActivity`).toISOString(),
    tags: (Array.isArray(value.tags) ? value.tags : []).map((tag) => text(tag, 60)).filter(Boolean).slice(0, MAX_TAGS),
    tickets: tickets.slice(0, MAX_TICKETS),
    prs: prs.map((pr) => {
      const parsed = httpsUrl(pr);
      if (!parsed) throw new ThreadInputError(`${id}: pull request urls must be https`);
      return parsed;
    }),
    approvals,
    lastMessage: text(value.lastMessage, MAX_TEXT),
  };
}

export interface ThreadRecord { id: string; machine: string; payload: string; lastActivity: Date; updatedAt: Date; removedAt: Date | null }

export interface ThreadStore {
  rows(): Promise<ThreadRecord[]>;
  upsertRow(id: string, machine: string, payload: string, lastActivity: Date, now: Date): Promise<void>;
  removeRows(ids: string[], now: Date): Promise<void>;
  /** threadId -> the lastActivity that was dismissed. */
  dismissed(): Promise<Map<string, Date>>;
  addDismissal(threadId: string, lastActivity: Date, now: Date): Promise<void>;
}

interface ThreadMeta { syncedAt: string; jiraSnapshotAt: string | null }

export class ThreadService {
  constructor(private readonly store: ThreadStore) {}

  /**
   * A full set from one producer: its threads that are missing from it get removedAt. Everything is checked before
   * anything is written, so a refused payload changes nothing. Returns the counts.
   */
  async ingest(input: unknown, machine: string, now = new Date()) {
    if (!isRecord(input) || !Array.isArray(input.rows)) throw new ThreadInputError('Send { syncedAt, jiraSnapshotAt, rows: [...] }');
    if (input.rows.length > MAX_ROWS) throw new ThreadInputError(`At most ${MAX_ROWS} threads`);
    const meta: ThreadMeta = {
      syncedAt: instant(input.syncedAt, 'syncedAt').toISOString(),
      jiraSnapshotAt: input.jiraSnapshotAt === undefined || input.jiraSnapshotAt === null ? null : instant(input.jiraSnapshotAt, 'jiraSnapshotAt').toISOString(),
    };
    const rows = input.rows.map(parseThread);
    const ids = new Set(rows.map((row) => row.id));
    if (ids.size !== rows.length) throw new ThreadInputError('Thread ids must be unique');
    for (const row of rows) await this.store.upsertRow(row.id, machine, JSON.stringify(row), new Date(row.lastActivity), now);
    await this.store.upsertRow(META_ID, machine, JSON.stringify(meta), now, now);
    const gone = (await this.store.rows()).filter((row) => row.id !== META_ID && row.machine === machine && !row.removedAt && !ids.has(row.id)).map((row) => row.id);
    if (gone.length) await this.store.removeRows(gone, now);
    return { rows: rows.length, removed: gone.length };
  }

  async list(): Promise<{ rows: ThreadView[]; syncedAt: string | null; jiraSnapshotAt: string | null }> {
    const records = await this.store.rows();
    const dismissed = await this.store.dismissed();
    const meta = records.find((row) => row.id === META_ID);
    const synced = meta ? (JSON.parse(meta.payload) as ThreadMeta) : null;
    const rows = records.filter((row) => row.id !== META_ID && !row.removedAt).map((row): ThreadView => {
      const at = dismissed.get(row.id);
      return { ...(JSON.parse(row.payload) as ThreadRow), dismissed: at !== undefined && at.getTime() === row.lastActivity.getTime() };
    }).sort((a, b) => Number(b.needsYou) - Number(a.needsYou) || b.lastActivity.localeCompare(a.lastActivity) || a.id.localeCompare(b.id));
    return { rows, syncedAt: synced?.syncedAt ?? null, jiraSnapshotAt: synced?.jiraSnapshotAt ?? null };
  }

  /** Hides a thread until its lastActivity changes. False when the thread is not open. */
  async dismiss(id: string, now = new Date()) {
    const row = (await this.store.rows()).find((entry) => entry.id === id && entry.id !== META_ID && !entry.removedAt);
    if (!row) return false;
    await this.store.addDismissal(id, row.lastActivity, now);
    return true;
  }
}

export function prismaThreadStore(db: PrismaClient): ThreadStore {
  return {
    rows: () => db.boardThread.findMany(),
    upsertRow: async (id, machine, payload, lastActivity, now) => {
      await db.boardThread.upsert({ where: { id }, create: { id, machine, payload, lastActivity, updatedAt: now }, update: { machine, payload, lastActivity, updatedAt: now, removedAt: null } });
    },
    removeRows: async (ids, now) => { await db.boardThread.updateMany({ where: { id: { in: ids } }, data: { removedAt: now } }); },
    dismissed: async () => new Map((await db.boardThreadDismissal.findMany()).map((row) => [row.threadId, row.lastActivity])),
    addDismissal: async (threadId, lastActivity, now) => {
      await db.boardThreadDismissal.upsert({ where: { threadId }, create: { threadId, lastActivity, createdAt: now }, update: { lastActivity, createdAt: now } });
    },
  };
}

export const threadService = new ThreadService(prismaThreadStore(prisma));
