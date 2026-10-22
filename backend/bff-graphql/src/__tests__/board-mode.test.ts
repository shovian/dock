import assert from 'node:assert';
import test from 'node:test';
import type { Request } from 'express';
import { boardMode, BoardModeError, refuseInBoardMode, requiredApprovals } from '../board-mode';
import { shouldRequirePin } from '../auth/session';
import { reviewDecisionOf } from '../integrations/pr-signals';
import { JiraAPI } from '../datasources/JiraAPI';

const withEnv = async (values: Record<string, string | undefined>, run: () => unknown | Promise<unknown>) => {
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  try { await run(); } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
};

test('board mode is off unless DOCK_BOARD_MODE is set to a yes value', () => {
  assert.strictEqual(boardMode({}), false);
  assert.strictEqual(boardMode({ DOCK_BOARD_MODE: '0' }), false);
  assert.strictEqual(boardMode({ DOCK_BOARD_MODE: 'no' }), false);
  for (const yes of ['1', 'true', 'YES', ' on ']) assert.strictEqual(boardMode({ DOCK_BOARD_MODE: yes }), true, yes);
});

test('required approvals: one by default, two in board mode, an explicit number wins', () => {
  assert.strictEqual(requiredApprovals({}), 1);
  assert.strictEqual(requiredApprovals({ DOCK_BOARD_MODE: '1' }), 2);
  assert.strictEqual(requiredApprovals({ DOCK_BOARD_MODE: '1', DOCK_REQUIRED_APPROVALS: '3' }), 3);
  assert.strictEqual(requiredApprovals({ DOCK_REQUIRED_APPROVALS: '0' }), 1, 'out of range falls back');
  assert.strictEqual(requiredApprovals({ DOCK_REQUIRED_APPROVALS: 'x' }), 1);
});

test('refuseInBoardMode throws only in board mode', () => {
  assert.doesNotThrow(() => refuseInBoardMode('Posting to Discord', {}));
  assert.throws(() => refuseInBoardMode('Posting to Discord', { DOCK_BOARD_MODE: '1' }), BoardModeError);
});

const review = (login: string, state: string) => ({ user: { login }, state });

test('a pull request needs the required number of approving reviewers', () => {
  const one = [review('ann', 'APPROVED')];
  const two = [review('ann', 'APPROVED'), review('bob', 'APPROVED')];
  assert.strictEqual(reviewDecisionOf(one, 1), 'approved');
  assert.strictEqual(reviewDecisionOf(one, 2), 'none', 'one of two approvals is not approved yet');
  assert.strictEqual(reviewDecisionOf(two, 2), 'approved');
  assert.strictEqual(reviewDecisionOf([...two, review('cid', 'CHANGES_REQUESTED')], 2), 'changes_requested');
  assert.strictEqual(reviewDecisionOf([review('ann', 'APPROVED'), review('ann', 'APPROVED')], 2), 'none', 'one reviewer counts once');
});

test('the default approvals follow the environment', async () => {
  const one = [review('ann', 'APPROVED')];
  await withEnv({ DOCK_BOARD_MODE: undefined, DOCK_REQUIRED_APPROVALS: undefined }, () => assert.strictEqual(reviewDecisionOf(one), 'approved'));
  await withEnv({ DOCK_BOARD_MODE: '1', DOCK_REQUIRED_APPROVALS: undefined }, () => assert.strictEqual(reviewDecisionOf(one), 'none'));
});

test('board mode always asks for the PIN, even through a Tailscale host', async () => {
  const tailscale = { headers: { host: 'box.tail1234.ts.net' }, ip: '127.0.0.1', socket: {} } as unknown as Request;
  await withEnv({ DOCK_BOARD_MODE: undefined, DOCK_PIN_MODE: undefined }, () => assert.strictEqual(shouldRequirePin(tailscale, true), false, 'auto mode lets the tailnet in'));
  await withEnv({ DOCK_BOARD_MODE: '1', DOCK_PIN_MODE: undefined }, () => assert.strictEqual(shouldRequirePin(tailscale, true), true));
  await withEnv({ DOCK_BOARD_MODE: '1', DOCK_PIN_MODE: 'disabled' }, () => assert.strictEqual(shouldRequirePin(tailscale, true), true, 'board mode overrides disabled'));
});

test('board mode never moves a Jira ticket', async () => {
  let called = false;
  const jira = Object.create(JiraAPI.prototype) as JiraAPI;
  (jira as any).getConfiguration = async () => ({ credentials: {} });
  (jira as any).jiraService = { transitionTo: async () => { called = true; return true; } };
  await withEnv({ DOCK_BOARD_MODE: '1' }, async () => assert.strictEqual(await jira.transitionTicket('QRD-1', 'PR Review'), false));
  assert.strictEqual(called, false);
  await withEnv({ DOCK_BOARD_MODE: undefined }, async () => assert.strictEqual(await jira.transitionTicket('QRD-1', 'PR Review'), true));
  assert.strictEqual(called, true);
});
