import express, { type Request, type Response, Router } from 'express';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { bearerToken } from '../auth/ingest-token';
import { PinRateLimiter, sessionManager, shouldRequirePin } from '../auth/session';
import { CHAT_MACHINE, ChatService, chatService } from '../integrations/chat';
import { AttachmentRefusal } from '../integrations/chat-attachments';
import { demoVideos, ingestDemoLink, type DemoVideos } from '../integrations/demo-videos';
import { DEMO_STORAGE_ROUTES, demoStorage, demoStorageRoute, type DemoStorage } from '../integrations/demo-storage';
import { receiveDemoVideo } from './demo-videos';
import { ELEVENLABS_ROUTES, elevenLabsKeys, elevenLabsRoute, type ElevenLabsKeys } from '../integrations/elevenlabs-keys';
import { MAX_TRANSCRIPT_BYTES, OrchestratorInputError, OrchestratorService, orchestratorService } from '../integrations/orchestrator';
import { StorageService } from '../storage/service';
import { BoardInputError, BoardService, boardService } from '../integrations/board';
import { ThreadInputError, ThreadService, threadService } from '../integrations/board-threads';
import { boardMode } from '../board-mode';

const clientKey = (request: Request) => request.ip || request.socket.remoteAddress || 'unknown';

export const ingestAuth = (service: OrchestratorService, limiter: PinRateLimiter) => async (request: Request, response: Response, next: express.NextFunction) => {
  try {
    const token = bearerToken(request);
    const machine = token ? await service.authenticateMachine(token) : null;
    if (machine) {
      response.locals.machine = machine;
      next();
      return;
    }
    // Only failures are throttled, so a noisy stranger cannot lock out a valid token.
    const key = clientKey(request);
    const retryAfter = limiter.retryAfterSeconds(key);
    if (retryAfter > 0) {
      response.status(429).set('retry-after', String(retryAfter)).json({ error: 'Too many failed attempts' });
      return;
    }
    limiter.recordFailure(key);
    response.status(401).json({ error: 'A valid ingest token is required' });
  } catch (error) {
    next(error);
  }
};

/**
 * Laptop -> DOCK. Every route needs an ingest token: the PIN session and the
 * Tailscale trust that unlock the dashboard do not apply here.
 */
export function createOrchestratorIngestRouter(
  service: OrchestratorService = orchestratorService,
  limiter = new PinRateLimiter(10, 15 * 60 * 1000),
  chat: ChatService = chatService,
  keys: ElevenLabsKeys = elevenLabsKeys,
  videos: DemoVideos = demoVideos,
  storageSettings: DemoStorage = demoStorage,
  board: BoardService = boardService,
  threads: ThreadService = threadService,
): Router {
  const router = Router();

  router.use(ingestAuth(service, limiter));

  const handle = (work: (body: unknown, signal: AbortSignal, machine: string) => Promise<unknown>) => async (request: Request, response: Response) => {
    // A long poll stops when the laptop hangs up, so it cannot take a message nobody is waiting for.
    const hangup = new AbortController();
    response.on('close', () => hangup.abort());
    try {
      const result = await work(request.body, hangup.signal, response.locals.machine);
      if (hangup.signal.aborted) return;
      if (result === null) {
        response.status(404).json({ error: 'Unknown ticket. Send its status first.' });
        return;
      }
      response.status(200).json({ ok: true, result });
    } catch (error) {
      if (error instanceof OrchestratorInputError) {
        response.status(400).json({ error: error.message });
        return;
      }
      console.error('[Orchestrator] ingest failed:', error instanceof Error ? error.message : 'unknown error');
      response.status(500).json({ error: 'Ingest failed' });
    }
  };

  const small = express.json({ limit: '256kb' });
  // A board input error is the producer's fault, like an orchestrator input error: answer 400, not 500.
  const boardWork = <T>(work: () => Promise<T>) => work().catch((error) => {
    if (error instanceof BoardInputError) throw new OrchestratorInputError(error.message);
    throw error;
  });
  const threadWork = <T>(work: () => Promise<T>) => work().catch((error) => {
    if (error instanceof ThreadInputError) throw new OrchestratorInputError(error.message);
    throw error;
  });
  router.post('/board/items', express.json({ limit: '2mb' }), handle((body, _signal, machine) => boardWork(() => board.ingest(body, machine))));
  // Bug Reports exist only in board mode; elsewhere the route answers as if it were not there.
  const boardModeOnly = (_request: Request, response: Response, next: express.NextFunction) => {
    if (boardMode()) next();
    else response.status(404).json({ error: 'Bug reports are only kept in board mode' });
  };
  router.post('/board/threads', boardModeOnly, express.json({ limit: '4mb' }), handle((body, _signal, machine) => threadWork(() => threads.ingest(body, machine))));
  router.post('/board/answers/pull', small, handle((_body, _signal, machine) => boardWork(() => board.pull(machine))));
  router.post('/board/answers/ack', small, handle((body, _signal, machine) => boardWork(() => board.ack(body, machine))));
  router.post('/', small, handle(async (body, _signal, machine) => {
    const run = await service.ingestLedger(body, new Date(), machine);
    return run.ignored ? { key: run.key, ignored: true, owner: run.machine } : { key: run.key, stage: run.stage };
  }));
  router.post('/ledger/list', small, handle((_body, _signal, machine) => service.ledgerList(machine)));
  router.post('/ledger/get', small, handle((body, _signal, machine) => service.ledgerGet(body, machine)));
  router.post('/ledger/handover', small, handle((body, _signal, machine) => service.ledgerHandover(body, machine)));
  router.post('/ledger/accept', small, handle((body, _signal, machine) => service.ledgerAccept(body, machine)));
  router.post('/event', small, handle(async (body, _signal, machine) => {
    const run = await service.ingestHookEvent(body, new Date(), machine);
    return run && { key: run.key, activity: run.activity, ...(run.ignored ? { ignored: true, owner: run.machine } : {}) };
  }));
  router.post('/events', small, handle(async (body, _signal, machine) => {
    const run = await service.ingestEventBatch(body, new Date(), machine);
    return run && { key: run.key, activity: run.activity, ...(run.ignored ? { ignored: true, owner: run.machine } : {}) };
  }));
  // The workspace DOCK reads the runs kept here and copies its own dismissals, so both Agents pages agree.
  router.post('/runs', small, handle(() => service.list()));
  router.post('/runs/get', small, handle((body) => service.getWithEvents(String((body as { key?: unknown })?.key ?? ''))));
  for (const route of DEMO_STORAGE_ROUTES) router.post(`/demo-storage/${route}`, small, handle((body) => demoStorageRoute(storageSettings, route, (body ?? {}) as Record<string, unknown>)));
  router.post('/demo-link', small, handle((body) => ingestDemoLink(body)));
  router.post('/demo-video', (request: Request, response: Response) => receiveDemoVideo(videos, request.query.key, request, response));
  for (const route of ELEVENLABS_ROUTES) router.post(`/elevenlabs/${route}`, small, handle((body) => elevenLabsRoute(keys, route, (body ?? {}) as Record<string, unknown>)));
  router.post('/jira', small, handle((body, _signal, machine) => service.ingestJiraStatus(body, machine)));
  router.post('/dismiss', small,handle((body, _signal, machine) => service.dismiss(String((body as { key?: unknown })?.key ?? ''), machine)));
  router.post('/transcript', express.json({ limit: MAX_TRANSCRIPT_BYTES + 1024 * 1024 }), handle((body, _signal, machine) => service.saveTranscript(body, new Date(), machine)));
  const historyMachineOnly = (_request: Request, response: Response, next: express.NextFunction) => {
    if (response.locals.machine === CHAT_MACHINE) {
      next();
      return;
    }
    response.status(403).json({ error: `Session history is only kept for the ${CHAT_MACHINE} machine. Turn off the sessions sync on ${response.locals.machine}.` });
  };
  router.post('/sessions', historyMachineOnly, express.json({ limit: '2mb' }), handle((body, _signal, machine) => chat.syncSession(body, machine)));
  router.post('/chat/claim', small, handle((body, signal, machine) => chat.claim(body, signal, machine)));
  router.post('/chat/delta', small, handle((body, _signal, machine) => chat.delta(body, machine)));
  router.post('/chat/activity', small, handle((body, _signal, machine) => chat.activity(body, machine)));
  router.post('/chat/status', small, handle(async (body, _signal, machine) => chat.ingestStatus(body, machine)));
  router.post('/chat/wait', small, handle((body, signal, machine) => chat.wait(body, signal, machine)));
  router.post('/chat/ask', small, handle((body, _signal, machine) => chat.ask(body, machine)));
  router.post('/chat/catalog', express.json({ limit: '512kb' }), handle((body, _signal, machine) => chat.ingestCatalog(body, machine)));
  router.post('/chat/upload', async (request: Request, response: Response) => {
    const declared = Number(request.get('content-length'));
    try {
      const result = await chat.receiveUpload(request.query, {
        contentType: request.get('content-type') ?? '',
        contentLength: request.get('content-length') !== undefined && Number.isFinite(declared) ? declared : null,
        body: request,
      }, response.locals.machine);
      response.status(200).json({ ok: true, result });
    } catch (error) {
      if (error instanceof AttachmentRefusal) {
        response.status(error.status).json({ error: error.message });
        return;
      }
      if (error instanceof OrchestratorInputError) {
        response.status(400).json({ error: error.message });
        return;
      }
      if (request.destroyed || request.aborted) return;
      console.error('[Orchestrator] upload failed:', error instanceof Error ? error.message : 'unknown error');
      response.status(500).json({ error: 'Ingest failed' });
    }
  });
  router.post('/chat/attachment', small, async (request: Request, response: Response) => {
    try {
      const file = await chat.openAttachment(request.body, response.locals.machine);
      if (!file) {
        response.status(404).json({ error: 'Unknown ticket. Send its status first.' });
        return;
      }
      response.status(200).set({
        'content-type': 'application/octet-stream',
        'content-length': String(file.size),
        'x-dock-sha256': file.sha256,
        'cache-control': 'no-store',
      });
      await pipeline(createReadStream(file.path), response);
    } catch (error) {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      if (error instanceof OrchestratorInputError) {
        response.status(400).json({ error: error.message });
        return;
      }
      console.error('[Orchestrator] attachment failed:', error instanceof Error ? error.message : 'unknown error');
      response.status(500).json({ error: 'Ingest failed' });
    }
  });

  router.use((error: unknown, _request: Request, response: Response, _next: express.NextFunction) => {
    const { status, type } = (error ?? {}) as { status?: number; type?: string };
    if (status === 413) {
      response.status(413).json({ error: 'Payload too large' });
      return;
    }
    if (type === 'entity.parse.failed') {
      response.status(400).json({ error: 'Invalid JSON body' });
      return;
    }
    console.error('[Orchestrator] ingest failed:', error instanceof Error ? error.message : 'unknown error');
    response.status(500).json({ error: 'Ingest failed' });
  });

  return router;
}

/** DOCK browser -> transcript for the flow graph. Uses the dashboard session. */
export function createOrchestratorApiRouter(
  service: OrchestratorService = orchestratorService,
  storage = new StorageService(),
): Router {
  const router = Router();

  router.get('/transcript/:key', async (request, response) => {
    try {
      if (shouldRequirePin(request, await storage.hasMasterPin()) && !sessionManager.isAuthenticated(request)) {
        response.status(401).json({ error: 'Unlock DOCK to continue' });
        return;
      }
      const transcript = await service.readTranscript(request.params.key);
      if (!transcript) {
        response.status(404).json({ error: 'No transcript for this ticket' });
        return;
      }
      response.status(200).set('cache-control', 'no-store').type('application/json').send(transcript);
    } catch (error) {
      console.error('[Orchestrator] transcript read failed:', error instanceof Error ? error.message : 'unknown error');
      response.status(500).json({ error: 'Transcript is unavailable' });
    }
  });

  return router;
}
