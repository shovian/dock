import { boardMode, refuseInBoardMode } from '../board-mode';
import { BoardInputError, boardService } from '../integrations/board';
import { threadService } from '../integrations/board-threads';
import { threadRefresher } from '../integrations/board-threads-refresh';
import { JiraAPI, JiraTicketLookupError } from '../datasources/JiraAPI';
import { GitHubAPI } from '../datasources/GitHubAPI';
import { DiscordAPI } from '../datasources/DiscordAPI';
import { StorageAPI } from '../datasources/StorageAPI';
import { GraphQLError } from 'graphql';
import { shouldRequirePin, type AuthContext } from '../auth/session';
import { CalendarUnavailableError, googleCalendarService } from '../integrations/google-calendar';
import { upstreamMonitorService } from '../integrations/upstream-monitor';
import { dockerRuntimeService } from '../integrations/docker-runtime';
import { OrchestratorInputError, orchestratorService } from '../integrations/orchestrator';
import { CHAT_MACHINE, chatService } from '../integrations/chat';
import { ledgerPeer, withPeerRuns } from '../integrations/ledger-peer';
import { mergeAttention, withoutSettledTickets } from '../integrations/attention';
import { CronInputError } from '../integrations/orchestrator-cron';
import { orchestratorCron } from '../integrations/orchestrator-cron-live';
import { labelOrder } from '../integrations/orchestrator-cron';
import { pushService } from '../integrations/push';
import { demoVideos } from '../integrations/demo-videos';
import { demoStorage, type DemoStorageInput } from '../integrations/demo-storage';
import { DevServerError, devServers } from '../integrations/dev-servers';
import { elevenLabsKeys } from '../integrations/elevenlabs-keys';
import { moveToReview } from '../integrations/broadcast-review';
import type { AnswerInput } from '../integrations/chat-interactions';
import { SprintBusyError, SprintInputError, sprintDashboardService } from '../integrations/sprint-dashboard';
import { dockMode } from '../mode';

const jiraAPI = new JiraAPI();
const githubAPI = new GitHubAPI();
const discordAPI = new DiscordAPI();
const storageAPI = new StorageAPI();
const isPresent = <T>(value: T | null | undefined): value is T => value != null;

function orchestratorInputError(error: unknown): never {
  if (error instanceof OrchestratorInputError || error instanceof BoardInputError) {
    throw new GraphQLError(error.message, { extensions: { code: 'BAD_USER_INPUT' } });
  }
  throw error;
}

function sprintError(error: unknown): never {
  if (error instanceof SprintInputError || error instanceof SprintBusyError) {
    throw new GraphQLError(error.message, { extensions: { code: error instanceof SprintBusyError ? 'CONFLICT' : 'BAD_USER_INPUT' } });
  }
  throw error;
}

function requireCron(): void {
  if (dockMode() !== 'workspace') {
    throw new GraphQLError('The cron runs on the workspace DOCK.', { extensions: { code: 'BAD_USER_INPUT' } });
  }
}

function requireDemoVideos(): void {
  if (dockMode() !== 'workspace') {
    throw new GraphQLError('Demo videos are kept from the workspace DOCK.', { extensions: { code: 'BAD_USER_INPUT' } });
  }
}

// A refusal of the bucket or the input is a message for the Demo Video page.
function demoVideoError(error: unknown): never {
  throw new GraphQLError(error instanceof Error ? error.message : 'Demo videos failed', { extensions: { code: 'BAD_USER_INPUT' } });
}

function requireWorkspace(): void {
  if (dockMode() !== 'workspace') {
    throw new GraphQLError('Dev servers run on the workspace DOCK.', { extensions: { code: 'BAD_USER_INPUT' } });
  }
}

function devServerError(error: unknown): never {
  if (error instanceof DevServerError) throw new GraphQLError(error.message, { extensions: { code: 'BAD_USER_INPUT' } });
  throw error;
}

// A key the laptop DOCK refused, or a peer it could not reach, is a message for the Settings page.
function elevenLabsError(error: unknown): never {
  throw new GraphQLError(error instanceof Error ? error.message : 'ElevenLabs keys failed', { extensions: { code: 'BAD_USER_INPUT' } });
}

function cronError(error: unknown): never {
  if (error instanceof CronInputError || error instanceof OrchestratorInputError) {
    throw new GraphQLError(error.message, { extensions: { code: 'BAD_USER_INPUT' } });
  }
  throw error;
}

async function hasMasterPin(): Promise<boolean> {
  return storageAPI.hasMasterPin();
}

async function requireUnlocked(context: AuthContext): Promise<void> {
  if (shouldRequirePin(context.request, await hasMasterPin()) && !context.authenticated) {
    throw new GraphQLError('Unlock DOCK to continue', {
      extensions: { code: 'UNAUTHENTICATED' },
    });
  }
}

export const resolvers = {
  Query: {
    authStatus: async (_: unknown, __: unknown, context: AuthContext) => {
      const pinEnabled = shouldRequirePin(context.request, await hasMasterPin());
      return {
        authenticated: !pinEnabled || context.authenticated,
        hasMasterPin: pinEnabled,
      };
    },
    // Public: the page needs it before the PIN to know which navigation to draw.
    dockMode: () => dockMode(),
    boardMode: () => boardMode(),
    dashboard: async () => {
      // Scatter-gather parallel fetching
      const [tickets] = await Promise.all([
        jiraAPI.getTickets(),
      ]);
      
      // Group tickets by status
      const groups: Record<string, any> = {};
      tickets.forEach((ticket: any) => {
        if (!groups[ticket.status]) {
          groups[ticket.status] = [];
        }
        groups[ticket.status].push(ticket);
      });
      
      const statusPriority = [
        'todo', 'to do', 'backlog',
        'in progress', 'in-progress', 'inprogress',
        'pr preview', 'review', 'in review', 'pull request preview',
        'uat merged', 'uat-merged',
        'uat check', 'uat-check', 'testing', 'qa',
        'uat/bugg improvement', 'uat/bug improvement', 'bug improvement', 'improvement',
        'ready for production', 'staging', 'release ready',
        'done/merged', 'done / merged', 'done', 'merged', 'closed'
      ];

      const getStatusRank = (st: string) => {
        const lower = st.toLowerCase().trim();
        const idx = statusPriority.findIndex(s => lower === s || lower.includes(s) || s.includes(lower));
        return idx !== -1 ? idx : 999;
      };

      return Object.keys(groups)
        .sort((a, b) => getStatusRank(a) - getStatusRank(b))
        .map(status => ({
          status,
          // Dashboard cards may request PR badges, but uncached GitHub work
          // must not keep the whole board in a loading state.
          tickets: groups[status].map((ticket: any) => ({ ...ticket, __dashboard: true }))
        }));
    },
    ticketDetail: async (_: any, { key }: { key: string }) => {
      try {
        return await jiraAPI.getTicket(key);
      } catch (error) {
        if (error instanceof JiraTicketLookupError) {
          throw new GraphQLError(error.message, {
            extensions: {
              code: 'SERVICE_UNAVAILABLE',
              retryable: true,
              statusCode: error.statusCode,
            },
          });
        }
        throw error;
      }
    },
    ticketRelationGroup: async (_: any, { ticketKey }: { ticketKey: string }) => {
      return storageAPI.getTicketRelationGroup(ticketKey);
    },
    boardItems: () => boardService.list(),
    // Bug Reports exist only in board mode; elsewhere the page is simply empty.
    boardThreads: async () => {
      if (!boardMode()) return { rows: [], syncedAt: null, jiraSnapshotAt: null, refreshing: false, refreshError: null };
      const { running, lastError } = threadRefresher.status();
      return { ...(await threadService.list()), refreshing: running, refreshError: lastError };
    },
    needsAttention: async () => {
      const [agentItems, pullRequestItems] = await Promise.all([
        orchestratorService.needsAttention().catch((error) => {
          console.error('[BFF Orchestrator] Failed to load attention items:', error instanceof Error ? error.message : 'unknown error');
          return [];
        }),
        githubAPI.getNeedsAttention(),
      ]);
      const items = mergeAttention(agentItems, pullRequestItems);
      const keys = [...new Set(items.map((item) => item.ticketKey).filter(isPresent))];
      const tickets = await Promise.all(keys.map((key) => jiraAPI.getTicket(key).catch(() => null)));
      const statusOf = new Map(tickets.filter(isPresent).map((ticket: any) => [String(ticket.key), String(ticket.status)]));
      return withoutSettledTickets(items, statusOf);
    },
    settings: async () => {
      return await storageAPI.getPublicSettings();
    },
    jiraProjects: async (_: any, { url, email, token }: { url?: string, email?: string, token?: string }) => {
      return await jiraAPI.listProjects(url, email, token);
    },
    githubRepos: async (_: any, { token }: { token?: string }) => {
      return await githubAPI.listRepositories(token);
    },
    quickLinks: async () => storageAPI.getQuickLinks(),
    calendarEvents: async (_: any, args: { timeMin?: string, timeMax?: string, maxResults?: number }) => {
      try {
        return await googleCalendarService.listEvents(args.timeMin, args.timeMax, args.maxResults);
      } catch (error: any) {
        if (error.message === 'Google Calendar is not connected') return [];
        if (error instanceof CalendarUnavailableError) return [];
        console.error('[BFF Calendar] Failed to load events:', error.response?.status || error.message);
        return [];
      }
    },
    monitors: async (_: unknown, { refresh }: { refresh?: boolean }) => {
      return upstreamMonitorService.list(Boolean(refresh));
    },
    dockerRuntime: async (_: unknown, { includeStats }: { includeStats?: boolean }) => {
      return dockerRuntimeService.runtime(Boolean(includeStats));
    },
    orchestrations: async () => {
      const [local, peerRuns] = await Promise.all([orchestratorService.list(), ledgerPeer ? ledgerPeer.runs() : []]);
      return withPeerRuns(local, peerRuns, dockMode());
    },
    orchestration: async (_: unknown, { key }: { key: string }) => {
      const [local, remote] = await Promise.all([orchestratorService.get(key), ledgerPeer ? ledgerPeer.get(key) : null]);
      const [run] = withPeerRuns([local].filter(isPresent), [remote].filter(isPresent), dockMode());
      return run ?? null;
    },
    ingestTokens: async () => orchestratorService.tokens(),
    demoVideos: async () => {
      requireDemoVideos();
      return demoVideos.list(await storageAPI.listDemoLinks().catch(demoVideoError)).catch(demoVideoError);
    },
    demoStorage: async () => demoStorage.view().catch(demoVideoError),
    devServers: async () => { requireWorkspace(); return devServers.list(); },
    devServerLog: async (_: unknown, { name, bytes }: { name: string; bytes?: number | null }) => {
      requireWorkspace();
      try { return devServers.log(name, bytes ?? undefined); } catch (error) { return devServerError(error); }
    },
    elevenLabsKeys: async () => elevenLabsKeys.list().catch(elevenLabsError),
    chatSessions: async (_: unknown, { source, limit }: { source?: string; limit?: number }) => {
      return chatService.sessions(source, limit, CHAT_MACHINE).catch(orchestratorInputError);
    },
    chatSession: async (_: unknown, { id }: { id: string }) => chatService.session(id, CHAT_MACHINE),
    chatMessages: async (_: unknown, args: { sessionId: string; afterId?: number; beforeId?: number; limit?: number }) => {
      return chatService.messages(args.sessionId, args.afterId, args.beforeId, args.limit)
        .then((rows) => chatService.withAttachments(rows)).catch(orchestratorInputError);
    },
    chatActivity: async (_: unknown, args: { sessionId: string; afterSeq?: number; fromTurnId?: number; beforeTurnId?: number; limit?: number }) => {
      return chatService.activityRows(args.sessionId, args).catch(orchestratorInputError);
    },
    chatSessionWorkers: async (_: unknown, { sessionId }: { sessionId: string }) => chatService.workers(sessionId),
    chatActivityDetail: async (_: unknown, { sessionId, id }: { sessionId: string; id: number }) => chatService.activityDetail(sessionId, id),
    chatSearch: async (_: unknown, { query, limit }: { query: string; limit?: number }) => chatService.search(query, limit, CHAT_MACHINE),
    chatBridge: async () => chatService.bridge(),
    chatMachines: async () => chatService.machinesWithInfo(await orchestratorService.machines()),
    chatCommands: async (_: unknown, { machine, query, limit }: { machine: string; query?: string | null; limit?: number | null }) => {
      return chatService.commands(machine, query, limit, await orchestratorService.machines()).catch(orchestratorInputError);
    },
    chatMachineOptions: async (_: unknown, { machine }: { machine: string }) => {
      return chatService.machineOptions(machine, await orchestratorService.machines()).catch(orchestratorInputError);
    },
    chatStatus: async (_: unknown, { machine }: { machine?: string | null }) => chatService.statusSnapshot(machine ?? undefined),
    chatBalloons: async () => chatService.balloons(),
    sprintList: async () => sprintDashboardService.listSprints(),
    sprintDashboard: async (_: unknown, { sprintId }: { sprintId?: number | null }) => sprintDashboardService.getDashboard(sprintId),
    sprintTrend: async () => sprintDashboardService.trend(),
    sprintIssueEvents: async (_: unknown, { sprintId }: { sprintId: number }) => sprintDashboardService.issueEvents(sprintId),
    sprintDashboardSettings: async () => sprintDashboardService.getSettings(),
    orchestratorCronSettings: async () => orchestratorCron.getSettings(),
    orchestratorCronStatus: async () => JSON.stringify(await orchestratorCron.status()),
    pushPublicKey: async () => pushService.publicKey(),
    dockerContainerLogs: async (_: unknown, { id, tail }: { id: string; tail?: number }) => {
      try {
        return await dockerRuntimeService.logs(id, tail);
      } catch (error) {
        if (error instanceof Error && error.message === 'Invalid container ID') {
          throw new GraphQLError(error.message, { extensions: { code: 'BAD_USER_INPUT' } });
        }
        console.error('[BFF Docker] Failed to load logs:', error instanceof Error ? error.message : 'unknown error');
        throw new GraphQLError('Container logs are unavailable', { extensions: { code: 'SERVICE_UNAVAILABLE' } });
      }
    },
  },
  
  Ticket: {
    labels: (parent: any) => Array.isArray(parent.labels) ? parent.labels : [],
    workOrder: async (parent: any) => (await storageAPI.ticketOrders()).get(parent.key) ?? labelOrder(parent.labels),
    workOrderSource: async (parent: any) => ((await storageAPI.ticketOrders()).has(parent.key) ? 'dock' : labelOrder(parent.labels) === null ? null : 'label'),
    workManual: async (parent: any) => (await storageAPI.manualTickets()).has(parent.key),
    pullRequests: async (parent: any) => {
      return await githubAPI.getPullRequestsForTicket(parent.key, {
        staleWhileRevalidate: parent.__dashboard === true,
      });
    },
    demoLink: async (parent: any) => {
      return await storageAPI.getDemoLink(parent.key);
    },
    orchestration: async (parent: any) => {
      const [local, peerRuns] = await Promise.all([orchestratorService.get(parent.key).catch(() => null), ledgerPeer ? ledgerPeer.recentRuns() : []]);
      const [run] = withPeerRuns([local].filter(isPresent), peerRuns.filter((item) => item.key === parent.key), dockMode());
      return run ?? null;
    },
  },

  // A run read from the peer DOCK brings its own events; its tool events and transcript stay on that DOCK.
  Orchestration: {
    remote: (parent: { machine: string }) => parent.machine !== dockMode(),
    events: async (parent: { key: string; peer?: boolean; events?: unknown[] }) => (parent.peer ? parent.events ?? [] : orchestratorService.events(parent.key)),
    timeline: async (parent: { key: string; peer?: boolean }) => (parent.peer ? null : orchestratorService.timeline(parent.key)),
    members: async (parent: { key: string; peer?: boolean }) => (parent.peer ? [] : orchestratorService.members(parent.key).catch(() => [])),
  },

  TicketRelationGroup: {
    tickets: async (parent: { ticketKeys: string[] }) => {
      const tickets = await Promise.all(parent.ticketKeys.map((key) => jiraAPI.getTicket(key)));
      return tickets.filter(Boolean);
    },
  },

  MonitorTarget: {
    lastCheckedAt: (parent: any) => parent.lastCheckedAt?.toISOString?.() || parent.lastCheckedAt || null,
  },

  Settings: {
    googleCalendarError: () => googleCalendarService.lastError(),
  },

  Mutation: {
    answerBoardItem: (_: unknown, { id, answers }: { id: string; answers: unknown }) => boardService.answer(id, answers).catch(orchestratorInputError),
    confirmBoardItems: (_: unknown, { ids }: { ids: unknown }) => boardService.confirmAll(ids).catch(orchestratorInputError),
    dismissBoardThread: async (_: unknown, { id }: { id: string }) => (boardMode() ? threadService.dismiss(id) : false),
    refreshBoardThreads: async () => threadRefresher.start(),
    lockSession: async (_: unknown, __: unknown, context: AuthContext) => {
      context.sessions.clear(context.request, context.response);
      return true;
    },
    saveDemoLink: async (_: any, { ticketKey, url }: { ticketKey: string, url: string }) => {
      return await storageAPI.saveDemoLink(ticketKey, url);
    },
    sendToDiscord: async (_: any, { ticketKey, customMessage, threadId, threadName }: { ticketKey: string, customMessage?: string, threadId?: string, threadName?: string }) => {
      refuseInBoardMode('Posting to Discord from DOCK');
      const relation = await storageAPI.getTicketRelationGroup(ticketKey);
      const tickets = (await Promise.all(relation.ticketKeys.map((key) => jiraAPI.getTicket(key)))).filter(isPresent);
      if (tickets.length === 0) return false;

      const [pullRequestGroups, demoLinks] = await Promise.all([
        Promise.all(tickets.map((ticket) => githubAPI.getPullRequestsForTicket(ticket.key))),
        Promise.all(tickets.map((ticket) => storageAPI.getDemoLink(ticket.key))),
      ]);
      const prs = [...new Map(pullRequestGroups.flat().map((pr: any) => [pr.url || pr.id, pr])).values()];
      const primaryTicket = tickets.find((ticket) => ticket.key === relation.primaryKey) || tickets[0];
      if (!primaryTicket) return false;
      const settings = await storageAPI.getSettings();
      const demoEntries = demoLinks
        .map((demoLink, index) => ({ key: tickets[index]?.key, url: demoLink?.url }))
        .filter((entry): entry is { key: string; url: string } => Boolean(entry.key && entry.url));
      const uniqueDemoUrls = [...new Set(demoEntries.map((entry) => entry.url))];

      const payload = {
        ticket: {
          key: primaryTicket.key,
          title: primaryTicket.title,
          url: primaryTicket.url || `https://jira.example.com/browse/${primaryTicket.key}`
        },
        relatedTickets: tickets.map((ticket) => ({
          key: ticket.key,
          title: ticket.title,
          url: ticket.url || `https://jira.example.com/browse/${ticket.key}`,
        })),
        prs,
        demoUrl: (uniqueDemoUrls.length === 1
          ? `- **${tickets.map((ticket) => ticket.key).join(' + ')}:** ${uniqueDemoUrls[0]}`
          : demoEntries.map((entry) => `- **${entry.key}:** ${entry.url}`).join('\n')) || undefined,
        webhookUrl: settings.discordWebhookUrl,
        messageTemplate: settings.discordMessageTemplate,
        customMessage,
        threadId,
        threadName
      };

      const sent = await discordAPI.sendSummary(payload);
      if (sent) {
        const notMoved = await moveToReview(tickets, (key, status) => jiraAPI.transitionTicket(key, status));
        if (notMoved.length) console.warn(`[Broadcast] Jira did not move ${notMoved.join(', ')} to PR Review`);
      }
      return sent;
    },
    setTicketDependency: async (_: unknown, { ticketKey, dependsOnKey }: { ticketKey: string; dependsOnKey: string }) => {
      const [ticket, dependency] = await Promise.all([jiraAPI.getTicket(ticketKey), jiraAPI.getTicket(dependsOnKey)]);
      if (!ticket || !dependency) {
        throw new GraphQLError('Both Jira tickets must exist and be accessible', { extensions: { code: 'BAD_USER_INPUT' } });
      }
      try {
        return await storageAPI.setTicketDependency(ticket.key, dependency.key);
      } catch (error) {
        throw new GraphQLError(error instanceof Error ? error.message : 'Invalid ticket dependency', { extensions: { code: 'BAD_USER_INPUT' } });
      }
    },
    setTicketWorkOrder: async (_: unknown, { ticketKey, position }: { ticketKey: string; position: number }) => {
      await storageAPI.setTicketOrder(ticketKey, position).catch((error) => {
        throw new GraphQLError(error instanceof Error ? error.message : 'Invalid work order', { extensions: { code: 'BAD_USER_INPUT' } });
      });
      return true;
    },
    clearTicketWorkOrder: async (_: unknown, { ticketKey }: { ticketKey: string }) => {
      await storageAPI.clearTicketOrder(ticketKey);
      return true;
    },
    setTicketManual: async (_: unknown, { ticketKey, manual }: { ticketKey: string; manual: boolean }) => {
      await storageAPI.setTicketManual(ticketKey, manual).catch((error) => {
        throw new GraphQLError(error instanceof Error ? error.message : 'Invalid ticket', { extensions: { code: 'BAD_USER_INPUT' } });
      });
      return true;
    },
    clearTicketDependency: async (_: unknown, { ticketKey }: { ticketKey: string }) => {
      try {
        return await storageAPI.clearTicketDependency(ticketKey);
      } catch (error) {
        throw new GraphQLError(error instanceof Error ? error.message : 'Invalid ticket dependency', { extensions: { code: 'BAD_USER_INPUT' } });
      }
    },
    updateSettings: async (_: any, { input }: { input: any }) => {
      return await storageAPI.updateSettings(input);
    },
    validateJira: async (_: any, { url, email, token }: { url?: string, email?: string, token?: string }) => {
      return await jiraAPI.validateJira(url, email, token);
    },
    validateGitHub: async (_: any, { token }: { token?: string }) => {
      return await githubAPI.validateGitHub(token);
    },
    validateDiscord: async (_: any, { webhookUrl }: { webhookUrl?: string }) => {
      return await discordAPI.validateDiscord(webhookUrl);
    },
    setMasterPin: async (_: any, { pin }: { pin: string }, context: AuthContext) => {
      await requireUnlocked(context);
      const changed = await storageAPI.setMasterPin(pin);
      if (changed) {
        context.sessions.clearAll();
        context.sessions.create(context.response);
      }
      return changed;
    },
    changeMasterPin: async (_: any, { oldPin, newPin }: { oldPin: string, newPin: string }, context: AuthContext) => {
      const changed = await storageAPI.changeMasterPin(oldPin, newPin);
      if (changed) {
        context.sessions.clearAll();
        context.sessions.create(context.response);
      }
      return changed;
    },
    verifyMasterPin: async (_: any, { pin }: { pin: string }, context: AuthContext) => {
      const retryAfter = context.pinRateLimiter.retryAfterSeconds(context.clientKey);
      if (retryAfter > 0) {
        throw new GraphQLError('Too many PIN attempts. Try again later.', {
          extensions: { code: 'RATE_LIMITED', retryAfter },
        });
      }

      const valid = await storageAPI.verifyMasterPin(pin);
      if (!valid) {
        context.pinRateLimiter.recordFailure(context.clientKey);
        return false;
      }

      context.pinRateLimiter.reset(context.clientKey);
      context.sessions.create(context.response);
      return true;
    },
    removeMasterPin: async (_: any, { oldPin }: { oldPin: string }, context: AuthContext) => {
      const removed = await storageAPI.removeMasterPin(oldPin);
      if (removed) {
        context.sessions.clearAll();
        context.sessions.clear(context.request, context.response);
      }
      return removed;
    },
    refreshData: async () => {
      const result = await jiraAPI.refreshTickets();
      return result !== false;
    },
    checkConflicts: async (_: any, { owner, repo, pullNumber }: { owner: string, repo: string, pullNumber: number }) => {
      return await githubAPI.checkConflicts(owner, repo, pullNumber);
    },
    addQuickLink: async (_: any, { input }: { input: { title: string, url: string, color?: string } }) => {
      return storageAPI.addQuickLink(input);
    },
    removeQuickLink: async (_: any, { id }: { id: string }) => storageAPI.removeQuickLink(id),
    disconnectGoogleCalendar: async () => {
      await googleCalendarService.disconnect();
      return true;
    },
    addMonitor: async (_: unknown, { input }: { input: any }) => upstreamMonitorService.add(input),
    updateMonitor: async (_: unknown, { id, input }: { id: string, input: any }) => upstreamMonitorService.update(id, input),
    removeMonitor: async (_: unknown, { id }: { id: string }) => upstreamMonitorService.remove(id),
    checkMonitors: async () => upstreamMonitorService.checkAll(),
    createIngestToken: async (_: unknown, { name, machine }: { name: string; machine?: string | null }) => {
      return orchestratorService.createToken(name, machine).catch(orchestratorInputError);
    },
    revokeIngestToken: async (_: unknown, { id }: { id: string }) => orchestratorService.revokeToken(id),
    deleteDemoVideo: async (_: unknown, { ticketKey }: { ticketKey: string }) => { requireDemoVideos(); return demoVideos.remove(ticketKey).catch(demoVideoError); },
    saveDemoStorage: async (_: unknown, { input }: { input: DemoStorageInput }) => demoStorage.save(input).catch(demoVideoError),
    clearDemoStorage: async () => demoStorage.clear().catch(demoVideoError),
    startDevServer: async (_: unknown, { name }: { name: string }) => { requireWorkspace(); return devServers.start(name).catch(devServerError); },
    stopDevServer: async (_: unknown, { name }: { name: string }) => { requireWorkspace(); return devServers.stop(name).catch(devServerError); },
    restartDevServer: async (_: unknown, { name }: { name: string }) => { requireWorkspace(); return devServers.restart(name).catch(devServerError); },
    startAllDevServers: async () => { requireWorkspace(); return devServers.startAll().catch(devServerError); },
    stopAllDevServers: async () => { requireWorkspace(); return devServers.stopAll().catch(devServerError); },
    stopWorktreeServer: async (_: unknown, { port }: { port: number }) => { requireWorkspace(); return devServers.stopWorktree(port).catch(devServerError); },
    addElevenLabsKey: async (_: unknown, { name, key }: { name: string; key: string }) => elevenLabsKeys.add(name, key).then(() => true).catch(elevenLabsError),
    removeElevenLabsKey: async (_: unknown, { name }: { name: string }) => elevenLabsKeys.remove(name).catch(elevenLabsError),
    unparkElevenLabsKey: async (_: unknown, { name }: { name: string }) => elevenLabsKeys.park(name, null).then(() => true).catch(elevenLabsError),
    dismissOrchestration: async (_: unknown, { key }: { key: string }) => {
      return orchestratorService.dismiss(key, dockMode()).catch(orchestratorInputError);
    },
    moveOrchestration: async (_: unknown, { key, machine }: { key: string; machine: string }) => {
      return orchestratorService.moveRun(key, machine).catch(orchestratorInputError);
    },
    createChatSession: async (_: unknown, args: { title?: string; ticketKey?: string; forkFrom?: string; machine?: string | null }) => {
      if (args.machine && args.machine !== CHAT_MACHINE) {
        throw new GraphQLError(`Chat sessions run on ${CHAT_MACHINE} only`, { extensions: { code: 'BAD_USER_INPUT' } });
      }
      if (!(await orchestratorService.machines()).includes(CHAT_MACHINE)) {
        throw new GraphQLError('Unknown machine', { extensions: { code: 'BAD_USER_INPUT' } });
      }
      return chatService.createSession({ ...args, machine: CHAT_MACHINE }).catch(orchestratorInputError);
    },
    sendChatMessage: async (
      _: unknown,
      { sessionId, text, attachmentIds, options, mode }: { sessionId: string; text: string; attachmentIds?: string[] | null; options?: unknown; mode?: string | null },
    ) => {
      return chatService.sendMessage(sessionId, text, await orchestratorService.machines(), { attachmentIds, options, mode }).catch(orchestratorInputError);
    },
    answerTicket: async (_: unknown, { ticketKey, text }: { ticketKey: string; text: string }) => {
      await chatService.answerTicket(ticketKey, text, await orchestratorService.machines()).catch(orchestratorInputError);
      return true;
    },
    answerChatInteraction: async (
      _: unknown,
      args: { sessionId: string; id: number; decision: string; answers?: AnswerInput[] | null; note?: string | null },
    ) => {
      return chatService.answerInteraction(args.sessionId, args.id, args.decision, args.answers, args.note).catch(orchestratorInputError);
    },
    stopChatTurn: async (_: unknown, { sessionId }: { sessionId: string }) => chatService.stopTurn(sessionId).catch(orchestratorInputError),
    renameChatSession: async (_: unknown, { id, title }: { id: string; title: string }) => {
      return chatService.renameSession(id, title).catch(orchestratorInputError);
    },
    setChatSessionOptions: async (_: unknown, { id, options }: { id: string; options: unknown }) => {
      return chatService.setSessionOptions(id, options).catch(orchestratorInputError);
    },
    deleteChatSession: async (_: unknown, { id }: { id: string }) => chatService.deleteSession(id),
    refreshSprintDashboard: async (_: unknown, { sprintId }: { sprintId: number }) => {
      try { return sprintDashboardService.startRefresh(sprintId); } catch (error) { return sprintError(error); }
    },
    backfillSprintDashboards: async (_: unknown, { count }: { count: number }) => {
      try { return sprintDashboardService.startBackfill(count); } catch (error) { return sprintError(error); }
    },
    updateSprintDashboardSettings: async (_: unknown, { boardId, config }: { boardId: string; config: string }) => {
      await sprintDashboardService.updateSettings(boardId, config).catch(sprintError);
      return true;
    },
    updateOrchestratorCronSettings: async (_: unknown, { config, webhookUrl }: { config: string; webhookUrl?: string | null }) => {
      requireCron();
      await orchestratorCron.updateSettings(config, webhookUrl).catch(cronError);
      return true;
    },
    runOrchestratorCronNow: async () => {
      requireCron();
      return JSON.stringify(await orchestratorCron.runFill(true));
    },
    confirmOrchestration: async (_: unknown, { key }: { key: string }) => {
      requireCron();
      await orchestratorCron.confirm(key).catch(cronError);
      return true;
    },
    stopAllAgents: async () => orchestratorCron.stopAll(),
    subscribePush: async (_: unknown, input: { endpoint: string; p256dh: string; auth: string }) => {
      await pushService.subscribe(input).catch(cronError);
      return true;
    },
    unsubscribePush: async (_: unknown, { endpoint }: { endpoint: string }) => {
      await pushService.unsubscribe(endpoint);
      return true;
    },
    sendTestPush: async () => pushService.send({ title: 'DOCK', body: 'Notifications work on this device.', url: '/' }),
  },
  ChatSession: {
    pending: async (session: { id: string; status: string; machine: string }) => chatService.pending(session.id, session.status, session.machine),
    settled: async (session: { id: string; status: string; machine: string }) => chatService.settled(session.id, session.status, session.machine),
  },
  ChatMessage: {
    attachments: (message: { attachments?: unknown[] }) => message.attachments ?? [],
  },
};

export const protectedQueries = [
  'dashboard', 'ticketDetail', 'ticketRelationGroup', 'needsAttention', 'boardItems', 'boardThreads', 'jiraProjects', 'githubRepos', 'quickLinks', 'calendarEvents', 'monitors',
  'dockerRuntime', 'dockerContainerLogs', 'orchestrations', 'orchestration', 'ingestTokens', 'elevenLabsKeys', 'devServers', 'devServerLog', 'demoVideos', 'demoStorage',
  'chatSessions', 'chatSession', 'chatMessages', 'chatActivity', 'chatSessionWorkers', 'chatActivityDetail', 'chatSearch', 'chatBridge', 'chatMachines', 'chatStatus', 'chatBalloons',
  'chatCommands', 'chatMachineOptions',
  'sprintList', 'sprintDashboard', 'sprintTrend', 'sprintDashboardSettings', 'sprintIssueEvents', 'orchestratorCronSettings', 'orchestratorCronStatus', 'pushPublicKey',
] as const;
export const protectedMutations = [
  'answerBoardItem',
  'confirmBoardItems',
  'dismissBoardThread',
  'refreshBoardThreads',
  'saveDemoLink',
  'sendToDiscord',
  'setTicketDependency',
  'clearTicketDependency',
  'setTicketWorkOrder',
  'clearTicketWorkOrder',
  'setTicketManual',
  'updateSettings',
  'validateJira',
  'validateGitHub',
  'validateDiscord',
  'changeMasterPin',
  'removeMasterPin',
  'refreshData',
  'checkConflicts',
  'addQuickLink',
  'removeQuickLink',
  'disconnectGoogleCalendar',
  'addMonitor',
  'updateMonitor',
  'removeMonitor',
  'checkMonitors',
  'createIngestToken',
  'revokeIngestToken',
  'deleteDemoVideo',
  'saveDemoStorage',
  'clearDemoStorage',
  'startDevServer',
  'stopDevServer',
  'restartDevServer',
  'startAllDevServers',
  'stopAllDevServers',
  'stopWorktreeServer',
  'addElevenLabsKey',
  'removeElevenLabsKey',
  'unparkElevenLabsKey',
  'dismissOrchestration',
  'moveOrchestration',
  'createChatSession',
  'sendChatMessage',
  'answerTicket',
  'answerChatInteraction',
  'stopChatTurn',
  'renameChatSession',
  'setChatSessionOptions',
  'deleteChatSession',
  'refreshSprintDashboard',
  'backfillSprintDashboards',
  'updateSprintDashboardSettings',
  'updateOrchestratorCronSettings',
  'runOrchestratorCronNow',
  'confirmOrchestration',
  'stopAllAgents',
  'subscribePush',
  'unsubscribePush',
  'sendTestPush',
] as const;

for (const field of protectedQueries) {
  const resolver: any = resolvers.Query[field];
  (resolvers.Query as Record<string, any>)[field] = async (...args: any[]) => {
    await requireUnlocked(args[2] as AuthContext);
    return resolver(...args);
  };
}

for (const field of protectedMutations) {
  const resolver: any = resolvers.Mutation[field];
  (resolvers.Mutation as Record<string, any>)[field] = async (...args: any[]) => {
    await requireUnlocked(args[2] as AuthContext);
    return resolver(...args);
  };
}
