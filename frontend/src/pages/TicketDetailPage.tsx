import React, { useCallback, useState } from 'react';
import { useQuery, useMutation } from '@apollo/client';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Circle,
  ExternalLink,
  GitBranch,
  Link2,
  MessagesSquare,
  MoreVertical,
  RefreshCw,
  X,
} from 'lucide-react';
import { GET_DASHBOARD, GET_ORCHESTRATION, GET_TICKET_DETAIL_CORE, GET_TICKET_DETAIL_ENRICHMENT } from '../graphql/queries';
import { stageLabel, type AgentRun } from '../agents/runs';
import { machineOf } from '../chat/messages';
import { useAnswerTicket } from '../chat/useAnswerTicket';
import { useOpenForTicket } from '../chat/useOpenForTicket';
import { DependencyDialog } from '../components/ticket/DependencyDialog';
import { NeedsYouCard } from '../components/ticket/NeedsYouCard';
import { MENU_WIDTH, TicketMenu, type TicketMenuTarget } from '../components/ticket/TicketMenu';
import { useTicketWork } from '../components/ticket/useTicketWork';
import { SAVE_DEMO_LINK, SEND_TO_DISCORD, CHECK_CONFLICTS } from '../graphql/mutations';
import { PRBadge } from '../components/PRBadge';
import { ConflictModal } from '../components/ConflictModal';
import { DiscordPreviewModal } from '../components/DiscordPreviewModal';
import { useBoardMode } from '../lib/boardMode';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { Toast } from '../components/Toast';
import { Button, Card, Input, Page } from '../components/ui';
import { cn } from '../lib/cn';
import { CACHED_QUERY_OPTIONS, DETAIL_QUERY_OPTIONS, displayAssignee } from '../lib/queryPolicy';
import { RUN_STATE_LABEL, isLongDescription, needsYou, runState, type NeedItem } from '../lib/ticketDetail';
import { getPassLabels } from '../lib/ticketApprovals';
import { nextWorkOrder } from '../lib/workOrder';

interface TicketDetailPageProps {
  ticketKey: string;
  onBack?: () => void;
}

const RUN_TONE: Record<ReturnType<typeof runState>, string> = {
  none: 'text-muted-foreground',
  waiting: 'text-status-warn',
  stalled: 'text-status-conflict',
  running: 'text-status-warn',
  finished: 'text-status-merged',
};

const AC_ICON = {
  PASS: <Check size={14} className="text-status-merged" aria-hidden="true" />,
  FAIL: <X size={14} className="text-status-conflict" aria-hidden="true" />,
};

/** One label and value in the ticket's property list. */
const Property: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <>
    <dt className="py-1.5 text-xs text-muted-foreground">{label}</dt>
    <dd className="flex min-w-0 items-center gap-2 py-1 text-sm">{children}</dd>
  </>
);

const propertyButton = '-ml-2 rounded-xs border border-transparent px-2 py-1 text-left text-sm font-semibold hover:border-border hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 max-[760px]:min-h-11';
const sectionTitle = 'mb-1.5 mt-4 border-t border-border pt-3 font-mono text-[0.62rem] font-bold uppercase tracking-[0.1em] text-muted-foreground';

const TicketDetailPage: React.FC<TicketDetailPageProps> = ({ ticketKey, onBack }) => {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { data: coreData, loading: coreLoading, error: coreError, refetch: refetchCore } = useQuery(GET_TICKET_DETAIL_CORE, {
    ...DETAIL_QUERY_OPTIONS,
    variables: { key: ticketKey },
    pollInterval: 30000,
  });
  const { data: cachedDashboardData } = useQuery(GET_DASHBOARD, {
    fetchPolicy: 'cache-only',
    returnPartialData: true,
  });
  const cachedTickets = cachedDashboardData?.dashboard?.flatMap((group: any) => group.tickets || []) ?? [];
  const cachedTicket = cachedTickets.find((item: any) => item.key?.toUpperCase() === ticketKey.toUpperCase());
  const coreTicketFromResponse = coreData?.ticketDetail?.key?.toUpperCase() === ticketKey.toUpperCase()
    ? coreData.ticketDetail
    : undefined;
  const coreTicket = coreTicketFromResponse || (coreData?.ticketDetail === undefined ? cachedTicket : undefined);
  const { data: enrichmentData, loading: enrichmentLoading, error: enrichmentError, refetch: refetchEnrichment } = useQuery(GET_TICKET_DETAIL_ENRICHMENT, {
    ...DETAIL_QUERY_OPTIONS,
    variables: { key: ticketKey },
    skip: !coreTicket,
  });
  const [saveDemoLink] = useMutation(SAVE_DEMO_LINK);
  const [sendToDiscord, { loading: sendingDiscord }] = useMutation(SEND_TO_DISCORD);
  const [checkConflicts] = useMutation(CHECK_CONFLICTS);
  const work = useTicketWork(['GetTicketDetailCore']);

  const [showConflictModal, setShowConflictModal] = useState(false);
  const [showDiscordModal, setShowDiscordModal] = useState(false);
  const board = useBoardMode();
  const [showDependency, setShowDependency] = useState(false);
  const [conflictMessage, setConflictMessage] = useState('');
  const [demoUrl, setDemoUrl] = useState('');
  const [editingDemo, setEditingDemo] = useState(false);
  const [editingOrder, setEditingOrder] = useState(false);
  const [workOrder, setWorkOrder] = useState('');
  const [menu, setMenu] = useState<TicketMenuTarget | null>(null);
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' | 'info' } | null>(null);
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const { data: runData } = useQuery(GET_ORCHESTRATION, { ...CACHED_QUERY_OPTIONS, variables: { key: ticketKey }, pollInterval: 30000 });
  const run: AgentRun | null = runData?.orchestration?.key?.toUpperCase() === ticketKey.toUpperCase() ? runData.orchestration : null;
  const { openForTicket, opening: openingSession, error: sessionError } = useOpenForTicket();
  const { answer, sending: answering } = useAnswerTicket();
  const closeMenu = useCallback(() => setMenu(null), []);

  const renderBackButton = () => onBack ? (
    <button onClick={onBack} className="inline-flex min-h-6 max-[760px]:min-h-11 items-center gap-2 font-mono text-[0.82rem] font-semibold text-muted-foreground transition-colors duration-150 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
      <ArrowLeft size={14} aria-hidden="true" />
      <span>Dashboard</span>
      <span className="opacity-40">/</span>
      <span className="text-foreground">{ticketKey}</span>
    </button>
  ) : null;

  const enrichedTicket = enrichmentData?.ticketDetail?.key?.toUpperCase() === ticketKey.toUpperCase()
    ? enrichmentData.ticketDetail
    : undefined;
  const ticket = coreTicket
    ? { ...coreTicket, ...(enrichedTicket || {}) }
    : undefined;

  if (coreLoading && !ticket) return (
    <Page width="full">
      <div className="mb-5">{renderBackButton()}</div>
      <LoadingSkeleton />
    </Page>
  );
  if (coreError && !ticket) return (
    <Page width="full">
      <div className="mb-5">{renderBackButton()}</div>
      <Card className="border-status-conflict text-status-conflict" role="alert">
        <p>Error loading ticket details: {coreError.message}</p>
        <Button className="mt-3" variant="primary" onClick={() => void refetchCore()}>Retry</Button>
      </Card>
    </Page>
  );

  if (!ticket) return (
    <Page width="full">
      <div className="mb-5">{renderBackButton()}</div>
      <Card>Ticket "{ticketKey}" not found in current workspace.</Card>
    </Page>
  );

  const refetchAll = async () => {
    await Promise.all([refetchCore(), refetchEnrichment()]);
  };

  const report = (message: string, type: 'success' | 'error') => setToast({ message, type });

  const handleSaveWorkOrder = async () => {
    setEditingOrder(false);
    if (!workOrder || (ticket.workOrderSource === 'dock' && String(ticket.workOrder) === workOrder)) return;
    try {
      report(await work.saveOrder(ticketKey, Number(workOrder)), 'success');
    } catch (err: any) {
      report(err.message || 'Failed to save the work order', 'error');
    }
  };

  const handleToggleManual = async (manual: boolean) => {
    if (manual === Boolean(ticket.workManual)) return;
    try {
      report(await work.setManual(ticketKey, manual), 'success');
    } catch (err: any) {
      report(err.message || 'Failed to update manual work', 'error');
    }
  };

  const handleInspect = async (owner: string, repo: string, pullNumber: number) => {
    try {
      const res = await checkConflicts({ variables: { owner, repo, pullNumber } });
      if (res.data?.checkConflicts?.hasConflict) {
        setConflictMessage(res.data.checkConflicts.message || 'File conflict in target branch.');
        setShowConflictModal(true);
      } else {
        setToast({ message: 'No conflicts detected! Clean merge status.', type: 'success' });
      }
    } catch (err) {
      setToast({ message: 'Failed to inspect file conflicts', type: 'error' });
    }
  };

  const handleSaveDemo = async () => {
    if (!demoUrl) return;
    try {
      const saved = await saveDemoLink({ variables: { ticketKey, url: demoUrl } });
      if (saved.data?.saveDemoLink !== true) throw new Error('Demo recording link was not stored');
      await refetchEnrichment();
      setToast({ message: 'Demo recording link saved permanently!', type: 'success' });
      setDemoUrl('');
      setEditingDemo(false);
    } catch (err) {
      setToast({ message: 'Failed to save demo recording link', type: 'error' });
    }
  };

  const handleDiscordBroadcast = () => {
    setShowDiscordModal(true);
  };

  const handleConfirmDiscord = async (customMessage: string, threadId?: string, threadName?: string) => {
    try {
      const res = await sendToDiscord({ variables: { ticketKey, customMessage, threadId, threadName } });
      if (res.data?.sendToDiscord) {
        setToast({ message: 'Summary posted to Discord. Tickets before review moved to PR Review.', type: 'success' });
        setShowDiscordModal(false);
        await refetchAll();
      } else {
        setToast({ message: 'Failed to post summary to Discord', type: 'error' });
      }
    } catch (err) {
      setToast({ message: 'Discord webhook transmission error', type: 'error' });
    }
  };

  const handleManualRefetch = async () => {
    setIsRefreshing(true);
    try {
      await refetchEnrichment();
      setToast({ message: 'Pull requests synchronized successfully!', type: 'success' });
    } catch (e) {
      setToast({ message: 'Failed to synchronize pull requests', type: 'error' });
    } finally {
      setIsRefreshing(false);
    }
  };

  const needs = needsYou({ run, pullRequests: ticket.pullRequests });
  const handleNeed = (item: NeedItem) => {
    if (item.kind === 'question') void openForTicket(ticket.key);
    else if (item.kind === 'ac') document.getElementById('acceptance-criteria')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    else {
      const pr = item.kind === 'conflict'
        ? ticket.pullRequests?.find((candidate: any) => `conflict-${candidate.id ?? candidate.repo}` === item.id)
        : ticket.pullRequests?.[0];
      if (item.kind === 'conflict' && pr) void handleInspect(pr.owner, pr.repo, pr.pullNumber || pr.number);
      else if (pr?.url) window.open(pr.url, '_blank', 'noreferrer');
    }
  };
  const foldDescription = isLongDescription(ticket.description, 3);

  const state = runState(run);
  const acItems = run?.ac ?? [];
  const passLabels = getPassLabels(ticket.labels);
  const assignee = displayAssignee(ticket.assignee);
  const relation = coreData?.ticketRelationGroup;
  const enrichedRelation = enrichmentData?.ticketRelationGroup;
  const relationTickets = enrichedRelation?.tickets?.length ? enrichedRelation.tickets : [ticket];
  const isCombinedAnnouncement = relationTickets.length > 1;
  const primaryTicket = relationTickets.find((item: any) => item.key === relation?.primaryKey) || relationTickets[0];
  const announcementTicket = { key: primaryTicket.key, title: primaryTicket.title, url: primaryTicket.url };
  const announcementPullRequests = [...new Map(relationTickets
    .flatMap((item: any) => item.pullRequests || [])
    .map((pullRequest: any) => [pullRequest.url || pullRequest.id, pullRequest])).values()];
  const demoEntries = relationTickets
    .map((item: any) => ({ key: item.key, url: item.demoLink?.url || (item.key === ticket.key ? demoUrl : '') }))
    .filter((entry: any) => entry.url);
  const uniqueDemoUrls = [...new Set(demoEntries.map((entry: any) => entry.url))];
  const announcementDemoUrl = uniqueDemoUrls.length === 1
    ? `- **${relationTickets.map((item: any) => item.key).join(' + ')}:** ${uniqueDemoUrls[0]}`
    : demoEntries.map((entry: any) => `- **${entry.key}:** ${entry.url}`).join('\n');
  const ticketChoices = [...new Map((coreData?.dashboard || [])
    .flatMap((group: any) => group.tickets || [])
    .filter((item: any) => item.key !== ticket.key)
    .map((item: any) => [item.key, item])).values()]
    .sort((first: any, second: any) => first.key.localeCompare(second.key)) as Array<{ key: string; title: string }>;

  return (
    <Page width="full">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {renderBackButton()}
        <div className="flex flex-wrap items-center gap-2">
          {ticket.url && <a href={ticket.url} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-sm border border-border bg-surface-2 px-3 text-sm font-semibold hover:border-border-glow max-[760px]:h-11"><ExternalLink size={15} aria-hidden="true" />Jira</a>}
          {/* Board mode: no chat session per ticket and no Discord post from DOCK (sous posts the review request). */}
          {!board && <Button className="max-[760px]:h-11" onClick={() => void openForTicket(ticket.key)} disabled={openingSession}><MessagesSquare size={15} aria-hidden="true" />{openingSession ? 'Opening...' : 'Session'}</Button>}
          {!board && <Button
            className="border-status-discord bg-status-discord text-white hover:bg-status-discord/80 max-[760px]:h-11"
            title={isCombinedAnnouncement ? `One combined Discord announcement for ${relationTickets.map((item: any) => item.key).join(' + ')}` : 'Send status, PR checks and the demo link to Discord'}
            onClick={handleDiscordBroadcast}
          >
            {isCombinedAnnouncement ? `Broadcast ${relationTickets.length}` : 'Broadcast'}
          </Button>}
          <Button
            className="w-9 px-0 max-[760px]:h-11 max-[760px]:w-11"
            aria-label={`Actions for ${ticket.key}`}
            aria-haspopup="menu"
            onClick={(event) => {
              const box = event.currentTarget.getBoundingClientRect();
              setMenu({ key: ticket.key, x: box.right - MENU_WIDTH, y: box.bottom + 4, sheet: window.matchMedia('(max-width: 760px)').matches });
            }}
          >
            <MoreVertical size={16} aria-hidden="true" />
          </Button>
        </div>
      </div>
      {sessionError && <Card className="mb-4 border-status-conflict text-pretty text-sm text-status-conflict" role="alert">{sessionError}</Card>}

      <div className="grid grid-cols-[minmax(0,2fr)_minmax(320px,1fr)] items-start gap-8 max-[1000px]:grid-cols-1 max-[1000px]:gap-6">
        <main className="flex min-w-0 flex-col gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2.5 font-mono text-xs text-muted-foreground">
              <span className="rounded-xs border border-accent/30 bg-accent-dim px-2 py-0.5 text-sm font-extrabold text-accent">{ticket.key}</span>
              {ticket.status && <PRBadge status={ticket.status} />}
              {ticket.sprintName && ticket.sprintName !== 'No Sprint' && <span className={cn(ticket.sprintState !== 'CLOSED' && 'text-status-merged')}>{ticket.sprintName}</span>}
            </div>
            <h1 className="mt-2 text-balance font-display text-[1.6rem] leading-snug font-bold">{ticket.title}</h1>
          </div>

          <NeedsYouCard
            items={needs}
            onAction={handleNeed}
            answering={answering}
            answerBlocked={run?.remote ? 'The other DOCK runs this ticket. Answer it there.' : null}
            onAnswer={async (text) => {
              try {
                const where = await answer(ticket.key, text);
                setToast({ message: `Sent to ${where}.`, type: 'success' });
              } catch (answerError) {
                setToast({ message: answerError instanceof Error ? answerError.message : 'The answer could not be sent', type: 'error' });
                throw answerError;
              }
            }}
          />

          <section>
            <h2 className="mb-1.5 flex items-center gap-3 font-display text-sm font-bold">
              Description
              {foldDescription && <button type="button" className="text-xs font-semibold text-accent hover:underline" aria-expanded={descriptionOpen} onClick={() => setDescriptionOpen((open) => !open)}>{descriptionOpen ? 'Show less' : 'Show all'}</button>}
            </h2>
            <div className={cn('whitespace-pre-wrap break-words text-sm leading-relaxed text-secondary-foreground', foldDescription && !descriptionOpen && 'line-clamp-3')}>
              {ticket.description || 'No detailed description provided in this Jira issue.'}
            </div>
          </section>

          <section id="acceptance-criteria" className="scroll-mt-6">
            <h2 className="mb-1.5 flex items-baseline gap-2 font-display text-sm font-bold">
              Acceptance criteria
              {run && <span className="font-body text-xs font-medium text-muted-foreground">{run.acPassed} of {run.acTotal} passing</span>}
            </h2>
            {acItems.length === 0 ? (
              <p className="text-pretty text-sm text-muted-foreground">{run ? 'No acceptance criteria recorded yet.' : 'They show here once an agent run starts on this ticket.'}</p>
            ) : (
              <ol className="flex flex-col">
                {acItems.map((item) => (
                  <li key={item.n} className="grid grid-cols-[20px_minmax(0,1fr)] items-center gap-2 py-1 text-sm" title={item.evidence || undefined}>
                    {AC_ICON[item.state as keyof typeof AC_ICON] ?? <Circle size={10} className="mx-auto text-muted-foreground" aria-hidden="true" />}
                    <span className="truncate">
                      <span className="sr-only">{item.state}: </span>
                      {item.text || `AC ${item.n}`}
                      {item.state === 'FAIL' && item.evidence && <span className="ml-2 font-mono text-[0.7rem] text-status-conflict">{item.evidence}</span>}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </main>

        <aside className="min-w-0 border-l border-border pl-6 max-[1000px]:border-l-0 max-[1000px]:border-t max-[1000px]:pl-0 max-[1000px]:pt-4">
          <dl className="grid grid-cols-[96px_minmax(0,1fr)] items-center gap-x-3">
            <Property label="Agent">
              <span className={cn('flex items-center gap-1.5 whitespace-nowrap font-semibold', RUN_TONE[state])}>
                <i className={cn('size-1.5 rounded-full bg-current', state === 'running' && 'animate-pulse motion-reduce:animate-none')} aria-hidden="true" />
                {RUN_STATE_LABEL[state]}{run ? ` · ${stageLabel(run.stage)}` : ''}
              </span>
              {run && <span className="truncate font-mono text-[0.7rem] text-muted-foreground">{machineOf(run)}</span>}
            </Property>
            {run?.stage === 'blocked' && <><dt className="sr-only">Blocked</dt><dd className="col-span-2 pb-1 text-pretty text-xs text-status-conflict">Blocked: {run.note || run.waiting || 'see the session for the reason'}.</dd></>}
            <Property label="Order">
              {editingOrder ? (
                <form className="flex items-center gap-1.5" onSubmit={(event) => { event.preventDefault(); void handleSaveWorkOrder(); }}>
                  <Input
                    autoFocus
                    className="h-8 w-20 font-mono"
                    inputMode="numeric"
                    aria-label={`Work order for ${ticket.key}`}
                    value={workOrder}
                    onChange={(event) => setWorkOrder(event.target.value.replace(/[^0-9]/g, ''))}
                    onKeyDown={(event) => { if (event.key === 'Escape') setEditingOrder(false); }}
                    onBlur={() => setEditingOrder(false)}
                  />
                </form>
              ) : (
                <button
                  type="button"
                  className={cn(propertyButton, ticket.workOrder == null && 'font-normal text-muted-foreground')}
                  title={ticket.workOrderSource === 'label' ? 'From the Jira label; a number set here wins over it' : ticket.workOrderSource === 'dock' ? 'Set in DOCK; never written to Jira' : 'No number: taken after the numbered tickets'}
                  onClick={() => { setWorkOrder(ticket.workOrder != null ? String(ticket.workOrder) : ''); setEditingOrder(true); }}
                  disabled={work.busy}
                >
                  {ticket.workOrder != null ? `#${ticket.workOrder}${ticket.workOrderSource === 'label' ? ' · Jira label' : ''}` : 'Set order'}
                </button>
              )}
            </Property>
            <Property label="Mode">
              <span className="inline-flex overflow-hidden rounded-sm border border-border" role="group" aria-label="How the ticket gets worked">
                {[{ manual: false, label: 'Cron' }, { manual: true, label: 'Manual' }].map((option) => (
                  <button
                    key={option.label}
                    type="button"
                    aria-pressed={Boolean(ticket.workManual) === option.manual}
                    className={cn('h-7 px-3 text-xs font-semibold max-[760px]:h-11', Boolean(ticket.workManual) === option.manual ? 'bg-surface-hover text-foreground' : 'bg-surface-1 text-muted-foreground hover:text-foreground')}
                    onClick={() => void handleToggleManual(option.manual)}
                    disabled={work.busy}
                  >
                    {option.label}
                  </button>
                ))}
              </span>
            </Property>
            <Property label="Depends on">
              <button type="button" className={cn(propertyButton, 'flex items-center gap-1.5', !relation?.dependsOnKey && 'font-normal text-muted-foreground')} onClick={() => setShowDependency(true)}>
                <Link2 size={13} aria-hidden="true" />{relation?.dependsOnKey || 'None'}
              </button>
            </Property>
            <Property label="Assignee">{assignee || <span className="text-muted-foreground">Unassigned</span>}</Property>
            <Property label="Points">{ticket.storyPoints ?? <span className="text-muted-foreground">—</span>}</Property>
            <Property label="Approved">
              {passLabels.length > 0
                ? <span className="flex flex-wrap gap-1">{passLabels.map((label) => <span key={label} className="rounded-xs bg-status-merged-bg px-1.5 py-0.5 font-mono text-[0.7rem] font-semibold text-status-merged">{label}</span>)}</span>
                : <span className="text-muted-foreground">—</span>}
            </Property>
          </dl>

          <h2 className={cn(sectionTitle, 'flex items-center justify-between')}>
            Pull requests
            <button type="button" className="rounded-xs p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60" onClick={() => void handleManualRefetch()} disabled={isRefreshing} aria-label="Refresh pull requests from GitHub" title="Refresh PRs from GitHub">
              <RefreshCw size={12} className={cn(isRefreshing && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" />
            </button>
          </h2>
          {enrichmentLoading && !enrichmentData && <p className="font-mono text-xs text-muted-foreground">Loading pull requests...</p>}
          {enrichmentError && <p className="font-mono text-xs text-status-conflict">Pull request details are temporarily unavailable.</p>}
          {!enrichmentLoading && !enrichmentError && !ticket.pullRequests?.length && <p className="text-sm text-muted-foreground">No pull requests linked.</p>}
          <ul className="flex flex-col gap-1">
            {ticket.pullRequests?.map((pr: any) => {
              const isConflict = pr.status?.toUpperCase() === 'CONFLICT';
              return (
                <li key={pr.id} className={cn('-mx-2 rounded-xs px-2 py-1.5', isConflict ? 'bg-status-conflict-bg' : 'hover:bg-surface-2')}>
                  <div className="flex items-center justify-between gap-2">
                    <a href={pr.url} target="_blank" rel="noreferrer" className="truncate font-mono text-xs font-bold text-accent hover:underline" title={pr.title}>{pr.repo}#{pr.pullNumber || pr.number}</a>
                    {isConflict
                      ? <Button size="sm" variant="danger" onClick={() => void handleInspect(pr.owner, pr.repo, pr.pullNumber || pr.number)}><AlertTriangle size={12} aria-hidden="true" />Inspect</Button>
                      : <PRBadge status={pr.status} />}
                  </div>
                  <p className="mt-0.5 flex items-center gap-1 truncate font-mono text-[0.68rem] text-muted-foreground" title={`${pr.headBranch} → ${pr.baseBranch}`}>
                    <GitBranch size={11} className="shrink-0" aria-hidden="true" />
                    <span className="truncate">{pr.headBranch || 'feature'} → {pr.baseBranch || 'main'}</span>
                  </p>
                </li>
              );
            })}
          </ul>

          <h2 className={sectionTitle}>Demo</h2>
          {editingDemo ? (
            <form className="flex items-center gap-1.5" onSubmit={(event) => { event.preventDefault(); void handleSaveDemo(); }}>
              <Input autoFocus aria-label="Demo recording URL" className="h-8 min-w-0 flex-1 font-mono text-xs" placeholder="https://loom.com/share/..." value={demoUrl} onChange={(event) => setDemoUrl(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setEditingDemo(false); }} />
              <Button size="sm" variant="primary" type="submit" disabled={!demoUrl}>Save</Button>
            </form>
          ) : ticket.demoLink?.url ? (
            <div className="flex items-center justify-between gap-2">
              <a href={ticket.demoLink.url} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-1.5 font-mono text-xs font-semibold text-status-merged hover:underline"><ExternalLink size={12} className="shrink-0" aria-hidden="true" /><span className="truncate">{ticket.demoLink.url.replace(/^https?:\/\//, '')}</span></a>
              <button type="button" className="text-xs font-semibold text-accent hover:underline" onClick={() => { setDemoUrl(ticket.demoLink.url); setEditingDemo(true); }}>Edit</button>
            </div>
          ) : (
            <button type="button" className="text-sm font-semibold text-accent hover:underline" onClick={() => setEditingDemo(true)}>+ Add link</button>
          )}
        </aside>
      </div>

      {menu && (
        <TicketMenu
          target={menu}
          ticket={ticket}
          nextOrder={nextWorkOrder(cachedTickets, ticket.key)}
          refetchQueries={['GetTicketDetailCore']}
          onSession={() => void openForTicket(ticket.key)}
          onDependency={() => setShowDependency(true)}
          onDone={report}
          onClose={closeMenu}
        />
      )}

      <DependencyDialog
        open={showDependency}
        ticketKey={ticket.key}
        dependsOnKey={relation?.dependsOnKey}
        primaryKey={relation?.primaryKey}
        groupKeys={relation?.ticketKeys ?? []}
        choices={ticketChoices}
        onClose={() => setShowDependency(false)}
        onDone={report}
      />

      <ConflictModal
        isOpen={showConflictModal}
        onClose={() => setShowConflictModal(false)}
        message={conflictMessage}
      />

      <DiscordPreviewModal
        isOpen={showDiscordModal}
        onClose={() => setShowDiscordModal(false)}
        onConfirm={handleConfirmDiscord}
        ticket={announcementTicket}
        relatedTickets={relationTickets.map((item: any) => ({ key: item.key, title: item.title, url: item.url }))}
        pullRequests={announcementPullRequests as any[]}
        demoUrl={announcementDemoUrl || undefined}
        messageTemplate={coreData?.settings?.discordMessageTemplate}
        loading={sendingDiscord}
      />

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </Page>
  );
};

export default TicketDetailPage;
