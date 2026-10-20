import React, { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { ArrowDown, ArrowUp, Building2, ChevronLeft, ChevronRight, Clock, ExternalLink, EyeOff, GitPullRequest, Hand, MessagesSquare, Moon, Octagon, Play, Square, Table2, X } from 'lucide-react';
import { GET_CHAT_BALLOONS, GET_ORCHESTRATION, GET_ORCHESTRATIONS } from '../graphql/queries';
import { CONFIRM_ORCHESTRATION, DISMISS_ORCHESTRATION, STOP_ALL_AGENTS } from '../graphql/mutations';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { EmptyState } from '../components/EmptyState';
import { DeskScene } from '../components/empty/scenes/DeskScene';
import { RobotScene } from '../components/empty/scenes/RobotScene';
import { Badge, Button, Card, Dialog, Page, PageHeader, PhoneCards } from '../components/ui';
import { isPhone } from '../lib/phone';
import { apiOrigin } from '../lib/apollo';
import { cn } from '../lib/cn';
import { hasPage, useDockMode } from '../lib/dockMode';
import { answerHint, useBoardMode } from '../lib/boardMode';
import { CACHED_QUERY_OPTIONS, isInitialQueryLoading } from '../lib/queryPolicy';
import { FILTER_KINDS, FILTER_MACHINES, PARKED_TEXT, START_FAILED_TEXT, completeRun, formatAge, reviewFindings, hasTrouble, isArchived, kindLabel, matchesRunFilter, offerOf, pageOf, runActions, runFilterFromSearch, runFilterSearch, runStatus, sortRuns, stageColor, stageLabel, stageName, statusLabel, type AgentEvent, type AgentRun, type AgentTimeline, type RunFilter, type RunSort, type RunSortColumn, type RunStatus } from '../agents/runs';
import { KindBadge } from '../agents/KindBadge';
import { VerdictBadge } from '../agents/VerdictBadge';
import { RAIL_STAGES, railIndex } from '../agents/office/layout';
import { sampleRuns, sampleTimeline } from '../agents/sampleRuns';
import { AgentFlowGraph } from '../components/AgentFlowGraph';
import { CHAT_MACHINE, machineOf, machinePlace, ticketBalloons, type ChatMessage } from '../chat/messages';
import { MachineChip } from '../chat/MachineControls';
import { MoveTicket } from '../agents/MoveTicket';
import { CronSettingsDialog } from '../agents/CronSettingsDialog';
import { CronRow } from '../agents/CronRow';
import { chatStore } from '../chat/store';
import { LimitsLine } from '../chat/StatusLine';
import { useOpenForTicket } from '../chat/useOpenForTicket';

const AgentsOffice = lazy(() => import('../components/AgentsOffice'));

interface AgentsPageProps { onTicketClick: (key: string) => void; onNavigate: (path: string) => void; }

type View = 'office' | 'table';
type FlowView = 'live' | 'replay';
type TableTab = 'active' | 'archive';

const POLL_MS = 5000;
const PAGE_SIZE = 10;
const OFFICE_VIEW_KEY = 'dock-agents-office-view';
const OFFICE_VIEWS = [['overview', 'Overview'], ['lead', 'Lead'], ['owner', 'Me'], ['lounge', 'Lounge']] as const;
const TABLE_COLUMNS: Array<[RunSortColumn, string]> = [
  ['ticket', 'Ticket'], ['stage', 'Stage'], ['status', 'Status'], ['ac', 'AC'], ['waiting', 'Waiting on you'], ['activity', 'Last activity'],
];

const savedOfficeView = (): string => {
  try {
    return window.localStorage.getItem(OFFICE_VIEW_KEY) || 'overview';
  } catch {
    return 'overview';
  }
};
const sectionLabel = 'font-mono text-[0.66rem] font-bold uppercase tracking-[0.1em] text-muted-foreground';

const statusTone: Record<RunStatus, string> = {
  waiting: 'border-amber-300/50 bg-amber-300/10 text-amber-200',
  failed: 'border-status-conflict/50 bg-status-conflict-bg text-status-conflict',
  stalled: 'border-status-conflict/50 bg-status-conflict-bg text-status-conflict',
  changes_requested: 'border-status-conflict/50 bg-status-conflict-bg text-status-conflict',
  checks_failing: 'border-status-conflict/50 bg-status-conflict-bg text-status-conflict',
  working: 'border-status-merged/40 bg-status-merged-bg text-status-merged',
  review: 'border-sky-300/50 bg-sky-300/10 text-sky-200',
  thinking: 'border-border-glow bg-surface-2 text-secondary-foreground',
  asleep: 'border-border bg-surface-2 text-muted-foreground',
  done: 'border-status-merged/40 bg-status-merged-bg text-status-merged',
};

const acTone = (state: string) => state === 'PASS'
  ? 'border-status-merged bg-status-merged-bg text-status-merged'
  : state === 'FAIL'
    ? 'border-status-conflict bg-status-conflict-bg text-status-conflict'
    : 'border-border-glow text-secondary-foreground';

const eventLabel: Record<string, string> = {
  STAGE: 'Moved to', WAITING: 'Waiting on you', RESUMED: 'Resumed',
  AGENT_ACTIVE: 'Working', AGENT_IDLE: 'Idle', AGENT_WAITING: 'Asking',
  ACTIVE: 'Working', IDLE: 'Idle',
  HANDOVER: 'Offered to', MACHINE: 'Now on', JIRA: 'Jira status',
};

const StageChip: React.FC<{ stage: string; kind?: string }> = ({ stage, kind }) => (
  <span className="inline-flex items-center gap-1.5 rounded-xs border border-border-glow px-2 py-0.5 font-mono text-[0.66rem] font-bold text-secondary-foreground">
    <i className="size-1.5 rounded-full" style={{ background: stageColor(stage) }} aria-hidden="true" />
    {stageName(stage, kind).toUpperCase()}
  </span>
);

const StatusChip: React.FC<{ status: RunStatus; review?: AgentRun['review'] }> = ({ status, review }) => (
  <span className={cn('inline-flex items-center rounded-xs border px-2 py-0.5 font-mono text-[0.66rem] font-bold', statusTone[status])}>{statusLabel(status, review)}</span>
);

const OfferBadge: React.FC<{ run: AgentRun; className?: string }> = ({ run, className }) => {
  const offer = offerOf(run);
  if (!offer) return null;
  return <span className={cn('inline-flex items-center rounded-xs border border-amber-300/50 bg-amber-300/10 px-1.5 py-px font-mono text-[0.62rem] font-bold text-amber-200', className)}>{offer.label}</span>;
};

const AgentsPage: React.FC<AgentsPageProps> = ({ onTicketClick, onNavigate }) => {
  const { data, loading, error, refetch } = useQuery(GET_ORCHESTRATIONS, { ...CACHED_QUERY_OPTIONS, returnPartialData: false, pollInterval: POLL_MS });
  const [dismissOrchestration, { loading: dismissing }] = useMutation(DISMISS_ORCHESTRATION);
  const [confirmOrchestration, { loading: confirming }] = useMutation(CONFIRM_ORCHESTRATION);
  const [stopAllAgents, { loading: stoppingAll }] = useMutation(STOP_ALL_AGENTS);
  const [showCron, setShowCron] = useState(false);
  const [cronError, setCronError] = useState('');
  const board = useBoardMode();
  // Board mode drops everything that acts on chat sessions: work starts from the blackboard.
  const chat = hasPage(useDockMode(), '/sessions') && !board;
  const { data: balloonData } = useQuery<{ chatBalloons: ChatMessage[]; chatSessions: Array<{ id: string; ticketKey?: string | null }> }>(GET_CHAT_BALLOONS, { fetchPolicy: 'network-only', pollInterval: POLL_MS, skip: !chat });
  const balloons = useMemo(() => ticketBalloons(balloonData?.chatBalloons || [], balloonData?.chatSessions || []), [balloonData]);
  const { openForTicket, opening: openingChat, error: chatError } = useOpenForTicket();
  const [view, setView] = useState<View>(() => (isPhone() ? 'table' : 'office'));
  const [flowView, setFlowView] = useState<FlowView>('live');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [sampleStartedAt, setSampleStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now() / 1000);
  const [dismissTarget, setDismissTarget] = useState<AgentRun | null>(null);
  const [actionError, setActionError] = useState('');
  const [receivedAt, setReceivedAt] = useState(() => Date.now() / 1000);
  const [officeView, setOfficeView] = useState(savedOfficeView);
  const [viewTick, setViewTick] = useState(0);
  const [boardOpen, setBoardOpen] = useState(false);
  const [tableTab, setTableTab] = useState<TableTab>('active');
  const [sort, setSort] = useState<RunSort>({ column: 'activity', descending: false });
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<RunFilter>(() => runFilterFromSearch(window.location.search));

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const serverRuns = useMemo<AgentRun[] | undefined>(() => data?.orchestrations?.map(completeRun), [data?.orchestrations]);
  useEffect(() => { setReceivedAt(Date.now() / 1000); }, [serverRuns]);

  const sampling = sampleStartedAt !== null;
  const sampleTick = sampling ? Math.floor(now - sampleStartedAt) : 0;
  const allRuns = useMemo<AgentRun[]>(
    () => (sampling
      ? sampleRuns(sampleTick).map((run) => (run.key === 'SAMPLE-2' ? { ...run, members: sampleTimeline(sampleTick).agents.filter((agent) => agent.parentId) } : run))
      : serverRuns || []),
    [sampling, sampleTick, serverRuns],
  );
  const runs = useMemo(() => allRuns.filter((run) => matchesRunFilter(run, filter)), [allRuns, filter]);
  // Nothing picked yet: show a run that is still going, never one from the archive.
  const selected = runs.find((run) => run.key === selectedKey) || runs.find((run) => run.waiting && !isArchived(run)) || runs.find((run) => !isArchived(run)) || null;

  const { data: detailData } = useQuery(GET_ORCHESTRATION, {
    ...CACHED_QUERY_OPTIONS,
    variables: { key: selected?.key },
    skip: !selected || sampling,
    pollInterval: POLL_MS,
  });
  const events: AgentEvent[] = !sampling && detailData?.orchestration?.key === selected?.key ? detailData?.orchestration?.events || [] : [];

  const timeline: AgentTimeline | null = sampling
    ? (selected?.key === 'SAMPLE-2' ? sampleTimeline(sampleTick) : null)
    : (detailData?.orchestration?.key === selected?.key ? detailData?.orchestration?.timeline || null : null);
  const actions = selected ? runActions(selected) : null;
  const canReplay = Boolean(selected?.hasTranscript) && !sampling && Boolean(actions?.replay);
  const showReplay = flowView === 'replay' && canReplay;

  // Ages keep counting between polls; the server only sends how old things were when it answered.
  const drift = sampling ? 0 : Math.max(0, now - receivedAt);
  const statusOf = (run: AgentRun) => runStatus({ ...run, idleSeconds: run.idleSeconds + drift }, now);
  const active = runs.filter((run) => !isArchived(run));
  const archived = runs.filter(isArchived);
  const listed = pageOf(sortRuns(tableTab === 'archive' ? archived : active, sort, statusOf), page, PAGE_SIZE);
  const teamView = officeView.startsWith('ticket:') ? officeView.slice(7) : '';

  const chooseView = (next: string) => {
    setOfficeView(next);
    // Picking the view you are already on flies the camera back to it.
    setViewTick((tick) => tick + 1);
    if (next.startsWith('ticket:')) setSelectedKey(next.slice(7));
    try {
      window.localStorage.setItem(OFFICE_VIEW_KEY, next);
    } catch {
      // The view is a convenience; without storage it simply resets on reload.
    }
  };
  const chooseFilter = (next: RunFilter) => {
    setFilter(next);
    setPage(1);
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${runFilterSearch(window.location.search, next)}`);
  };
  const sortBy = (column: RunSortColumn) => {
    setSort((current) => ({ column, descending: current.column === column ? !current.descending : false }));
    setPage(1);
  };
  const metrics = [
    { label: 'Tickets with an agent', value: active.length, className: 'text-accent' },
    { label: 'Waiting on you', value: active.filter((run) => run.waiting).length, className: 'text-amber-200' },
    { label: 'Working now', value: active.filter((run) => statusOf(run) === 'working').length, className: 'text-status-merged' },
    { label: 'Stalled or failed', value: active.filter(hasTrouble).length, className: 'text-status-conflict' },
  ];

  const handleDismiss = async () => {
    if (!dismissTarget) return;
    setActionError('');
    try {
      await dismissOrchestration({ variables: { key: dismissTarget.key } });
      setDismissTarget(null);
      setSelectedKey(null);
      await refetch();
    } catch (dismissError: any) {
      setActionError(dismissError.message || 'Failed to hide this run');
    }
  };

  // On a phone the run's panel sits below the table, so picking a row has to bring it into view.
  const pickRun = (key: string) => {
    setSelectedKey(key);
    if (isPhone()) requestAnimationFrame(() => document.getElementById('agent-run-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const runAction = async (work: () => Promise<void>) => {
    setCronError('');
    try {
      await work();
    } catch (failure: any) {
      setCronError(failure.message || 'The action failed');
    }
  };

  if (isInitialQueryLoading(loading, data)) return <Page width="full"><LoadingSkeleton /></Page>;

  const empty = allRuns.length === 0;
  const filterGroups = [
    { name: 'machine', label: 'Machine', options: FILTER_MACHINES.map((value) => [value, value] as const) },
    { name: 'kind', label: 'Type', options: FILTER_KINDS.map((value) => [value, kindLabel(value)] as const) },
  ] as const;

  return (
    <Page width="full">
      <PageHeader>
        <div>
          <h1 className="text-balance font-display text-3xl font-black">Agents</h1>
          <p className="mt-1 text-pretty text-secondary-foreground">Where each ticket's agent is working, and which ones are waiting on you.</p>
          <LimitsLine className="mt-2" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {sampling && <Badge variant="draft" className="border-dashed">SAMPLE DATA</Badge>}
          <div className="flex rounded-sm border border-border bg-surface-1 p-0.5" role="group" aria-label="View">
            {([['office', 'Office', Building2], ['table', 'Table', Table2]] as const).map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                className={cn('flex h-8 max-[760px]:h-11 items-center gap-1.5 rounded-xs px-3 font-display text-xs font-semibold text-secondary-foreground transition-colors duration-150', view === id && 'bg-accent text-black')}
                aria-pressed={view === id}
                onClick={() => setView(id)}
              >
                <Icon size={14} aria-hidden="true" />{label}
              </button>
            ))}
          </div>
          {/* The cron and Stop all act on chat sessions, so they live on the DOCK that has chat. */}
          {chat && <Button size="sm" aria-haspopup="dialog" onClick={() => setShowCron(true)}><Clock size={14} aria-hidden="true" />Cron</Button>}
          {chat && <Button size="sm" variant="danger" disabled={stoppingAll} onClick={() => void runAction(async () => { await stopAllAgents(); })}><Octagon size={14} aria-hidden="true" />Stop all</Button>}
          {sampling
            ? <Button size="sm" onClick={() => { setSampleStartedAt(null); setSelectedKey(null); }}><Square size={14} aria-hidden="true" />Stop sample</Button>
            : (serverRuns || []).length === 0 && <Button size="sm" variant="primary" onClick={() => { setSampleStartedAt(Date.now() / 1000); setSelectedKey('SAMPLE-2'); }}><Play size={14} aria-hidden="true" />Run a sample</Button>}
        </div>
      </PageHeader>

      {error && !data && <Card className="mb-4 border-status-conflict text-status-conflict" role="alert">Agent runs failed to load: {error.message}</Card>}
      {cronError && <Card className="mb-4 border-status-conflict text-status-conflict" role="alert">{cronError}</Card>}
      {chat && <CronSettingsDialog open={showCron} onClose={() => setShowCron(false)} />}
      {chat && <CronRow pollMs={POLL_MS} onOpenSettings={() => setShowCron(true)} />}

      {!empty && (
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2" role="group" aria-label="Filter runs">
          {filterGroups.map((group) => (
            <div key={group.name} className="flex items-center gap-2">
              <span className={sectionLabel}>{group.label}</span>
              <div className="flex rounded-sm border border-border bg-surface-1 p-0.5" role="group" aria-label={`${group.label} shown`}>
                {([[null, 'All'], ...group.options] as const).map(([value, label]) => (
                  <button
                    key={label}
                    type="button"
                    className={cn('flex h-7 max-[760px]:h-11 items-center rounded-xs px-3 font-display text-xs font-semibold text-secondary-foreground transition-colors duration-150', filter[group.name] === value && 'bg-accent text-black')}
                    aria-pressed={filter[group.name] === value}
                    onClick={() => chooseFilter({ ...filter, [group.name]: value })}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <section className="mb-4 grid grid-cols-4 overflow-hidden rounded-md border border-border bg-surface-1 max-[700px]:grid-cols-2 [&>div]:border-r [&>div]:border-border [&>div:last-child]:border-r-0 max-[700px]:[&>div:nth-child(2)]:border-r-0 max-[700px]:[&>div:nth-child(-n+2)]:border-b" aria-label="Agent overview">
        {metrics.map((metric) => (
          <div className="p-[18px]" key={metric.label}>
            <strong className={cn('block font-display text-[1.55rem] leading-none font-extrabold tabular-nums', metric.className)}>{metric.value}</strong>
            <span className="mt-[7px] block text-[0.68rem] text-muted-foreground">{metric.label}</span>
          </div>
        ))}
      </section>

      <div className="grid grid-cols-[minmax(0,1fr)_360px] items-start gap-4 max-[1120px]:grid-cols-1">
        <Card className="p-0">
          {view === 'office' ? (
            <>
            {!empty && (
              <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-surface-0 px-3 py-2" role="group" aria-label="Point of view">
                <span className={cn(sectionLabel, 'mr-1')}>View</span>
                {OFFICE_VIEWS.map(([id, label]) => (
                  <button key={id} type="button" className={cn('h-7 max-[760px]:h-11 rounded-xs px-2.5 font-display text-xs font-semibold text-secondary-foreground transition-colors duration-150 hover:text-foreground', officeView === id && 'bg-accent text-black hover:text-black')} aria-pressed={officeView === id} onClick={() => chooseView(id)}>{label}</button>
                ))}
                <select
                  className={cn('h-7 max-[760px]:h-11 max-w-[190px] rounded-xs border-0 bg-surface-2 px-2 font-display text-xs font-semibold text-secondary-foreground', teamView && 'bg-accent text-black')}
                  aria-label="Team view for a ticket"
                  value={teamView}
                  onChange={(event) => chooseView(event.target.value ? `ticket:${event.target.value}` : 'overview')}
                >
                  <option value="">Team…</option>
                  {active.map((run) => <option key={run.key} value={run.key}>{run.key} · {stageName(run.stage, run.kind)}</option>)}
                </select>
                <button type="button" className={cn('h-7 max-[760px]:h-11 rounded-xs px-2.5 font-display text-xs font-semibold text-secondary-foreground transition-colors duration-150 hover:text-foreground', boardOpen && 'bg-accent text-black hover:text-black')} aria-pressed={boardOpen} onClick={() => setBoardOpen((open) => !open)}>Board</button>
              </div>
            )}
            <div className="relative">
              <Suspense fallback={<div className="grid h-[600px] place-items-center text-sm text-muted-foreground max-[900px]:h-[420px]" role="status">Opening the office...</div>}>
                <AgentsOffice className="h-[600px] max-[900px]:h-[420px]" runs={runs} selectedKey={selected?.key || null} onSelect={setSelectedKey} balloons={sampling ? undefined : balloons} onBalloon={chatStore.openSession} view={officeView} viewTick={viewTick} />
              </Suspense>
              {boardOpen && !empty && (
                <div className="absolute inset-0 z-10 flex flex-col bg-[rgb(12_12_12/0.96)] p-4" role="dialog" aria-label="Status board">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h2 className="font-display text-[0.95rem] font-bold">Status board <span className="ml-1.5 font-mono text-xs font-semibold text-muted-foreground tabular-nums">{active.length} {active.length === 1 ? 'ticket' : 'tickets'}</span></h2>
                    <Button size="sm" variant="ghost" onClick={() => setBoardOpen(false)}><X size={14} aria-hidden="true" />Close</Button>
                  </div>
                  <div className="grid min-h-0 flex-1 grid-cols-6 gap-2 overflow-x-auto max-[900px]:grid-cols-[repeat(6,150px)]">
                    {RAIL_STAGES.map((stage, column) => {
                      const cards = active.filter((run) => Math.min(RAIL_STAGES.length - 1, railIndex(run.stage)) === column);
                      return (
                        <div className="flex min-h-0 flex-col rounded-[8px] border border-border bg-surface-1" key={stage}>
                          <p className={cn(sectionLabel, 'flex items-center justify-between border-b border-border px-2.5 py-2')}><span>{stageName(stage, 'build')}</span><span className="tabular-nums">{cards.length}</span></p>
                          <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-2">
                            {cards.length === 0 && <span className="py-2 text-center text-xs text-muted-foreground">—</span>}
                            {cards.map((run) => (
                              <button key={run.key} type="button" className={cn('rounded-xs border border-border-glow border-l-[3px] bg-surface-0 px-2 py-1.5 text-left hover:border-accent', run.waiting ? 'border-l-amber-300' : hasTrouble(run) ? 'border-l-status-conflict' : 'border-l-status-merged', selected?.key === run.key && 'border-accent')} onClick={() => { setSelectedKey(run.key); setBoardOpen(false); }}>
                                <span className="flex items-center justify-between gap-2 font-mono text-xs font-extrabold text-accent"><span>{run.key}</span><span className="font-semibold text-muted-foreground tabular-nums">{run.acPassed}/{run.acTotal}</span></span>
                                <span className="mt-0.5 flex flex-wrap gap-1"><MachineChip name={machineOf(run)} /><KindBadge kind={run.kind} /><VerdictBadge run={run} /></span>
                                <OfferBadge run={run} className="mt-0.5" />
                                <span className="mt-0.5 line-clamp-2 text-[0.74rem] text-secondary-foreground">{run.waiting || run.title || 'Untitled'}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              <div className="pointer-events-none absolute bottom-3 left-3.5 flex flex-wrap gap-x-3.5 gap-y-1 rounded-[8px] border border-border bg-[rgb(12_12_12/0.78)] px-[11px] py-[7px] font-mono text-[0.7rem] font-semibold text-secondary-foreground">
                <span className="flex items-center gap-1.5"><Hand size={12} className="text-amber-200" aria-hidden="true" />raised hand = waiting on you</span>
                <span className="flex items-center gap-1.5"><GitPullRequest size={12} className="text-sky-300" aria-hidden="true" />pull request = in review</span>
                <span className="flex items-center gap-1.5"><Moon size={12} aria-hidden="true" />zzz = no activity</span>
                <span>faded = finished</span>
                <span className="max-[900px]:hidden">drag to orbit · scroll to zoom</span>
              </div>
              {empty && (
                <div className="absolute inset-x-0 top-1/2 mx-auto w-[min(440px,calc(100%-2rem))] -translate-y-1/2 rounded-md border border-border bg-[rgb(12_12_12/0.9)] p-5">
                  <EmptyState
                    className="p-0"
                    scene={<DeskScene />}
                    title="The office is empty"
                    description="No ticket has reported in yet. Create an ingest token, then let the orchestrator on your laptop push its ticket status here."
                    action={(
                      <>
                        <Button size="sm" variant="primary" onClick={() => onNavigate('/settings')}>Open System Settings</Button>
                        <Button size="sm" onClick={() => { setSampleStartedAt(Date.now() / 1000); setSelectedKey('SAMPLE-2'); }}><Play size={14} aria-hidden="true" />Run a sample</Button>
                      </>
                    )}
                  />
                </div>
              )}
            </div>
            </>
          ) : empty ? (
            <EmptyState scene={<RobotScene />} description="No ticket has reported in yet." action={<Button size="sm" variant="primary" onClick={() => onNavigate('/settings')}>Open System Settings</Button>} />
          ) : (
            <div>
              <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
                <div className="flex rounded-sm border border-border bg-surface-1 p-0.5" role="group" aria-label="Tickets shown">
                  {([['active', 'Active', active.length], ['archive', 'Archive', archived.length]] as const).map(([id, label, count]) => (
                    <button key={id} type="button" className={cn('flex h-7 max-[760px]:h-11 items-center gap-1.5 rounded-xs px-3 font-display text-xs font-semibold text-secondary-foreground transition-colors duration-150', tableTab === id && 'bg-accent text-black')} aria-pressed={tableTab === id} onClick={() => { setTableTab(id); setPage(1); }}>
                      {label}<span className="font-mono tabular-nums opacity-70">{count}</span>
                    </button>
                  ))}
                </div>
                <span className="text-pretty text-xs text-muted-foreground">{tableTab === 'archive' ? 'Finished tickets. They no longer count in the totals above.' : 'Tickets an agent is still on.'}</span>
              </div>
              <PhoneCards>
                <table className="w-full min-w-[860px] border-collapse text-left text-sm">
                  <thead className="bg-surface-1 text-xs text-muted-foreground">
                    <tr>
                      {TABLE_COLUMNS.map(([column, label]) => (
                        <th key={column} className="px-4 py-2 font-medium" aria-sort={sort.column === column ? (sort.descending ? 'descending' : 'ascending') : 'none'}>
                          <button type="button" className={cn('flex items-center gap-1 border-0 bg-transparent p-0 py-1 font-medium hover:text-foreground', sort.column === column && 'text-foreground')} onClick={() => sortBy(column)}>
                            {label}
                            {sort.column === column && (sort.descending ? <ArrowDown size={12} aria-hidden="true" /> : <ArrowUp size={12} aria-hidden="true" />)}
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {listed.items.length === 0 && (
                      <tr><td colSpan={TABLE_COLUMNS.length} className="px-4 py-10 text-center text-sm text-muted-foreground">{tableTab === 'archive' ? 'Nothing archived yet. A ticket moves here when it is done.' : 'No ticket is being worked on right now.'}</td></tr>
                    )}
                    {listed.items.map((run) => (
                      <tr key={run.key} className={cn('cursor-pointer border-t border-border hover:bg-surface-1', selected?.key === run.key && 'bg-surface-1')} onClick={() => pickRun(run.key)}>
                        <td className="px-4 py-3"><button type="button" className="border-0 bg-transparent p-0 text-left" onClick={() => pickRun(run.key)}><span className="font-mono text-xs font-extrabold text-accent">{run.key}</span><span className="sr-only">, machine </span><MachineChip name={machineOf(run)} className="ml-2" /><KindBadge kind={run.kind} className="ml-1" /><VerdictBadge run={run} className="ml-1" /><OfferBadge run={run} className="ml-2" /><span className="mt-0.5 block max-w-[320px] truncate text-[0.8rem] text-foreground">{run.title || 'Untitled'}</span></button></td>
                        <td className="px-4 py-3"><StageChip stage={run.stage} kind={run.kind} /></td>
                        <td className="px-4 py-3"><StatusChip status={statusOf(run)} review={run.review} /></td>
                        <td className="px-4 py-3 font-mono text-xs tabular-nums">{run.acPassed}/{run.acTotal}{run.acFailed > 0 && <span className="ml-1.5 text-status-conflict">{run.acFailed} failed</span>}</td>
                        <td className="max-w-[280px] px-4 py-3 text-xs text-secondary-foreground"><span className="line-clamp-2">{run.waiting || '—'}</span></td>
                        <td className="px-4 py-3 text-xs text-muted-foreground tabular-nums">{formatAge(run.idleSeconds + drift)} ago</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </PhoneCards>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
                <span className="tabular-nums">{listed.from === 0 ? '0 tickets' : `${listed.from}–${listed.to} of ${tableTab === 'archive' ? archived.length : active.length}`}</span>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="ghost" disabled={listed.page <= 1} onClick={() => setPage(listed.page - 1)} aria-label="Previous page"><ChevronLeft size={14} aria-hidden="true" />Prev</Button>
                  <span className="font-mono tabular-nums">Page {listed.page} / {listed.pages}</span>
                  <Button size="sm" variant="ghost" disabled={listed.page >= listed.pages} onClick={() => setPage(listed.page + 1)} aria-label="Next page">Next<ChevronRight size={14} aria-hidden="true" /></Button>
                </div>
              </div>
            </div>
          )}
        </Card>

        <Card id="agent-run-detail" className="flex max-h-[600px] scroll-mt-4 flex-col gap-3.5 overflow-y-auto bg-surface-0 p-[18px] max-[1120px]:max-h-none" aria-live="polite">
          {!selected ? (
            <p className="text-pretty text-sm text-muted-foreground">Select a character, a wall card or a table row to see that ticket's run.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-xs border border-accent/30 bg-accent-dim px-[9px] py-[3px] font-mono text-sm font-extrabold text-accent">{selected.key}</span>
                <KindBadge kind={selected.kind} />
                <VerdictBadge run={selected} />
                <StageChip stage={selected.stage} kind={selected.kind} />
                <StatusChip status={statusOf(selected)} review={selected.review} />
                <MachineChip name={machineOf(selected)} />
                <OfferBadge run={selected} />
                {chat && actions?.chat && <Button size="sm" className="ml-auto h-7 px-2.5" disabled={openingChat} onClick={() => void openForTicket(selected.key)}><MessagesSquare size={13} aria-hidden="true" />Chat</Button>}
              </div>
              {chatError && <p className="text-pretty text-xs break-words text-status-conflict" role="alert">The chat could not be opened: {chatError}</p>}
              <h2 className="text-pretty font-display text-base leading-snug font-bold">{selected.title || 'Untitled'}</h2>
              {actions?.move && <MoveTicket key={selected.key} run={selected} />}

              {selected.waiting && (
                <div className="rounded-[8px] border border-amber-300/50 bg-amber-300/10 px-3 py-2.5 text-sm">
                  <b className="mb-0.5 block font-mono text-[0.66rem] font-bold uppercase tracking-[0.08em] text-amber-200">Waiting on you</b>
                  <span className="text-pretty">{selected.waiting}</span>
                  <p className="mt-1.5 text-pretty text-xs text-muted-foreground">{answerHint(board, machineOf(selected) === CHAT_MACHINE, machinePlace(machineOf(selected)))}</p>
                  {!board && actions?.confirm && (selected.waiting === PARKED_TEXT || selected.waiting === START_FAILED_TEXT)
                    ? <Button size="sm" variant="primary" className="mt-2 h-7 px-2.5" disabled={confirming} onClick={() => void runAction(async () => { await confirmOrchestration({ variables: { key: selected.key } }); await refetch(); })}>{selected.waiting === PARKED_TEXT ? 'Confirm and start' : 'Retry'}</Button>
                    : actions?.chat && machineOf(selected) === CHAT_MACHINE && <Button size="sm" className="mt-2 h-7 px-2.5" disabled={openingChat} onClick={() => void openForTicket(selected.key)}>Reply here</Button>}
                </div>
              )}

              <div className="rounded-[8px] border border-border bg-surface-1 px-3 py-2.5">
                <p className={cn(sectionLabel, 'mb-1.5')}>Activity</p>
                <dl className="grid grid-cols-[92px_1fr] gap-x-2.5 gap-y-1 text-[0.82rem]">
                  <dt className="pt-0.5 font-mono text-[0.68rem] font-semibold text-muted-foreground">State</dt>
                  <dd>{selected.activity === 'ACTIVE' ? `Active${selected.activityDetail ? ` · ${selected.activityDetail}` : ''}` : selected.activity === 'WAITING' ? 'Waiting' : 'Idle'}</dd>
                  <dt className="pt-0.5 font-mono text-[0.68rem] font-semibold text-muted-foreground">Last event</dt>
                  <dd className="tabular-nums">{formatAge(selected.idleSeconds + drift)} ago</dd>
                  {selected.reviewSignal === 'approved' && <><dt className="pt-0.5 font-mono text-[0.68rem] font-semibold text-muted-foreground">Review</dt><dd>Approved</dd></>}
                  {selected.reviewSignal === 'checks_pending' && <><dt className="pt-0.5 font-mono text-[0.68rem] font-semibold text-muted-foreground">Review</dt><dd>Checks running</dd></>}
                  {selected.gate && <><dt className="pt-0.5 font-mono text-[0.68rem] font-semibold text-muted-foreground">Gate</dt><dd>{selected.gate}</dd></>}
                  {selected.stalled && <><dt className="pt-0.5 font-mono text-[0.68rem] font-semibold text-muted-foreground">Stalled</dt><dd className="text-status-conflict">No activity past the stale limit</dd></>}
                </dl>
              </div>

              <div>
                <p className={cn(sectionLabel, 'mb-1')}>Acceptance criteria · {selected.acPassed}/{selected.acTotal}</p>
                {selected.ac.length === 0 && <p className="text-sm text-muted-foreground">No acceptance criteria recorded yet.</p>}
                {selected.ac.map((item) => (
                  <div className="grid grid-cols-[46px_1fr] gap-[9px] border-b border-border py-1.5 text-[0.82rem] last:border-b-0" key={item.n}>
                    <span className={cn('h-fit rounded-xs border py-0.5 text-center font-mono text-[0.62rem] font-extrabold', acTone(item.state))}>{item.state}</span>
                    <span className="min-w-0"><span className="text-pretty">{item.text || `AC ${item.n}`}</span>{item.evidence && <span className="mt-0.5 block break-all font-mono text-[0.68rem] text-muted-foreground">{item.evidence}</span>}</span>
                  </div>
                ))}
              </div>

              {(selected.testsBe || selected.testsFe || selected.prBe || selected.prFe || selected.note) && (
                <dl className="grid grid-cols-[92px_1fr] gap-x-2.5 gap-y-1 text-[0.82rem]">
                  {selected.testsBe && <><dt className="pt-0.5 font-mono text-[0.68rem] font-semibold text-muted-foreground">Tests BE</dt><dd className="break-words">{selected.testsBe}</dd></>}
                  {selected.testsFe && <><dt className="pt-0.5 font-mono text-[0.68rem] font-semibold text-muted-foreground">Tests FE</dt><dd className="break-words">{selected.testsFe}</dd></>}
                  {selected.pullRequests?.map((pr) => (
                    <React.Fragment key={pr.url}><dt className="pt-0.5 font-mono text-[0.68rem] font-semibold text-muted-foreground">{pr.status}</dt><dd className="min-w-0"><a className="flex items-center gap-1 font-mono text-xs text-accent hover:underline" href={pr.url} target="_blank" rel="noreferrer"><span className="truncate">{pr.repo}#{pr.number}</span><ExternalLink className="size-3.5 shrink-0" aria-hidden="true" /></a>{(pr.reviewDecision === 'changes_requested' || pr.reviewDecision === 'approved' || (pr.checks && pr.checks !== 'none')) && <span className="font-mono text-[0.68rem] text-muted-foreground">{[pr.reviewDecision === 'changes_requested' && 'changes requested', pr.reviewDecision === 'approved' && 'approved', pr.checks === 'failing' && 'CI failing', pr.checks === 'pending' && 'checks running', pr.checks === 'passing' && 'CI passing'].filter(Boolean).join(' · ')}</span>}</dd></React.Fragment>
                  ))}
                  {!selected.pullRequests?.length && [['PR BE', selected.prBe], ['PR FE', selected.prFe]].map(([label, url]) => url && (
                    <React.Fragment key={label}><dt className="pt-0.5 font-mono text-[0.68rem] font-semibold text-muted-foreground">{label}</dt><dd className="min-w-0"><a className="flex items-center gap-1 font-mono text-xs text-accent hover:underline" href={url} target="_blank" rel="noreferrer"><span className="truncate">{url}</span><ExternalLink className="size-3.5 shrink-0" aria-hidden="true" /></a></dd></React.Fragment>
                  ))}
                  {selected.note && <><dt className="pt-0.5 font-mono text-[0.68rem] font-semibold text-muted-foreground">Note</dt><dd className="break-words">{selected.note}</dd></>}
                </dl>
              )}

              {selected.brief && (
                <div>
                  <p className={cn(sectionLabel, 'mb-1')}>Brief</p>
                  <p className="whitespace-pre-wrap break-words text-[0.82rem]">{selected.brief}</p>
                </div>
              )}

              {!!selected.decisions?.length && (
                <div>
                  <p className={cn(sectionLabel, 'mb-1')}>Decisions</p>
                  <ol className="flex flex-col">
                    {[...selected.decisions].reverse().map((decision, index) => (
                      <li className="grid grid-cols-[1fr_auto] gap-2 border-b border-border py-1.5 text-[0.78rem] last:border-b-0" key={`${decision.at}-${index}`}>
                        <span className="min-w-0 break-words">{decision.text}</span>
                        <time className="font-mono text-[0.68rem] text-muted-foreground tabular-nums" dateTime={decision.at}>{new Date(decision.at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</time>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {!!selected.assumptions?.length && (
                <div>
                  <p className={cn(sectionLabel, 'mb-1')}>Assumptions</p>
                  <ol className="flex flex-col">
                    {selected.assumptions.map((assumption) => (
                      <li className="grid grid-cols-[1fr_auto] gap-2 border-b border-border py-1.5 text-[0.78rem] last:border-b-0" key={assumption.n}>
                        <span className="min-w-0 break-words">{assumption.text}<span className="mt-0.5 block text-[0.72rem] text-muted-foreground">Wrong if: {assumption.falsifier}</span>{assumption.evidence && <span className="mt-0.5 block break-all font-mono text-[0.68rem] text-muted-foreground">{assumption.evidence}</span>}</span>
                        <span className="font-mono text-[0.68rem] text-muted-foreground">{assumption.state}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {selected.kind === 'review' && (!!selected.findings?.length || !!selected.lgtm?.length || !!selected.verdict) && (
                <div>
                  <p className={cn(sectionLabel, 'mb-1')}>Review</p>
                  <ol className="flex flex-col">
                    {reviewFindings(selected.findings ?? []).map((finding, index) => (
                      <li className="grid grid-cols-[1fr_auto] gap-2 border-b border-border py-1.5 text-[0.78rem] last:border-b-0" key={`${finding.at}-${index}`}>
                        <span className="min-w-0 break-words">{finding.text}</span>
                        <span className={cn('font-mono text-[0.68rem] font-semibold', finding.severity === 'blocker' ? 'text-status-conflict' : 'text-muted-foreground')}>{finding.severity}</span>
                      </li>
                    ))}
                    {(selected.lgtm ?? []).map((part, index) => (
                      <li className="grid grid-cols-[1fr_auto] gap-2 border-b border-border py-1.5 text-[0.78rem] last:border-b-0" key={`lgtm-${part.at}-${index}`}>
                        <span className="min-w-0 break-words">{part.text}</span>
                        <span className="font-mono text-[0.68rem] font-semibold text-status-merged">lgtm</span>
                      </li>
                    ))}
                  </ol>
                  {selected.verdict && <p className="mt-1.5 font-mono text-[0.72rem] font-bold">Verdict: {selected.verdict === 'approve' ? 'Approve' : 'Request change'}</p>}
                </div>
              )}

              {!!selected.failures?.length && (
                <div>
                  <p className={cn(sectionLabel, 'mb-1')}>Failures</p>
                  <ol className="flex flex-col">
                    {[...selected.failures].reverse().map((failure, index) => (
                      <li className="grid grid-cols-[1fr_auto] gap-2 border-b border-border py-1.5 text-[0.78rem] last:border-b-0" key={`${failure.at}-${index}`}>
                        <span className="min-w-0 break-words">{failure.what || failure.type}<span className="mt-0.5 block break-all font-mono text-[0.68rem] text-muted-foreground">{failure.evidence}</span></span>
                        <span className="font-mono text-[0.68rem] text-muted-foreground tabular-nums">{failure.type} #{failure.attempt}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {selected.closing && (
                <div>
                  <p className={cn(sectionLabel, 'mb-1')}>Closing</p>
                  <dl className="grid grid-cols-[92px_1fr] gap-x-2.5 gap-y-1 text-[0.82rem]">
                    <dt className="pt-0.5 font-mono text-[0.68rem] font-semibold text-muted-foreground">Fix rounds</dt><dd className="tabular-nums">{selected.closing.fixRounds}</dd>
                    <dt className="pt-0.5 font-mono text-[0.68rem] font-semibold text-muted-foreground">Replans</dt><dd className="tabular-nums">{selected.closing.replans}</dd>
                    {selected.closing.hours != null && <><dt className="pt-0.5 font-mono text-[0.68rem] font-semibold text-muted-foreground">Hours</dt><dd className="tabular-nums">{selected.closing.hours}</dd></>}
                  </dl>
                </div>
              )}

              {events.length > 0 && (
                <div>
                  <p className={cn(sectionLabel, 'mb-1')}>Recent events</p>
                  <ol className="flex flex-col">
                    {events.slice(0, 8).map((event) => (
                      <li className="grid grid-cols-[1fr_auto] gap-2 border-b border-border py-1.5 text-[0.78rem] last:border-b-0" key={event.id}>
                        <span className="min-w-0 truncate"><span className="text-secondary-foreground">{eventLabel[event.kind] || event.kind}</span>{event.detail && <span className="text-foreground"> {event.kind === 'STAGE' ? stageLabel(event.detail) : event.detail}</span>}</span>
                        <time className="font-mono text-[0.68rem] text-muted-foreground tabular-nums" dateTime={event.at}>{new Date(event.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</time>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {!selected.sample && (
                <div className="mt-auto flex flex-wrap gap-2 border-t border-border pt-3.5">
                  <Button size="sm" variant="primary" onClick={() => onTicketClick(selected.key)}>Open ticket</Button>
                  {actions?.hide && <Button size="sm" variant="ghost" onClick={() => { setActionError(''); setDismissTarget(selected); }}><EyeOff size={14} aria-hidden="true" />Hide run</Button>}
                  {selected.remote && <span className="self-center text-pretty text-xs text-muted-foreground">Read-only here. This run belongs to the {machineOf(selected)} DOCK.</span>}
                </div>
              )}
            </>
          )}
        </Card>
      </div>

      <Card className="mt-4 p-0">
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 border-b border-border bg-surface-0 px-5 py-2.5">
          <h2 className="font-display text-[0.95rem] font-bold">Session flow</h2>
          {selected && <span className="font-mono text-xs font-bold text-accent">{selected.key}</span>}
          <span className="text-pretty text-[0.78rem] text-muted-foreground">{showReplay ? `The uploaded Claude Code session, with secrets masked on ${selected ? machinePlace(machineOf(selected)) : 'the laptop'}.` : `Live from the stage, gate and tool-call events ${selected ? machinePlace(machineOf(selected)) : 'your laptop'} reports.`}</span>
          {canReplay && (
            <div className="ml-auto flex rounded-sm border border-border bg-surface-1 p-0.5 max-[700px]:ml-0" role="group" aria-label="Session flow view">
              {([['live', 'Live graph'], ['replay', 'Replay detail']] as const).map(([id, label]) => (
                <button key={id} type="button" className={cn('h-7 rounded-xs px-3 font-display text-xs font-semibold text-secondary-foreground transition-colors duration-150', flowView === id && 'bg-accent text-black')} aria-pressed={flowView === id} onClick={() => setFlowView(id)}>{label}</button>
              ))}
            </div>
          )}
        </div>
        {showReplay && selected
          ? <iframe key={selected.key} className="block h-[540px] w-full border-0 bg-[#0b0b0c]" title={`Session replay for ${selected.key}`} src={`${import.meta.env.BASE_URL}zoetrope/index.html?key=${encodeURIComponent(selected.key)}&api=${encodeURIComponent(apiOrigin)}`} />
          : selected && timeline
            ? <AgentFlowGraph run={selected} timeline={timeline} />
            : <p className="px-5 py-8 text-center text-pretty text-sm text-muted-foreground">{!selected ? 'Select a ticket to see its flow.' : sampling ? 'Select SAMPLE-2 to see a sample flow.' : selected.remote && detailData?.orchestration?.key === selected.key ? `The flow and transcript of ${selected.key} stay on the ${machineOf(selected)} DOCK.` : 'Loading the flow...'}</p>}
      </Card>

      <Dialog open={Boolean(dismissTarget)} onClose={() => !dismissing && setDismissTarget(null)} dismissible={!dismissing} labelledBy="hide-run-title" describedBy="hide-run-description">
        <Card className="w-[min(440px,calc(100vw-2rem))] shadow-card">
          <h2 id="hide-run-title" className="text-balance font-display text-xl font-bold">Hide this run?</h2>
          <p id="hide-run-description" className="mt-2 text-pretty text-sm text-muted-foreground">{dismissTarget?.key} leaves the office and Needs Attention. It comes back the next time the orchestrator pushes its status.</p>
          {actionError && <p className="mt-3 text-pretty text-sm text-status-conflict" role="alert">{actionError}</p>}
          <div className="mt-6 flex justify-end gap-2"><Button onClick={() => setDismissTarget(null)} disabled={dismissing}>Cancel</Button><Button variant="danger" onClick={handleDismiss} disabled={dismissing}>{dismissing ? 'Hiding...' : 'Hide run'}</Button></div>
        </Card>
      </Dialog>
    </Page>
  );
};

export default AgentsPage;
