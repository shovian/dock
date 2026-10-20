import { boardMode } from '../board-mode';
import { StorageAPI } from './StorageAPI';
import { JiraCredentials, JiraService } from '../integrations/jira';

export class JiraTicketLookupError extends Error {
  constructor(public readonly statusCode?: number) {
    super('Jira ticket lookup is temporarily unavailable');
    this.name = 'JiraTicketLookupError';
  }
}

export class JiraAPI {
  private storageAPI: StorageAPI;
  private jiraService: JiraService;

  constructor() {
    this.storageAPI = new StorageAPI();
    this.jiraService = new JiraService();
  }

  private async getConfiguration() {
    const settings = await this.storageAPI.getSettings();
    return {
      credentials: {
        domain: settings.jiraUrl || '',
        email: settings.jiraEmail || '',
        apiToken: settings.jiraApiToken || '',
      } as JiraCredentials,
      projectKeys: String(settings.jiraProjectKeys || '').split(',').map((key) => key.trim()).filter(Boolean),
    };
  }

  async getTickets() {
    try {
      const { credentials, projectKeys } = await this.getConfiguration();
      if (!credentials.domain || !credentials.email || !credentials.apiToken) {
        console.warn('[BFF JiraAPI] Missing Jira credentials in settings (jiraUrl, jiraEmail, jiraApiToken). Please configure in Settings.');
        return [];
      }
      return await this.jiraService.getAssignedTickets(credentials, projectKeys);
    } catch (error: any) {
      console.error('[BFF JiraAPI] Error fetching tickets:', error.response?.status, error.response?.data || error.message);
      return []; // Graceful degradation
    }
  }

  async getTicket(key: string) {
    try {
      const { credentials } = await this.getConfiguration();
      return await this.jiraService.getTicketDetails(credentials, key);
    } catch (error: any) {
      const statusCode = Number.isInteger(error?.response?.status) ? error.response.status : undefined;
      if (statusCode === 404) return null;
      console.error(`[BFF JiraAPI] Error getting ticket ${key}:`, statusCode || error?.code || error?.message || 'unknown error');
      throw new JiraTicketLookupError(statusCode);
    }
  }

  /** True when the ticket was moved; a missing transition or a Jira error is false, never a throw. */
  async transitionTicket(key: string, statusName: string): Promise<boolean> {
    // Board mode: Jira status changes stay with the owner.
    if (boardMode()) {
      console.warn(`[BFF JiraAPI] Board mode: not moving ${key} to ${statusName}`);
      return false;
    }
    try {
      const { credentials } = await this.getConfiguration();
      return await this.jiraService.transitionTo(credentials, key, statusName);
    } catch (error: any) {
      console.error(`[BFF JiraAPI] Error moving ${key} to ${statusName}:`, error?.response?.status || error?.code || error?.message || 'unknown error');
      return false;
    }
  }

  async refreshTickets() {
    try {
      const { credentials, projectKeys } = await this.getConfiguration();
      return await this.jiraService.getAssignedTickets(credentials, projectKeys, true);
    } catch (error: any) {
      console.error('[BFF JiraAPI] Error refreshing tickets:', error.response?.status, error.response?.data || error.message);
      return false;
    }
  }

  async validateJira(domain?: string, email?: string, apiToken?: string) {
    try {
      const stored = await this.getConfiguration();
      const credentials = {
        domain: domain || stored.credentials.domain,
        email: email || stored.credentials.email,
        apiToken: apiToken || stored.credentials.apiToken,
      };
      await this.jiraService.validateCredentials(credentials);
      return { success: true, message: 'Jira connection valid & successfully connected!' };
    } catch (error: any) {
      const errDetail = error.response?.data?.error || error.message || 'Jira connection failed';
      console.error(`[BFF] Jira validation error (${error.response?.status}):`, errDetail);
      return { success: false, message: `Jira failed: ${errDetail}` };
    }
  }

  async listProjects(domain?: string, email?: string, apiToken?: string) {
    try {
      const stored = await this.getConfiguration();
      const credentials = {
        domain: domain || stored.credentials.domain,
        email: email || stored.credentials.email,
        apiToken: apiToken || stored.credentials.apiToken,
      };
      if (!credentials.domain || !credentials.email || !credentials.apiToken) return [];
      return await this.jiraService.listProjects(credentials);
    } catch (error: any) {
      console.error('[BFF JiraAPI] Error listing projects:', error.response?.status, error.message);
      return [];
    }
  }
}
