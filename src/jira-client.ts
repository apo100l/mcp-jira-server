import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { BrowserSessionManager } from './browser-auth.js';

export type JiraAuthMode = 'browser' | 'cookie' | 'pat';

export interface JiraConfig {
  baseUrl: string;
  authMode?: JiraAuthMode;
  personalAccessToken?: string;
  sessionCookie?: string;
  userAgent?: string;
  browserProfile?: string;
  browserChannel?: string;
}

export interface JiraIssue {
  key: string;
  fields: {
    summary: string;
    description?: string;
    status: {
      name: string;
    };
    issuetype: {
      name: string;
    };
    priority?: {
      name: string;
    };
    assignee?: {
      displayName: string;
      emailAddress: string;
    };
    reporter?: {
      displayName: string;
      emailAddress: string;
    };
    created: string;
    updated: string;
    [key: string]: any;
  };
}

export interface JiraProject {
  id: string;
  key: string;
  name: string;
  projectTypeKey: string;
  avatarUrls?: {
    '48x48'?: string;
  };
}

export interface CreateIssueInput {
  projectKey: string;
  summary: string;
  description?: string;
  issueType: string;
  priority?: string;
  assignee?: string;
  labels?: string[];
  components?: string[];
  customFields?: Record<string, any>;
}

export interface UpdateIssueInput {
  summary?: string;
  description?: string;
  assignee?: string;
  priority?: string;
  labels?: string[];
  status?: string;
  customFields?: Record<string, any>;
}

export interface JiraComment {
  id: string;
  body: string;
  author: {
    displayName: string;
    emailAddress: string;
  };
  created: string;
  updated: string;
}

export class JiraClient {
  private client: AxiosInstance;
  private baseUrl: string;
  private config: JiraConfig;
  private browserSession?: BrowserSessionManager;

  constructor(config: JiraConfig) {
    this.config = config;
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Atlassian-Token': 'no-check',
    };

    const mode = this.resolveAuthMode(config);

    if (mode === 'browser') {
      if (!config.browserProfile) {
        throw new Error('JIRA_BROWSER_PROFILE is required when JIRA_AUTH_MODE=browser');
      }
      this.browserSession = new BrowserSessionManager({
        baseUrl: this.baseUrl,
        browserProfile: config.browserProfile,
        browserChannel: config.browserChannel || 'chrome',
        userAgent: config.userAgent,
      });
    } else if (mode === 'cookie' && config.sessionCookie) {
      headers['Cookie'] = config.sessionCookie;
    } else if (mode === 'pat' && config.personalAccessToken) {
      headers['Authorization'] = `Bearer ${config.personalAccessToken}`;
    } else {
      throw new Error(
        'Configure JIRA_AUTH_MODE=browser with JIRA_BROWSER_PROFILE, or provide JIRA_COOKIE / JIRA_PAT'
      );
    }

    if (config.userAgent) {
      headers['User-Agent'] = config.userAgent;
    }

    this.client = axios.create({
      baseURL: `${this.baseUrl}/rest/api/2`,
      headers,
      maxRedirects: 0,
    });
  }

  private resolveAuthMode(config: JiraConfig): JiraAuthMode {
    if (config.authMode) {
      return config.authMode;
    }
    if (config.browserProfile) {
      return 'browser';
    }
    if (config.sessionCookie) {
      return 'cookie';
    }
    return 'pat';
  }

  private isSsoFailureResponse(responseData: any, contentType?: string): boolean {
    const ct = (contentType || '').toLowerCase();
    if (ct.includes('text/html')) {
      return true;
    }
    if (typeof responseData === 'string' && /^\s*<!doctype html|^\s*<html/i.test(responseData)) {
      return true;
    }
    return false;
  }

  private async request<T = any>(reqConfig: AxiosRequestConfig): Promise<T> {
    if (this.browserSession) {
      const { cookieHeader, userAgent } = await this.browserSession.getValidCookie(false);
      reqConfig.headers = {
        ...reqConfig.headers,
        Cookie: cookieHeader,
        ...(userAgent ? { 'User-Agent': userAgent } : {}),
      };
    }

    try {
      const response = await this.client.request<T>(reqConfig);
      if (this.isSsoFailureResponse(response.data, String(response.headers['content-type'] || ''))) {
        if (this.browserSession) {
          const refreshed = await this.browserSession.getValidCookie(true);
          reqConfig.headers = {
            ...reqConfig.headers,
            Cookie: refreshed.cookieHeader,
            ...(refreshed.userAgent ? { 'User-Agent': refreshed.userAgent } : {}),
          };
          const retryResponse = await this.client.request<T>(reqConfig);
          if (
            this.isSsoFailureResponse(
              retryResponse.data,
              String(retryResponse.headers['content-type'] || '')
            )
          ) {
            throw new Error(
              'SSO proxy returned HTML login page instead of Jira JSON even after browser login'
            );
          }
          return retryResponse.data;
        }
        throw new Error(
          'SSO session expired or unauthorized (received HTML login page instead of JSON from Jira API)'
        );
      }
      return response.data;
    } catch (error: any) {
      const status = error.response?.status;
      if (this.browserSession && (status === 401 || status === 403 || status === 302)) {
        const refreshed = await this.browserSession.getValidCookie(true);
        reqConfig.headers = {
          ...reqConfig.headers,
          Cookie: refreshed.cookieHeader,
          ...(refreshed.userAgent ? { 'User-Agent': refreshed.userAgent } : {}),
        };
        const retryResponse = await this.client.request<T>(reqConfig);
        return retryResponse.data;
      }
      throw error;
    }
  }

  async loginWithBrowser(): Promise<any> {
    if (!this.browserSession) {
      throw new Error('Browser authentication is not enabled. Set JIRA_AUTH_MODE=browser and JIRA_BROWSER_PROFILE.');
    }
    await this.browserSession.getValidCookie(true);
    return await this.getCurrentUser();
  }

  async getIssue(issueKey: string): Promise<JiraIssue> {
    return await this.request<JiraIssue>({
      method: 'GET',
      url: `/issue/${issueKey}`,
    });
  }

  async searchIssues(jql: string, maxResults: number = 50): Promise<JiraIssue[]> {
    const data = await this.request<{ issues: JiraIssue[] }>({
      method: 'POST',
      url: '/search',
      data: {
        jql,
        maxResults,
        fields: [
          'summary',
          'status',
          'assignee',
          'reporter',
          'priority',
          'issuetype',
          'created',
          'updated',
          'description',
        ],
      },
    });
    return data.issues || [];
  }

  async createIssue(input: CreateIssueInput): Promise<JiraIssue> {
    const issueData: any = {
      fields: {
        project: {
          key: input.projectKey,
        },
        summary: input.summary,
        issuetype: {
          name: input.issueType,
        },
      },
    };

    if (input.description) {
      issueData.fields.description = input.description;
    }
    if (input.priority) {
      issueData.fields.priority = { name: input.priority };
    }
    if (input.assignee) {
      issueData.fields.assignee = { name: input.assignee };
    }
    if (input.labels && input.labels.length > 0) {
      issueData.fields.labels = input.labels;
    }
    if (input.components && input.components.length > 0) {
      issueData.fields.components = input.components.map((c) => ({ name: c }));
    }
    if (input.customFields && typeof input.customFields === 'object') {
      Object.assign(issueData.fields, input.customFields);
    }

    const created = await this.request<{ key: string }>({
      method: 'POST',
      url: '/issue',
      data: issueData,
    });
    return await this.getIssue(created.key);
  }

  async updateIssue(issueKey: string, input: UpdateIssueInput): Promise<JiraIssue> {
    const updateData: any = {
      fields: {},
    };

    if (input.summary) {
      updateData.fields.summary = input.summary;
    }
    if (input.description !== undefined) {
      updateData.fields.description = input.description;
    }
    if (input.assignee) {
      updateData.fields.assignee = { name: input.assignee };
    }
    if (input.priority) {
      updateData.fields.priority = { name: input.priority };
    }
    if (input.labels) {
      updateData.fields.labels = input.labels;
    }
    if (input.customFields && typeof input.customFields === 'object') {
      Object.assign(updateData.fields, input.customFields);
    }

    await this.request({
      method: 'PUT',
      url: `/issue/${issueKey}`,
      data: updateData,
    });

    if (input.status) {
      await this.transitionIssue(issueKey, input.status);
    }

    return await this.getIssue(issueKey);
  }

  async transitionIssue(issueKey: string, statusName: string): Promise<void> {
    const transitionsData = await this.request<{ transitions: any[] }>({
      method: 'GET',
      url: `/issue/${issueKey}/transitions`,
    });
    const transitions = transitionsData.transitions || [];

    const transition = transitions.find(
      (t: any) => t.to?.name?.toLowerCase() === statusName.toLowerCase()
    );

    if (!transition) {
      throw new Error(`No transition found to status: ${statusName}`);
    }

    await this.request({
      method: 'POST',
      url: `/issue/${issueKey}/transitions`,
      data: {
        transition: {
          id: transition.id,
        },
      },
    });
  }

  async addComment(issueKey: string, comment: string): Promise<JiraComment> {
    return await this.request<JiraComment>({
      method: 'POST',
      url: `/issue/${issueKey}/comment`,
      data: {
        body: comment,
      },
    });
  }

  async getComments(issueKey: string): Promise<JiraComment[]> {
    const data = await this.request<{ comments: JiraComment[] }>({
      method: 'GET',
      url: `/issue/${issueKey}/comment`,
    });
    return data.comments || [];
  }

  async getProjects(): Promise<JiraProject[]> {
    return await this.request<JiraProject[]>({
      method: 'GET',
      url: '/project',
    });
  }

  async getProject(projectKey: string): Promise<JiraProject> {
    return await this.request<JiraProject>({
      method: 'GET',
      url: `/project/${projectKey}`,
    });
  }

  async getIssueTypes(projectKey: string): Promise<any[]> {
    const data = await this.request<{ issueTypes?: any[] }>({
      method: 'GET',
      url: `/project/${projectKey}`,
    });
    return data.issueTypes || [];
  }

  async assignIssue(issueKey: string, assignee: string): Promise<void> {
    await this.request({
      method: 'PUT',
      url: `/issue/${issueKey}/assignee`,
      data: {
        name: assignee,
      },
    });
  }

  async deleteIssue(issueKey: string): Promise<void> {
    await this.request({
      method: 'DELETE',
      url: `/issue/${issueKey}`,
    });
  }

  async getCurrentUser(): Promise<any> {
    return await this.request<any>({
      method: 'GET',
      url: '/myself',
    });
  }
}
