/** Board threads: Discord forum threads that sous discord-sync sent, grouped for the Bug Reports page. */

export type ThreadTab = 'needs' | 'bugreport' | 'uat-bug-report' | 'pull-request' | 'review';

export interface BoardThreadTicket { key: string; status: string | null; assignee: string | null }
export interface BoardThreadApprovals { have: number; need: number }
export interface BoardThread {
  id: string;
  forum: string;
  title: string;
  url: string;
  state: string;
  why: string;
  needsYou: boolean;
  older: boolean;
  createdAt: string;
  lastActivity: string;
  tags: string[];
  tickets: BoardThreadTicket[];
  prs: string[];
  approvals: BoardThreadApprovals | null;
  lastMessage: string;
  dismissed: boolean;
}

/** Where a thread stands, most urgent first. A state missing here sorts last. */
export const STATE_ORDER: string[] = [
  'FLOW_1', 'FLOW_2', 'FLOW_3', 'FLOW_4', 'YOUR_TURN', 'FLOW_5', 'REVIEW_ASKED',
  'YOURS_IN_PROGRESS', 'TAKEN', 'WAITING_ON_REPORTER', 'HANDLED', 'QUIET', 'CLOSED', 'NOT_YOURS',
];

export const STATE_LABEL: Record<string, string> = {
  FLOW_1: 'New bug',
  FLOW_2: 'Bug, mentions you',
  FLOW_3: 'UAT bug',
  FLOW_4: 'UAT bug, mentions you',
  YOUR_TURN: 'Your turn',
  FLOW_5: 'Comment on your PR',
  REVIEW_ASKED: 'Review asked',
  YOURS_IN_PROGRESS: 'Yours, in progress',
  TAKEN: 'Taken',
  WAITING_ON_REPORTER: 'Waiting on reporter',
  HANDLED: 'Handled',
  QUIET: 'Quiet',
  CLOSED: 'Closed',
  NOT_YOURS: 'Not yours',
};

const rank = (state: string): number => {
  const i = STATE_ORDER.indexOf(state);
  return i === -1 ? STATE_ORDER.length : i;
};

const time = (iso: string): number => {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? 0 : ms;
};

/**
 * Splits the rows of one tab into what needs the owner now (`main`), what needs them but went quiet (`older`)
 * and everything else, dismissed rows included (`folded`). The tab narrows the rows before they are split.
 */
export function groupThreads(rows: BoardThread[], tab: ThreadTab): { main: BoardThread[]; older: BoardThread[]; folded: BoardThread[] } {
  const inTab = rows.filter((r) => (tab === 'needs' ? true : tab === 'review' ? r.state === 'REVIEW_ASKED' : r.forum === tab));
  const live = (r: BoardThread) => r.needsYou && !r.dismissed;
  const main = inTab.filter((r) => live(r) && !r.older).sort((a, b) => rank(a.state) - rank(b.state) || time(b.lastActivity) - time(a.lastActivity));
  const older = inTab.filter((r) => live(r) && r.older);
  const folded = inTab.filter((r) => !live(r));
  return { main, older, folded };
}
