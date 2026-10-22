import { boardMode } from '../board-mode';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { generateIngestToken, hashIngestToken } from '../auth/ingest-token';
import { GitHubAPI } from '../datasources/GitHubAPI';
import { StorageService } from '../storage/service';
import { ledgerPeer, type LedgerPeer } from './ledger-peer';
import { buildTimeline } from './orchestrator-timeline';
import { reviewSignalOf, type ChecksState, type ReviewDecision } from './pr-signals';

export const ORCHESTRATOR_STAGES = [
  'gate', 'plan', 'code', 'test', 'verify', 'evidence', 'commit', 'pr', 'done', 'blocked',
] as const;
export type OrchestratorStage = typeof ORCHESTRATOR_STAGES[number];
export type AcState = 'PASS' | 'FAIL' | 'TODO';
export type Activity = 'IDLE' | 'ACTIVE' | 'WAITING';

export const HOOK_EVENTS = [
  'PreToolUse', 'PostToolUse', 'Stop', 'SubagentStop', 'Notification', 'PermissionRequest', 'UserPromptSubmit',
] as const;
export type HookEvent = typeof HOOK_EVENTS[number];

// Idle / Active / Waiting and these windows follow pixtuoid's reducer
// (state/reducer/mod.rs, MIT, (c) 2026 Ivan Wang): an Active agent falls back
// to Idle 1.5 s after its tool ends, and each state goes stale on its own clock.
export const ACTIVE_GRACE_MS = 1500;
export const STALE_ACTIVE_MS = 10 * 60 * 1000;
export const STALE_IDLE_MS = 30 * 60 * 1000;
export const DEFAULT_MACHINE = 'laptop';
const MACHINE_NAME = /^[a-z][a-z0-9-]{0,23}$/;
const BRANCH_NAME = /^[A-Za-z0-9._/-]{1,200}$/;
const MAX_LIVE_RUNS_PER_MACHINE = 300;

const TICKET_KEY = /^[A-Z][A-Z0-9_]{0,31}-[1-9]\d{0,9}$/;
const MAX_AC = 50;
const MAX_DECISIONS = 100;
const MAX_ASSUMPTIONS = 50;
const MAX_FAILURES = 100;
const MAX_EVENTS_KEPT = 60;
const EVENTS_RETURNED = 20;
const MAX_TOOL_EVENTS_KEPT = 300;
const MAX_BATCH_EVENTS = 100;
const RESYNC_DISMISSED_MS = 24 * 3600 * 1000;
// Tools that are plumbing between agents rather than work worth drawing.
const HIDDEN_TOOLS = new Set(['SubagentHandback']);
const SPAWN_TOOLS = new Set(['Agent', 'Task']);
const MAX_TOKENS = 5;
const MAX_TRANSCRIPT_FILES = 40;
export const MAX_TRANSCRIPT_BYTES = 12 * 1024 * 1024;
const TRANSCRIPT_PATH = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+){0,3}$/;

export class OrchestratorInputError extends Error {}

export interface LedgerAc { n: number; state: AcState; text: string; evidence: string | null }
export interface LedgerDecision { at: string; text: string }
export const ASSUMPTION_STATES = ['open', 'confirmed', 'refuted'] as const;
export type AssumptionState = typeof ASSUMPTION_STATES[number];
export interface LedgerAssumption { n: number; text: string; falsifier: string; state: AssumptionState; evidence: string | null }
export const FAILURE_TYPES = ['transient', 'defect', 'spec', 'env', 'permission'] as const;
export type FailureType = typeof FAILURE_TYPES[number];
export interface LedgerFailure { at: string; type: FailureType; what: string | null; evidence: string; attempt: number }
export interface LedgerClosing { hours: number | null; fixRounds: number; replans: number }
export const RUN_KINDS = ['build', 'review'] as const;
export type RunKind = typeof RUN_KINDS[number];
export const FINDING_SEVERITIES = ['blocker', 'non-blocking', 'nit'] as const;
export type FindingSeverity = typeof FINDING_SEVERITIES[number];
export const REVIEW_VERDICTS = ['approve', 'request-change'] as const;
export type ReviewVerdict = typeof REVIEW_VERDICTS[number];
export interface LedgerFinding { at: string; severity: FindingSeverity; text: string }
export interface LedgerLgtm { at: string; text: string }
const MAX_FINDINGS = 50;

export interface Ledger {
  key: string;
  kind: RunKind;
  title: string;
  stage: OrchestratorStage;
  waiting: string;
  gate: string | null;
  ac: LedgerAc[];
  testsBe: string | null;
  testsFe: string | null;
  prBe: string | null;
  prFe: string | null;
  note: string | null;
  brief: string | null;
  decisions: LedgerDecision[];
  assumptions: LedgerAssumption[];
  failures: LedgerFailure[];
  closing: LedgerClosing | null;
  findings: LedgerFinding[];
  lgtm: LedgerLgtm[];
  verdict: ReviewVerdict | null;
  updatedAt: string;
}

export interface TranscriptFile { path: string; text: string }

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function optionalText(value: unknown, max: number): string | null {
  return text(value, max) || null;
}

function httpUrl(value: unknown): string | null {
  const raw = text(value, 500);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

export function normalizeMachine(value: unknown): string {
  const machine = String(value ?? '').trim().toLowerCase();
  if (!MACHINE_NAME.test(machine)) {
    throw new OrchestratorInputError('A machine name starts with a letter and has up to 24 letters, digits or dashes');
  }
  return machine;
}

export function normalizeTicketKey(value: unknown): string {
  const key = String(value ?? '').trim().toUpperCase();
  if (!TICKET_KEY.test(key)) throw new OrchestratorInputError('A valid ticket key is required');
  return key;
}

/**
 * The ledger is written by a script on the laptop. Only the fields DOCK shows
 * are kept: local directories and ports stay on the laptop.
 */
export function parseLedger(input: unknown, now = new Date()): Ledger {
  if (!isRecord(input)) throw new OrchestratorInputError('A ticket status object is required');
  const key = normalizeTicketKey(input.key);
  const stage = text(input.stage, 20) as OrchestratorStage;
  if (!ORCHESTRATOR_STAGES.includes(stage)) {
    throw new OrchestratorInputError(`Stage must be one of ${ORCHESTRATOR_STAGES.join(', ')}`);
  }

  const rawAc = Array.isArray(input.ac) ? input.ac : [];
  if (rawAc.length > MAX_AC) throw new OrchestratorInputError(`A maximum of ${MAX_AC} acceptance criteria is supported`);
  const ac = rawAc.filter(isRecord).map((item, index): LedgerAc => {
    const state = text(item.state, 10).toUpperCase();
    return {
      n: Number.isInteger(item.n) && Number(item.n) > 0 ? Number(item.n) : index + 1,
      state: state === 'PASS' || state === 'FAIL' ? state : 'TODO',
      text: text(item.text, 500),
      evidence: optionalText(item.evidence, 500),
    };
  });

  const decisions = (Array.isArray(input.decisions) ? input.decisions : [])
    .filter(isRecord)
    .map((item): LedgerDecision => ({ at: text(item.at, 40), text: text(item.text, 1000) }))
    .filter((item) => item.text)
    .slice(-MAX_DECISIONS);

  const assumptions = (Array.isArray(input.assumptions) ? input.assumptions : [])
    .filter(isRecord)
    .map((item, index): LedgerAssumption => {
      const state = text(item.state, 12) as AssumptionState;
      return {
        n: Number.isInteger(item.n) && Number(item.n) > 0 ? Number(item.n) : index + 1,
        text: text(item.text, 500),
        falsifier: text(item.falsifier, 500),
        state: ASSUMPTION_STATES.includes(state) ? state : 'open',
        evidence: optionalText(item.evidence, 500),
      };
    })
    .filter((item) => item.text)
    .slice(-MAX_ASSUMPTIONS);

  const failures = (Array.isArray(input.failures) ? input.failures : [])
    .filter(isRecord)
    .map((item): LedgerFailure => ({
      at: text(item.at, 40),
      type: text(item.type, 12) as FailureType,
      what: optionalText(item.what, 200),
      evidence: text(item.evidence, 500),
      attempt: Number.isInteger(item.attempt) && Number(item.attempt) > 0 ? Number(item.attempt) : 1,
    }))
    .filter((item) => FAILURE_TYPES.includes(item.type))
    .slice(-MAX_FAILURES);

  const count = (value: unknown): number => (Number.isInteger(value) && Number(value) > 0 ? Number(value) : 0);
  const closing: LedgerClosing | null = isRecord(input.closing)
    ? {
      hours: typeof input.closing.hours === 'number' && Number.isFinite(input.closing.hours) && input.closing.hours >= 0 ? input.closing.hours : null,
      fixRounds: count(input.closing.fixRounds),
      replans: count(input.closing.replans),
    }
    : null;

  // A finding written before severities existed counts as non-blocking.
  const findings = (Array.isArray(input.findings) ? input.findings : [])
    .filter(isRecord)
    .map((item): LedgerFinding => {
      const severity = text(item.severity, 20) as FindingSeverity;
      return { at: text(item.at, 40), severity: FINDING_SEVERITIES.includes(severity) ? severity : 'non-blocking', text: text(item.text, 1000) };
    })
    .filter((item) => item.text)
    .slice(-MAX_FINDINGS);
  const lgtm = (Array.isArray(input.lgtm) ? input.lgtm : [])
    .filter(isRecord)
    .map((item): LedgerLgtm => ({ at: text(item.at, 40), text: text(item.text, 500) }))
    .filter((item) => item.text)
    .slice(-MAX_FINDINGS);
  const verdictValue = isRecord(input.verdict) ? text(input.verdict.value, 20) as ReviewVerdict : null;
  const verdict = verdictValue && REVIEW_VERDICTS.includes(verdictValue) ? verdictValue : null;

  const tests = isRecord(input.tests) ? input.tests : {};
  const pr = isRecord(input.pr) ? input.pr : {};
  const updatedAt = new Date(text(input.updatedAt, 40));

  return {
    key,
    kind: text(input.kind, 20) === 'review' ? 'review' : 'build',
    title: text(input.title, 300),
    stage,
    waiting: text(input.waiting, 500),
    gate: optionalText(input.gate, 40),
    ac,
    testsBe: optionalText(tests.be, 200),
    testsFe: optionalText(tests.fe, 200),
    prBe: httpUrl(pr.be),
    prFe: httpUrl(pr.fe),
    note: optionalText(input.note, 500),
    brief: optionalText(input.brief, 20000),
    decisions,
    assumptions,
    failures,
    closing,
    findings,
    lgtm,
    verdict,
    updatedAt: (Number.isNaN(updatedAt.getTime()) || updatedAt > now ? now : updatedAt).toISOString(),
  };
}

export function parseHookEvent(input: unknown): { key: string; event: HookEvent; detail: string | null } {
  if (!isRecord(input)) throw new OrchestratorInputError('An event object is required');
  const event = text(input.event, 40) as HookEvent;
  if (!HOOK_EVENTS.includes(event)) throw new OrchestratorInputError(`Event must be one of ${HOOK_EVENTS.join(', ')}`);
  return { key: normalizeTicketKey(input.key), event, detail: optionalText(input.detail, 80) };
}

export interface BatchEvent {
  event: HookEvent;
  at: Date;
  tool: string | null;
  agentId: string | null;
  agentType: string | null;
  spawnType: string | null;
  spawnName: string | null;
  detail: string | null;
}

/** A queue of hook events flushed from the laptop every few seconds. */
export function parseEventBatch(input: unknown, now = new Date()): { key: string; events: BatchEvent[] } {
  if (!isRecord(input)) throw new OrchestratorInputError('An event batch object is required');
  const raw = Array.isArray(input.events) ? input.events : [];
  if (raw.length === 0 || raw.length > MAX_BATCH_EVENTS) {
    throw new OrchestratorInputError(`Between 1 and ${MAX_BATCH_EVENTS} events are required`);
  }
  const events = raw.map((item): BatchEvent => {
    if (!isRecord(item)) throw new OrchestratorInputError('Each event must be an object');
    const event = text(item.event, 40) as HookEvent;
    if (!HOOK_EVENTS.includes(event)) throw new OrchestratorInputError(`Event must be one of ${HOOK_EVENTS.join(', ')}`);
    const at = new Date(text(item.at, 40));
    return {
      event,
      at: Number.isNaN(at.getTime()) || at > now ? now : at,
      tool: optionalText(item.tool, 60),
      agentId: optionalText(item.agentId, 64),
      agentType: optionalText(item.agentType, 80),
      spawnType: optionalText(item.spawnType, 80),
      spawnName: optionalText(item.spawnName, 32),
      detail: optionalText(item.detail, 80),
    };
  });
  return { key: normalizeTicketKey(input.key), events };
}

export function parseTranscript(input: unknown): { key: string; files: TranscriptFile[]; stats: Record<string, number> } {
  if (!isRecord(input)) throw new OrchestratorInputError('A transcript object is required');
  const rawFiles = Array.isArray(input.files) ? input.files : [];
  if (rawFiles.length === 0 || rawFiles.length > MAX_TRANSCRIPT_FILES) {
    throw new OrchestratorInputError(`Between 1 and ${MAX_TRANSCRIPT_FILES} transcript files are required`);
  }
  let bytes = 0;
  const files = rawFiles.map((item): TranscriptFile => {
    if (!isRecord(item) || typeof item.path !== 'string' || typeof item.text !== 'string') {
      throw new OrchestratorInputError('Each transcript file needs a path and text');
    }
    if (!TRANSCRIPT_PATH.test(item.path) || item.path.includes('..')) {
      throw new OrchestratorInputError('Transcript paths must be relative file names');
    }
    bytes += Buffer.byteLength(item.text);
    return { path: item.path, text: item.text };
  });
  if (bytes > MAX_TRANSCRIPT_BYTES) throw new OrchestratorInputError('Transcript is too large');

  const rawStats = isRecord(input.stats) ? input.stats : {};
  const stats: Record<string, number> = { files: files.length, bytes };
  for (const name of ['masked', 'blobs', 'lines']) {
    const value = Number(rawStats[name]);
    if (Number.isFinite(value) && value >= 0) stats[name] = Math.floor(value);
  }
  return { key: normalizeTicketKey(input.key), files, stats };
}

interface ActivityState {
  activity: Activity;
  activityDetail: string | null;
  activityEndedAt: Date | null;
}

/** Hook event -> state change, after pixtuoid's source/decoder.rs. */
export function reduceHookEvent(current: ActivityState, event: HookEvent, detail: string | null, now: Date): ActivityState {
  switch (event) {
    case 'PreToolUse':
      return { activity: 'ACTIVE', activityDetail: detail || 'tool', activityEndedAt: null };
    case 'UserPromptSubmit':
      return { activity: 'ACTIVE', activityDetail: 'prompt', activityEndedAt: null };
    case 'PostToolUse':
    case 'Stop':
    case 'SubagentStop':
      // A notification or permission prompt is answered once the agent acts or stops again.
      if (current.activity === 'WAITING') return { activity: 'IDLE', activityDetail: null, activityEndedAt: null };
      return current.activity === 'ACTIVE' ? { ...current, activityEndedAt: now } : current;
    case 'Notification':
      return { activity: 'WAITING', activityDetail: detail || 'waiting', activityEndedAt: null };
    case 'PermissionRequest':
      return { activity: 'WAITING', activityDetail: 'permission', activityEndedAt: null };
  }
}

interface RunRow {
  key: string;
  title: string;
  stage: string;
  waiting: string;
  payload: string;
  activity: string;
  activityDetail: string | null;
  activityEndedAt: Date | null;
  lastEventAt: Date | null;
  ledgerUpdatedAt: Date;
  transcriptAt: Date | null;
  dismissedAt: Date | null;
  machine?: string;
  ledgerRaw?: string | null;
  handover?: string | null;
  jiraStatus?: string | null;
  jiraStage?: string | null;
  stalledDetail?: string | null;
  stalledAt?: Date | null;
}

const TODO_STATUS = 'to do';
// Where a Jira status puts a run. In Progress and a UAT bug leave the stage to the ledger.
const JIRA_STAGES: Record<string, OrchestratorStage> = {
  'pr review': 'pr',
  'uat merged': 'done',
  'uat check': 'done',
  'readyforproduction': 'done',
  'done / merged': 'done',
  'done': 'done',
};

// Blocked is not a step forward: any stage Jira gives moves a blocked run on.
const stageRank = (stage: string) => (stage === 'blocked' ? -1 : ORCHESTRATOR_STAGES.indexOf(stage as OrchestratorStage));

/** The further of the ledger's stage and the stage Jira gives: a ledger push never takes a run back behind Jira. */
export const furthestStage = (ledgerStage: string, jiraStage: string | null | undefined) => (
  jiraStage && stageRank(jiraStage) > stageRank(ledgerStage) ? jiraStage : ledgerStage
);

export interface Handover {
  from: string;
  to: string;
  at: string;
  note: string | null;
  branches: { be: string | null; fe: string | null };
}

const isBranchName = (value: string) => BRANCH_NAME.test(value) && !value.includes('..') && !value.startsWith('-');

function storedBranch(value: unknown): string | null {
  return typeof value === 'string' && isBranchName(value) ? value : null;
}

function parseHandover(raw: string | null | undefined): Handover | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || typeof value.from !== 'string' || typeof value.to !== 'string' || typeof value.at !== 'string') return null;
    const branches = isRecord(value.branches) ? value.branches : {};
    return {
      from: value.from,
      to: value.to,
      at: value.at,
      note: typeof value.note === 'string' ? value.note : null,
      branches: { be: storedBranch(branches.be), fe: storedBranch(branches.fe) },
    };
  } catch {
    return null;
  }
}

function branchInput(value: unknown, name: string): string | null {
  const branch = typeof value === 'string' ? value.trim() : value;
  if (branch === undefined || branch === null || branch === '') return null;
  if (typeof branch !== 'string' || !isBranchName(branch)) throw new OrchestratorInputError(`${name} is not a valid branch name`);
  return branch;
}

const FINISHED_STAGES = new Set<string>(['done', 'blocked']);

export type PullRequestStatus = 'open' | 'draft' | 'merged' | 'closed';
export interface RunPullRequest { url: string; number: number; repo: string; status: PullRequestStatus; reviewDecision?: ReviewDecision | null; checks?: ChecksState | null }
export type PullRequestLookup = (key: string) => Promise<RunPullRequest[]>;

const PR_LOOKUP_INTERVAL_MS = 5 * 60 * 1000;
const PR_LOOKUP_STAGES = new Set<string>(['pr', 'commit', 'evidence']);

function ledgerPullRequest(url: string): RunPullRequest {
  const match = /github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/.exec(url);
  return { url, number: match ? Number(match[2]) : 0, repo: match ? match[1] : url, status: 'open' };
}

function reviewState(pullRequests: RunPullRequest[]): 'open' | 'merged' | null {
  if (pullRequests.some((pr) => pr.status === 'open' || pr.status === 'draft')) return 'open';
  if (pullRequests.length > 0 && pullRequests.every((pr) => pr.status === 'merged')) return 'merged';
  return null;
}

// Cache-only GitHub lookup for the 5 s polled list: asks at most once per ticket
// per window and serves the last answer in between.
export function throttledPullRequestLookup(
  search: PullRequestLookup,
  intervalMs = PR_LOOKUP_INTERVAL_MS,
  clock: () => number = Date.now,
): PullRequestLookup {
  const last = new Map<string, { at: number; pullRequests: RunPullRequest[] }>();
  return async (key) => {
    const seen = last.get(key);
    if (seen && clock() - seen.at < intervalMs) return seen.pullRequests;
    const entry = { at: clock(), pullRequests: seen?.pullRequests ?? [] };
    last.set(key, entry);
    try { entry.pullRequests = await search(key); } catch { /* a failing GitHub lookup keeps the previous answer */ }
    return entry.pullRequests;
  };
}

export function toOrchestration(row: RunRow, now: Date, githubPullRequests: RunPullRequest[] = []) {
  let ledger: Partial<Ledger> = {};
  try { ledger = JSON.parse(row.payload); } catch { /* an unreadable payload still shows the row's own columns */ }
  const ac = Array.isArray(ledger.ac) ? ledger.ac : [];
  const lastSeen = row.lastEventAt && row.lastEventAt > row.ledgerUpdatedAt ? row.lastEventAt : row.ledgerUpdatedAt;
  const idleMs = Math.max(0, now.getTime() - lastSeen.getTime());
  const handover = parseHandover(row.handover);

  // The ledger's "waiting" is a gate only the owner can open, so it wins over
  // whatever the hooks last reported.
  let activity: Activity = row.activity === 'ACTIVE' || row.activity === 'WAITING' ? row.activity : 'IDLE';
  let activityDetail = row.activityDetail;
  let endedMs: number | null = row.activityEndedAt ? Math.max(0, now.getTime() - row.activityEndedAt.getTime()) : null;
  if (activity === 'ACTIVE' && endedMs !== null && endedMs >= ACTIVE_GRACE_MS) {
    activity = 'IDLE'; activityDetail = null; endedMs = null;
  }
  // A hook-level WAITING (notification, permission prompt) is not a gate: with no event for as long as an idle
  // run may stay quiet, nobody is still blocked on it. The ledger's own gate below always wins.
  if (activity === 'WAITING' && idleMs > STALE_IDLE_MS) { activity = 'IDLE'; activityDetail = null; endedMs = null; }
  if (row.waiting) { activity = 'WAITING'; activityDetail = 'gate'; endedMs = null; }
  if (FINISHED_STAGES.has(row.stage) && !row.waiting) { activity = 'IDLE'; activityDetail = null; endedMs = null; }

  const pullRequests = githubPullRequests.length > 0
    ? githubPullRequests
    : [ledger.prBe, ledger.prFe].filter((url): url is string => typeof url === 'string' && url.length > 0).map(ledgerPullRequest);
  const review = FINISHED_STAGES.has(row.stage) ? null : reviewState(pullRequests);
  if (review && activity === 'ACTIVE' && idleMs > STALE_ACTIVE_MS) { activity = 'IDLE'; activityDetail = null; endedMs = null; }

  const stalled = !FINISHED_STAGES.has(row.stage)
    && activity !== 'WAITING'
    && review === null
    && (Boolean(row.stalledDetail) || idleMs > (activity === 'ACTIVE' ? STALE_ACTIVE_MS : STALE_IDLE_MS));

  return {
    key: row.key,
    machine: row.machine ?? DEFAULT_MACHINE,
    handoverTo: handover?.to ?? null,
    handoverAt: handover?.at ?? null,
    kind: ledger.kind === 'review' ? 'review' : 'build',
    title: row.title,
    stage: row.stage,
    waiting: row.waiting || null,
    gate: ledger.gate ?? null,
    ac,
    acPassed: ac.filter((item) => item.state === 'PASS').length,
    acFailed: ac.filter((item) => item.state === 'FAIL').length,
    acTotal: ac.length,
    testsBe: ledger.testsBe ?? null,
    testsFe: ledger.testsFe ?? null,
    prBe: ledger.prBe ?? null,
    prFe: ledger.prFe ?? null,
    pullRequests,
    review,
    reviewSignal: review === 'open' ? reviewSignalOf(pullRequests) : null,
    finished: row.stage === 'done' || review === 'merged',
    note: ledger.note ?? null,
    brief: ledger.brief ?? null,
    decisions: Array.isArray(ledger.decisions) ? ledger.decisions : [],
    assumptions: Array.isArray(ledger.assumptions) ? ledger.assumptions : [],
    failures: Array.isArray(ledger.failures) ? ledger.failures : [],
    closing: ledger.closing ?? null,
    findings: Array.isArray(ledger.findings) ? ledger.findings : [],
    lgtm: Array.isArray(ledger.lgtm) ? ledger.lgtm : [],
    verdict: ledger.verdict ?? null,
    blockers: Array.isArray(ledger.findings) ? ledger.findings.filter((item) => item.severity === 'blocker').length : 0,
    activity,
    activityDetail,
    idleSeconds: Math.floor(idleMs / 1000),
    endedSeconds: endedMs === null ? null : endedMs / 1000,
    stalled,
    stalledDetail: stalled ? row.stalledDetail ?? null : null,
    hasTranscript: Boolean(row.transcriptAt),
    updatedAt: row.ledgerUpdatedAt.toISOString(),
  };
}

export type Orchestration = ReturnType<typeof toOrchestration>;

function minutes(seconds: number): string {
  const value = Math.round(seconds / 60);
  return value < 90 ? `${value} min` : `${Math.round(value / 60)} h`;
}

export function attentionItems(runs: Orchestration[]) {
  return runs.flatMap((run) => {
    const items: Array<{ id: string; type: string; message: string; ticketKey: string }> = [];
    if (run.review === 'merged') return items;
    if (run.waiting) {
      items.push({ id: `agent-waiting-${run.key}`, type: 'AGENT_WAITING', message: `Waiting on you: ${run.waiting}`, ticketKey: run.key });
    }
    if (run.acFailed > 0) {
      const failed = run.ac.filter((item) => item.state === 'FAIL').map((item) => `AC${item.n}`).join(', ');
      items.push({ id: `agent-ac-failed-${run.key}`, type: 'AGENT_AC_FAILED', message: `Acceptance check failed: ${failed}`, ticketKey: run.key });
    }
    if (run.review === 'open') {
      const named = (pick: (pr: Orchestration['pullRequests'][number]) => boolean) => run.pullRequests.filter((pr) => (pr.status === 'open' || pr.status === 'draft') && pick(pr)).map((pr) => `${pr.repo}#${pr.number}`).join(', ');
      const changes = named((pr) => pr.reviewDecision === 'changes_requested');
      if (changes) items.push({ id: `agent-changes-requested-${run.key}`, type: 'AGENT_CHANGES_REQUESTED', message: `Changes requested on ${changes}`, ticketKey: run.key });
      const failing = named((pr) => pr.checks === 'failing');
      if (failing) items.push({ id: `agent-checks-failing-${run.key}`, type: 'AGENT_CHECKS_FAILING', message: `Checks failing on ${failing}`, ticketKey: run.key });
    }
    if (run.stalled) {
      items.push({ id: `agent-stalled-${run.key}`, type: 'AGENT_STALLED', message: run.stalledDetail ?? `No agent activity for ${minutes(run.idleSeconds)} in ${run.stage}`, ticketKey: run.key });
    }
    return items;
  });
}

function defaultTranscriptDirectory(): string {
  return path.join(path.resolve(process.env.JIDIS_DATA_DIR || 'data'), 'transcripts');
}

export class OrchestratorService {
  constructor(
    private readonly storage = new StorageService(),
    private readonly transcriptDirectory = defaultTranscriptDirectory(),
    private readonly lookupPullRequests: PullRequestLookup | null = null,
    private readonly peer: Pick<LedgerPeer, 'forward' | 'runs'> | null = null,
  ) {}

  private async present(row: RunRow, now: Date) {
    const run = toOrchestration(row, now);
    if (!this.lookupPullRequests || row.stage === 'done') return run;
    if (!PR_LOOKUP_STAGES.has(row.stage) && !run.stalled) return run;
    const pullRequests = await this.lookupPullRequests(row.key).catch(() => []);
    return pullRequests.length > 0 ? toOrchestration(row, now, pullRequests) : run;
  }

  async list(now = new Date()) {
    const rows = await this.storage.getOrchestratorRuns();
    return Promise.all(rows.filter((row) => !row.dismissedAt).map((row) => this.present(row, now)));
  }

  async get(keyInput: string, now = new Date()) {
    let key: string;
    try { key = normalizeTicketKey(keyInput); } catch { return null; }
    const row = await this.storage.getOrchestratorRun(key);
    return row && !row.dismissedAt ? this.present(row, now) : null;
  }

  async events(key: string) {
    const events = await this.storage.getOrchestratorEvents(key, EVENTS_RETURNED);
    return events.map((event) => ({ id: event.id, kind: event.kind, detail: event.detail, at: event.createdAt.toISOString() }));
  }

  async timeline(keyInput: string, now = new Date()) {
    const run = await this.get(keyInput, now);
    if (!run) return null;
    const [stageEvents, toolEvents] = await Promise.all([
      this.storage.getOrchestratorEvents(run.key, MAX_EVENTS_KEPT),
      this.storage.getOrchestratorToolEvents(run.key, MAX_TOOL_EVENTS_KEPT),
    ]);
    return buildTimeline(run, stageEvents, toolEvents, now);
  }

  /** The agents the main session has spawned for the stage the ticket is in. */
  async members(keyInput: string, now = new Date()) {
    const timeline = await this.timeline(keyInput, now);
    return timeline ? timeline.agents.filter((agent) => agent.parentId) : [];
  }

  async needsAttention(now = new Date()) {
    return attentionItems(await this.list(now));
  }

  async ingestLedger(input: unknown, now: Date, machine: string) {
    const ledger = parseLedger(input, now);
    const previous = await this.storage.getOrchestratorRun(ledger.key);
    // The peer decides who owns a ticket: a leftover ledger here never brings back a run the peer gives to another machine.
    const other = this.peer && (await this.peer.runs()).find((run) => run.key === ledger.key && run.machine !== machine);
    if (other) {
      if (previous && !previous.dismissedAt) await this.stepAside(ledger.key, other.machine, now);
      return { ...other, ignored: true };
    }
    if (!previous) {
      const reset = await this.storage.getOrchestratorReset(ledger.key);
      const createdAt = Date.parse(String((input as Record<string, unknown>).createdAt ?? ''));
      if (reset && !(createdAt > reset.resetAt.getTime())) {
        throw new OrchestratorInputError(`${ledger.key} went back to To Do in Jira after this ledger was made. Archive the ledger and start the ticket again.`);
      }
    }
    const owner = previous?.machine ?? DEFAULT_MACHINE;
    const dismissedElsewhere = Boolean(previous?.dismissedAt) && owner !== machine;
    if (previous && ((!previous.dismissedAt && owner !== machine) || (dismissedElsewhere && (await this.machines()).includes(owner)))) {
      return { ...toOrchestration(previous, now), ignored: true };
    }
    if ((!previous || previous.dismissedAt) && await this.storage.countLiveOrchestratorRuns(machine) >= MAX_LIVE_RUNS_PER_MACHINE) {
      throw new OrchestratorInputError(`A maximum of ${MAX_LIVE_RUNS_PER_MACHINE} live tickets per machine is supported. Dismiss finished tickets on the Agents page and push again.`);
    }
    const { dirs: _dirs, ports: _ports, ...shared } = input as Record<string, unknown>;
    const stage = furthestStage(ledger.stage, previous?.jiraStage);
    const fields = {
      title: ledger.title,
      stage,
      waiting: ledger.waiting,
      payload: JSON.stringify(ledger),
      ledgerUpdatedAt: new Date(ledger.updatedAt),
      machine,
      ledgerRaw: JSON.stringify(shared),
      // A new or revived run starts unstalled; a ledger written after the stall shows the agent moved on.
      ...(!previous || previous.dismissedAt || (previous.stalledAt && new Date(ledger.updatedAt) > previous.stalledAt) ? { stalledDetail: null, stalledAt: null } : {}),
    };
    const taking = dismissedElsewhere;
    const row = taking
      ? await this.storage.takeDismissedOrchestratorRun(ledger.key, fields)
      : await this.storage.upsertOrchestratorRun(ledger.key, fields);
    if ((row.machine ?? DEFAULT_MACHINE) !== machine) return { ...toOrchestration(row, now), ignored: true };

    if (taking) {
      await this.storage.addOrchestratorEvent(ledger.key, 'MACHINE', machine, MAX_EVENTS_KEPT);
    }
    if (!previous || previous.stage !== stage) {
      await this.storage.addOrchestratorEvent(ledger.key, 'STAGE', stage, MAX_EVENTS_KEPT);
    }
    if (ledger.waiting && previous?.waiting !== ledger.waiting) {
      await this.storage.addOrchestratorEvent(ledger.key, 'WAITING', ledger.waiting, MAX_EVENTS_KEPT);
    } else if (!ledger.waiting && previous?.waiting) {
      await this.storage.addOrchestratorEvent(ledger.key, 'RESUMED', null, MAX_EVENTS_KEPT);
    }
    void this.peer?.forward('', input);
    return { ...toOrchestration(row, now), ignored: false };
  }

  /**
   * Hooks fire on every tool call, so this path is one read and one write.
   * The event log only grows when the state actually changes.
   */
  async ingestHookEvent(input: unknown, now: Date, machine: string) {
    const { key, event, detail } = parseHookEvent(input);
    const row = await this.storage.getOrchestratorRun(key);
    if (!row) return null;
    if ((row.machine ?? DEFAULT_MACHINE) !== machine) return { ...toOrchestration(row, now), ignored: true };

    const current: ActivityState = {
      activity: row.activity === 'ACTIVE' || row.activity === 'WAITING' ? row.activity : 'IDLE',
      activityDetail: row.activityDetail,
      activityEndedAt: row.activityEndedAt,
    };
    const next = reduceHookEvent(current, event, detail, now);
    const moved = row.stalledAt && now > row.stalledAt ? { stalledDetail: null, stalledAt: null } : {};
    const updated = await this.storage.updateOrchestratorRun(key, { ...next, lastEventAt: now, ...moved });
    if (next.activity !== current.activity) {
      await this.storage.addOrchestratorEvent(key, `AGENT_${next.activity}`, next.activityDetail, MAX_EVENTS_KEPT);
    }
    void this.peer?.forward('/event', input);
    return { ...toOrchestration(updated, now), ignored: false };
  }

  /**
   * The batched path the hook uses: one read, one state write and one insert
   * for up to a hundred events, however many tools ran in the window.
   */
  async ingestEventBatch(input: unknown, now: Date, machine: string) {
    const { key, events } = parseEventBatch(input, now);
    const row = await this.storage.getOrchestratorRun(key);
    if (!row) return null;
    if ((row.machine ?? DEFAULT_MACHINE) !== machine) return { ...toOrchestration(row, now), ignored: true };

    const initial: ActivityState = {
      activity: row.activity === 'ACTIVE' || row.activity === 'WAITING' ? row.activity : 'IDLE',
      activityDetail: row.activityDetail,
      activityEndedAt: row.activityEndedAt,
    };
    let state = initial;
    let lastEventAt = row.lastEventAt ?? new Date(0);
    const rows: Array<{ kind: string; agentId: string; agentType: string | null; name: string; detail: string | null; at: Date }> = [];

    for (const event of [...events].sort((a, b) => a.at.getTime() - b.at.getTime())) {
      const fromSubagent = Boolean(event.agentId);
      // A subagent finishing a turn is not the ticket going quiet; only the main session's own stop is.
      if ((event.event !== 'SubagentStop' && !(fromSubagent && event.event === 'Stop')) || state.activity === 'WAITING') {
        state = reduceHookEvent(state, event.event, event.tool || event.detail, event.at);
      }
      if (event.at > lastEventAt) lastEventAt = event.at;

      if (event.event === 'PreToolUse' && event.tool && !HIDDEN_TOOLS.has(event.tool)) {
        const agent = { agentId: event.agentId || 'main', agentType: event.agentType };
        rows.push({ kind: 'tool', ...agent, name: event.tool, detail: null, at: event.at });
        if (SPAWN_TOOLS.has(event.tool)) {
          // On a spawn row agentType carries the name the spawner gave its member, when it gave one.
          rows.push({ kind: 'spawn', agentId: agent.agentId, agentType: event.spawnName, name: event.spawnType || 'agent', detail: event.detail, at: event.at });
        }
      } else if (event.event === 'SubagentStop' && event.agentId) {
        rows.push({ kind: 'stop', agentId: event.agentId, agentType: event.agentType, name: event.agentType || 'agent', detail: null, at: event.at });
      }
    }

    const stalledAt = row.stalledAt;
    const moved = stalledAt && events.some((event) => event.at > stalledAt) ? { stalledDetail: null, stalledAt: null } : {};
    const updated = await this.storage.updateOrchestratorRun(key, { ...state, lastEventAt, ...moved });
    await this.storage.addOrchestratorToolEvents(key, rows, MAX_TOOL_EVENTS_KEPT);
    if (state.activity !== initial.activity) {
      await this.storage.addOrchestratorEvent(key, `AGENT_${state.activity}`, state.activityDetail, MAX_EVENTS_KEPT);
    }
    void this.peer?.forward('/events', input);
    return { ...toOrchestration(updated, now), ignored: false };
  }

  /** Set when a cron turn of the ticket ends with the reason the run is stalled, cleared (null) when the next turn starts. */
  async setStalledDetail(keyInput: string, detail: string | null, now = new Date()) {
    const row = await this.storage.getOrchestratorRun(normalizeTicketKey(keyInput));
    if (!row || row.dismissedAt || (row.stalledDetail ?? null) === detail) return;
    await this.storage.updateOrchestratorRun(row.key, { stalledDetail: detail, stalledAt: detail ? now : null });
    if (detail) await this.storage.addOrchestratorEvent(row.key, 'STALLED', detail, MAX_EVENTS_KEPT);
  }

  /** Only the machine that owns a run hides it: a run of another machine is read-only here. */
  async dismiss(keyInput: string, machine: string) {
    const key = normalizeTicketKey(keyInput);
    const row = await this.storage.getOrchestratorRun(key);
    if (!row) return false;
    if ((row.machine ?? DEFAULT_MACHINE) !== machine) throw new OrchestratorInputError(`This run belongs to ${row.machine ?? DEFAULT_MACHINE}. Hide it on that DOCK.`);
    await this.storage.updateOrchestratorRun(key, { dismissedAt: new Date() });
    void this.peer?.forward('/dismiss', { key });
    return true;
  }

  /**
   * Sends every live run of this machine to the peer again, and the dismissals of the last day:
   * a copy lost while the peer was down catches up here. Returns how many were sent.
   */
  async resyncPeer(machine: string, now = new Date()) {
    if (!this.peer) return 0;
    // The peer decides who owns a ticket. When it gives one this DOCK also holds to another machine,
    // the run here steps aside, so both pages show one run. A ledger's own time never takes a ticket.
    const theirs = new Map((await this.peer.runs()).filter((run) => run.machine !== machine).map((run) => [run.key, run]));
    let sent = 0;
    for (const row of await this.storage.getOrchestratorRuns()) {
      if ((row.machine ?? DEFAULT_MACHINE) !== machine) continue;
      if (row.dismissedAt) {
        if (now.getTime() - row.dismissedAt.getTime() > RESYNC_DISMISSED_MS || theirs.has(row.key)) continue;
        await this.peer.forward('/dismiss', { key: row.key });
      } else {
        const other = theirs.get(row.key);
        if (other) {
          await this.stepAside(row.key, other.machine, now);
          continue;
        }
        const ledger = this.sharedLedger((await this.storage.getOrchestratorRunWithLedger(row.key)) ?? row).ledger;
        if (!isRecord(ledger)) continue;
        await this.peer.forward('', ledger);
      }
      sent += 1;
    }
    return sent;
  }

  /**
   * Every few minutes: the Jira status of each live build run this machine owns. A run whose ticket was moved back
   * to To Do is removed on both DOCKs; any other change moves the stage on as far as Jira says. Returns how many changed.
   */
  async syncJira(machine: string, tickets: Array<{ key: string; status?: string | null }>, now = new Date()) {
    const statuses = new Map(tickets.map((ticket) => [ticket.key, String(ticket.status ?? '').trim()]));
    let changed = 0;
    for (const row of await this.storage.getOrchestratorRuns()) {
      if ((row.machine ?? DEFAULT_MACHINE) !== machine || row.dismissedAt || toOrchestration(row, now).kind === 'review') continue;
      const status = statuses.get(row.key);
      if (!status || status === row.jiraStatus) continue;
      const reset = await this.applyJiraStatus(row, status, now);
      void this.peer?.forward('/jira', { key: row.key, status, reset });
      changed += 1;
    }
    return changed;
  }

  /** A Jira status the owner DOCK saw, applied to this DOCK's copy of that machine's run. */
  async ingestJiraStatus(input: unknown, machine: string, now = new Date()) {
    if (!isRecord(input)) throw new OrchestratorInputError('A request object is required');
    const row = await this.storage.getOrchestratorRun(normalizeTicketKey(input.key));
    const status = text(input.status, 60);
    if (!row || !status || (row.machine ?? DEFAULT_MACHINE) !== machine) return false;
    if (input.reset === true) await this.storage.resetOrchestratorRun(row.key, machine, now);
    else await this.applyJiraStatus(row, status, now);
    return true;
  }

  // The first status seen is only recorded: a run the cron just started is still To Do until Jira moves it.
  // True when the run was removed because its ticket went back to To Do.
  private async applyJiraStatus(row: RunRow, status: string, now: Date) {
    // Board mode: the board, not Jira, says whether a ticket's work is gone.
    if (status.toLowerCase() === TODO_STATUS && row.jiraStatus && !boardMode()) {
      await this.storage.resetOrchestratorRun(row.key, row.machine ?? DEFAULT_MACHINE, now);
      return true;
    }
    const jiraStage = JIRA_STAGES[status.toLowerCase()] ?? null;
    const stage = furthestStage(row.stage, jiraStage);
    await this.storage.updateOrchestratorRun(row.key, { jiraStatus: status, jiraStage, stage });
    await this.storage.addOrchestratorEvent(row.key, 'JIRA', status, MAX_EVENTS_KEPT);
    if (stage !== row.stage) await this.storage.addOrchestratorEvent(row.key, 'STAGE', stage, MAX_EVENTS_KEPT);
    return false;
  }

  private async stepAside(key: string, owner: string, now: Date) {
    await this.storage.updateOrchestratorRun(key, { dismissedAt: now });
    await this.storage.addOrchestratorEvent(key, 'MACHINE', owner, MAX_EVENTS_KEPT);
  }

  /** What the peer DOCK reads for its own detail panel: the run and its recent events. */
  async getWithEvents(keyInput: string, now = new Date()) {
    const run = await this.get(keyInput, now);
    return run && { ...run, events: await this.events(run.key) };
  }

  private sharedLedger(row: RunRow) {
    let ledger: unknown = null;
    try { ledger = JSON.parse(row.ledgerRaw || row.payload); } catch { ledger = null; }
    return { key: row.key, machine: row.machine ?? DEFAULT_MACHINE, ledgerUpdatedAt: row.ledgerUpdatedAt.toISOString(), handover: parseHandover(row.handover), ledger };
  }

  private async liveRun(input: unknown, withLedger = false) {
    if (!isRecord(input)) throw new OrchestratorInputError('A request object is required');
    const key = normalizeTicketKey(input.key);
    const row = withLedger ? await this.storage.getOrchestratorRunWithLedger(key) : await this.storage.getOrchestratorRun(key);
    return row && !row.dismissedAt ? row : null;
  }

  async ledgerList(machine: string) {
    const [rows, resets] = await Promise.all([this.storage.getOrchestratorRuns(), this.storage.getOrchestratorResets(machine)]);
    return {
      resets: resets.map((reset) => ({ key: reset.key, resetAt: reset.resetAt.toISOString() })),
      runs: rows
        .filter((row) => !row.dismissedAt && ((row.machine ?? DEFAULT_MACHINE) === machine || parseHandover(row.handover)?.to === machine))
        .map((row) => ({
          key: row.key,
          title: row.title,
          stage: row.stage,
          machine: row.machine ?? DEFAULT_MACHINE,
          ledgerUpdatedAt: row.ledgerUpdatedAt.toISOString(),
          handoverTo: parseHandover(row.handover)?.to ?? null,
          mine: (row.machine ?? DEFAULT_MACHINE) === machine,
        })),
    };
  }

  async ledgerGet(input: unknown, machine: string) {
    const row = await this.liveRun(input, true);
    if (!row) return null;
    const visible = (row.machine ?? DEFAULT_MACHINE) === machine || parseHandover(row.handover)?.to === machine;
    return visible ? this.sharedLedger(row) : null;
  }

  async ledgerHandover(input: unknown, machine: string, now = new Date()) {
    const row = await this.liveRun(input);
    if (!row) return null;
    const owner = row.machine ?? DEFAULT_MACHINE;
    if (owner !== machine) throw new OrchestratorInputError('Only the owning machine can hand a ticket over');
    const body = input as Record<string, unknown>;
    if (body.cancel === true) {
      await this.storage.updateOrchestratorRun(row.key, { handover: null });
      if (row.handover) await this.storage.addOrchestratorEvent(row.key, 'HANDOVER_CANCELLED', parseHandover(row.handover)?.to ?? null, MAX_EVENTS_KEPT);
      return { key: row.key, handover: null };
    }
    const to = String(body.to ?? '').trim().toLowerCase();
    if (!(await this.machines()).includes(to)) throw new OrchestratorInputError('Unknown machine');
    if (to === owner) throw new OrchestratorInputError('to must differ from the owner');
    const branches = isRecord(body.branches) ? body.branches : {};
    const handover: Handover = {
      from: owner,
      to,
      at: now.toISOString(),
      note: typeof body.note === 'string' ? optionalText(body.note.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' '), 500) : null,
      branches: { be: branchInput(branches.be, 'branches.be'), fe: branchInput(branches.fe, 'branches.fe') },
    };
    await this.storage.updateOrchestratorRun(row.key, { handover: JSON.stringify(handover) });
    await this.storage.addOrchestratorEvent(row.key, 'HANDOVER', to, MAX_EVENTS_KEPT);
    return { key: row.key, handover };
  }

  async ledgerAccept(input: unknown, machine: string) {
    const row = await this.liveRun(input, true);
    if (!row) return null;
    if ((row.machine ?? DEFAULT_MACHINE) === machine) return this.sharedLedger(row);
    const offer = parseHandover(row.handover);
    if (offer?.to !== machine) throw new OrchestratorInputError('This ticket is not offered to this machine');
    const won = await this.storage.changeOrchestratorRunOwner(row.key, { machine: row.machine ?? DEFAULT_MACHINE, handover: row.handover ?? null }, machine);
    const current = await this.storage.getOrchestratorRunWithLedger(row.key);
    if (!won) {
      if (current && !current.dismissedAt && (current.machine ?? DEFAULT_MACHINE) === machine) return this.sharedLedger(current);
      throw new OrchestratorInputError('This ticket is not offered to this machine');
    }
    await this.storage.addOrchestratorEvent(row.key, 'MACHINE', machine, MAX_EVENTS_KEPT);
    return this.sharedLedger(current!);
  }

  async moveRun(keyInput: string, machineInput: string, now = new Date()) {
    const key = normalizeTicketKey(keyInput);
    const machine = normalizeMachine(machineInput);
    if (!(await this.machines()).includes(machine)) throw new OrchestratorInputError('Unknown machine');
    const row = await this.storage.getOrchestratorRun(key);
    if (!row) throw new OrchestratorInputError('Unknown ticket');
    if ((row.machine ?? DEFAULT_MACHINE) === machine) return this.present(row, now);
    const won = await this.storage.changeOrchestratorRunOwner(key, { machine: row.machine ?? DEFAULT_MACHINE, handover: row.handover ?? null }, machine);
    const current = await this.storage.getOrchestratorRun(key);
    if (!won) {
      if (current && (current.machine ?? DEFAULT_MACHINE) === machine) return this.present(current, now);
      throw new OrchestratorInputError('The ticket changed while it was being moved. Try again.');
    }
    await this.storage.addOrchestratorEvent(key, 'MACHINE', machine, MAX_EVENTS_KEPT);
    return this.present(current!, now);
  }

  private transcriptFile(key: string) {
    return path.join(this.transcriptDirectory, `${key}.json`);
  }

  async saveTranscript(input: unknown, now: Date, machine: string) {
    const { key, files, stats } = parseTranscript(input);
    const row = await this.storage.getOrchestratorRun(key);
    if (!row) return null;
    if ((row.machine ?? DEFAULT_MACHINE) !== machine) return { ignored: true, owner: row.machine ?? DEFAULT_MACHINE };
    await mkdir(this.transcriptDirectory, { recursive: true });
    const target = this.transcriptFile(key);
    const pending = `${target}.${process.pid}.tmp`;
    await writeFile(pending, JSON.stringify({ files, stats: { ...stats, receivedAt: now.toISOString() } }));
    await rename(pending, target);
    await this.storage.updateOrchestratorRun(key, { transcriptAt: now });
    return stats;
  }

  async readTranscript(keyInput: string): Promise<string | null> {
    let key: string;
    try { key = normalizeTicketKey(keyInput); } catch { return null; }
    const target = this.transcriptFile(key);
    try {
      await stat(target);
      return await readFile(target, 'utf8');
    } catch {
      return null;
    }
  }

  async tokens() {
    const tokens = await this.storage.getIngestTokens();
    return tokens.map((token) => ({
      id: token.id,
      name: token.name,
      prefix: token.prefix,
      createdAt: token.createdAt.toISOString(),
      lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
      machine: token.machine,
    }));
  }

  async machines() {
    const tokens = await this.storage.getIngestTokens();
    return [...new Set(tokens.map((token) => token.machine))];
  }

  async createToken(nameInput: string, machineInput?: string | null) {
    const name = text(nameInput, 60);
    if (!name) throw new OrchestratorInputError('Token name is required');
    const machine = normalizeMachine(machineInput?.trim() || DEFAULT_MACHINE);
    if (await this.storage.countIngestTokens() >= MAX_TOKENS) {
      throw new OrchestratorInputError(`A maximum of ${MAX_TOKENS} ingest tokens is supported`);
    }
    const generated = generateIngestToken();
    const record = await this.storage.createIngestToken({ name, prefix: generated.prefix, tokenHash: generated.tokenHash, machine });
    return {
      token: generated.token,
      record: { id: record.id, name: record.name, prefix: record.prefix, createdAt: record.createdAt.toISOString(), lastUsedAt: null, machine: record.machine },
    };
  }

  async revokeToken(id: string) {
    if (!id) return false;
    const token = (await this.storage.getIngestTokens()).find((item) => item.id === id);
    const revoked = (await this.storage.revokeIngestToken(id)).count > 0;
    if (revoked && token && !(await this.machines()).includes(token.machine)) {
      for (const row of await this.storage.getOrchestratorRuns()) {
        if (parseHandover(row.handover)?.to !== token.machine) continue;
        await this.storage.updateOrchestratorRun(row.key, { handover: null });
        await this.storage.addOrchestratorEvent(row.key, 'HANDOVER_CANCELLED', `${token.machine} (token revoked)`, MAX_EVENTS_KEPT);
      }
    }
    return revoked;
  }

  async authenticateMachine(token: string, now = new Date()) {
    const record = await this.storage.findIngestToken(hashIngestToken(token));
    if (!record) return null;
    // lastUsedAt is informational; once a minute is enough and keeps hook traffic to one write.
    if (!record.lastUsedAt || now.getTime() - record.lastUsedAt.getTime() > 60_000) {
      await this.storage.touchIngestToken(record.id, now).catch(() => undefined);
    }
    return record.machine;
  }
}

const githubAPI = new GitHubAPI();
export const orchestratorService = new OrchestratorService(undefined, undefined, throttledPullRequestLookup(async (key) => {
  const found = await githubAPI.getPullRequestsForTicket(key, { staleWhileRevalidate: true });
  const signals = await githubAPI.getPullRequestSignals(key, found);
  return found.map((pr) => ({
    url: pr.url,
    number: pr.number,
    repo: `${pr.owner}/${pr.repo}`,
    status: (['open', 'draft', 'merged', 'closed'].includes(pr.status) ? pr.status : 'open') as PullRequestStatus,
    reviewDecision: (signals as Record<string, { reviewDecision?: ReviewDecision }>)[pr.url]?.reviewDecision ?? null,
    checks: (signals as Record<string, { checks?: ChecksState }>)[pr.url]?.checks ?? null,
  }));
}), ledgerPeer);
