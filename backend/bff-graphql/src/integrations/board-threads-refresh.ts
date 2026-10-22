import { execFile } from 'node:child_process';
import { boardMode } from '../board-mode';

/**
 * The Refresh button of Bug Reports: runs `sous discord-sync`, which reads Discord and Jira itself and sends the full
 * thread list back to this server's /ingest/orchestrator/board/threads. The Discord token stays with sous; DOCK only runs the script.
 * The command and its arguments are fixed, so nothing from a request reaches the child.
 */

export type RunScript = (cmd: string, args: string[], env: NodeJS.ProcessEnv) => Promise<{ code: number; output: string }>;
export interface RefreshStart { started: boolean; running: boolean; error: string | null }

/** A cold sync takes about three minutes, a warm one one minute. */
export const SYNC_TIMEOUT_MS = 300_000;

export class SyncTimeoutError extends Error {}
class SyncSpawnError extends Error {}

/** Resolves with the exit code of a script that ran; rejects when it could not start or ran out of time. */
export const execRun: RunScript = (cmd, args, env) => new Promise((resolve, reject) => {
  execFile(cmd, args, { env, timeout: SYNC_TIMEOUT_MS, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
    const output = `${stdout}${stderr}`;
    if (!error) return resolve({ code: 0, output });
    const failure = error as NodeJS.ErrnoException & { killed?: boolean };
    if (failure.killed) return reject(new SyncTimeoutError());
    if (typeof failure.code === 'number') return resolve({ code: failure.code, output });
    reject(new SyncSpawnError());
  });
});

const EXIT_MESSAGES: Record<number, string> = { 1: 'DOCK refused the update', 2: 'fetch failed, list unchanged', 3: 'a sync is already running' };

export class ThreadRefresher {
  private running = false;
  private lastError: string | null = null;

  constructor(
    private readonly run: RunScript,
    private readonly scriptPath: string | null,
    private readonly port: number,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  /** Starts one sync, or reports the one already running. Never waits for it. */
  start(): RefreshStart {
    if (!this.scriptPath || !boardMode(this.env)) return { started: false, running: false, error: 'refresh not configured' };
    // Single flight: a second press, or a second tab, while sync runs spawns nothing.
    if (this.running) return { started: false, running: true, error: null };
    this.running = true;
    // DOCK's own environment, so sous sees the same home and token file; only the sync URL is set here.
    const env = { ...this.env, DOCK_SYNC_URL: `http://127.0.0.1:${this.port}` };
    // A run that throws before it returns a promise is a failed run too, not a stuck guard.
    new Promise<{ code: number; output: string }>((resolve) => resolve(this.run(this.scriptPath as string, ['discord-sync'], env)))
      .then(({ code }) => { this.lastError = code === 0 ? null : EXIT_MESSAGES[code] ?? `sync failed (exit ${code})`; })
      .catch((error) => { this.lastError = error instanceof SyncTimeoutError ? 'sync timed out' : 'could not start the sync'; })
      .finally(() => { this.running = false; });
    return { started: true, running: true, error: null };
  }

  status(): { running: boolean; lastError: string | null } {
    return { running: this.running, lastError: this.lastError };
  }
}

/** The one refresher of this server. The script is `~/.claude/sous/sous`; unset, Refresh is off. */
export const threadRefresher = new ThreadRefresher(execRun, process.env.DOCK_DISCORD_SYNC?.trim() || null, Number(process.env.PORT || 4000));
