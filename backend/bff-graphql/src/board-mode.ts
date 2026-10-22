/**
 * Board mode: DOCK is a window onto a blackboard that another tool (sous) owns. The board holds the ticket state,
 * so DOCK never starts work, never moves Jira and never posts to Discord itself, and it always asks for the PIN.
 * Off unless DOCK_BOARD_MODE is set, so a DOCK without it behaves as before.
 */
export function boardMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return /^(1|true|yes|on)$/i.test(env.DOCK_BOARD_MODE?.trim() ?? '');
}

/** Approving reviews a pull request needs before DOCK calls it approved. Board mode defaults to the team's two. */
export function requiredApprovals(env: NodeJS.ProcessEnv = process.env): number {
  const configured = Number(env.DOCK_REQUIRED_APPROVALS?.trim());
  if (Number.isInteger(configured) && configured >= 1 && configured <= 10) return configured;
  return boardMode(env) ? 2 : 1;
}

export class BoardModeError extends Error {}

/** Throws when board mode is on; `what` names the action in the message the UI shows. */
export function refuseInBoardMode(what: string, env: NodeJS.ProcessEnv = process.env): void {
  if (boardMode(env)) throw new BoardModeError(`${what} is off in board mode: the blackboard and sous handle it`);
}
