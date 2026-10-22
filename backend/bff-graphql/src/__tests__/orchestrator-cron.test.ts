import assert from 'node:assert';
import test from 'node:test';
import {
  CronInputError, DEFAULT_CRON_SETTINGS, MAX_RESUMES, OrchestratorCron, PARKED_TEXT, RESUME_GAVE_UP_TEXT, START_FAILED_TEXT, candidates, hasAcceptanceCriteria, labelOrder, ticketHasAcceptanceCriteria, outsideWindow, parseCronSettings,
  confirmedPrompt, resumePrompt, startPrompt, wib, type CronDeps, type CronRun, type CronSettings, type CronTicket,
} from '../integrations/orchestrator-cron';

const AC = 'Context.\n\nAcceptance criteria\n\nReloading the page still shows Disconnected.\n\nA manually disabled channel keeps its status.';
const ticket = (key: string, overrides: Partial<CronTicket> = {}): CronTicket => ({ key, title: `Title ${key}`, description: AC, status: 'To Do', sprintState: 'ACTIVE', labels: [], ...overrides });
const settings = (overrides: Partial<CronSettings> = {}): CronSettings => ({ ...DEFAULT_CRON_SETTINGS, ...overrides });
/** Wednesday 2026-10-14, 09:05 WIB. */
const WED_0905 = new Date('2026-10-14T02:05:00.000Z');

test('settings: defaults when nothing is saved, saved fields win, v1 keys are ignored, wrong values are refused', () => {
  assert.deepStrictEqual(parseCronSettings(null), DEFAULT_CRON_SETTINGS);
  assert.deepStrictEqual(
    [DEFAULT_CRON_SETTINGS.enabled, DEFAULT_CRON_SETTINGS.workStart, DEFAULT_CRON_SETTINGS.workEnd, DEFAULT_CRON_SETTINGS.workDays, DEFAULT_CRON_SETTINGS.maxPerDay, DEFAULT_CRON_SETTINGS.mode],
    [false, 9, 17, [1, 2, 3, 4, 5], 6, 'auto'],
  );
  const saved = parseCronSettings(JSON.stringify({ enabled: true, hoursWib: [9], perRound: 3, workDays: [5, 1, 1], parallel: 1, labels: [' be ', 'be'], epicBase: { 'QRD-1232': 'feat/V1-Playbook' } }));
  assert.deepStrictEqual([saved.enabled, saved.workDays, saved.parallel, saved.labels], [true, [1, 5], 1, ['be']]);
  assert.ok(!('hoursWib' in saved) && !('perRound' in saved) && !('epicBase' in saved), 'keys from older configs are dropped');
  for (const bad of [
    '{', '[]', '{"parallel":0}', '{"workStart":17,"workEnd":9}', '{"workEnd":25}', '{"workDays":[]}', '{"workDays":[8]}', '{"maxPerDay":0}',
    '{"activeFrom":"2026-10-20","activeUntil":"2026-10-01"}', '{"activeFrom":"14-10-2026"}', '{"mode":"bypassPermissions"}',
    '{"sprint":"next"}', '{"todoStatuses":[]}', '{"usageBrakePercent":101}',
    '{"notifyUserId":"danu"}', '{"enabled":"yes"}', '{"machine":""}',
  ]) {
    assert.throws(() => parseCronSettings(bad), CronInputError, bad);
  }
});

test('acceptance criteria need the heading and at least one criterion under it', () => {
  assert.strictEqual(hasAcceptanceCriteria(AC), true);
  assert.strictEqual(hasAcceptanceCriteria('Acceptance criteria\n\n- Button works'), true, 'one short criterion is enough');
  assert.strictEqual(hasAcceptanceCriteria('ACCEPTANCE CRITERIA: Backend\n\n1. Three new models exist, as in the RFC database section.'), true);
  for (const none of [null, '', 'Token counts are not in the audit log. They are written per agent run.', 'Acceptance criteria\n\n.', 'Acceptance criteria\n\n- TBD']) {
    assert.strictEqual(hasAcceptanceCriteria(none), false, String(none));
  }
});

test('candidates: only To Do tickets in scope, without a run or an open dependency; ordered tickets first, then by ticket number', () => {
  const tickets = [
    ticket('QRD-30'), ticket('QRD-4'), ticket('QRD-5', { status: 'In Progress' }), ticket('QRD-6', { sprintState: 'FUTURE' }),
    ticket('QRD-7'), ticket('QRD-8'), ticket('QRD-9', { status: 'to do', labels: ['FE'] }),
  ];
  const keys = (list: CronTicket[]) => list.map((item) => item.key);
  assert.deepStrictEqual(keys(candidates(tickets, new Set(['QRD-7']), new Set(['QRD-8']), settings())), ['QRD-4', 'QRD-9', 'QRD-30']);
  assert.deepStrictEqual(keys(candidates(tickets, new Set(), new Set(), settings({ sprint: 'any', labels: ['fe'] }))), ['QRD-9']);

  const playbook = [ticket('QRD-10', { labels: ['#2'] }), ticket('QRD-11'), ticket('QRD-12', { labels: ['playbook', '#1'] }), ticket('QRD-3'), ticket('QRD-13', { labels: ['#3'] })];
  assert.deepStrictEqual(keys(candidates(playbook, new Set(), new Set(), settings())), ['QRD-12', 'QRD-10', 'QRD-13', 'QRD-3', 'QRD-11'], 'Jira #N labels first, the rest by number');
  assert.deepStrictEqual(keys(candidates(playbook, new Set(), new Set(), settings(), new Map([['QRD-13', 1], ['QRD-12', 5]]))), ['QRD-13', 'QRD-10', 'QRD-12', 'QRD-3', 'QRD-11'], 'a number set in DOCK wins over the label');
  assert.deepStrictEqual([labelOrder(['#7', '#2']), labelOrder(['#x', 'v1']), labelOrder(undefined)], [2, null, null]);
});

test('work window: hours, work days and active dates, all in WIB', () => {
  assert.deepStrictEqual(wib(WED_0905), { date: '2026-10-14', hour: 9, day: 3 });
  assert.strictEqual(outsideWindow(WED_0905, settings()), null);
  assert.match(String(outsideWindow(new Date('2026-10-14T01:59:00.000Z'), settings())), /09:00-17:00 WIB/, '08:59 WIB');
  assert.match(String(outsideWindow(new Date('2026-10-14T10:00:00.000Z'), settings())), /09:00-17:00 WIB/, '17:00 WIB is already out');
  assert.match(String(outsideWindow(new Date('2026-10-17T03:00:00.000Z'), settings())), /not a work day/, 'Saturday');
  assert.strictEqual(outsideWindow(new Date('2026-10-17T03:00:00.000Z'), settings({ workDays: [6] })), null);
  assert.match(String(outsideWindow(WED_0905, settings({ activeFrom: '2026-10-15' }))), /active from 2026-10-15/);
  assert.match(String(outsideWindow(WED_0905, settings({ activeUntil: '2026-10-13' }))), /active until 2026-10-13/);
  assert.strictEqual(outsideWindow(WED_0905, settings({ activeFrom: '2026-10-14', activeUntil: '2026-10-14' })), null, 'both ends are inclusive');
});

test('the start prompt does not ask on a ticket with AC, lists decisions, and leaves the pull request to the owner', () => {
  const prompt = startPrompt('QRD-1240');
  assert.match(prompt, /do not stop to ask/);
  assert.match(prompt, /status\.cjs decide QRD-1240/);
  assert.match(prompt, /decision taken without the owner in your last chat message/);
  assert.match(prompt, /committed on the ticket branch and ready for review/);
  for (const text of [prompt, confirmedPrompt('QRD-1240')]) {
    assert.match(text, /Do not push and do not open a pull request/);
    assert.doesNotMatch(text, /develop|feat\/V1-Playbook|against/);
  }
});

test('both prompts send the session to the contract rule and to the vault', () => {
  for (const prompt of [startPrompt('QRD-1240'), confirmedPrompt('QRD-1240')]) {
    assert.match(prompt, /rules\/ticket-contract\.md/);
    assert.match(prompt, /cannot be read, stop and report/);
    assert.match(prompt, /brain\.py save/);
  }
});

interface Start {
  tickets?: CronTicket[];
  config?: Partial<CronSettings>;
  runs?: CronRun[];
  online?: boolean;
  used?: { usedPercentage: number; resetsAt: string | null } | null;
  webhook?: string;
  moves?: boolean;
  dependencies?: Array<{ ticketKey: string; dependsOnKey: string }>;
  pushDevices?: boolean;
  dockOrder?: Map<string, number>;
  manual?: Set<string>;
  now?: Date;
}

type SessionState = 'queued' | 'running' | 'idle' | 'error';

/**
 * The cron against fakes. Sessions model the chat side: a message sent to a session queues it, and `claim` is the
 * bridge's claim with the slot gate (the oldest queued cron session runs while fewer than `parallel` run).
 */
function world(start: Start = {}) {
  const state = {
    now: start.now ?? WED_0905,
    settings: new Map<string, string>([['orchestratorCronConfig', JSON.stringify({ ...DEFAULT_CRON_SETTINGS, enabled: true, ...start.config })]]),
    cache: new Map<string, unknown>(),
    tickets: start.tickets ?? [],
    runs: start.runs ?? [] as CronRun[],
    online: start.online ?? true,
    sessions: [] as Array<{ id: string; ticketKey: string; machine: string; origin: string; options: Record<string, string>; state: SessionState; queuedAt: number; replied: boolean }>,
    sent: [] as Array<{ sessionId: string; text: string; options: Record<string, string> }>,
    moved: [] as string[],
    movedTo: [] as Array<[string, string]>,
    stopped: [] as string[],
    posts: [] as Array<{ url: string; body: unknown }>,
    pushes: [] as Array<{ title: string; body: string; url: string }>,
    clock: 0,
    ownerStopped: new Set<string>(),
    otherActive: new Set<string>(),
    failSend: false,
  };
  if (start.webhook) state.settings.set('orchestratorCronWebhookUrl', start.webhook);
  const parallel = () => JSON.parse(state.settings.get('orchestratorCronConfig') as string).parallel as number;
  const deps: CronDeps = {
    now: () => state.now,
    settingValue: async (key) => state.settings.get(key) || null,
    saveSetting: async (key, value) => { state.settings.set(key, value); },
    cacheGet: async (key) => state.cache.get(key) ?? null,
    cacheSet: async (key, value) => { state.cache.set(key, JSON.parse(JSON.stringify(value))); },
    cacheDelete: async (key) => { state.cache.delete(key); },
    tickets: async () => state.tickets,
    ticket: async (key) => state.tickets.find((item) => item.key === key) ?? null,
    moveTicket: async (key, statusName) => { state.moved.push(key); state.movedTo.push([key, statusName]); return start.moves ?? true; },
    dependencies: async () => start.dependencies ?? [],
    dockOrder: async () => start.dockOrder ?? new Map(),
    manualKeys: async () => start.manual ?? new Set(),
    slots: async () => ({ busy: state.sessions.filter((s) => s.state === 'running').length, waiting: state.sessions.filter((s) => s.state === 'queued').length }),
    machines: async () => ['laptop', 'workspace'],
    online: () => state.online,
    fiveHourUsed: () => start.used ?? null,
    takenKeys: async () => state.runs.map((run) => run.key),
    deadStarts: async () => [...new Set(state.sessions.map((s) => s.ticketKey))]
      .map((key) => state.sessions.filter((s) => s.ticketKey === key).at(-1)!)
      .filter((s) => s.state === 'idle' && s.queuedAt > 0 && !s.replied)
      .map((s) => s.ticketKey),
    runs: async () => state.runs,
    saveRun: async (ledger, machine) => {
      const run: CronRun = { key: String(ledger.key), machine, title: String(ledger.title), waiting: String(ledger.waiting) || null, activity: 'IDLE' };
      state.runs = [...state.runs.filter((item) => item.key !== run.key), run];
    },
    park: async (key, waiting) => { state.runs = state.runs.map((run) => (run.key === key ? { ...run, waiting, stalled: false } : run)); },
    cronSessions: async (keys) => new Map(state.sessions.filter((s) => keys.includes(s.ticketKey)).map((s) => [s.ticketKey, { id: s.id, status: s.state, stopped: state.ownerStopped.has(s.ticketKey), otherActive: state.otherActive.has(s.ticketKey) }])),
    openSession: async (input) => {
      const session = { id: `s-${state.sessions.length + 1}`, ...input, state: 'idle' as SessionState, queuedAt: 0, replied: false };
      state.sessions.push(session);
      return session;
    },
    send: async (sessionId, text, options) => {
      if (state.failSend) throw new Error('send refused');
      state.sent.push({ sessionId, text, options });
      const session = state.sessions.find((item) => item.id === sessionId)!;
      Object.assign(session, { state: 'queued', queuedAt: ++state.clock });
    },
    runningSessions: async () => ['s-1', 's-2'],
    stopTurn: async (sessionId) => { state.stopped.push(sessionId); },
    post: async (url, body) => { state.posts.push({ url, body }); },
    hasPushDevices: async () => start.pushDevices ?? false,
    push: async (message) => { state.pushes.push(message); },
  };
  const cron = new OrchestratorCron(deps);
  const byKey = (key: string) => state.sessions.filter((session) => session.ticketKey === key).at(-1)!;
  /** The bridge claiming until the gate says no. */
  const claim = () => {
    for (;;) {
      const next = state.sessions.filter((s) => s.state === 'queued').sort((a, b) => a.queuedAt - b.queuedAt)[0];
      if (!next || state.sessions.filter((s) => s.state === 'running').length >= parallel()) return;
      next.state = 'running';
    }
  };
  /** A turn ends: the agent asks the owner, or the PR is open. Either way the slot is free. */
  const endTurn = (key: string) => { Object.assign(byKey(key), { state: 'idle', replied: true }); };
  /** The turn ends before the agent says anything, as when a hook blocks the prompt. */
  const dieOnStart = (key: string) => { byKey(key).state = 'idle'; };
  /** The owner answers in the chat: the session queues again, behind messages queued earlier. */
  const answer = (key: string) => Object.assign(byKey(key), { state: 'queued', queuedAt: ++state.clock });
  const step = async () => { await cron.runFill(); claim(); };
  const running = () => state.sessions.filter((s) => s.state === 'running').map((s) => s.ticketKey).sort();
  return { state, cron, claim, endTurn, dieOnStart, answer, step, running };
}

test('the agreed scenario: a stuck ticket frees its slot, the answer takes the next free slot before new tickets, a parked ticket takes none', async () => {
  const order = new Map([['QRD-1', 1], ['QRD-2', 2], ['QRD-3', 3], ['QRD-4', 4], ['QRD-5', 5], ['QRD-6', 6]]);
  const tickets = ['QRD-1', 'QRD-2', 'QRD-3', 'QRD-4', 'QRD-5', 'QRD-6'].map((key) => ticket(key, key === 'QRD-5' ? { description: 'No criteria.' } : {}));
  const w = world({ tickets, dockOrder: order, config: { parallel: 2, maxPerDay: 10 } });

  await w.step();
  assert.deepStrictEqual(w.running(), ['QRD-1', 'QRD-2'], '09:00 #1 and #2');
  assert.deepStrictEqual((await w.cron.lastFill())!.deferred.map((d) => d.key), ['QRD-3', 'QRD-4', 'QRD-6'], 'the rest is logged as slots full');

  w.endTurn('QRD-1'); await w.step();
  assert.deepStrictEqual(w.running(), ['QRD-2', 'QRD-3'], '09:40 #1 stuck: #3 takes its slot');

  w.answer('QRD-1'); await w.step();
  assert.deepStrictEqual(w.running(), ['QRD-2', 'QRD-3'], '10:00 answer while both slots are busy: it waits, nothing exceeds 2');

  w.endTurn('QRD-2'); await w.step();
  assert.deepStrictEqual(w.running(), ['QRD-1', 'QRD-3'], '10:20 #2 done: the answer to #1 goes before #4');

  w.endTurn('QRD-3'); await w.step();
  assert.deepStrictEqual(w.running(), ['QRD-1', 'QRD-4'], '11:00 #3 done: #4 starts');
  assert.strictEqual(w.state.runs.find((run) => run.key === 'QRD-5')?.waiting, PARKED_TEXT, '#5 is parked and took no slot');

  w.endTurn('QRD-4'); await w.step();
  assert.deepStrictEqual(w.running(), ['QRD-1', 'QRD-6'], '11:30 #4 stuck: #6 takes its slot');

  w.answer('QRD-4'); await w.step();
  w.endTurn('QRD-1'); await w.step();
  assert.deepStrictEqual(w.running(), ['QRD-4', 'QRD-6'], '12:10 #1 done: the answer to #4 runs');
});

test('acceptance criteria also count when they live in the Jira Acceptance Criteria field', () => {
  const pointer = 'Technical detail only. Problem Definition, User Story and Acceptance Criteria live in their own fields.';
  assert.strictEqual(ticketHasAcceptanceCriteria({ description: 'Board ID: h-reveal', acceptanceCriteria: '* The tool set is rebuilt between steps' }), true);
  assert.strictEqual(ticketHasAcceptanceCriteria({ description: AC, acceptanceCriteria: null }), true, 'the description heading still works');
  assert.strictEqual(ticketHasAcceptanceCriteria({ description: 'Board ID: h-reveal', acceptanceCriteria: null }), false);
  assert.strictEqual(ticketHasAcceptanceCriteria({ description: 'Board ID: h-reveal', acceptanceCriteria: '.' }), false, 'a lone dot is not a criterion');
  assert.strictEqual(ticketHasAcceptanceCriteria({ description: pointer, acceptanceCriteria: '* Size is shown per datapoint' }), true);
});

test('a ticket whose criteria are only in the Jira field is started, not parked', async () => {
  const tickets = [
    ticket('QRD-1', { description: 'Board ID: h-reveal', acceptanceCriteria: '* The tool set is rebuilt between steps' }),
    ticket('QRD-2', { description: 'Board ID: g-stack', acceptanceCriteria: null }),
  ];
  const w = world({ tickets, config: { parallel: 2 } });
  const log = await w.cron.runFill();
  assert.deepStrictEqual([log.started, log.parked], [['QRD-1'], ['QRD-2']]);
});

test('two answers take slots in the order they were given', async () => {
  const w = world({ tickets: ['QRD-1', 'QRD-2', 'QRD-3'].map((key) => ticket(key)), config: { parallel: 1 } });
  await w.step();
  w.endTurn('QRD-1'); await w.step();
  w.endTurn('QRD-2'); await w.step();
  assert.deepStrictEqual(w.running(), ['QRD-3']);
  w.answer('QRD-2'); w.answer('QRD-1');
  w.endTurn('QRD-3'); await w.step();
  assert.deepStrictEqual(w.running(), ['QRD-2'], 'answered first, runs first');
});

test('the daily cap stops new tickets and parked tickets; the next day starts again', async () => {
  const tickets = [...['QRD-1', 'QRD-2', 'QRD-3'].map((key) => ticket(key)), ticket('QRD-8', { description: '' }), ticket('QRD-9', { description: '' })];
  const w = world({ tickets, config: { parallel: 5, maxPerDay: 1 } });
  const log = await w.cron.runFill();
  assert.deepStrictEqual([log.started, log.parked], [['QRD-1'], ['QRD-8']]);
  assert.deepStrictEqual(log.deferred, [
    { key: 'QRD-2', reason: 'daily cap reached: 1 started today' },
    { key: 'QRD-3', reason: 'daily cap reached: 1 started today' },
    { key: 'QRD-9', reason: 'daily cap reached: 1 parked today' },
  ]);
  w.state.now = new Date('2026-10-15T02:05:00.000Z');
  assert.deepStrictEqual((await w.cron.runFill()).started, ['QRD-2']);
  assert.deepStrictEqual((await w.cron.status()).startedToday, 1);
});

test('outside the work window nothing is taken, but a queued answer still runs when a slot is free', async () => {
  const w = world({ tickets: [ticket('QRD-1'), ticket('QRD-2')], config: { parallel: 1 } });
  await w.step();
  w.endTurn('QRD-1');
  w.state.now = new Date('2026-10-17T03:00:00.000Z');
  w.answer('QRD-1');
  const log = await w.cron.runFill();
  assert.match(String(log.skipped), /not a work day/);
  w.claim();
  assert.deepStrictEqual(w.running(), ['QRD-1'], 'the Saturday answer runs');
  assert.strictEqual(w.state.sessions.length, 1, 'QRD-2 was not started');
  assert.deepStrictEqual((await w.cron.runFill(true)).started, [], '"Run now" ignores the window, but the slot is still in use');
});

test('a fill starts in the chosen mode with model and effort and opens cron sessions', async () => {
  const { state, cron } = world({ tickets: [ticket('QRD-1', { parentKey: 'QRD-1232' })], config: { model: 'opus', effort: 'high', mode: 'manual' } });
  await cron.runFill();
  assert.deepStrictEqual(state.sessions.map((s) => [s.ticketKey, s.machine, s.origin]), [['QRD-1', 'workspace', 'cron']]);
  assert.deepStrictEqual(state.sent[0].options, { permissionMode: 'default', model: 'opus', effort: 'high' });
  assert.match(state.sent[0].text, /^Build ticket QRD-1 with the build-ticket skill\. The ticket has acceptance criteria: do not stop to ask/);
  assert.deepStrictEqual(state.moved, ['QRD-1']);
  const auto = world({ tickets: [ticket('QRD-1')] });
  await auto.cron.runFill();
  assert.strictEqual(auto.state.sent[0].options.permissionMode, 'auto');
});

test('a fill is skipped when the machine is offline or the usage brake is reached; a limit whose window has passed does not brake', async () => {
  const offline = world({ tickets: [ticket('QRD-1')], online: false });
  assert.deepStrictEqual([(await offline.cron.runFill()).skipped, offline.state.sessions.length], ['machine workspace is offline', 0]);

  const braked = world({ tickets: [ticket('QRD-1')], used: { usedPercentage: 71.4, resetsAt: '2026-10-14T05:00:00.000Z' } });
  assert.strictEqual((await braked.cron.runFill()).skipped, 'usage brake: 5 hour usage is at 71%, the brake is 70%');

  const stale = world({ tickets: [ticket('QRD-1')], used: { usedPercentage: 99, resetsAt: '2026-10-14T01:00:00.000Z' } });
  assert.deepStrictEqual((await stale.cron.runFill()).started, ['QRD-1']);
});

test('a ticket whose dependency is not settled waits; a ticket Jira would not move still starts and is reported', async () => {
  const { cron } = world({
    tickets: [ticket('QRD-1'), ticket('QRD-2'), ticket('QRD-10', { status: 'PR Review' }), ticket('QRD-11', { status: 'Done / MERGED' })],
    dependencies: [{ ticketKey: 'QRD-1', dependsOnKey: 'QRD-10' }, { ticketKey: 'QRD-2', dependsOnKey: 'QRD-11' }],
    moves: false,
  });
  const log = await cron.runFill();
  assert.deepStrictEqual([log.started, log.notMoved], [['QRD-2'], ['QRD-2']]);
});

test('confirming a parked ticket queues it in a cron session with the asking-allowed prompt; anything else is refused', async () => {
  const { state, cron } = world({ tickets: [ticket('QRD-2', { description: '' })] });
  await cron.runFill();
  await assert.rejects(() => cron.confirm('QRD-404'), CronInputError);
  await cron.confirm('QRD-2');
  assert.deepStrictEqual(state.sessions.map((session) => [session.ticketKey, session.origin, session.state]), [['QRD-2', 'cron', 'queued']]);
  assert.doesNotMatch(state.sent[0].text, /do not stop to ask/);
  assert.strictEqual(state.runs.find((run) => run.key === 'QRD-2')?.waiting, null, 'the gate is cleared');
  await assert.rejects(() => cron.confirm('QRD-2'), CronInputError, 'it no longer waits for a confirmation');
});

test('each run that waits on the owner pings Discord once; the first look after a webhook is set stays quiet', async () => {
  const waiting: CronRun = { key: 'QRD-7', machine: 'workspace', title: 'Old gate', waiting: 'Which endpoint?', activity: 'WAITING' };
  const { state, cron } = world({ runs: [waiting], webhook: 'https://discord.com/api/webhooks/1/abc', config: { notifyUserId: '123456789' } });
  assert.deepStrictEqual(await cron.notifyWaiting(), [], 'what already waited is remembered, not announced');

  state.runs = [waiting, { key: 'QRD-8', machine: 'workspace', title: 'New work', waiting: PARKED_TEXT, activity: 'IDLE' }];
  assert.deepStrictEqual(await cron.notifyWaiting(), ['QRD-8']);
  assert.deepStrictEqual(state.posts, [{ url: 'https://discord.com/api/webhooks/1/abc', body: { content: `<@123456789> **QRD-8** New work\n${PARKED_TEXT}`, allowed_mentions: { users: ['123456789'] } } }]);
  assert.deepStrictEqual(await cron.notifyWaiting(), [], 'no second ping for the same reason');

  state.runs = [{ ...waiting, waiting: 'Ready for review: waiting for the owner' }];
  assert.deepStrictEqual(await cron.notifyWaiting(), ['QRD-7'], 'a new reason on the same run pings again');

  const silent = world({ runs: [waiting] });
  assert.deepStrictEqual([await silent.cron.notifyWaiting(), silent.state.posts.length], [[], 0], 'no webhook, no ping');

  const phone = world({ runs: [], pushDevices: true });
  await phone.cron.notifyWaiting();
  phone.state.runs = [waiting];
  assert.deepStrictEqual(await phone.cron.notifyWaiting(), ['QRD-7']);
  assert.deepStrictEqual([phone.state.posts.length, phone.state.pushes], [0, [{ title: 'QRD-7 waits on you', body: 'Which endpoint?', url: '/detail/QRD-7', tag: 'wait-QRD-7' }]], 'a phone alone gets the push, with no Discord post');
});

test('settings are saved after validation; the webhook is kept, replaced or cleared; every tick fills while enabled', async () => {
  const { state, cron } = world({ tickets: [ticket('QRD-1'), ticket('QRD-2')], config: { enabled: false, parallel: 1 } });
  await assert.rejects(() => cron.updateSettings('{"machine":"mars"}'), /Unknown machine mars/);
  await assert.rejects(() => cron.updateSettings('{}', 'https://example.com/hook'), /Discord webhook URL/);
  await cron.tick();
  assert.strictEqual(state.sessions.length, 0, 'disabled: the tick starts nothing');

  await cron.updateSettings('{"enabled":true,"parallel":1}', 'https://discord.com/api/webhooks/1/abc');
  assert.deepStrictEqual([(await cron.getSettings()).webhookSet, JSON.parse((await cron.getSettings()).config).enabled], [true, true]);
  await cron.updateSettings('{"enabled":true,"parallel":1}');
  assert.strictEqual((await cron.getSettings()).webhookSet, true, 'no webhook argument keeps the saved one');
  await cron.tick();
  await cron.tick();
  assert.deepStrictEqual(state.sessions.map((session) => session.ticketKey), ['QRD-1'], 'the queued start holds the only slot');
  await cron.updateSettings('{"enabled":true}', '');
  assert.strictEqual((await cron.getSettings()).webhookSet, false);
});

test('stop all asks every running session to stop', async () => {
  const { state, cron } = world();
  assert.strictEqual(await cron.stopAll(), 2);
  assert.deepStrictEqual(state.stopped, ['s-1', 's-2']);
});

test('a cron session that dies before the agent answers frees its quota, waits on the owner and goes back to To Do; retry starts it again', async () => {
  const w = world({ tickets: [ticket('QRD-1'), ticket('QRD-2'), ticket('QRD-3')], config: { parallel: 2, maxPerDay: 2 } });
  await w.step();
  assert.deepStrictEqual(w.running(), ['QRD-1', 'QRD-2']);

  w.dieOnStart('QRD-1');
  w.endTurn('QRD-2');
  await w.step();
  const fill = (await w.cron.lastFill())!;
  assert.deepStrictEqual(fill.released, ['QRD-1'], 'only the session without a reply is released');
  assert.deepStrictEqual(fill.started, ['QRD-3'], 'the freed quota goes to the next ticket');
  assert.strictEqual(w.state.runs.find((run) => run.key === 'QRD-1')?.waiting, START_FAILED_TEXT);
  assert.deepStrictEqual(w.state.movedTo.filter(([key]) => key === 'QRD-1'), [['QRD-1', 'In Progress'], ['QRD-1', 'To Do']]);
  assert.strictEqual((await w.cron.status()).startedToday, 2);

  await w.step();
  assert.deepStrictEqual((await w.cron.lastFill())!.released, [], 'a released run is not released again');
  assert.strictEqual(w.state.movedTo.filter(([key]) => key === 'QRD-1').length, 2);

  await w.cron.confirm('QRD-1');
  assert.strictEqual(w.state.sent.at(-1)?.text, startPrompt('QRD-1'), 'the retry uses the normal prompt, not the asking-allowed one');
  assert.strictEqual(w.state.runs.find((run) => run.key === 'QRD-1')?.waiting, null);
  w.claim();
  await w.step();
  assert.deepStrictEqual((await w.cron.lastFill())!.released, [], 'the old dead session no longer counts once a new one is open');
});

test('candidates skip a ticket the owner works by hand', () => {
  const keys = candidates([ticket('QRD-1'), ticket('QRD-2')], new Set(), new Set(), settings(), new Map(), new Set(['QRD-1'])).map((item) => item.key);
  assert.deepStrictEqual(keys, ['QRD-2']);
});

test('every cron prompt keeps the lead in its turn while members run and asks for Bahasa Indonesia in chat', () => {
  for (const prompt of [startPrompt('QRD-1'), confirmedPrompt('QRD-1'), resumePrompt('QRD-1')]) {
    assert.match(prompt, /oh-my-claudecode:team skill/);
    assert.match(prompt, /Do not end your turn while a subagent you started is still running/);
    assert.match(prompt, /Bahasa Indonesia; code, comments, commit messages and pull request text stay in English/);
  }
  assert.match(resumePrompt('QRD-1'), /^Lanjutkan tiket QRD-1 dari ledger: cek status\.cjs show QRD-1 dan worktree-nya, jangan mulai dari awal\./);
});

test('a cron session is opened with the options its messages carry', async () => {
  const { state, cron } = world({ tickets: [ticket('QRD-1')], config: { model: 'opus', mode: 'auto' } });
  await cron.runFill();
  assert.deepStrictEqual(state.sessions[0].options, { permissionMode: 'auto', model: 'opus' });
  assert.deepStrictEqual(state.sessions[0].options, state.sent[0].options);
});

const LEFT_RUNNING = 'Lead ended its turn while 2 subagents were still running';

/** QRD-1 started by the cron and its turn ended; the run is then marked stalled as given. QRD-2 waits in To Do. */
async function stalledWorld(run: Partial<CronRun>, manual?: Set<string>) {
  const w = world({ tickets: [ticket('QRD-1')], config: { parallel: 2, maxPerDay: 10, effort: 'high' }, manual });
  await w.cron.runFill();
  w.endTurn('QRD-1');
  w.state.tickets = [ticket('QRD-2')];
  w.state.runs = w.state.runs.map((item) => ({ ...item, stalled: true, ...run }));
  return w;
}

test('a run whose lead left subagents running is resumed in its own session before any new ticket, at most three times, then waits on the owner', async () => {
  const w = await stalledWorld({ stalledDetail: LEFT_RUNNING });
  const sentBefore = w.state.sent.length;
  for (let round = 1; round <= MAX_RESUMES; round += 1) {
    const log = await w.cron.runFill();
    assert.deepStrictEqual([log.resumed, log.started], [['QRD-1'], []], `resume ${round} takes no new ticket`);
    assert.match(String(log.skipped), /stalled runs are resumed first: QRD-1/);
    assert.deepStrictEqual(w.state.sent.at(-1), { sessionId: 's-1', text: resumePrompt('QRD-1'), options: { permissionMode: 'auto', effort: 'high' } });
    assert.strictEqual(w.state.cache.get('resumes:QRD-1'), round, 'the count is kept in the cron cache');
    w.endTurn('QRD-1');
  }
  assert.strictEqual(w.state.sent.length - sentBefore, MAX_RESUMES);
  assert.strictEqual(w.state.sessions.length, 1, 'no new session was opened for the stalled ticket');

  const log = await w.cron.runFill();
  assert.deepStrictEqual([log.resumed, log.parked, log.started], [[], ['QRD-1'], ['QRD-2']], 'the fourth stall waits on the owner and the queue moves on');
  assert.strictEqual(w.state.runs.find((run) => run.key === 'QRD-1')?.waiting, RESUME_GAVE_UP_TEXT);
});

test('a run whose cron session failed is resumed', async () => {
  const failed = await stalledWorld({});
  failed.state.sessions[0].state = 'error';
  assert.deepStrictEqual((await failed.cron.runFill()).resumed, ['QRD-1']);
});

test('a run that only went quiet is resumed, at most three times although its turns end cleanly, then waits on the owner', async () => {
  const w = await stalledWorld({});
  for (let round = 1; round <= MAX_RESUMES; round += 1) {
    const log = await w.cron.runFill();
    assert.deepStrictEqual([log.resumed, log.started], [['QRD-1'], []], `quiet resume ${round} takes no new ticket`);
    assert.deepStrictEqual(w.state.sent.at(-1)?.text, resumePrompt('QRD-1'));
    w.endTurn('QRD-1');
    await w.cron.resetResumes('QRD-1');
  }
  assert.strictEqual(w.state.cache.get(`quietResumes:QRD-1`), MAX_RESUMES, 'a clean turn end does not reset the quiet count');

  const log = await w.cron.runFill();
  assert.deepStrictEqual([log.resumed, log.parked, log.started], [[], ['QRD-1'], ['QRD-2']], 'the fourth quiet stall waits on the owner and the queue moves on');
  assert.strictEqual(w.state.runs.find((run) => run.key === 'QRD-1')?.waiting, RESUME_GAVE_UP_TEXT);
});

test('a quiet run whose session still runs a turn is not resumed', async () => {
  const w = await stalledWorld({});
  w.state.sessions[0].state = 'running';
  assert.deepStrictEqual((await w.cron.runFill()).resumed, []);
});

test('a stalled run is left alone when the owner stopped it, works it in another session, gates it, marks it manual, or its session is busy', async () => {
  const stopped = await stalledWorld({ stalledDetail: LEFT_RUNNING });
  stopped.state.ownerStopped.add('QRD-1');
  assert.deepStrictEqual((await stopped.cron.runFill()).resumed, [], 'the owner stopped the last turn');

  const elsewhere = await stalledWorld({ stalledDetail: LEFT_RUNNING });
  elsewhere.state.otherActive.add('QRD-1');
  assert.deepStrictEqual((await elsewhere.cron.runFill()).resumed, [], 'a manual session of the ticket is active');

  const gated = await stalledWorld({ stalledDetail: LEFT_RUNNING, waiting: 'Which endpoint?' });
  assert.deepStrictEqual((await gated.cron.runFill()).resumed, []);

  const marked = new Set<string>();
  const manual = await stalledWorld({ stalledDetail: LEFT_RUNNING }, marked);
  marked.add('QRD-1');
  const log = await manual.cron.runFill();
  assert.deepStrictEqual([log.resumed, log.started], [[], ['QRD-2']], 'a manual ticket is never resumed and does not hold the queue');

  const busy = await stalledWorld({ stalledDetail: LEFT_RUNNING });
  busy.answer('QRD-1');
  assert.deepStrictEqual((await busy.cron.runFill()).resumed, [], 'the session is still queued');
});

test('the resume count grows only after the message is sent, and starts again on a new start or a clean turn end', async () => {
  const refused = await stalledWorld({ stalledDetail: LEFT_RUNNING });
  refused.state.failSend = true;
  const log = await refused.cron.runFill();
  assert.deepStrictEqual([log.resumed, log.failed[0], refused.state.cache.has('resumes:QRD-1')], [[], 'QRD-1', false]);

  const w = await stalledWorld({ stalledDetail: LEFT_RUNNING });
  await w.cron.runFill();
  assert.strictEqual(w.state.cache.get('resumes:QRD-1'), 1);
  await w.cron.resetResumes('QRD-1');
  assert.strictEqual(w.state.cache.has('resumes:QRD-1'), false, 'a turn that ended without subagents running');

  const fresh = world({ tickets: [ticket('QRD-5')] });
  fresh.state.cache.set('resumes:QRD-5', 2);
  await fresh.cron.runFill();
  assert.strictEqual(fresh.state.cache.has('resumes:QRD-5'), false, 'a start, a retry or a confirmed ticket starts at zero');
});

test('board mode: the cron starts and resumes nothing; work starts from the blackboard', async () => {
  const saved = process.env.DOCK_BOARD_MODE;
  process.env.DOCK_BOARD_MODE = '1';
  try {
    const w = world({ tickets: [ticket('QRD-1'), ticket('QRD-2')] });
    const log = await w.cron.runFill();
    assert.match(String(log.skipped), /board mode/);
    assert.deepStrictEqual([w.state.sessions.length, w.state.sent.length], [0, 0]);
  } finally {
    if (saved === undefined) delete process.env.DOCK_BOARD_MODE; else process.env.DOCK_BOARD_MODE = saved;
  }
});
