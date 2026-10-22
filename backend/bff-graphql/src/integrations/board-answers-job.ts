import { boardMode } from '../board-mode';
import type { BoardService } from './board';
import { FixedJobRunner, execRun, type JobSpec, type JobStart, type RunScript } from './fixed-job';

/**
 * The "Write answers to board" button of Needs Attention: runs `sous answer`, which pulls the owner's answers from this
 * server, writes the `**Jawaban owner:**` lines to the board files, acknowledges them here and resyncs the board items.
 * Exit 1 of that command covers a failed pull and answers that could not be written or acknowledged; those stay in DOCK.
 */

const ANSWER: JobSpec = {
  args: ['answer'],
  exitMessages: { 1: 'answers not fully written; unwritten ones stay in DOCK' },
  failed: (code) => `answers failed (exit ${code})`,
  timedOut: 'answers timed out',
  couldNotStart: 'could not start sous answer',
  notConfigured: 'not configured',
};

export class AnswerWriter extends FixedJobRunner {
  constructor(run: RunScript, scriptPath: string | null, port: number, env: NodeJS.ProcessEnv = process.env) {
    super(ANSWER, run, scriptPath, port, env);
  }
}

export interface AnswerJobStatus { pending: number; running: boolean; lastError: string | null }

export async function answerJobStatus(board: Pick<BoardService, 'pendingAnswerCount'>, writer: AnswerWriter, env: NodeJS.ProcessEnv = process.env): Promise<AnswerJobStatus> {
  if (!boardMode(env)) return { pending: 0, running: false, lastError: null };
  return { pending: await board.pendingAnswerCount(), ...writer.status() };
}

export function startAnswerJob(writer: AnswerWriter, env: NodeJS.ProcessEnv = process.env): JobStart {
  return boardMode(env) ? writer.start() : { started: false, running: false, error: 'not configured' };
}

/** The one writer of this server. The script is `~/.claude/sous/sous`; unset, the button is off. */
export const answerWriter = new AnswerWriter(execRun, process.env.DOCK_ANSWER_SYNC?.trim() || null, Number(process.env.PORT || 4000));
