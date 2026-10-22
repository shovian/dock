/** Board items: blackboard entries that wait on the owner, and the owner's answers to them. */

export interface BoardOption { key: string; label: string; effect: string | null; built: boolean }
export interface BoardAsk { question: string; options: BoardOption[] }
export interface BoardAnswerPart { ask: number; choice: string | null; text: string | null }
export interface BoardItem {
  id: string;
  epic: string;
  kind: 'issue' | 'decision';
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
  pending: BoardAnswerPart[] | null;
  keepsBuilt: boolean | null;
  answeredAt: string | null;
}

/** The answer to a decision without asks that keeps what sous built. */
export const CONFIRM = 'confirm';

/** What the owner has picked or typed so far, per ask. An empty choice with text means "Other". */
export interface DraftPart { choice: string | null; other: boolean; text: string }
export type Draft = DraftPart[];

/** The questions a card shows: the item's asks, or a single confirm/change question for a decision without asks. */
export function questionsOf(item: BoardItem): BoardAsk[] {
  if (item.asks.length) return item.asks;
  return [{ question: 'Keep this decision?', options: [{ key: CONFIRM, label: 'Confirm', effect: 'nothing changes', built: true }] }];
}

/** A new draft, or the pending answer when the owner already answered. */
export function draftOf(item: BoardItem): Draft {
  return questionsOf(item).map((_, ask) => {
    const part = item.pending?.find((entry) => entry.ask === ask);
    if (part?.text) return { choice: null, other: true, text: part.text };
    return { choice: part?.choice ?? null, other: false, text: '' };
  });
}

/** The parts to send, or the reason the draft cannot be sent yet. */
export function answerOf(item: BoardItem, draft: Draft): { parts: BoardAnswerPart[] } | { error: string } {
  const questions = questionsOf(item);
  const parts: BoardAnswerPart[] = [];
  for (let ask = 0; ask < questions.length; ask += 1) {
    const part = draft[ask];
    const label = questions.length > 1 ? `Question ${ask + 1}` : 'The question';
    if (part?.other) {
      const text = part.text.trim();
      if (!text) return { error: `${label}: write your answer, or pick an option` };
      parts.push({ ask, choice: null, text });
    } else if (part?.choice) {
      parts.push({ ask, choice: part.choice, text: null });
    } else {
      return { error: `${label}: pick an option or write your own` };
    }
  }
  return { parts };
}

/** True when sending this draft keeps everything sous built (no revision). */
export function draftKeepsBuilt(item: BoardItem, draft: Draft): boolean {
  return questionsOf(item).every((question, ask) => {
    const part = draft[ask];
    return Boolean(part && !part.other && question.options.find((option) => option.key === part.choice)?.built);
  });
}

/** Items grouped by ticket (an item without a ticket goes under its epic), escalated groups first, keeping the server's order inside. */
export function groupItems(items: BoardItem[]): Array<{ key: string; epic: string; items: BoardItem[] }> {
  const groups = new Map<string, { key: string; epic: string; items: BoardItem[] }>();
  for (const item of items) {
    const key = item.tickets[0] ?? item.epic;
    if (!groups.has(key)) groups.set(key, { key, epic: item.epic, items: [] });
    groups.get(key)!.items.push(item);
  }
  return [...groups.values()].sort((a, b) => Number(b.items.some((item) => item.escalated)) - Number(a.items.some((item) => item.escalated)));
}

/** The line under a card once the owner answered. */
export function pendingNote(item: BoardItem): string | null {
  if (!item.pending) return null;
  return item.keepsBuilt
    ? 'Answer saved: keeps what sous built. sous writes it to the board on its next `sous answer`.'
    : 'Answer saved: differs from what sous built, so the ticket gets a revision. sous writes it to the board on its next `sous answer`.';
}
