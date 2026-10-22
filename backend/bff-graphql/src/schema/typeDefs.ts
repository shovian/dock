import { gql } from 'graphql-tag';

export const typeDefs = gql`
  type Ticket {
    key: ID!
    title: String!
    description: String
    status: String!
    assignee: String
    url: String!
    projectKey: String
    projectName: String
    sprintName: String
    sprintState: String
    storyPoints: Float
    labels: [String!]!
    """Work order for the cron: the number set in DOCK, else the ticket's "#N" Jira label."""
    workOrder: Int
    """"dock" when the number was set in DOCK, "label" when it comes from a Jira label."""
    workOrderSource: String
    """True when the owner works the ticket by hand: the cron never takes or resumes it."""
    workManual: Boolean!
    pullRequests: [PullRequest!]
    demoLink: DemoLink
    orchestration: Orchestration
  }

  type TicketGroup {
    status: String!
    tickets: [Ticket!]!
  }

  type TicketRelationGroup {
    primaryKey: String!
    dependsOnKey: String
    ticketKeys: [String!]!
    tickets: [Ticket!]!
  }

  type CommitInfo {
    sha: String!
    author: String
    message: String!
    date: String
    url: String
  }

  type FileInfo {
    filename: String!
    status: String
    additions: Int
    deletions: Int
    changes: Int
    blobUrl: String
  }

  type PullRequest {
    id: ID!
    title: String!
    url: String!
    status: String!
    repo: String!
    type: String!
    owner: String!
    pullNumber: Int!
    baseBranch: String
    headBranch: String
    commitsCount: Int
    commits: [CommitInfo!]
    changedFilesCount: Int
    files: [FileInfo!]
  }

  type ConflictDetail {
    hasConflict: Boolean!
    message: String
  }

  type DemoLink {
    url: String!
    updatedAt: String!
  }

  type QuickLink {
    id: ID!
    title: String!
    url: String!
    color: String!
    position: Int!
  }

  type CalendarEvent {
    id: ID!
    title: String!
    start: String!
    end: String
    allDay: Boolean!
    location: String
    url: String
    calendarId: String
  }

  type MonitorTarget {
    id: ID!
    name: String!
    url: String!
    expectedStatus: Int!
    timeoutMs: Int!
    lastStatus: String
    lastStatusCode: Int
    lastLatencyMs: Int
    lastCheckedAt: String
    lastError: String
  }

  type DockerContainer {
    id: ID!
    name: String!
    project: String
    image: String!
    command: String
    state: String!
    status: String!
    ports: [String!]!
    createdAt: String!
    uptime: String!
    cpuPercent: Float
    memoryUsageBytes: Float
    memoryLimitBytes: Float
    memoryPercent: Float
  }

  type DockerRuntime {
    available: Boolean!
    engineVersion: String
    serverName: String
    total: Int!
    running: Int!
    stopped: Int!
    images: Int!
    containers: [DockerContainer!]!
    refreshedAt: String!
    error: String
  }

  type Settings {
    jiraUrl: String
    jiraEmail: String
    jiraProjectKeys: String
    githubRepos: String
    googleClientId: String
    googleCalendarId: String
    hasJiraApiToken: Boolean!
    hasGithubToken: Boolean!
    hasDiscordWebhookUrl: Boolean!
    discordMessageTemplate: String!
    hasGoogleClientSecret: Boolean!
    googleCalendarConnected: Boolean!
    googleCalendarError: String
    serviceHealthRefreshSeconds: Int!
    hasMasterPin: Boolean
    chatDefaultModel: String
    chatDefaultEffort: String
    chatDefaultMode: String
    chatRtk: String!
    chatCaveman: String!
  }

  type ValidationResult {
    success: Boolean!
    message: String!
  }

  type AuthStatus {
    authenticated: Boolean!
    hasMasterPin: Boolean!
  }

  "One option of a board ask. built marks what sous already built: picking it confirms, any other choice is a revision."
  type BoardOption {
    key: String!
    label: String!
    effect: String
    built: Boolean!
  }

  type BoardAsk {
    question: String!
    options: [BoardOption!]!
  }

  type BoardAnswerPart {
    ask: Int!
    choice: String
    text: String
  }

  "A blackboard entry that waits on the owner: an issue I-n with Resolver OWNER or a SHOV decision D-n."
  type BoardItem {
    id: ID!
    epic: String!
    kind: String!
    ref: String!
    title: String!
    tickets: [String!]!
    type: String
    status: String
    resolver: String
    blocks: String
    escalated: Boolean!
    detail: String
    asks: [BoardAsk!]!
    prs: [String!]!
    findings: String
    source: String
    "The owner's answer that sous has not written to the board yet."
    pending: [BoardAnswerPart!]
    keepsBuilt: Boolean
    answeredAt: String
  }

  type BoardThreadTicket {
    key: String!
    status: String
    assignee: String
  }

  type BoardThreadApprovals {
    have: Int!
    need: Int!
  }

  "A Discord forum thread that sous discord-sync sent, with where it stands in the bug-report flow."
  type BoardThread {
    id: ID!
    forum: String!
    title: String!
    url: String!
    state: String!
    why: String!
    needsYou: Boolean!
    older: Boolean!
    createdAt: String!
    lastActivity: String!
    tags: [String!]!
    tickets: [BoardThreadTicket!]!
    prs: [String!]!
    approvals: BoardThreadApprovals
    lastMessage: String!
    "Hidden by the owner until the thread has a new message."
    dismissed: Boolean!
  }

  type BoardThreadPage {
    rows: [BoardThread!]!
    syncedAt: String
    jiraSnapshotAt: String
    "True while sous discord-sync runs."
    refreshing: Boolean!
    "Why the last refresh failed; empty after one that worked."
    refreshError: String
  }

  type BoardThreadRefresh {
    started: Boolean!
    running: Boolean!
    error: String
  }

  type BoardBatchResult {
    confirmed: Int!
    "Items the owner had already answered; their answer is kept."
    skipped: [ID!]!
  }

  input BoardAnswerInput {
    ask: Int!
    choice: String
    text: String
  }

  type NeedsAttentionItem {
    id: ID!
    type: String!
    message: String!
    ticketKey: String
    prUrl: String
    owner: String
    repo: String
    pullNumber: Int
  }

  type OrchestrationAc {
    n: Int!
    state: String!
    text: String!
    evidence: String
  }

  type OrchestrationEvent {
    id: ID!
    kind: String!
    detail: String
    at: String!
  }

  type TimelineGate {
    id: ID!
    stageIndex: Int!
    text: String!
    state: String!
    at: String!
  }

  type TimelineAgent {
    id: ID!
    parentId: ID
    name: String!
    detail: String
    state: String!
    tool: String
    tools: Int!
  }

  type TimelineBucket {
    n: Int!
    gate: Boolean!
  }

  type TimelineLogEntry {
    at: String!
    kind: String!
    head: String!
    text: String!
  }

  type OrchestrationTimeline {
    stageIndex: Int!
    round: Int!
    loopFrom: Int
    loopTo: Int
    gates: [TimelineGate!]!
    agents: [TimelineAgent!]!
    buckets: [TimelineBucket!]!
    totalTools: Int!
    log: [TimelineLogEntry!]!
  }

  type OrchestrationPullRequest {
    url: String!
    number: Int!
    repo: String!
    status: String!
    reviewDecision: String
    checks: String
  }

  type OrchestrationDecision {
    at: String!
    text: String!
  }

  type OrchestrationAssumption {
    n: Int!
    text: String!
    falsifier: String!
    state: String!
    evidence: String
  }

  type OrchestrationFailure {
    at: String!
    type: String!
    what: String
    evidence: String!
    attempt: Int!
  }

  type DemoVideo {
    ticketKey: String!
    url: String!
    size: Float
    updatedAt: String
  }

  type DemoStorage {
    configured: Boolean!
    endpoint: String!
    region: String!
    bucket: String!
    folder: String!
    publicBaseUrl: String!
    accessKeyMasked: String
    secretSet: Boolean!
  }

  input DemoStorageInput {
    endpoint: String
    region: String
    bucket: String
    folder: String
    publicBaseUrl: String
    accessKey: String
    secretKey: String
  }

  type DemoVideoList {
    configured: Boolean!
    videos: [DemoVideo!]!
  }

  enum DevServerState {
    running
    starting
    stopped
    failed
  }

  type DevServer {
    name: String!
    folder: String!
    port: Int!
    running: Boolean!
    pid: Int
    state: DevServerState!
    error: String
    ticketKey: String
    hasLog: Boolean!
  }

  type DevServerAction {
    at: String!
    target: String!
    action: String!
    ok: Boolean!
    output: String!
  }

  type DevServers {
    main: [DevServer!]!
    secondary: [DevServer!]!
    actions: [DevServerAction!]!
  }

  type ElevenLabsKey {
    name: String!
    masked: String!
    parkedUntil: String
    current: Boolean!
  }

  type OrchestrationClosing {
    hours: Float
    fixRounds: Int!
    replans: Int!
  }

  type OrchestrationFinding {
    at: String!
    severity: String!
    text: String!
  }

  type OrchestrationLgtm {
    at: String!
    text: String!
  }

  type Orchestration {
    key: ID!
    kind: String!
    title: String!
    stage: String!
    waiting: String
    gate: String
    ac: [OrchestrationAc!]!
    acPassed: Int!
    acFailed: Int!
    acTotal: Int!
    testsBe: String
    testsFe: String
    prBe: String
    prFe: String
    pullRequests: [OrchestrationPullRequest!]!
    review: String
    reviewSignal: String
    finished: Boolean!
    note: String
    brief: String
    decisions: [OrchestrationDecision!]!
    assumptions: [OrchestrationAssumption!]!
    failures: [OrchestrationFailure!]!
    closing: OrchestrationClosing
    findings: [OrchestrationFinding!]!
    lgtm: [OrchestrationLgtm!]!
    verdict: String
    blockers: Int!
    activity: String!
    activityDetail: String
    idleSeconds: Int!
    endedSeconds: Float
    stalled: Boolean!
    hasTranscript: Boolean!
    machine: String!
    """The run belongs to another DOCK's machine: shown here, changed only there."""
    remote: Boolean!
    handoverTo: String
    handoverAt: String
    updatedAt: String!
    events: [OrchestrationEvent!]!
    timeline: OrchestrationTimeline
    members: [TimelineAgent!]!
  }

  type IngestToken {
    id: ID!
    name: String!
    prefix: String!
    machine: String!
    createdAt: String!
    lastUsedAt: String
  }

  type IngestTokenSecret {
    token: String!
    record: IngestToken!
  }

  type ChatSession {
    id: ID!
    source: String!
    title: String!
    ticketKey: String
    forkFrom: String
    machine: String!
    status: String!
    statusDetail: String
    messageCount: Int!
    startedAt: String!
    lastMessageAt: String!
    lastText: String
    waiting: Boolean!
    workerCount: Int!
    pending: [ChatInteraction!]!
    settled: [ChatSettled!]!
    options: ChatTurnOptions
  }

  type ChatWorker {
    id: String!
    name: String!
    label: String!
    status: String!
  }

  type ChatMessage {
    id: Int!
    sessionId: ID!
    role: String!
    text: String!
    state: String!
    at: String!
    stopped: Boolean!
    attachments: [ChatAttachment!]!
  }

  type ChatSettled {
    id: Int!
    state: String!
    decision: String
  }

  type ChatInteraction {
    id: Int!
    sessionId: ID!
    turnId: Int!
    kind: String!
    title: String!
    body: String!
    state: String!
    createdAt: String!
    expiresAt: String!
    answeredAt: String
  }

  type ChatAttachment {
    id: ID!
    name: String!
    mime: String!
    size: Int!
    state: String!
  }

  type ChatTurnOptions {
    model: String
    effort: String
    permissionMode: String
    fast: Boolean
  }

  type ChatCommand {
    name: String!
    description: String!
    argumentHint: String!
    kind: String!
  }

  type ChatModel {
    value: String!
    label: String!
    efforts: [String!]!
    fast: Boolean!    auto: Boolean!
  }

  type ChatMachineDefaults {
    model: String
    effort: String
    permissionMode: String
  }

  type ChatMachineOptions {
    models: [ChatModel!]!
    modes: [String!]!
    fastAvailable: Boolean!
    defaults: ChatMachineDefaults!
  }

  input ChatTurnOptionsInput {
    model: String
    effort: String
    permissionMode: String
    fast: Boolean
  }

  input ChatAnswerInput {
    index: Int!
    labels: [String!]!
    other: String
  }

  type ChatActivity {
    id: Int!
    sessionId: ID!
    turnId: Int!
    eventId: String!
    parentId: String
    kind: String!
    agent: String!
    name: String!
    label: String!
    summary: String!
    status: String!
    hasDetail: Boolean!
    seq: Int!
    startedAt: String!
    endedAt: String
  }

  type ChatBridge {
    online: Boolean!
    lastSeenAt: String
  }

  type ChatMachine {
    name: String!
    online: Boolean!
    lastSeenAt: String
    capabilities: [String!]!
    claudeVersion: String
  }

  type ChatLimit {
    usedPercentage: Float!
    resetsAt: String
  }

  type ChatLimits {
    fiveHour: ChatLimit
    sevenDay: ChatLimit
    receivedAt: String!
    stale: Boolean!
  }

  type ChatFileChange {
    path: String!
    added: Int!
    removed: Int!
  }

  type ChatSessionStatus {
    sessionId: ID!
    machine: String
    model: String
    effort: String
    fastMode: Boolean
    contextPercentage: Float
    contextTokens: Float
    contextSize: Float
    costUsd: Float
    cacheWarm: Boolean
    cacheHitRatio: Float
    files: [ChatFileChange!]!
    receivedAt: String!
    stale: Boolean!
  }

  type ChatStatus {
    limits: ChatLimits
    sessions: [ChatSessionStatus!]!
  }

  type ChatSearchHit {
    session: ChatSession!
    messageId: Int!
    snippet: String!
    at: String!
  }

  type GitHubRepo {
    id: ID!
    name: String!
    fullName: String!
    private: Boolean!
    url: String!
    description: String
  }

  type JiraProject {
    id: ID!
    key: String!
    name: String!
  }

  input SettingsInput {
    jiraUrl: String
    jiraEmail: String
    jiraApiToken: String
    jiraProjectKeys: String
    githubToken: String
    githubRepos: String
    discordWebhookUrl: String
    discordMessageTemplate: String
    googleClientId: String
    googleClientSecret: String
    googleCalendarId: String
    serviceHealthRefreshSeconds: Int
    chatDefaultModel: String
    chatDefaultEffort: String
    chatDefaultMode: String
    chatRtk: String
    chatCaveman: String
  }

  input QuickLinkInput {
    title: String!
    url: String!
    color: String
  }

  input MonitorTargetInput {
    name: String!
    url: String!
    expectedStatus: Int
    timeoutMs: Int
  }

  type SprintSummary {
    id: Int!
    name: String!
    state: String!
    startDate: String!
    endDate: String!
    computedAt: String
    lastError: String
  }

  type SprintRefreshState {
    status: String!
    label: String!
    done: Int!
    total: Int!
    error: String
  }

  type SprintDashboard {
    summary: SprintSummary
    result: String
    refreshState: SprintRefreshState!
  }

  type SprintDashboardSettings {
    boardId: String!
    config: String!
  }

  type OrchestratorCronSettings {
    config: String!
    webhookSet: Boolean!
    lastFill: String!
  }

  type Query {
    authStatus: AuthStatus!
    dockMode: String!
    "True when DOCK shows a blackboard owned by sous: no cron, no chat answers, no Jira moves, no Discord posts."
    boardMode: Boolean!
    dashboard: [TicketGroup!]!
    ticketDetail(key: String!): Ticket
    ticketRelationGroup(ticketKey: String!): TicketRelationGroup!
    needsAttention: [NeedsAttentionItem!]!
    boardItems: [BoardItem!]!
    boardThreads: BoardThreadPage!
    settings: Settings
    jiraProjects(url: String, email: String, token: String): [JiraProject!]!
    githubRepos(token: String): [GitHubRepo!]!
    quickLinks: [QuickLink!]!
    calendarEvents(timeMin: String, timeMax: String, maxResults: Int): [CalendarEvent!]!
    monitors(refresh: Boolean = false): [MonitorTarget!]!
    dockerRuntime(includeStats: Boolean = false): DockerRuntime!
    dockerContainerLogs(id: ID!, tail: Int = 100): String!
    orchestrations: [Orchestration!]!
    orchestration(key: String!): Orchestration
    ingestTokens: [IngestToken!]!
    demoVideos: DemoVideoList!
    demoStorage: DemoStorage!
    devServers: DevServers!
    devServerLog(name: String!, bytes: Int): String!
    elevenLabsKeys: [ElevenLabsKey!]!
    chatSessions(source: String, limit: Int): [ChatSession!]!
    chatSession(id: ID!): ChatSession
    chatMessages(sessionId: ID!, afterId: Int, beforeId: Int, limit: Int): [ChatMessage!]!
    chatActivity(sessionId: ID!, afterSeq: Int, fromTurnId: Int, beforeTurnId: Int, limit: Int): [ChatActivity!]!
    chatSessionWorkers(sessionId: ID!): [ChatWorker!]!
    chatActivityDetail(sessionId: ID!, id: Int!): String
    chatSearch(query: String!, limit: Int): [ChatSearchHit!]!
    chatBridge: ChatBridge!
    chatMachines: [ChatMachine!]!
    chatStatus(machine: String): ChatStatus!
    chatBalloons: [ChatMessage!]!
    chatCommands(machine: String!, query: String, limit: Int): [ChatCommand!]!
    chatMachineOptions(machine: String!): ChatMachineOptions
    sprintList: [SprintSummary!]!
    sprintDashboard(sprintId: Int): SprintDashboard!
    sprintTrend: String!
    sprintIssueEvents(sprintId: Int!): String!
    sprintDashboardSettings: SprintDashboardSettings!
    orchestratorCronSettings: OrchestratorCronSettings!
    """JSON: cron slots in use, today's count against the cap, and the last fill (started, parked, deferred)."""
    orchestratorCronStatus: String!
    pushPublicKey: String!
  }

  type Mutation {
    "Saves the owner's answer to a board item; sous writes it to the board later. A new answer before then replaces the old one."
    answerBoardItem(id: ID!, answers: [BoardAnswerInput!]!): Boolean!
    "Confirm all except: keeps what sous built for each listed item."
    confirmBoardItems(ids: [ID!]!): BoardBatchResult!
    "Hides a Discord thread until it has a new message. False when the thread is not open."
    dismissBoardThread(id: String!): Boolean!
    "Starts sous discord-sync unless it already runs; does not wait for it."
    refreshBoardThreads: BoardThreadRefresh!
    lockSession: Boolean!
    saveDemoLink(ticketKey: String!, url: String!): Boolean
    sendToDiscord(ticketKey: String!, customMessage: String, threadId: String, threadName: String): Boolean
    setTicketDependency(ticketKey: String!, dependsOnKey: String!): TicketRelationGroup!
    clearTicketDependency(ticketKey: String!): TicketRelationGroup!
    setTicketWorkOrder(ticketKey: String!, position: Int!): Boolean!
    clearTicketWorkOrder(ticketKey: String!): Boolean!
    setTicketManual(ticketKey: String!, manual: Boolean!): Boolean!
    updateSettings(input: SettingsInput!): Boolean
    validateJira(url: String, email: String, token: String): ValidationResult
    validateGitHub(token: String): ValidationResult
    validateDiscord(webhookUrl: String): ValidationResult
    setMasterPin(pin: String!): Boolean
    changeMasterPin(oldPin: String!, newPin: String!): Boolean
    verifyMasterPin(pin: String!): Boolean
    removeMasterPin(oldPin: String!): Boolean
    refreshData: Boolean
    checkConflicts(owner: String!, repo: String!, pullNumber: Int!): ConflictDetail
    addQuickLink(input: QuickLinkInput!): QuickLink!
    removeQuickLink(id: ID!): Boolean!
    disconnectGoogleCalendar: Boolean!
    addMonitor(input: MonitorTargetInput!): MonitorTarget!
    updateMonitor(id: ID!, input: MonitorTargetInput!): MonitorTarget!
    removeMonitor(id: ID!): Boolean!
    checkMonitors: [MonitorTarget!]!
    createIngestToken(name: String!, machine: String): IngestTokenSecret!
    revokeIngestToken(id: ID!): Boolean!
    deleteDemoVideo(ticketKey: String!): Boolean!
    saveDemoStorage(input: DemoStorageInput!): DemoStorage!
    clearDemoStorage: Boolean!
    startDevServer(name: String!): Boolean!
    stopDevServer(name: String!): Boolean!
    restartDevServer(name: String!): Boolean!
    startAllDevServers: Boolean!
    stopAllDevServers: Boolean!
    stopWorktreeServer(port: Int!): Boolean!
    addElevenLabsKey(name: String!, key: String!): Boolean!
    removeElevenLabsKey(name: String!): Boolean!
    unparkElevenLabsKey(name: String!): Boolean!
    dismissOrchestration(key: String!): Boolean!
    moveOrchestration(key: String!, machine: String!): Orchestration!
    createChatSession(title: String, ticketKey: String, forkFrom: ID, machine: String): ChatSession!
    sendChatMessage(sessionId: ID!, text: String!, attachmentIds: [ID!], options: ChatTurnOptionsInput, mode: String): ChatMessage!
    answerChatInteraction(sessionId: ID!, id: Int!, decision: String!, answers: [ChatAnswerInput!], note: String): ChatInteraction!
    answerTicket(ticketKey: String!, text: String!): Boolean!
    stopChatTurn(sessionId: ID!): ChatSession!
    renameChatSession(id: ID!, title: String!): ChatSession!
    setChatSessionOptions(id: ID!, options: ChatTurnOptionsInput!): ChatSession!
    deleteChatSession(id: ID!): Boolean!
    refreshSprintDashboard(sprintId: Int!): SprintRefreshState!
    backfillSprintDashboards(count: Int!): SprintRefreshState!
    updateSprintDashboardSettings(boardId: String!, config: String!): Boolean!
    updateOrchestratorCronSettings(config: String!, webhookUrl: String): Boolean!
    runOrchestratorCronNow: String!
    confirmOrchestration(key: String!): Boolean!
    stopAllAgents: Int!
    subscribePush(endpoint: String!, p256dh: String!, auth: String!): Boolean!
    unsubscribePush(endpoint: String!): Boolean!
    sendTestPush: Int!
  }
`;
