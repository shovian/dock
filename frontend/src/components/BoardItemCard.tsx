import React, { useState } from 'react';
import { useMutation } from '@apollo/client';
import { ExternalLink } from 'lucide-react';
import { ANSWER_BOARD_ITEM } from '../graphql/mutations';
import { Badge, Button, Card, Textarea } from './ui';
import { cn } from '../lib/cn';
import { answerOf, draftKeepsBuilt, draftOf, pendingNote, questionsOf, type BoardItem, type Draft } from '../lib/boardItems';

const MAX_TEXT = 2000;

/**
 * One blackboard entry that waits on the owner. Work already continued on the option marked "built",
 * so this is a confirm-or-change card, not a question that blocks a session: the answer is kept until
 * sous writes it to the board.
 */
export const BoardItemCard: React.FC<{ item: BoardItem; onSaved: () => void }> = ({ item, onSaved }) => {
  const [draft, setDraft] = useState<Draft>(() => draftOf(item));
  const [error, setError] = useState<string | null>(null);
  const [answer, { loading }] = useMutation(ANSWER_BOARD_ITEM);
  const questions = questionsOf(item);
  const change = (ask: number, next: Partial<Draft[number]>) => setDraft((current) => current.map((part, at) => (at === ask ? { ...part, ...next } : part)));
  const keeps = draftKeepsBuilt(item, draft);
  const ready = !('error' in answerOf(item, draft));
  const note = pendingNote(item);

  const submit = async () => {
    const result = answerOf(item, draft);
    if ('error' in result) { setError(result.error); return; }
    setError(null);
    try {
      await answer({ variables: { id: item.id, answers: result.parts } });
      onSaved();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The answer was not saved');
    }
  };

  return (
    <Card className={cn('flex flex-col gap-3', item.escalated ? 'border-amber-300/50' : 'border-border')} aria-label={`${item.ref}: ${item.title}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={item.kind === 'issue' ? 'warn' : 'accent'}>{item.ref}</Badge>
        {item.type && <Badge>{item.type}</Badge>}
        {item.kind === 'decision' && <Badge>SHOV</Badge>}
        {item.escalated && <Badge variant="danger">ESCALATED</Badge>}
        {item.prs.map((url) => (
          <a key={url} href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-xs text-secondary-foreground underline-offset-2 hover:underline">
            <ExternalLink size={12} aria-hidden="true" />PR #{url.split('/').pop()}
          </a>
        ))}
      </div>
      <h3 className="text-pretty text-base font-semibold">{item.title}</h3>
      {item.detail && <p className="line-clamp-3 text-pretty text-sm text-secondary-foreground" title={item.detail}>{item.detail}</p>}
      {item.blocks && <p className="text-xs text-muted-foreground">Blocks: {item.blocks}</p>}

      {questions.map((question, ask) => {
        const part = draft[ask];
        return (
          <fieldset key={ask} className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">{question.question}</legend>
            <div className="flex flex-wrap gap-2">
              {question.options.map((option) => {
                const picked = !part.other && part.choice === option.key;
                return (
                  <Button
                    key={option.key}
                    size="sm"
                    variant={picked ? 'primary' : 'default'}
                    aria-pressed={picked}
                    title={option.effect ?? undefined}
                    onClick={() => change(ask, { choice: option.key, other: false })}
                  >
                    {item.asks.length ? `(${option.key}) ` : ''}{option.label}{option.built && item.asks.length ? ' · built' : ''}
                  </Button>
                );
              })}
              <Button size="sm" variant={part.other ? 'primary' : 'default'} aria-pressed={part.other} onClick={() => change(ask, { other: true })}>
                {item.asks.length ? 'Other…' : 'Change…'}
              </Button>
            </div>
            {!part.other && part.choice && (() => {
              const effect = question.options.find((option) => option.key === part.choice)?.effect;
              return effect ? <p className="text-xs text-muted-foreground">If picked: {effect}</p> : null;
            })()}
            {part.other && (
              <Textarea
                aria-label={`Your answer to: ${question.question}`}
                value={part.text}
                maxLength={MAX_TEXT}
                rows={3}
                placeholder={item.asks.length ? 'Write your own answer' : 'What should change?'}
                onChange={(event) => change(ask, { text: event.target.value })}
              />
            )}
          </fieldset>
        );
      })}

      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="primary" disabled={loading} onClick={() => void submit()}>
          {loading ? 'Saving…' : !ready ? 'Answer' : keeps ? 'Confirm' : 'Send revision'}
        </Button>
        {item.source && <span className="font-mono text-[0.68rem] text-muted-foreground">{item.source}</span>}
        {item.findings && <span className="font-mono text-[0.68rem] text-muted-foreground">{item.findings}</span>}
      </div>
      {error && <p className="text-sm text-status-conflict" role="alert">{error}</p>}
      {note && !error && <p className="text-xs text-status-merged">{note}</p>}
    </Card>
  );
};
