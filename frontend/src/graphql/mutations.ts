import { gql } from '@apollo/client';
import { CHAT_INTERACTION_FIELDS, CHAT_MESSAGE_FIELDS, CHAT_SESSION_FIELDS, ORCHESTRATION_FIELDS } from './queries';

export const SAVE_DEMO_LINK = gql`
  mutation SaveDemoLink($ticketKey: String!, $url: String!) {
    saveDemoLink(ticketKey: $ticketKey, url: $url)
  }
`;

export const SEND_TO_DISCORD = gql`
  mutation SendToDiscord($ticketKey: String!, $customMessage: String, $threadId: String, $threadName: String) {
    sendToDiscord(ticketKey: $ticketKey, customMessage: $customMessage, threadId: $threadId, threadName: $threadName)
  }
`;

export const SET_TICKET_DEPENDENCY = gql`
  mutation SetTicketDependency($ticketKey: String!, $dependsOnKey: String!) {
    setTicketDependency(ticketKey: $ticketKey, dependsOnKey: $dependsOnKey) {
      primaryKey
      dependsOnKey
      ticketKeys
    }
  }
`;

export const CLEAR_TICKET_DEPENDENCY = gql`
  mutation ClearTicketDependency($ticketKey: String!) {
    clearTicketDependency(ticketKey: $ticketKey) {
      primaryKey
      dependsOnKey
      ticketKeys
    }
  }
`;

export const UPDATE_SETTINGS = gql`
  mutation UpdateSettings($input: SettingsInput!) {
    updateSettings(input: $input)
  }
`;

export const REFRESH_DATA = gql`
  mutation RefreshData {
    refreshData
  }
`;

export const CHECK_CONFLICTS = gql`
  mutation CheckConflicts($owner: String!, $repo: String!, $pullNumber: Int!) {
    checkConflicts(owner: $owner, repo: $repo, pullNumber: $pullNumber) {
      hasConflict
      message
    }
  }
`;

export const VALIDATE_JIRA = gql`
  mutation ValidateJira($url: String, $email: String, $token: String) {
    validateJira(url: $url, email: $email, token: $token) {
      success
      message
    }
  }
`;

export const VALIDATE_GITHUB = gql`
  mutation ValidateGitHub($token: String) {
    validateGitHub(token: $token) {
      success
      message
    }
  }
`;

export const VALIDATE_DISCORD = gql`
  mutation ValidateDiscord($webhookUrl: String) {
    validateDiscord(webhookUrl: $webhookUrl) {
      success
      message
    }
  }
`;

export const SET_MASTER_PIN = gql`
  mutation SetMasterPin($pin: String!) {
    setMasterPin(pin: $pin)
  }
`;

export const CHANGE_MASTER_PIN = gql`
  mutation ChangeMasterPin($oldPin: String!, $newPin: String!) {
    changeMasterPin(oldPin: $oldPin, newPin: $newPin)
  }
`;

export const VERIFY_MASTER_PIN = gql`
  mutation VerifyMasterPin($pin: String!) {
    verifyMasterPin(pin: $pin)
  }
`;

export const REMOVE_MASTER_PIN = gql`
  mutation RemoveMasterPin($oldPin: String!) {
    removeMasterPin(oldPin: $oldPin)
  }
`;

export const ADD_QUICK_LINK = gql`
  mutation AddQuickLink($input: QuickLinkInput!) {
    addQuickLink(input: $input) {
      id
      title
      url
      color
      position
    }
  }
`;

export const REMOVE_QUICK_LINK = gql`
  mutation RemoveQuickLink($id: ID!) {
    removeQuickLink(id: $id)
  }
`;

export const REFRESH_SPRINT_DASHBOARD = gql`
  mutation RefreshSprintDashboard($sprintId: Int!) {
    refreshSprintDashboard(sprintId: $sprintId) {
      status
      label
      done
      total
      error
    }
  }
`;

export const BACKFILL_SPRINT_DASHBOARDS = gql`
  mutation BackfillSprintDashboards($count: Int!) {
    backfillSprintDashboards(count: $count) {
      status
      label
      done
      total
      error
    }
  }
`;

export const UPDATE_SPRINT_DASHBOARD_SETTINGS = gql`
  mutation UpdateSprintDashboardSettings($boardId: String!, $config: String!) {
    updateSprintDashboardSettings(boardId: $boardId, config: $config)
  }
`;

export const ADD_MONITOR = gql`
  mutation AddMonitor($input: MonitorTargetInput!) {
    addMonitor(input: $input) {
      id
      name
      url
      expectedStatus
      timeoutMs
    }
  }
`;

export const REMOVE_MONITOR = gql`
  mutation RemoveMonitor($id: ID!) {
    removeMonitor(id: $id)
  }
`;

export const UPDATE_MONITOR = gql`
  mutation UpdateMonitor($id: ID!, $input: MonitorTargetInput!) {
    updateMonitor(id: $id, input: $input) {
      id
      name
      url
      expectedStatus
      timeoutMs
    }
  }
`;

export const CHECK_MONITORS = gql`
  mutation CheckMonitors {
    checkMonitors {
      id
      lastStatus
      lastStatusCode
      lastLatencyMs
      lastCheckedAt
      lastError
    }
  }
`;

export const DISCONNECT_GOOGLE_CALENDAR = gql`
  mutation DisconnectGoogleCalendar {
    disconnectGoogleCalendar
  }
`;

export const CREATE_INGEST_TOKEN = gql`
  mutation CreateIngestToken($name: String!, $machine: String) {
    createIngestToken(name: $name, machine: $machine) {
      token
      record {
        id
        name
        prefix
        machine
        createdAt
        lastUsedAt
      }
    }
  }
`;

export const REVOKE_INGEST_TOKEN = gql`
  mutation RevokeIngestToken($id: ID!) {
    revokeIngestToken(id: $id)
  }
`;

export const DISMISS_ORCHESTRATION = gql`
  mutation DismissOrchestration($key: String!) {
    dismissOrchestration(key: $key)
  }
`;

export const MOVE_ORCHESTRATION = gql`
  mutation MoveOrchestration($key: String!, $machine: String!) {
    moveOrchestration(key: $key, machine: $machine) {
      ${ORCHESTRATION_FIELDS}
    }
  }
`;

export const CREATE_CHAT_SESSION = gql`
  mutation CreateChatSession($title: String, $ticketKey: String, $forkFrom: ID, $machine: String) {
    createChatSession(title: $title, ticketKey: $ticketKey, forkFrom: $forkFrom, machine: $machine) {
      ${CHAT_SESSION_FIELDS}
    }
  }
`;

export const SEND_CHAT_MESSAGE = gql`
  mutation SendChatMessage($sessionId: ID!, $text: String!, $attachmentIds: [ID!], $options: ChatTurnOptionsInput, $mode: String) {
    sendChatMessage(sessionId: $sessionId, text: $text, attachmentIds: $attachmentIds, options: $options, mode: $mode) {
      ${CHAT_MESSAGE_FIELDS}
    }
  }
`;

export const ANSWER_CHAT_INTERACTION = gql`
  mutation AnswerChatInteraction($sessionId: ID!, $id: Int!, $decision: String!, $answers: [ChatAnswerInput!], $note: String) {
    answerChatInteraction(sessionId: $sessionId, id: $id, decision: $decision, answers: $answers, note: $note) {
      ${CHAT_INTERACTION_FIELDS}
    }
  }
`;

export const STOP_CHAT_TURN = gql`
  mutation StopChatTurn($sessionId: ID!) {
    stopChatTurn(sessionId: $sessionId) {
      ${CHAT_SESSION_FIELDS}
    }
  }
`;

export const RENAME_CHAT_SESSION = gql`
  mutation RenameChatSession($id: ID!, $title: String!) {
    renameChatSession(id: $id, title: $title) {
      ${CHAT_SESSION_FIELDS}
    }
  }
`;

export const DELETE_CHAT_SESSION = gql`
  mutation DeleteChatSession($id: ID!) {
    deleteChatSession(id: $id)
  }
`;

export const SET_TICKET_WORK_ORDER = gql`
  mutation SetTicketWorkOrder($ticketKey: String!, $position: Int!) {
    setTicketWorkOrder(ticketKey: $ticketKey, position: $position)
  }
`;

export const CLEAR_TICKET_WORK_ORDER = gql`
  mutation ClearTicketWorkOrder($ticketKey: String!) {
    clearTicketWorkOrder(ticketKey: $ticketKey)
  }
`;

export const SET_TICKET_MANUAL = gql`
  mutation SetTicketManual($ticketKey: String!, $manual: Boolean!) {
    setTicketManual(ticketKey: $ticketKey, manual: $manual)
  }
`;

export const UPDATE_ORCHESTRATOR_CRON_SETTINGS = gql`
  mutation UpdateOrchestratorCronSettings($config: String!, $webhookUrl: String) {
    updateOrchestratorCronSettings(config: $config, webhookUrl: $webhookUrl)
  }
`;

export const RUN_ORCHESTRATOR_CRON_NOW = gql`
  mutation RunOrchestratorCronNow {
    runOrchestratorCronNow
  }
`;

export const CONFIRM_ORCHESTRATION = gql`
  mutation ConfirmOrchestration($key: String!) {
    confirmOrchestration(key: $key)
  }
`;

export const STOP_ALL_AGENTS = gql`
  mutation StopAllAgents {
    stopAllAgents
  }
`;

export const SUBSCRIBE_PUSH = gql`
  mutation SubscribePush($endpoint: String!, $p256dh: String!, $auth: String!) {
    subscribePush(endpoint: $endpoint, p256dh: $p256dh, auth: $auth)
  }
`;

export const UNSUBSCRIBE_PUSH = gql`
  mutation UnsubscribePush($endpoint: String!) {
    unsubscribePush(endpoint: $endpoint)
  }
`;

export const SEND_TEST_PUSH = gql`
  mutation SendTestPush {
    sendTestPush
  }
`;

export const SET_CHAT_SESSION_OPTIONS = gql`
  mutation SetChatSessionOptions($id: ID!, $options: ChatTurnOptionsInput!) {
    setChatSessionOptions(id: $id, options: $options) {
      ${CHAT_SESSION_FIELDS}
      options {
        model
        effort
        permissionMode
        fast
      }
    }
  }
`;

export const DELETE_DEMO_VIDEO = gql`
  mutation DeleteDemoVideo($ticketKey: String!) {
    deleteDemoVideo(ticketKey: $ticketKey)
  }
`;

export const START_DEV_SERVER = gql`
  mutation StartDevServer($name: String!) {
    startDevServer(name: $name)
  }
`;

export const STOP_DEV_SERVER = gql`
  mutation StopDevServer($name: String!) {
    stopDevServer(name: $name)
  }
`;

export const RESTART_DEV_SERVER = gql`
  mutation RestartDevServer($name: String!) {
    restartDevServer(name: $name)
  }
`;

export const START_ALL_DEV_SERVERS = gql`
  mutation StartAllDevServers {
    startAllDevServers
  }
`;

export const STOP_ALL_DEV_SERVERS = gql`
  mutation StopAllDevServers {
    stopAllDevServers
  }
`;

export const STOP_WORKTREE_SERVER = gql`
  mutation StopWorktreeServer($port: Int!) {
    stopWorktreeServer(port: $port)
  }
`;

export const ADD_ELEVENLABS_KEY = gql`
  mutation AddElevenLabsKey($name: String!, $key: String!) {
    addElevenLabsKey(name: $name, key: $key)
  }
`;

export const REMOVE_ELEVENLABS_KEY = gql`
  mutation RemoveElevenLabsKey($name: String!) {
    removeElevenLabsKey(name: $name)
  }
`;

export const UNPARK_ELEVENLABS_KEY = gql`
  mutation UnparkElevenLabsKey($name: String!) {
    unparkElevenLabsKey(name: $name)
  }
`;

export const SAVE_DEMO_STORAGE = gql`
  mutation SaveDemoStorage($input: DemoStorageInput!) {
    saveDemoStorage(input: $input) { configured endpoint region bucket folder publicBaseUrl accessKeyMasked secretSet }
  }
`;

export const CLEAR_DEMO_STORAGE = gql`
  mutation ClearDemoStorage {
    clearDemoStorage
  }
`;

export const ANSWER_TICKET = gql`
  mutation AnswerTicket($ticketKey: String!, $text: String!) {
    answerTicket(ticketKey: $ticketKey, text: $text)
  }
`;

export const ANSWER_BOARD_ITEM = gql`
  mutation AnswerBoardItem($id: ID!, $answers: [BoardAnswerInput!]!) {
    answerBoardItem(id: $id, answers: $answers)
  }
`;

export const CONFIRM_BOARD_ITEMS = gql`
  mutation ConfirmBoardItems($ids: [ID!]!) {
    confirmBoardItems(ids: $ids) { confirmed skipped }
  }
`;

export const DISMISS_BOARD_THREAD = gql`
  mutation DismissBoardThread($id: String!) {
    dismissBoardThread(id: $id)
  }
`;

export const REFRESH_BOARD_THREADS = gql`
  mutation RefreshBoardThreads {
    refreshBoardThreads { started running error }
  }
`;
