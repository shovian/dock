import React, { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation } from '@apollo/client';
import { AlertTriangle, Bot, ExternalLink, GitMerge, Hand, PenLine } from 'lucide-react';
import { BOARD_ANSWER_JOB, GET_BOARD_ITEMS, GET_NEEDS_ATTENTION } from '../graphql/queries';
import { CHECK_CONFLICTS, CONFIRM_BOARD_ITEMS, WRITE_BOARD_ANSWERS } from '../graphql/mutations';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { EmptyState } from '../components/EmptyState';
import { AllClearScene } from '../components/empty/scenes/AllClearScene';
import { ConflictModal } from '../components/ConflictModal';
import { Toast } from '../components/Toast';
import { Badge, Button, Card, Page } from '../components/ui';
import { CACHED_QUERY_OPTIONS, isInitialQueryLoading } from '../lib/queryPolicy';
import { cn } from '../lib/cn';
import { useBoardMode } from '../lib/boardMode';
import { confirmPlan, groupItems, type BoardItem } from '../lib/boardItems';
import { BoardItemCard } from '../components/BoardItemCard';
import { CONFIRM_WINDOW_MS, pressWrite, writeButton } from '../lib/writeAnswers';

interface NeedsAttentionPageProps { onTicketClick: (key: string) => void }

const POLL_WHILE_WRITING_MS = 3000;

const agentLabel: Record<string, string> = { AGENT_WAITING: 'WAITING', AGENT_AC_FAILED: 'AC FAILED', AGENT_STALLED: 'STALLED', AGENT_CHANGES_REQUESTED: 'CHANGES REQUESTED', AGENT_CHECKS_FAILING: 'CI FAILING' };

const NeedsAttentionPage: React.FC<NeedsAttentionPageProps> = ({ onTicketClick }) => {
  const { data, loading, error } = useQuery(GET_NEEDS_ATTENTION, { ...CACHED_QUERY_OPTIONS, pollInterval: 30000 });
  const board = useBoardMode();
  const boardQuery = useQuery(GET_BOARD_ITEMS, { ...CACHED_QUERY_OPTIONS, pollInterval: 30000, skip: !board });
  // How many answers wait for `sous answer`; asked every few seconds while it runs.
  const [writing, setWriting] = useState(false);
  const jobQuery = useQuery(BOARD_ANSWER_JOB, { ...CACHED_QUERY_OPTIONS, pollInterval: writing ? POLL_WHILE_WRITING_MS : 30000, skip: !board });
  const [writeAnswers, { loading: starting }] = useMutation(WRITE_BOARD_ANSWERS);
  // The click time; the timer below clears it, so the render needs no clock of its own.
  const [armedAt, setArmedAt] = useState<number | null>(null);
  const [writeNote, setWriteNote] = useState<string | null>(null);
  const job = jobQuery.data?.boardAnswerJob;
  const running = job?.running === true;
  const { refetch: refetchBoard } = boardQuery;
  const { refetch: refetchJob } = jobQuery;
  // The server runs it on its own; when it ends, load the board again so the written cards disappear.
  const wasRunning = useRef(false);
  useEffect(() => {
    setWriting(running);
    if (wasRunning.current && !running) void refetchBoard();
    wasRunning.current = running;
  }, [running, refetchBoard]);
  // The armed button goes back to normal after the confirm window.
  useEffect(() => {
    if (armedAt === null) return undefined;
    const timer = window.setTimeout(() => setArmedAt(null), CONFIRM_WINDOW_MS);
    return () => window.clearTimeout(timer);
  }, [armedAt]);
  const [checkConflicts] = useMutation(CHECK_CONFLICTS);
  const [confirmBoardItems, { loading: confirming }] = useMutation(CONFIRM_BOARD_ITEMS);
  // "Confirm all except": the scope ('all' or a ticket key) and the items the owner keeps open.
  const [batchScope, setBatchScope] = useState<string | null>(null);
  const [excepted, setExcepted] = useState<Set<string>>(new Set());
  const [showConflictModal, setShowConflictModal] = useState(false);
  const [conflictMessage, setConflictMessage] = useState('');
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' | 'info' } | null>(null);

  if (isInitialQueryLoading(loading, data)) return <Page width="full"><LoadingSkeleton /></Page>;
  if (error && !data) return <Page width="full"><Card className="border-status-conflict text-status-conflict" role="alert">Error: {error.message}</Card></Page>;

  // Board mode: the board cards replace the agent's one-line "waiting" text for the same tickets.
  const items = (data?.needsAttention || []).filter((item: any) => !(board && item.type === 'AGENT_WAITING'));
  const boardItems: BoardItem[] = boardQuery.data?.boardItems || [];
  const boardGroups = groupItems(boardItems);
  const inBatch = (groupKey: string) => batchScope === 'all' || batchScope === groupKey;
  const batchItems = batchScope === 'all' ? boardItems : boardGroups.find((group) => group.key === batchScope)?.items ?? [];
  const plan = confirmPlan(batchItems, excepted);
  const refetchAnswers = () => { void refetchBoard(); void refetchJob(); };
  const button = writeButton({ pending: job?.pending ?? 0, running: running || starting, armedAt, now: armedAt ?? 0 });
  const pressWriteAnswers = async () => {
    const press = pressWrite(armedAt, Date.now());
    setArmedAt(press.armedAt);
    if (!press.run) return;
    setWriteNote(null);
    try {
      const result = (await writeAnswers()).data?.writeBoardAnswers;
      if (result && !result.started && !result.running) setWriteNote(result.error || 'Writing the answers did not start.');
      await Promise.all([refetchJob(), refetchBoard()]);
    } catch (failure) {
      setWriteNote(failure instanceof Error ? failure.message : 'Writing the answers did not start');
    }
  };
  const startBatch = (scope: string) => { setBatchScope(scope); setExcepted(new Set()); };
  const toggleExcept = (id: string) => setExcepted((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const runBatch = async () => {
    try {
      const res = await confirmBoardItems({ variables: { ids: plan.ids } });
      const { confirmed, skipped } = res.data?.confirmBoardItems ?? { confirmed: 0, skipped: [] };
      setToast({ message: `Confirmed ${confirmed}${skipped.length ? `, ${skipped.length} already answered` : ''}. sous writes them to the board on its next \`sous answer\`.`, type: 'success' });
      setBatchScope(null);
      refetchAnswers();
    } catch (failure) {
      setToast({ message: failure instanceof Error ? failure.message : 'Confirm failed', type: 'error' });
    }
  };
  const handleInspectConflict = async (owner: string, repo: string, pullNumber: number) => {
    try {
      const res = await checkConflicts({ variables: { owner, repo, pullNumber } });
      if (res.data?.checkConflicts?.hasConflict) {
        setConflictMessage(res.data.checkConflicts.message || 'Merge conflict detected in target branch.');
        setShowConflictModal(true);
      } else setToast({ message: 'No conflicts detected! Clean merge status.', type: 'success' });
    } catch {
      setToast({ message: 'Failed to inspect conflict details', type: 'error' });
    }
  };

  return (
    <Page width="full">
      <Card className="mb-8 border-status-conflict/60 bg-status-conflict-bg shadow-none">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="rounded-sm bg-status-conflict-bg p-4 text-status-conflict"><AlertTriangle size={36} aria-hidden="true" /></div>
            <div><h1 className="text-balance font-display text-2xl font-bold text-status-conflict">Needs Immediate Attention</h1><p className="mt-1 text-pretty text-secondary-foreground">Pull requests with merge conflicts, requested changes or failing checks, and tickets whose agent is waiting on you, failed a check or went quiet.</p></div>
          </div>
          {board && (
            <Button size="sm" variant="primary" disabled={button.disabled} onClick={() => void pressWriteAnswers()}>
              <PenLine size={14} aria-hidden="true" />{button.label}
            </Button>
          )}
        </div>
      </Card>
      {/* The server keeps the last failure until the next run succeeds, so it only counts once the run is over. */}
      {board && !running && job?.lastError && <Card className="mb-4 border-status-conflict text-status-conflict" role="alert">Writing answers failed: {job.lastError}</Card>}
      {board && writeNote && <Card className="mb-4 border-amber-300/50" role="status">{writeNote}</Card>}

      {board && boardGroups.length > 0 && (
        <section className="mb-8 flex flex-col gap-6" aria-label="On the board">
          <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-bold">On the board</h2>
            <p className="mt-1 text-pretty text-sm text-secondary-foreground">Issues waiting on you and decisions sous made on your behalf. The work already continued on the option marked built: confirm it, or pick another and the ticket gets a revision.</p>
          </div>
          {batchScope === null && <Button size="sm" onClick={() => startBatch('all')}>Confirm all except…</Button>}
          </div>
          {batchScope !== null && (
            <Card className="sticky top-2 z-10 flex flex-wrap items-center justify-between gap-3 border-border-glow" role="region" aria-label="Confirm all except">
              <p className="text-sm">
                <b>{plan.ids.length}</b> will be confirmed as built{batchScope !== 'all' ? ` for ${batchScope}` : ''} · <b>{plan.kept}</b> kept open{plan.answered ? ` · ${plan.answered} already answered` : ''}. Tick the ones to keep open.
              </p>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => setBatchScope(null)}>Cancel</Button>
                <Button size="sm" variant="primary" disabled={confirming || plan.ids.length === 0} onClick={() => void runBatch()}>{confirming ? 'Confirming…' : `Confirm ${plan.ids.length}`}</Button>
              </div>
            </Card>
          )}
          {boardGroups.map((group) => (
            <div key={group.key} className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-mono text-sm font-bold">{group.key} <span className="font-normal text-muted-foreground">· {group.epic} · {group.items.length}</span></h3>
                {batchScope === null && group.items.length > 1 && <Button size="sm" variant="ghost" onClick={() => startBatch(group.key)}>Confirm all except…</Button>}
              </div>
              {group.items.map((item) => (
                <BoardItemCard
                  key={item.id}
                  item={item}
                  onSaved={refetchAnswers}
                  except={inBatch(group.key) ? { checked: excepted.has(item.id), onToggle: () => toggleExcept(item.id) } : undefined}
                />
              ))}
            </div>
          ))}
        </section>
      )}
      {boardQuery.error && <Card className="mb-4 border-status-conflict text-status-conflict" role="alert">Board items failed to load: {boardQuery.error.message}</Card>}

      {items.length === 0 && boardGroups.length > 0 ? null : items.length === 0 ? (
        <Card><EmptyState scene={<AllClearScene />} title={<span className="text-status-merged">All clear</span>} description="No merge conflicts, and no agent is waiting on you." /></Card>
      ) : (
        <div className="flex flex-col gap-4">
          {items.map((item: any) => agentLabel[item.type] ? (
            <Card key={item.id} className={cn('flex flex-wrap items-center justify-between gap-4', item.type === 'AGENT_WAITING' ? 'border-amber-300/45' : 'border-status-conflict/40')}>
              <div className="flex min-w-0 items-center gap-4">
                <Badge variant={item.type === 'AGENT_WAITING' ? 'neutral' : 'danger'} className={cn('shrink-0 gap-1.5 px-3.5 py-2.5 text-sm', item.type === 'AGENT_WAITING' && 'border-amber-300/45 bg-amber-300/10 text-amber-200')}>{item.type === 'AGENT_WAITING' ? <Hand size={16} aria-hidden="true" /> : <Bot size={16} aria-hidden="true" />}<span>{item.ticketKey}</span></Badge>
                <div className="min-w-0"><p className="font-mono text-[0.68rem] font-extrabold text-muted-foreground">AGENT · {agentLabel[item.type]}</p><h3 className="text-pretty text-lg font-medium">{item.message}</h3></div>
              </div>
              {item.ticketKey && <Button size="sm" variant="primary" onClick={() => onTicketClick(item.ticketKey)}>Inspect Ticket</Button>}
            </Card>
          ) : <Card key={item.id} className="flex flex-wrap items-center justify-between gap-4 border-status-conflict/40">
            <div className="flex min-w-0 items-center gap-4">
              <Badge variant="danger" className="shrink-0 gap-1.5 px-3.5 py-2.5 text-sm"><AlertTriangle size={16} aria-hidden="true" /><span>{item.ticketKey || 'PULL REQUEST'}</span></Badge>
              <div className="min-w-0"><h3 className="text-balance text-lg font-medium">{item.message}</h3>{item.prUrl && <a href={item.prUrl} target="_blank" rel="noreferrer" className="mt-0.5 flex min-h-6 items-center gap-1 truncate font-mono text-sm text-accent hover:underline"><ExternalLink size={14} className="shrink-0" aria-hidden="true" /><span className="truncate">{item.prUrl}</span></a>}</div>
            </div>
            <div className="flex items-center gap-2">
              {item.type === 'CONFLICT' && item.owner && item.repo && item.pullNumber && <Button size="sm" variant="danger" onClick={() => handleInspectConflict(item.owner, item.repo, item.pullNumber)}><GitMerge size={16} aria-hidden="true" />Inspect File Conflict</Button>}
              {item.ticketKey && <Button size="sm" variant="primary" onClick={() => onTicketClick(item.ticketKey)}>Inspect Ticket</Button>}
            </div>
          </Card>)}
        </div>
      )}
      {showConflictModal && <ConflictModal isOpen={showConflictModal} message={conflictMessage} onClose={() => setShowConflictModal(false)} />}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </Page>
  );
};

export default NeedsAttentionPage;
