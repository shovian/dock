import { gql } from '@apollo/client';

export const GET_AUTH_STATUS = gql`
  query GetAuthStatus {
    authStatus {
      authenticated
      hasMasterPin
    }
    dockMode
    boardMode
  }
`;

export const GET_DASHBOARD = gql`
  query GetDashboard {
    dashboard {
      status
      tickets {
        key
        title
        status
        assignee
        url
        sprintName
        sprintState
        storyPoints
        labels
        workOrder
        workOrderSource
        workManual
        orchestration {
          key
          machine
          kind
          stage
          waiting
          acPassed
          acFailed
          acTotal
          activity
          stalled
        }
      }
    }
  }
`;

export const GET_TICKET_DETAIL = gql`
  query GetTicketDetail($key: String!) {
    ticketDetail(key: $key) {
      key
      title
      description
      status
      assignee
      url
      sprintName
      sprintState
      storyPoints
      labels
      workOrder
      workOrderSource
      workManual
      pullRequests {
        id
        title
        url
        status
        repo
        type
        owner
        pullNumber
        baseBranch
        headBranch
        commitsCount
        commits {
          sha
          author
          message
          date
          url
        }
        changedFilesCount
        files {
          filename
          status
          additions
          deletions
          changes
          blobUrl
        }
      }
      demoLink {
        url
        updatedAt
      }
    }
    ticketRelationGroup(ticketKey: $key) {
      primaryKey
      dependsOnKey
      ticketKeys
      tickets {
        key
        title
        url
        pullRequests {
          id
          title
          url
          status
          repo
          type
        }
        demoLink { url }
      }
    }
    dashboard {
      tickets { key title status }
    }
    settings {
      discordMessageTemplate
    }
  }
`;

export const GET_TICKET_DETAIL_CORE = gql`
  query GetTicketDetailCore($key: String!) {
    ticketDetail(key: $key) {
      key
      title
      description
      status
      assignee
      url
      sprintName
      sprintState
      storyPoints
      labels
      workOrder
      workOrderSource
      workManual
    }
    ticketRelationGroup(ticketKey: $key) {
      primaryKey
      dependsOnKey
      ticketKeys
    }
    dashboard {
      tickets { key title status }
    }
    settings {
      discordMessageTemplate
    }
  }
`;

export const GET_TICKET_DETAIL_ENRICHMENT = gql`
  query GetTicketDetailEnrichment($key: String!) {
    ticketDetail(key: $key) {
      key
      pullRequests {
        id
        title
        url
        status
        repo
        type
        owner
        pullNumber
        baseBranch
        headBranch
        commitsCount
        commits {
          sha
          author
          message
          date
          url
        }
        changedFilesCount
        files {
          filename
          status
          additions
          deletions
          changes
          blobUrl
        }
      }
      demoLink {
        url
        updatedAt
      }
    }
    ticketRelationGroup(ticketKey: $key) {
      primaryKey
      dependsOnKey
      ticketKeys
      tickets {
        key
        title
        url
        pullRequests {
          id
          title
          url
          status
          repo
          type
        }
        demoLink { url }
      }
    }
  }
`;

export const GET_NEEDS_ATTENTION = gql`
  query GetNeedsAttention {
    needsAttention {
      id
      type
      message
      ticketKey
      prUrl
      owner
      repo
      pullNumber
    }
  }
`;

export const GET_SETTINGS = gql`
  query GetSettings {
    settings {
      jiraUrl
      jiraEmail
      jiraProjectKeys
      githubRepos
      googleClientId
      googleCalendarId
      hasJiraApiToken
      hasGithubToken
      hasDiscordWebhookUrl
      discordMessageTemplate
      hasGoogleClientSecret
      googleCalendarConnected
      googleCalendarError
      serviceHealthRefreshSeconds
      hasMasterPin
      chatDefaultModel
      chatDefaultEffort
      chatDefaultMode
      chatRtk
      chatCaveman
    }
  }
`;

export const GET_HOME = gql`
  query GetHome {
    quickLinks {
      id
      title
      url
      color
      position
    }
    dashboard {
      status
      tickets {
        key
        title
        status
        sprintName
        storyPoints
      }
    }
    needsAttention {
      id
      message
      ticketKey
    }
    calendarEvents(maxResults: 50) {
      id
      title
      start
      end
      allDay
      location
      url
      calendarId
    }
    monitors(refresh: true) {
      id
      name
      url
      lastStatus
      lastStatusCode
      lastLatencyMs
      lastCheckedAt
    }
    settings {
      serviceHealthRefreshSeconds
    }
    dockerRuntime {
      available
      total
      running
      stopped
      containers { id name image state uptime }
    }
  }
`;

export const GET_HOME_CORE = gql`
  query GetHomeCore {
    quickLinks {
      id
      title
      url
      color
      position
    }
    dashboard {
      status
      tickets {
        key
        title
        status
        sprintName
        storyPoints
      }
    }
  }
`;

export const GET_HOME_SECONDARY = gql`
  query GetHomeSecondary($calendar: Boolean = true, $docker: Boolean = true) {
    needsAttention {
      id
      message
      ticketKey
    }
    orchestrations {
      key
      machine
      kind
      title
      stage
      waiting
      acPassed
      acFailed
      acTotal
      activity
      idleSeconds
      endedSeconds
      stalled
      finished
    }
    calendarEvents(maxResults: 50) @include(if: $calendar) {
      id
      title
      start
      end
      allDay
      location
      url
      calendarId
    }
    monitors(refresh: true) {
      id
      name
      url
      lastStatus
      lastStatusCode
      lastLatencyMs
      lastCheckedAt
    }
    settings {
      serviceHealthRefreshSeconds
    }
    dockerRuntime @include(if: $docker) {
      available
      total
      running
      stopped
      containers { id name image state uptime }
    }
  }
`;

export const GET_CALENDAR = gql`
  query GetCalendar($timeMin: String, $timeMax: String, $maxResults: Int) {
    calendarEvents(timeMin: $timeMin, timeMax: $timeMax, maxResults: $maxResults) {
      id
      title
      start
      end
      allDay
      location
      url
      calendarId
    }
  }
`;

export const GET_SPRINT_LIST = gql`
  query GetSprintList {
    sprintList {
      id
      name
      state
      startDate
      endDate
      computedAt
      lastError
    }
  }
`;

export const GET_SPRINT_DASHBOARD = gql`
  query GetSprintDashboard($sprintId: Int) {
    sprintDashboard(sprintId: $sprintId) {
      summary {
        id
        name
        state
        startDate
        endDate
        computedAt
        lastError
      }
      result
      refreshState {
        status
        label
        done
        total
        error
      }
    }
  }
`;

export const GET_SPRINT_TREND = gql`
  query GetSprintTrend {
    sprintTrend
  }
`;

export const GET_SPRINT_SETTINGS = gql`
  query GetSprintSettings {
    sprintDashboardSettings {
      boardId
      config
    }
  }
`;

export const GET_MONITORS = gql`
  query GetMonitors($refresh: Boolean = false, $docker: Boolean = true) {
    monitors(refresh: $refresh) {
      id
      name
      url
      expectedStatus
      timeoutMs
      lastStatus
      lastStatusCode
      lastLatencyMs
      lastCheckedAt
      lastError
    }
    settings {
      serviceHealthRefreshSeconds
    }
    dockerRuntime @include(if: $docker) {
      available
      total
      running
      stopped
      containers { id name image state uptime }
    }
  }
`;

export const GET_DOCKER_RUNTIME = gql`
  query GetDockerRuntime($includeStats: Boolean = true) {
    dockerRuntime(includeStats: $includeStats) {
      available
      engineVersion
      serverName
      total
      running
      stopped
      images
      refreshedAt
      error
      containers {
        id
        name
        project
        image
        command
        state
        status
        ports
        createdAt
        uptime
        cpuPercent
        memoryUsageBytes
        memoryLimitBytes
        memoryPercent
      }
    }
  }
`;

export const GET_DOCKER_CONTAINER_LOGS = gql`
  query GetDockerContainerLogs($id: ID!, $tail: Int = 100) {
    dockerContainerLogs(id: $id, tail: $tail)
  }
`;

export const GET_JIRA_PROJECTS = gql`
  query GetJiraProjects($url: String, $email: String, $token: String) {
    jiraProjects(url: $url, email: $email, token: $token) {
      id
      key
      name
    }
  }
`;

export const GET_GITHUB_REPOS = gql`
  query GetGithubRepos($token: String) {
    githubRepos(token: $token) {
      id
      name
      fullName
      private
      url
      description
    }
  }
`;

export const ORCHESTRATION_FIELDS = `
  key
  kind
  title
  stage
  waiting
  gate
  ac { n state text evidence }
  acPassed
  acFailed
  acTotal
  testsBe
  testsFe
  prBe
  prFe
  pullRequests {
    url
    number
    repo
    status
    reviewDecision
    checks
  }
  review
  reviewSignal
  finished
  note
  brief
  decisions { at text }
  assumptions { n text falsifier state evidence }
  failures { at type what evidence attempt }
  closing { hours fixRounds replans }
  findings { at severity text }
  lgtm { at text }
  verdict
  blockers
  activity
  activityDetail
  idleSeconds
  endedSeconds
  stalled
  hasTranscript
  machine
  remote
  handoverTo
  handoverAt
  updatedAt
`;

export const GET_ORCHESTRATIONS = gql`
  query GetOrchestrations {
    orchestrations {
      ${ORCHESTRATION_FIELDS}
      members { id parentId name detail state tool tools }
    }
  }
`;

export const GET_ORCHESTRATION = gql`
  query GetOrchestration($key: String!) {
    orchestration(key: $key) {
      ${ORCHESTRATION_FIELDS}
      events { id kind detail at }
      timeline {
        stageIndex
        round
        loopFrom
        loopTo
        gates { id stageIndex text state at }
        agents { id parentId name detail state tool tools }
        buckets { n gate }
        totalTools
        log { at kind head text }
      }
    }
  }
`;

export const GET_INGEST_TOKENS = gql`
  query GetIngestTokens {
    ingestTokens {
      id
      name
      prefix
      machine
      createdAt
      lastUsedAt
    }
  }
`;

export const CHAT_SESSION_FIELDS = `
  id
  source
  title
  ticketKey
  forkFrom
  machine
  status
  statusDetail
  messageCount
  startedAt
  lastMessageAt
  lastText
  waiting
  workerCount
`;

export const CHAT_INTERACTION_FIELDS = `
  id
  sessionId
  turnId
  kind
  title
  body
  state
  createdAt
  expiresAt
  answeredAt
`;

export const CHAT_MESSAGE_FIELDS = `
  id
  sessionId
  role
  text
  state
  at
  stopped
  attachments {
    id
    name
    mime
    size
    state
  }
`;

export const GET_CHAT_SESSIONS = gql`
  query GetChatSessions($source: String, $limit: Int) {
    chatSessions(source: $source, limit: $limit) {
      ${CHAT_SESSION_FIELDS}
    }
  }
`;

export const GET_CHAT_SESSION_WORKERS = gql`
  query GetChatSessionWorkers($sessionId: ID!) {
    chatSessionWorkers(sessionId: $sessionId) {
      id
      name
      label
      status
    }
  }
`;

export const GET_CHAT_SESSION = gql`
  query GetChatSession($id: ID!) {
    chatSession(id: $id) {
      ${CHAT_SESSION_FIELDS}
      pending {
        ${CHAT_INTERACTION_FIELDS}
      }
      settled {
        id
        state
        decision
      }
      options {
        model
        effort
        permissionMode
        fast
      }
    }
    chatBridge {
      online
      lastSeenAt
    }
    chatMachines {
      name
      online
      lastSeenAt
      capabilities
    }
  }
`;

export const GET_CHAT_MESSAGES = gql`
  query GetChatMessages($sessionId: ID!, $afterId: Int, $beforeId: Int, $limit: Int) {
    chatMessages(sessionId: $sessionId, afterId: $afterId, beforeId: $beforeId, limit: $limit) {
      ${CHAT_MESSAGE_FIELDS}
    }
  }
`;

export const CHAT_ACTIVITY_FIELDS = `
  id
  sessionId
  turnId
  eventId
  parentId
  kind
  agent
  name
  label
  summary
  status
  hasDetail
  seq
  startedAt
  endedAt
`;

export const GET_CHAT_ACTIVITY = gql`
  query GetChatActivity($sessionId: ID!, $afterSeq: Int, $fromTurnId: Int, $beforeTurnId: Int, $limit: Int) {
    chatActivity(sessionId: $sessionId, afterSeq: $afterSeq, fromTurnId: $fromTurnId, beforeTurnId: $beforeTurnId, limit: $limit) {
      ${CHAT_ACTIVITY_FIELDS}
    }
  }
`;

export const GET_CHAT_ACTIVITY_DETAIL = gql`
  query GetChatActivityDetail($sessionId: ID!, $id: Int!) {
    chatActivityDetail(sessionId: $sessionId, id: $id)
  }
`;

export const SEARCH_CHAT = gql`
  query SearchChat($query: String!, $limit: Int) {
    chatSearch(query: $query, limit: $limit) {
      session {
        ${CHAT_SESSION_FIELDS}
      }
      messageId
      snippet
      at
    }
  }
`;

export const GET_CHAT_BRIDGE = gql`
  query GetChatBridge {
    chatBridge {
      online
      lastSeenAt
    }
  }
`;

export const GET_CHAT_MACHINES = gql`
  query GetChatMachines {
    chatMachines {
      name
      online
      lastSeenAt
    }
  }
`;

export const GET_CHAT_STATUS = gql`
  query GetChatStatus($machine: String) {
    chatStatus(machine: $machine) {
      limits {
        fiveHour { usedPercentage resetsAt }
        sevenDay { usedPercentage resetsAt }
        receivedAt
        stale
      }
      sessions {
        sessionId
        model
        effort
        fastMode
        contextPercentage
        contextTokens
        contextSize
        costUsd
        cacheWarm
        cacheHitRatio
        files { path added removed }
        receivedAt
        stale
      }
    }
  }
`;

export const GET_CHAT_BALLOONS = gql`
  query GetChatBalloons {
    chatBalloons {
      ${CHAT_MESSAGE_FIELDS}
    }
    chatSessions(source: "dock", limit: 300) {
      id
      ticketKey
    }
  }
`;

export const GET_ORCHESTRATOR_CRON_SETTINGS = gql`
  query GetOrchestratorCronSettings {
    orchestratorCronSettings {
      config
      webhookSet
      lastFill
    }
  }
`;

export const GET_ORCHESTRATOR_CRON_STATUS = gql`
  query GetOrchestratorCronStatus {
    orchestratorCronStatus
  }
`;

export const GET_PUSH_PUBLIC_KEY = gql`
  query GetPushPublicKey {
    pushPublicKey
  }
`;

export const GET_DEMO_VIDEOS = gql`
  query GetDemoVideos {
    demoVideos {
      videos { ticketKey url size updatedAt }
    }
  }
`;

export const GET_DEV_SERVERS = gql`
  query GetDevServers {
    devServers {
      main { name folder port running pid state error ticketKey hasLog }
      secondary { name folder port running pid state error ticketKey hasLog }
      actions { at target action ok output }
    }
  }
`;

export const GET_DEV_SERVER_LOG = gql`
  query GetDevServerLog($name: String!, $bytes: Int) {
    devServerLog(name: $name, bytes: $bytes)
  }
`;

export const GET_ELEVENLABS_KEYS = gql`
  query GetElevenLabsKeys {
    elevenLabsKeys {
      name
      masked
      parkedUntil
      current
    }
  }
`;

export const GET_DEMO_STORAGE = gql`
  query GetDemoStorage {
    demoStorage { configured endpoint region bucket folder publicBaseUrl accessKeyMasked secretSet }
  }
`;

export const GET_BOARD_ITEMS = gql`
  query GetBoardItems {
    boardItems {
      id
      epic
      kind
      ref
      title
      tickets
      type
      status
      resolver
      blocks
      escalated
      detail
      asks { question options { key label effect built } }
      prs
      findings
      source
      pending { ask choice text }
      keepsBuilt
      answeredAt
    }
  }
`;

export const BOARD_ANSWER_JOB = gql`
  query BoardAnswerJob {
    boardAnswerJob { pending running lastError configured }
  }
`;

export const BOARD_THREADS = gql`
  query BoardThreads {
    boardThreads {
      rows {
        id
        forum
        title
        url
        state
        why
        needsYou
        older
        createdAt
        lastActivity
        tags
        tickets { key status assignee }
        prs
        approvals { have need }
        slots { have need }
        lastMessage
        dismissed
      }
      syncedAt
      jiraSnapshotAt
      refreshing
      refreshError
    }
  }
`;
