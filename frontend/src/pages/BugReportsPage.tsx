import React, { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { Bug, RefreshCw } from 'lucide-react';
import { BOARD_THREADS } from '../graphql/queries';
import { DISMISS_BOARD_THREAD, REFRESH_BOARD_THREADS } from '../graphql/mutations';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { EmptyState } from '../components/EmptyState';
import { AllClearScene } from '../components/empty/scenes/AllClearScene';
import { ThreadRow } from '../components/ThreadRow';
import { Button, Card, Page } from '../components/ui';
import { CACHED_QUERY_OPTIONS, isInitialQueryLoading } from '../lib/queryPolicy';
import { cn } from '../lib/cn';
import { relativeTime } from '../chat/messages';
import { groupThreads, newestFirst, type BoardThread, type ThreadTab } from '../lib/boardThreads';

const TABS: { id: ThreadTab; label: string }[] = [
  { id: 'needs', label: 'Needs you' },
  { id: 'bugreport', label: 'Bug report' },
  { id: 'uat-bug-report', label: 'UAT bug report' },
  { id: 'pull-request', label: 'Pull request' },
  { id: 'review', label: 'Review asked' },
];

const POLL_WHILE_REFRESHING_MS = 3000;

const Fold: React.FC<{ title: string; rows: BoardThread[]; render: (row: BoardThread) => React.ReactNode }> = ({ title, rows, render }) => (
  rows.length === 0 ? null : (
    <details className="group">
      <summary className="cursor-pointer select-none py-2 text-sm font-medium text-secondary-foreground hover:text-foreground">{title} ({rows.length})</summary>
      <div className="mt-2 flex flex-col gap-3">{rows.map(render)}</div>
    </details>
  )
);

const BugReportsPage: React.FC = () => {
  const { data, loading, error, refetch, startPolling, stopPolling } = useQuery(BOARD_THREADS, CACHED_QUERY_OPTIONS);
  const [refresh, { loading: starting }] = useMutation(REFRESH_BOARD_THREADS);
  const [dismiss] = useMutation(DISMISS_BOARD_THREAD);
  const [tab, setTab] = useState<ThreadTab>('needs');
  const [refreshNote, setRefreshNote] = useState<string | null>(null);
  const [dismissing, setDismissing] = useState<Set<string>>(new Set());
  const [dismissError, setDismissError] = useState<string | null>(null);

  // Relative times tick over while the page stays open.
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const page = data?.boardThreads;
  const refreshing = page?.refreshing === true;
  // The server runs the refresh on its own; ask again every few seconds until it says it is done.
  useEffect(() => {
    if (refreshing) startPolling(POLL_WHILE_REFRESHING_MS); else stopPolling();
    return stopPolling;
  }, [refreshing, startPolling, stopPolling]);

  if (isInitialQueryLoading(loading, data)) return <Page width="full"><LoadingSkeleton /></Page>;
  if (error && !page) return <Page width="full"><Card className="border-status-conflict text-status-conflict" role="alert">Error: {error.message}</Card></Page>;

  const rows: BoardThread[] = page?.rows ?? [];
  const groups = groupThreads(rows, tab);
  const older = newestFirst(groups.older);

  const startRefresh = async () => {
    setRefreshNote(null);
    try {
      const res = await refresh();
      const result = res.data?.refreshBoardThreads;
      if (result && !result.started) setRefreshNote(result.error || (result.running ? 'A refresh is already running.' : 'The refresh did not start.'));
      await refetch();
    } catch (failure) {
      setRefreshNote(failure instanceof Error ? failure.message : 'The refresh did not start');
    }
  };
  const dismissThread = async (id: string) => {
    setDismissError(null);
    setDismissing((current) => new Set(current).add(id));
    try {
      await dismiss({ variables: { id } });
      await refetch();
    } catch (failure) {
      setDismissError(failure instanceof Error ? failure.message : 'The thread was not dismissed');
    } finally {
      setDismissing((current) => { const next = new Set(current); next.delete(id); return next; });
    }
  };
  const renderRow = (row: BoardThread) => (
    <ThreadRow key={row.id} thread={row} now={now} dismissing={dismissing.has(row.id)} onDismiss={() => void dismissThread(row.id)} />
  );

  return (
    <Page width="full">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="rounded-sm bg-accent-dim p-3 text-accent"><Bug size={28} aria-hidden="true" /></div>
          <div>
            <h1 className="text-balance font-display text-2xl font-bold">Bug Reports</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              {page?.syncedAt ? `synced ${relativeTime(page.syncedAt, now)}` : 'not synced yet'}
              {' · '}
              {page?.jiraSnapshotAt ? `Jira snapshot ${relativeTime(page.jiraSnapshotAt, now)}` : 'no Jira snapshot'}
            </p>
          </div>
        </div>
        <Button size="sm" variant="primary" disabled={refreshing || starting} onClick={() => void startRefresh()}>
          <RefreshCw size={14} className={cn((refreshing || starting) && 'animate-spin')} aria-hidden="true" />{refreshing || starting ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>
      {/* The server keeps the last failure until the next run succeeds, so it only counts once the run is over. */}
      {!refreshing && page?.refreshError && <Card className="mb-4 border-status-conflict text-status-conflict" role="alert">Refresh failed: {page.refreshError}</Card>}
      {refreshNote && <Card className="mb-4 border-amber-300/50" role="status">{refreshNote}</Card>}
      {dismissError && <Card className="mb-4 border-status-conflict text-status-conflict" role="alert">{dismissError}</Card>}

      <div role="tablist" aria-label="Forum" className="mb-6 flex flex-wrap gap-2">
        {TABS.map(({ id, label }) => {
          const count = groupThreads(rows, id).main.length;
          return (
            <Button key={id} role="tab" aria-selected={tab === id} size="sm" variant={tab === id ? 'primary' : 'default'} onClick={() => setTab(id)}>
              {label}{count > 0 && <span className="font-mono tabular-nums">{count}</span>}
            </Button>
          );
        })}
      </div>

      <div role="tabpanel" className="flex flex-col gap-4">
        {groups.main.length === 0 && older.length === 0 && groups.folded.length === 0 ? (
          <Card><EmptyState scene={<AllClearScene />} title={<span className="text-status-merged">All clear</span>} description="No forum threads here yet." /></Card>
        ) : groups.main.length === 0 ? (
          <Card><EmptyState size="panel" scene={<AllClearScene />} title="Nothing needs you here" /></Card>
        ) : (
          <div className="flex flex-col gap-3">{groups.main.map(renderRow)}</div>
        )}
        <Fold title="Older" rows={older} render={renderRow} />
        <Fold title="Other" rows={groups.folded} render={renderRow} />
      </div>
    </Page>
  );
};

export default BugReportsPage;
