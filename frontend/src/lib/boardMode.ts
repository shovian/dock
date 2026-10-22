import { createContext, useContext } from 'react';

/**
 * Board mode (DOCK_BOARD_MODE on the server): DOCK shows a blackboard that sous owns.
 * The UI then leaves out what would act behind the board's back: the cron, chat replies,
 * Stop all, Confirm and start, the ticket Session button and the Discord broadcast.
 */
export const BoardModeContext = createContext<boolean>(false);

export const useBoardMode = () => useContext(BoardModeContext);

/** Where the owner answers a waiting ticket. */
export const answerHint = (board: boolean, here: boolean, place: string) => (board
  ? 'Answer on the board; sous picks it up in a fresh session.'
  : `${here ? 'Answer here, or' : 'Answer'} in the Claude Code session on ${place}.`);
