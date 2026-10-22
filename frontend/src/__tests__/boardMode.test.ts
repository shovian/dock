import assert from 'node:assert';
import test from 'node:test';
import { answerHint } from '../lib/boardMode';

test('board mode sends the owner to the board, not to a chat session', () => {
  assert.strictEqual(answerHint(true, true, 'workspace'), 'Answer on the board; sous picks it up in a fresh session.');
  assert.doesNotMatch(answerHint(true, false, 'laptop'), /Claude Code session/);
});

test('without board mode the hint names the chat session as before', () => {
  assert.strictEqual(answerHint(false, true, 'the workspace'), 'Answer here, or in the Claude Code session on the workspace.');
  assert.strictEqual(answerHint(false, false, 'the laptop'), 'Answer in the Claude Code session on the laptop.');
});
