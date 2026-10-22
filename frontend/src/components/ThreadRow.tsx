import React from 'react';
import { ExternalLink } from 'lucide-react';
import { Badge, Button, Card } from './ui';
import { cn } from '../lib/cn';
import { relativeTime } from '../chat/messages';
import { STATE_LABEL, type BoardThread } from '../lib/boardThreads';

/** One Discord forum thread that sous discord-sync sent. Dismiss moves it out of the way, under Other. */
export const ThreadRow: React.FC<{ thread: BoardThread; now: number; dismissing: boolean; onDismiss: () => void }> = ({ thread, now, dismissing, onDismiss }) => {
  const active = thread.needsYou && !thread.dismissed;
  return (
    <Card className={cn('flex flex-col gap-2', active ? 'border-border' : 'opacity-80')} aria-label={thread.title}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={active ? 'warn' : 'neutral'}>{STATE_LABEL[thread.state] ?? thread.state}</Badge>
        <Badge>{thread.forum}</Badge>
        {thread.dismissed && <Badge>Dismissed</Badge>}
        {thread.tickets.map((ticket) => (
          <Badge key={ticket.key} variant="accent">{ticket.key}{ticket.status ? ` · ${ticket.status}` : ''}</Badge>
        ))}
        {thread.approvals && <Badge variant={thread.approvals.have >= thread.approvals.need ? 'success' : 'neutral'}>approvals {thread.approvals.have}/{thread.approvals.need}</Badge>}
        {thread.slots && <Badge variant={thread.slots.have >= thread.slots.need ? 'success' : 'neutral'}>slots {thread.slots.have}/{thread.slots.need}</Badge>}
      </div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 className="min-w-0 text-pretty text-base font-semibold">
          <a href={thread.url} target="_blank" rel="noreferrer" className="inline-flex items-start gap-1.5 hover:underline">
            <span>{thread.title}</span><ExternalLink size={14} className="mt-1 shrink-0" aria-hidden="true" />
          </a>
        </h3>
        {!thread.dismissed && <Button size="sm" variant="ghost" disabled={dismissing} onClick={onDismiss}>{dismissing ? 'Dismissing…' : 'Dismiss'}</Button>}
      </div>
      {thread.why && <p className="text-pretty text-sm text-secondary-foreground">{thread.why}</p>}
      <p className="text-xs text-muted-foreground">Last activity {relativeTime(thread.lastActivity, now) || 'unknown'}</p>
    </Card>
  );
};
