import { execFile } from 'node:child_process';
import { boardMode } from '../board-mode';

/**
 * A fixed sous command that DOCK runs for a button (Refresh, Write answers). The command and its arguments are fixed,
 * so nothing from a request reaches the child, and what the child prints never goes back to the client.
 */

export type RunScript = (cmd: string, args: string[], env: NodeJS.ProcessEnv) => Promise<{ code: number; output: string }>;
export interface JobStart { started: boolean; running: boolean; error: string | null }

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

export interface JobSpec {
  args: string[];
  /** Short messages for the exit codes the command documents. */
  exitMessages: Record<number, string>;
  /** The message for any other non-zero exit. */
  failed: (code: number) => string;
  timedOut: string;
  couldNotStart: string;
  notConfigured: string;
}

export class FixedJobRunner {
  private running = false;
  private lastError: string | null = null;

  constructor(
    private readonly spec: JobSpec,
    private readonly run: RunScript,
    private readonly scriptPath: string | null,
    private readonly port: number,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  /** Starts one run, or reports the one already running. Never waits for it. */
  start(): JobStart {
    if (!this.scriptPath || !boardMode(this.env)) return { started: false, running: false, error: this.spec.notConfigured };
    // Single flight: a second press, or a second tab, while the job runs spawns nothing.
    if (this.running) return { started: false, running: true, error: null };
    this.running = true;
    // DOCK's own environment, so sous sees the same home and token file; only the sync URL is set here.
    const env = { ...this.env, DOCK_SYNC_URL: `http://127.0.0.1:${this.port}` };
    // A run that throws before it returns a promise is a failed run too, not a stuck guard.
    new Promise<{ code: number; output: string }>((resolve) => resolve(this.run(this.scriptPath as string, this.spec.args, env)))
      .then(({ code }) => { this.lastError = code === 0 ? null : this.spec.exitMessages[code] ?? this.spec.failed(code); })
      .catch((error) => { this.lastError = error instanceof SyncTimeoutError ? this.spec.timedOut : this.spec.couldNotStart; })
      .finally(() => { this.running = false; });
    return { started: true, running: true, error: null };
  }

  status(): { running: boolean; lastError: string | null } {
    return { running: this.running, lastError: this.lastError };
  }
}
