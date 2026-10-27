import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium, BrowserContext, Page } from 'playwright-core';

export interface BrowserAuthConfig {
  baseUrl: string;
  loginUrl?: string;
  profileDir?: string;
  channel?: string;
  headless?: boolean;
  userAgent?: string;
  validationTtlMs?: number;
}

export interface BrowserAuthStatus {
  authenticated: boolean;
  browserOpened: boolean;
  profileDir: string;
  statusCode?: number;
  message: string;
}

export class BrowserAuthenticationRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrowserAuthenticationRequiredError';
  }
}

export class BrowserAuthProvider {
  readonly profileDir: string;

  private readonly baseUrl: string;
  private readonly loginUrl: string;
  private readonly channel: string;
  private readonly headless: boolean;
  private readonly userAgent?: string;
  private readonly validationTtlMs: number;
  private contextPromise: Promise<BrowserContext> | null = null;
  private lastValidatedAt = 0;

  constructor(config: BrowserAuthConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    // Jira root may answer 401 without redirecting to SSO; /login.jsp starts the SSO flow.
    this.loginUrl = config.loginUrl || `${this.baseUrl}/login.jsp`;
    this.profileDir = config.profileDir || join(homedir(), '.mcp-jira-server', 'chrome-profile');
    this.channel = config.channel || 'chrome';
    this.headless = config.headless ?? false;
    this.userAgent = config.userAgent;
    this.validationTtlMs = config.validationTtlMs ?? 60_000;
  }

  async getCookieHeader(): Promise<string> {
    const status = await this.getStatus(true);
    if (!status.authenticated) {
      await this.openLogin();
      throw new BrowserAuthenticationRequiredError(
        'Jira browser session is not authenticated. Sign in in the opened browser window, then retry the Jira request.'
      );
    }

    const context = await this.getContext();
    const cookies = await context.cookies(this.baseUrl);
    if (cookies.length === 0) {
      throw new BrowserAuthenticationRequiredError(
        'No Jira cookies were found in the persistent browser profile. Run jira_browser_login and sign in.'
      );
    }

    return cookies.map(({ name, value }) => `${name}=${value}`).join('; ');
  }

  async openLogin(): Promise<BrowserAuthStatus> {
    const context = await this.getContext();
    const page = await this.getOrCreatePage(context);
    await page.goto(this.loginUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.bringToFront();
    this.lastValidatedAt = 0;

    const status = await this.getStatus(false);
    if (status.authenticated) {
      return {
        ...status,
        browserOpened: true,
        message: 'Jira browser session is authenticated and ready.',
      };
    }

    return {
      ...status,
      browserOpened: true,
      message: 'Browser opened. Complete Jira/SSO sign-in, then call jira_browser_auth_status or retry the Jira request.',
    };
  }

  async getStatus(useCache = true): Promise<BrowserAuthStatus> {
    const context = await this.getContext();
    const now = Date.now();
    if (useCache && this.lastValidatedAt > 0 && now - this.lastValidatedAt < this.validationTtlMs) {
      return {
        authenticated: true,
        browserOpened: true,
        profileDir: this.profileDir,
        message: 'Jira browser session was recently validated.',
      };
    }

    try {
      const response = await context.request.get(`${this.baseUrl}/rest/api/2/myself`, {
        headers: {
          Accept: 'application/json',
          ...(this.userAgent ? { 'User-Agent': this.userAgent } : {}),
        },
        timeout: 20_000,
      });
      const contentType = response.headers()['content-type'] || '';
      const authenticated = response.ok() && contentType.toLowerCase().includes('application/json');
      if (authenticated) {
        this.lastValidatedAt = now;
      } else {
        this.lastValidatedAt = 0;
      }

      return {
        authenticated,
        browserOpened: true,
        profileDir: this.profileDir,
        statusCode: response.status(),
        message: authenticated
          ? 'Jira browser session is authenticated.'
          : 'Jira browser session requires sign-in.',
      };
    } catch (error) {
      this.lastValidatedAt = 0;
      return {
        authenticated: false,
        browserOpened: true,
        profileDir: this.profileDir,
        message: `Could not validate Jira browser session: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  async close(): Promise<void> {
    const contextPromise = this.contextPromise;
    this.contextPromise = null;
    this.lastValidatedAt = 0;
    if (contextPromise) {
      const context = await contextPromise;
      await context.close();
    }
  }

  private async getContext(): Promise<BrowserContext> {
    if (this.contextPromise) {
      const existingContext = await this.contextPromise;
      if (existingContext.browser()?.isConnected()) {
        return existingContext;
      }
      this.contextPromise = null;
      this.lastValidatedAt = 0;
    }

    if (!this.contextPromise) {
      this.contextPromise = chromium.launchPersistentContext(this.profileDir, {
        channel: this.channel,
        headless: this.headless,
        userAgent: this.userAgent,
        viewport: null,
        args: ['--no-first-run'],
      }).catch((error) => {
        this.contextPromise = null;
        throw error;
      });
    }

    return await this.contextPromise;
  }

  private async getOrCreatePage(context: BrowserContext): Promise<Page> {
    const pages = context.pages();
    return pages[0] || context.newPage();
  }
}
