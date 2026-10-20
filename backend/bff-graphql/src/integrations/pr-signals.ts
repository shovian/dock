export type ReviewDecision = 'changes_requested' | 'approved' | 'none';
export type ChecksState = 'failing' | 'pending' | 'passing' | 'none';
export interface PullRequestSignal { reviewDecision: ReviewDecision; checks: ChecksState }

import { requiredApprovals } from '../board-mode';

interface ReviewLike { state?: string; user?: { login?: string } | null }

/**
 * The latest approving or requesting review of each reviewer decides; comments change nothing and a dismissal withdraws that reviewer's vote.
 * Approved needs `required` reviewers approving (DOCK_REQUIRED_APPROVALS; two in board mode).
 */
export function reviewDecisionOf(reviews: ReviewLike[], required = requiredApprovals()): ReviewDecision {
  const votes = new Map<string, string>();
  for (const review of reviews) {
    const reviewer = review.user?.login || 'unknown';
    const state = String(review.state || '').toUpperCase();
    if (state === 'APPROVED' || state === 'CHANGES_REQUESTED') votes.set(reviewer, state);
    else if (state === 'DISMISSED') votes.delete(reviewer);
  }
  const standing = [...votes.values()];
  if (standing.includes('CHANGES_REQUESTED')) return 'changes_requested';
  return standing.filter((state) => state === 'APPROVED').length >= required ? 'approved' : 'none';
}

interface CheckRunLike { status?: string; conclusion?: string | null }

const RANK: Record<ChecksState, number> = { none: 0, passing: 1, pending: 2, failing: 3 };
const worst = (...states: ChecksState[]): ChecksState => states.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), 'none' as ChecksState);

export function checkRunsState(runs: CheckRunLike[]): ChecksState {
  return worst(...runs.map((run): ChecksState => {
    if (run.status !== 'completed') return 'pending';
    const conclusion = String(run.conclusion || '').toLowerCase();
    if (['failure', 'cancelled', 'timed_out'].includes(conclusion)) return 'failing';
    return ['success', 'neutral', 'skipped'].includes(conclusion) ? 'passing' : 'pending';
  }));
}

/** The combined commit status for repositories whose CI reports statuses instead of check runs. */
export function commitStatusState(status: { state?: string; total_count?: number } | null | undefined): ChecksState {
  if (!status || !status.total_count) return 'none';
  if (status.state === 'failure' || status.state === 'error') return 'failing';
  if (status.state === 'pending') return 'pending';
  return status.state === 'success' ? 'passing' : 'none';
}

export const combineChecks = (...states: ChecksState[]): ChecksState => worst(...states);

export type ReviewSignal = 'changes_requested' | 'checks_failing' | 'checks_pending' | 'approved';

interface SignalPullRequest { status: string; reviewDecision?: ReviewDecision | null; checks?: ChecksState | null }

/** One word for a run's open pull requests: changes requested, then failing checks, then running checks, then approved. */
export function reviewSignalOf(pullRequests: SignalPullRequest[]): ReviewSignal | null {
  const open = pullRequests.filter((pr) => pr.status === 'open' || pr.status === 'draft');
  if (open.some((pr) => pr.reviewDecision === 'changes_requested')) return 'changes_requested';
  if (open.some((pr) => pr.checks === 'failing')) return 'checks_failing';
  if (open.some((pr) => pr.checks === 'pending')) return 'checks_pending';
  return open.length > 0 && open.every((pr) => pr.reviewDecision === 'approved') ? 'approved' : null;
}
