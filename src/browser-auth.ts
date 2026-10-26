import { spawn, ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import axios from 'axios';

export interface BrowserAuthOptions {
  baseUrl: string;
  browserProfile: string;
  browserChannel?: string;
  userAgent?: string;
  loginTimeoutMs?: number;
}

interface CachedSession {
  cookieHeader: string;
  userAgent?: string;
  updatedAt: string;
}

function expandHome(filepath: string): string {
  if (filepath.startsWith('~/') || filepath === '~') {
    return join(homedir(), filepath.slice(1));
  }
  return resolve(filepath);
}

function resolveBrowserExecutable(channel: string = 'chrome'): string {
  if (channel.startsWith('/') && existsSync(channel)) {
    return channel;
  }

  const normalized = channel.toLowerCase();
  const candidates: Record<string, string[]> = {
    chrome: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ],
    chromium: [
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ],
    brave: [
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    ],
    edge: [
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ],
  };

  const list = candidates[normalized] || candidates.chrome;
  for (const candidate of list) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Could not find browser executable for channel "${channel}". Checked: ${list.join(', ')}`
  );
}

async function getFreePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        srv.close(() => resolvePort(port));
      } else {
        srv.close(() => reject(new Error('Could not allocate free local port')));
      }
    });
    srv.on('error', reject);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchDebuggerCookies(
  port: number,
  targetUrl: string
): Promise<{ cookieHeader: string; userAgent?: string }> {
  const versionResp = await axios.get(`http://127.0.0.1:${port}/json/version`, {
    timeout: 2000,
  });
  const wsUrl: string | undefined = versionResp.data?.webSocketDebuggerUrl;
  const detectedUa: string | undefined = versionResp.data?.['User-Agent'];

  if (!wsUrl) {
    throw new Error('No webSocketDebuggerUrl returned from Chrome DevTools endpoint');
  }

  return new Promise((resolveResult, rejectResult) => {
    const ws = new WebSocket(wsUrl);
    const timeout = setTimeout(() => {
      try {
        ws.close();
      } catch {}
      rejectResult(new Error('Timed out waiting for CDP Storage.getCookies'));
    }, 5000);

    ws.addEventListener('open', () => {
      ws.send(
        JSON.stringify({
          id: 1,
          method: 'Storage.getCookies',
          params: {},
        })
      );
    });

    ws.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(String(event.data));
        if (data.id === 1) {
          clearTimeout(timeout);
          try {
            ws.close();
          } catch {}

          const cookies: Array<{
            name: string;
            value: string;
            domain: string;
            path: string;
            expires?: number;
          }> = data.result?.cookies || [];

          const parsedTarget = new URL(targetUrl);
          const hostname = parsedTarget.hostname.toLowerCase();
          const baseDomainParts = hostname.split('.');
          const rootDomain =
            baseDomainParts.length >= 2
              ? baseDomainParts.slice(-2).join('.')
              : hostname;

          const nowSec = Date.now() / 1000;
          const matching = cookies.filter((c) => {
            if (!c.name || !c.domain) return false;
            if (c.expires && c.expires > 0 && c.expires < nowSec) return false;
            const cleanDomain = c.domain.replace(/^\./, '').toLowerCase();
            return (
              hostname === cleanDomain ||
              hostname.endsWith(`.${cleanDomain}`) ||
              cleanDomain.endsWith(rootDomain)
            );
          });

          const cookieMap = new Map<string, string>();
          for (const c of matching) {
            cookieMap.set(c.name, `${c.name}=${c.value}`);
          }

          const cookieHeader = Array.from(cookieMap.values()).join('; ');
          resolveResult({
            cookieHeader,
            userAgent: detectedUa?.replace('HeadlessChrome/', 'Chrome/'),
          });
        }
      } catch (err) {
        clearTimeout(timeout);
        try {
          ws.close();
        } catch {}
        rejectResult(err);
      }
    });

    ws.addEventListener('error', (err) => {
      clearTimeout(timeout);
      rejectResult(new Error(`CDP WebSocket error: ${String(err)}`));
    });
  });
}

export class BrowserSessionManager {
  private baseUrl: string;
  private profileDir: string;
  private browserChannel: string;
  private configuredUserAgent?: string;
  private loginTimeoutMs: number;
  private cacheFilePath: string;
  private cachedCookie?: string;
  private cachedUserAgent?: string;

  constructor(options: BrowserAuthOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.profileDir = expandHome(options.browserProfile);
    this.browserChannel = options.browserChannel || 'chrome';
    this.configuredUserAgent = options.userAgent;
    this.loginTimeoutMs = options.loginTimeoutMs ?? 180_000;
    this.cacheFilePath = join(this.profileDir, '.jira-mcp-session.json');
    this.loadCachedSession();
  }

  private loadCachedSession(): void {
    try {
      if (existsSync(this.cacheFilePath)) {
        const raw = JSON.parse(readFileSync(this.cacheFilePath, 'utf8')) as CachedSession;
        if (raw.cookieHeader) {
          this.cachedCookie = raw.cookieHeader;
          this.cachedUserAgent = raw.userAgent;
        }
      }
    } catch {
      // Ignore invalid cache
    }
  }

  private saveCachedSession(cookieHeader: string, userAgent?: string): void {
    try {
      mkdirSync(this.profileDir, { recursive: true });
      const payload: CachedSession = {
        cookieHeader,
        userAgent,
        updatedAt: new Date().toISOString(),
      };
      writeFileSync(this.cacheFilePath, JSON.stringify(payload, null, 2), 'utf8');
    } catch {
      // Ignore cache write errors
    }
  }

  getEffectiveUserAgent(): string | undefined {
    return this.configuredUserAgent || this.cachedUserAgent;
  }

  async verifyCookie(cookieHeader: string, userAgent?: string): Promise<boolean> {
    if (!cookieHeader || !cookieHeader.trim()) {
      return false;
    }

    try {
      const headers: Record<string, string> = {
        Accept: 'application/json',
        Cookie: cookieHeader,
        'X-Atlassian-Token': 'no-check',
      };
      const ua = userAgent || this.getEffectiveUserAgent();
      if (ua) {
        headers['User-Agent'] = ua;
      }

      const response = await axios.get(`${this.baseUrl}/rest/api/2/myself`, {
        headers,
        timeout: 8000,
        maxRedirects: 0,
        validateStatus: (status) => status >= 200 && status < 400,
      });

      const contentType = String(response.headers['content-type'] || '').toLowerCase();
      if (!contentType.includes('application/json')) {
        return false;
      }

      return Boolean(
        response.data &&
          typeof response.data === 'object' &&
          (response.data.name || response.data.key || response.data.accountId || response.data.emailAddress)
      );
    } catch {
      return false;
    }
  }

  async getValidCookie(forceInteractive: boolean = false): Promise<{
    cookieHeader: string;
    userAgent?: string;
  }> {
    if (!forceInteractive && this.cachedCookie) {
      const ok = await this.verifyCookie(this.cachedCookie, this.cachedUserAgent);
      if (ok) {
        return {
          cookieHeader: this.cachedCookie,
          userAgent: this.getEffectiveUserAgent(),
        };
      }
    }

    if (!forceInteractive) {
      try {
        const headlessSession = await this.captureFromBrowser(true);
        if (
          headlessSession.cookieHeader &&
          (await this.verifyCookie(headlessSession.cookieHeader, headlessSession.userAgent))
        ) {
          this.cachedCookie = headlessSession.cookieHeader;
          this.cachedUserAgent = headlessSession.userAgent;
          this.saveCachedSession(headlessSession.cookieHeader, headlessSession.userAgent);
          return {
            cookieHeader: headlessSession.cookieHeader,
            userAgent: this.getEffectiveUserAgent(),
          };
        }
      } catch {
        // Fall through to interactive browser login
      }
    }

    const interactiveSession = await this.captureFromBrowser(false);
    this.cachedCookie = interactiveSession.cookieHeader;
    this.cachedUserAgent = interactiveSession.userAgent;
    this.saveCachedSession(interactiveSession.cookieHeader, interactiveSession.userAgent);
    return {
      cookieHeader: interactiveSession.cookieHeader,
      userAgent: this.getEffectiveUserAgent(),
    };
  }

  private async captureFromBrowser(
    headless: boolean
  ): Promise<{ cookieHeader: string; userAgent?: string }> {
    mkdirSync(this.profileDir, { recursive: true });
    const executablePath = resolveBrowserExecutable(this.browserChannel);
    const port = await getFreePort();

    const args = [
      `--user-data-dir=${this.profileDir}`,
      `--remote-debugging-port=${port}`,
      '--no-first-run',
      '--no-default-browser-check',
    ];

    if (this.configuredUserAgent) {
      args.push(`--user-agent=${this.configuredUserAgent}`);
    }

    if (headless) {
      args.push('--headless=new');
    }

    args.push(this.baseUrl);

    const proc: ChildProcess = spawn(executablePath, args, {
      stdio: 'ignore',
      detached: false,
    });

    const cleanup = () => {
      try {
        if (!proc.killed) {
          proc.kill('SIGTERM');
        }
      } catch {}
    };

    try {
      const deadline = Date.now() + (headless ? 12_000 : this.loginTimeoutMs);

      while (Date.now() < deadline) {
        if (proc.exitCode !== null) {
          throw new Error('Browser process exited before SSO session was established');
        }

        try {
          const { cookieHeader, userAgent } = await fetchDebuggerCookies(port, this.baseUrl);
          if (cookieHeader) {
            const valid = await this.verifyCookie(cookieHeader, userAgent);
            if (valid) {
              return { cookieHeader, userAgent };
            }
          }
        } catch {
          // Browser debugger not ready yet or user still completing SSO
        }

        if (headless) {
          await sleep(1000);
        } else {
          await sleep(2000);
        }
      }

      throw new Error(
        headless
          ? 'Headless profile check did not find an active SSO session'
          : `Timed out waiting for SSO login in browser at ${this.baseUrl}`
      );
    } finally {
      cleanup();
    }
  }
}
