import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildASTSchema, graphql, parse, validate, type GraphQLObjectType, type GraphQLSchema } from 'graphql';
import { typeDefs } from '../schema/typeDefs';
import { protectedMutations, protectedQueries, resolvers } from '../resolvers';
import { StorageAPI } from '../datasources/StorageAPI';
import { orchestratorService } from '../integrations/orchestrator';

function frontendOperations(files: string[]): Array<{ name: string; document: string }> {
  const templates = new Map<string, string>();
  const pattern = /export const (\w+) = (?:gql)?`([\s\S]*?)`;/g;
  for (const file of files) {
    const source = readFileSync(resolve(__dirname, '../../../../frontend/src/graphql', file), 'utf8');
    for (const match of source.matchAll(pattern)) templates.set(match[1], match[2]);
  }
  const expand = (body: string): string => body.replace(/\$\{(\w+)\}/g, (_, name: string) => expand(templates.get(name) ?? ''));
  return [...templates.entries()]
    .map(([name, body]) => ({ name, document: expand(body) }))
    .filter(({ document }) => /^\s*(query|mutation|subscription)\b/.test(document));
}

function operationErrors(schema: GraphQLSchema, document: string): string[] {
  return validate(schema, parse(document)).map((error) => error.message);
}

test('🛡️ [BFF GraphQL] Schema & Resolver Integrity Verification', async (t) => {
  await t.test('should define valid GraphQL type definitions containing essential DOCK domain types', () => {
    assert.ok(typeDefs, 'typeDefs must not be null or undefined');
    const schemaStr = typeDefs.loc?.source.body || JSON.stringify(typeDefs);
    assert.ok(schemaStr.includes('Ticket'), 'Schema must define Ticket GraphQL type');
    assert.ok(schemaStr.includes('description'), 'Ticket type must include Atlassian description field');
    assert.ok(schemaStr.includes('sprintName'), 'Ticket type must include sprintName field');
    assert.ok(schemaStr.includes('labels: [String!]!'), 'Ticket type must expose Jira labels');
    assert.ok(schemaStr.includes('PullRequest'), 'Schema must define PullRequest GraphQL type');
    assert.ok(schemaStr.includes('hasConflict'), 'Schema must support conflict check booleans');
    assert.ok(schemaStr.includes('DockerRuntime'), 'Schema must define Docker runtime inventory');
    assert.ok(schemaStr.includes('discordMessageTemplate'), 'Settings must expose the Discord message template');
    assert.ok(schemaStr.includes('TicketRelationGroup'), 'Schema must expose ticket dependency groups');
  });

  await t.test('should provide complete resolver mapping for queries, mutations, and field resolvers', () => {
    assert.ok(resolvers.Query, 'Query resolvers must be defined');
    assert.ok(typeof resolvers.Query.dashboard === 'function', 'dashboard query resolver must exist');
    assert.ok(resolvers.Ticket, 'Ticket field resolvers must be defined');
    assert.ok(typeof resolvers.Ticket.pullRequests === 'function', 'Ticket.pullRequests resolver must exist');
    assert.deepStrictEqual(resolvers.Ticket.labels({}), []);
    assert.strictEqual(
      resolvers.MonitorTarget.lastCheckedAt({ lastCheckedAt: new Date('2026-08-27T00:00:00.000Z') }),
      '2026-08-27T00:00:00.000Z',
    );
  });

  await t.test('should serialize fractional Jira story points', async () => {
    const schema = buildASTSchema(typeDefs);
    const result = await graphql({
      schema,
      source: '{ dashboard { tickets { storyPoints } } }',
      rootValue: {
        dashboard: [{
          status: 'In Progress',
          tickets: [
            { key: 'QRD-1', title: 'Quarter point', status: 'In Progress', url: 'https://example.test/QRD-1', storyPoints: 0.25 },
            { key: 'QRD-2', title: 'Half point', status: 'In Progress', url: 'https://example.test/QRD-2', storyPoints: 0.5 },
          ],
        }],
      },
    });

    assert.strictEqual(result.errors, undefined);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(result.data)), {
      dashboard: [{ tickets: [{ storyPoints: 0.25 }, { storyPoints: 0.5 }] }],
    });
  });

  await t.test('should preserve the public query and mutation contract during shell consolidation', () => {
    const schema = buildASTSchema(typeDefs);
    const queryFields = Object.keys(schema.getQueryType()?.getFields() || {}).sort();
    const mutationFields = Object.keys(schema.getMutationType()?.getFields() || {}).sort();

    assert.deepStrictEqual(queryFields, [
      'authStatus',
      'boardMode',
      'calendarEvents',
      'chatActivity',
      'chatActivityDetail',
      'chatBalloons',
      'chatBridge',
      'chatCommands',
      'chatMachineOptions',
      'chatMachines',
      'chatMessages',
      'chatSearch',
      'chatSession',
      'chatSessionWorkers',
      'chatSessions',
      'chatStatus',
      'dashboard',
      'demoStorage',
      'demoVideos',
      'devServerLog',
      'devServers',
      'dockMode',
      'dockerContainerLogs',
      'dockerRuntime',
      'elevenLabsKeys',
      'githubRepos',
      'ingestTokens',
      'jiraProjects',
      'monitors',
      'needsAttention',
      'orchestration',
      'orchestrations',
      'orchestratorCronSettings',
      'orchestratorCronStatus',
      'pushPublicKey',
      'quickLinks',
      'settings',
      'sprintDashboard',
      'sprintDashboardSettings',
      'sprintIssueEvents',
      'sprintList',
      'sprintTrend',
      'ticketDetail',
      'ticketRelationGroup',
    ]);
    assert.deepStrictEqual(mutationFields, [
      'addElevenLabsKey',
      'addMonitor',
      'addQuickLink',
      'answerChatInteraction',
      'answerTicket',
      'backfillSprintDashboards',
      'changeMasterPin',
      'checkConflicts',
      'checkMonitors',
      'clearDemoStorage',
      'clearTicketDependency',
      'clearTicketWorkOrder',
      'confirmOrchestration',
      'createChatSession',
      'createIngestToken',
      'deleteChatSession',
      'deleteDemoVideo',
      'disconnectGoogleCalendar',
      'dismissOrchestration',
      'lockSession',
      'moveOrchestration',
      'refreshData',
      'refreshSprintDashboard',
      'removeElevenLabsKey',
      'removeMasterPin',
      'removeMonitor',
      'removeQuickLink',
      'renameChatSession',
      'restartDevServer',
      'revokeIngestToken',
      'runOrchestratorCronNow',
      'saveDemoLink',
      'saveDemoStorage',
      'sendChatMessage',
      'sendTestPush',
      'sendToDiscord',
      'setChatSessionOptions',
      'setMasterPin',
      'setTicketDependency',
      'setTicketManual',
      'setTicketWorkOrder',
      'startAllDevServers',
      'startDevServer',
      'stopAllAgents',
      'stopAllDevServers',
      'stopChatTurn',
      'stopDevServer',
      'stopWorktreeServer',
      'subscribePush',
      'unparkElevenLabsKey',
      'unsubscribePush',
      'updateMonitor',
      'updateOrchestratorCronSettings',
      'updateSettings',
      'updateSprintDashboardSettings',
      'validateDiscord',
      'validateGitHub',
      'validateJira',
      'verifyMasterPin',
    ]);
  });

  await t.test('should put every root field behind the PIN or on the named public list', () => {
    const publicQueries = ['authStatus', 'boardMode', 'dockMode', 'settings'];
    const publicMutations = ['lockSession', 'verifyMasterPin', 'setMasterPin'];
    const schema = buildASTSchema(typeDefs);
    for (const [fields, guarded, open] of [
      [Object.keys(schema.getQueryType()!.getFields()), protectedQueries, publicQueries],
      [Object.keys(schema.getMutationType()!.getFields()), protectedMutations, publicMutations],
    ] as Array<[string[], readonly string[], string[]]>) {
      assert.deepStrictEqual(fields.filter((field) => !guarded.includes(field) && !open.includes(field)), [], 'a root field is neither guarded nor on the public list');
      assert.deepStrictEqual(guarded.filter((field) => open.includes(field)), [], 'a field is not both guarded and public');
      assert.deepStrictEqual(guarded.filter((field) => !fields.includes(field)), [], 'a guarded name is not in the schema');
      assert.deepStrictEqual(open.filter((field) => !fields.includes(field)), [], 'a public name is not in the schema');
    }
  });

  await t.test('should validate every frontend operation against the schema', () => {
    const schema = buildASTSchema(typeDefs);
    const operations = frontendOperations(['queries.ts', 'mutations.ts']);
    assert.ok(operations.length > 20, 'frontend operations must be extracted');
    for (const { name, document } of operations) {
      assert.deepStrictEqual(operationErrors(schema, document), [], `${name} must validate`);
    }
  });

  await t.test('should expose machine identity and hand-over fields additively', () => {
    const schema = buildASTSchema(typeDefs);
    const field = (type: string, name: string) => (schema.getType(type) as any).getFields()[name];
    for (const [type, name, shape] of [
      ['IngestToken', 'machine', 'String!'],
      ['ChatSession', 'machine', 'String!'],
      ['Orchestration', 'machine', 'String!'],
      ['Orchestration', 'handoverTo', 'String'],
      ['Orchestration', 'handoverAt', 'String'],
      ['ChatSessionStatus', 'machine', 'String'],
      ['ChatMachine', 'name', 'String!'],
      ['ChatMachine', 'online', 'Boolean!'],
      ['ChatMachine', 'lastSeenAt', 'String'],
      ['ChatMachine', 'capabilities', '[String!]!'],
      ['ChatMachine', 'claudeVersion', 'String'],
      ['ChatSession', 'waiting', 'Boolean!'],
      ['ChatSession', 'pending', '[ChatInteraction!]!'],
      ['ChatSession', 'options', 'ChatTurnOptions'],
      ['ChatMessage', 'attachments', '[ChatAttachment!]!'],
      ['ChatInteraction', 'body', 'String!'],
      ['ChatInteraction', 'answeredAt', 'String'],
      ['ChatModel', 'efforts', '[String!]!'],
      ['ChatMachineOptions', 'fastAvailable', 'Boolean!'],
    ]) {
      assert.strictEqual(String(field(type, name).type), shape, `${type}.${name}`);
    }
    const query = schema.getQueryType()!.getFields();
    const mutation = schema.getMutationType()!.getFields();
    assert.strictEqual(String(query.chatMachines.type), '[ChatMachine!]!');
    assert.deepStrictEqual(query.chatStatus.args.map((arg) => [arg.name, String(arg.type)]), [['machine', 'String']]);
    assert.deepStrictEqual(mutation.createIngestToken.args.map((arg) => [arg.name, String(arg.type)]), [['name', 'String!'], ['machine', 'String']]);
    assert.deepStrictEqual(
      mutation.createChatSession.args.map((arg) => [arg.name, String(arg.type)]),
      [['title', 'String'], ['ticketKey', 'String'], ['forkFrom', 'ID'], ['machine', 'String']],
    );
    assert.deepStrictEqual(query.chatCommands.args.map((arg) => [arg.name, String(arg.type)]), [['machine', 'String!'], ['query', 'String'], ['limit', 'Int']]);
    assert.strictEqual(String(query.chatCommands.type), '[ChatCommand!]!');
    assert.deepStrictEqual(query.chatMachineOptions.args.map((arg) => [arg.name, String(arg.type)]), [['machine', 'String!']]);
    assert.strictEqual(String(query.chatMachineOptions.type), 'ChatMachineOptions');
    assert.deepStrictEqual(
      mutation.sendChatMessage.args.map((arg) => [arg.name, String(arg.type)]),
      [['sessionId', 'ID!'], ['text', 'String!'], ['attachmentIds', '[ID!]'], ['options', 'ChatTurnOptionsInput'], ['mode', 'String']],
    );
    assert.deepStrictEqual(
      mutation.answerChatInteraction.args.map((arg) => [arg.name, String(arg.type)]),
      [['sessionId', 'ID!'], ['id', 'Int!'], ['decision', 'String!'], ['answers', '[ChatAnswerInput!]'], ['note', 'String']],
    );
    assert.strictEqual(String(mutation.answerChatInteraction.type), 'ChatInteraction!');
    assert.deepStrictEqual(mutation.stopChatTurn.args.map((arg) => [arg.name, String(arg.type)]), [['sessionId', 'ID!']]);
    assert.strictEqual(String(mutation.stopChatTurn.type), 'ChatSession!');
    assert.deepStrictEqual(mutation.moveOrchestration.args.map((arg) => [arg.name, String(arg.type)]), [['key', 'String!'], ['machine', 'String!']]);
    assert.strictEqual(String(mutation.moveOrchestration.type), 'Orchestration!');
  });

  await t.test('should mark runs of another DOCK as remote, keep peer runs off the local stores, and keep the cron on the workspace DOCK', async () => {
    const previousDockMode = process.env.DOCK_MODE;
    const originalPin = StorageAPI.prototype.hasMasterPin;
    StorageAPI.prototype.hasMasterPin = async () => false;
    try {
      const schema = buildASTSchema(typeDefs);
      assert.strictEqual(String((schema.getType('Orchestration') as GraphQLObjectType).getFields().remote.type), 'Boolean!');
      const field = resolvers.Orchestration as Record<string, (parent: any) => unknown>;
      process.env.DOCK_MODE = 'workspace';
      assert.deepStrictEqual([field.remote({ machine: 'laptop' }), field.remote({ machine: 'workspace' })], [true, false]);
      process.env.DOCK_MODE = 'laptop';
      assert.deepStrictEqual([field.remote({ machine: 'laptop' }), field.remote({ machine: 'workspace' })], [false, true]);

      const peerRun = { key: 'ZED-9', machine: 'laptop', peer: true, events: [{ id: '1', kind: 'STAGE', detail: 'code', at: '2026-10-16T00:00:00.000Z' }] };
      assert.deepStrictEqual(await field.events(peerRun), peerRun.events);
      assert.strictEqual(await field.timeline(peerRun), null);
      assert.deepStrictEqual(await field.members(peerRun), []);

      const mutations = resolvers.Mutation as Record<string, (...args: unknown[]) => Promise<unknown>>;
      const unlocked = { request: { headers: {}, socket: {} }, authenticated: true } as any;
      for (const [name, args] of [['updateOrchestratorCronSettings', { config: '{}' }], ['runOrchestratorCronNow', {}], ['confirmOrchestration', { key: 'ZED-9' }]] as const) {
        await assert.rejects(mutations[name]({}, args, unlocked), /The cron runs on the workspace DOCK/, name);
      }
    } finally {
      StorageAPI.prototype.hasMasterPin = originalPin;
      if (previousDockMode === undefined) delete process.env.DOCK_MODE;
      else process.env.DOCK_MODE = previousDockMode;
    }
  });

  await t.test('should reject a chat session on a machine without a token and guard privileged mutations', async () => {
    const previousMode = process.env.DOCK_PIN_MODE;
    const originalPin = StorageAPI.prototype.hasMasterPin;
    const originalMachines = orchestratorService.machines;
    process.env.DOCK_PIN_MODE = 'always';
    StorageAPI.prototype.hasMasterPin = async () => true;
    orchestratorService.machines = async () => ['laptop'];
    try {
      const mutations = resolvers.Mutation as Record<string, (...args: unknown[]) => Promise<unknown>>;
      const locked = { request: { headers: {}, socket: {} }, authenticated: false } as any;
      const unlocked = { ...locked, authenticated: true };
      await assert.rejects(
        mutations.moveOrchestration({}, { key: 'ZED-101', machine: 'workspace' }, locked),
        /Unlock DOCK to continue/,
      );
      await assert.rejects(
        mutations.createIngestToken({}, { name: 'workspace', machine: 'workspace' }, locked),
        /Unlock DOCK to continue/,
      );
      await assert.rejects(
        mutations.createChatSession({}, { title: 'Probe', machine: 'workspace' }, unlocked),
        /Unknown machine/,
      );
      await assert.rejects(
        mutations.createChatSession({}, { title: 'Probe', machine: 'laptop' }, unlocked),
        /Chat sessions run on workspace only/,
      );
    } finally {
      StorageAPI.prototype.hasMasterPin = originalPin;
      orchestratorService.machines = originalMachines;
      if (previousMode === undefined) delete process.env.DOCK_PIN_MODE;
      else process.env.DOCK_PIN_MODE = previousMode;
    }
  });
});
