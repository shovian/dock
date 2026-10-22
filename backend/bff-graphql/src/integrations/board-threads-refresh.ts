import { FixedJobRunner, SYNC_TIMEOUT_MS, SyncTimeoutError, execRun, type JobSpec, type JobStart, type RunScript } from './fixed-job';

/**
 * The Refresh button of Bug Reports: runs `sous discord-sync`, which reads Discord and Jira itself and sends the full
 * thread list back to this server's /ingest/orchestrator/board/threads. The Discord token stays with sous; DOCK only runs the script.
 * The runner is shared with the answers button (fixed-job.ts).
 */

export { SYNC_TIMEOUT_MS, SyncTimeoutError, execRun };
export type { RunScript };
export type RefreshStart = JobStart;

const REFRESH: JobSpec = {
  args: ['discord-sync'],
  exitMessages: { 1: 'DOCK refused the update', 2: 'fetch failed, list unchanged', 3: 'a sync is already running' },
  failed: (code) => `sync failed (exit ${code})`,
  timedOut: 'sync timed out',
  couldNotStart: 'could not start the sync',
  notConfigured: 'refresh not configured',
};

export class ThreadRefresher extends FixedJobRunner {
  constructor(run: RunScript, scriptPath: string | null, port: number, env: NodeJS.ProcessEnv = process.env) {
    super(REFRESH, run, scriptPath, port, env);
  }
}

/** The one refresher of this server. The script is `~/.claude/sous/sous`; unset, Refresh is off. */
export const threadRefresher = new ThreadRefresher(execRun, process.env.DOCK_DISCORD_SYNC?.trim() || null, Number(process.env.PORT || 4000));
