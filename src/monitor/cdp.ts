const CDP_BASE = "http://127.0.0.1:9222";

interface CdpMsg {
  id?: number;
  sessionId?: string;
  method?: string;
  result?: unknown;
  error?: { message: string };
  params?: unknown;
}

export interface CdpPage {
  goto(url: string, timeoutMs?: number): Promise<void>;
  waitForSelector(selector: string, timeoutMs?: number): Promise<void>;
  content(): Promise<string>;
  close(): Promise<void>;
}

// Multiplexes commands and events for both browser-level and page sessions
// over a single WebSocket. Commands include sessionId for page-level requests;
// responses and events echo it back for routing.
class CdpSession {
  private msgId = 1;
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private eventHandlers = new Map<string, Array<(params: unknown) => void>>();

  constructor(private ws: WebSocket) {
    ws.addEventListener("message", ({ data }) => {
      const msg = JSON.parse(data as string) as CdpMsg;
      const sid = msg.sessionId ?? "";

      if (msg.id !== undefined) {
        const cb = this.pending.get(`${sid}|${msg.id}`);
        if (cb) {
          this.pending.delete(`${sid}|${msg.id}`);
          msg.error ? cb.reject(new Error(msg.error.message)) : cb.resolve(msg.result);
        }
      }

      if (msg.method) {
        for (const h of this.eventHandlers.get(`${sid}|${msg.method}`) ?? []) h(msg.params);
      }
    });
  }

  send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<unknown> {
    const id = this.msgId++;
    this.pending.set(`${sessionId ?? ""}|${id}`, {
      resolve: (v) => v,
      reject: (e) => { throw e; },
    });
    return new Promise((resolve, reject) => {
      this.pending.set(`${sessionId ?? ""}|${id}`, { resolve, reject });
      const msg: Record<string, unknown> = { id, method, params };
      if (sessionId) msg.sessionId = sessionId;
      this.ws.send(JSON.stringify(msg));
    });
  }

  onceEvent(method: string, sessionId: string | undefined, timeoutMs: number): Promise<unknown> {
    const key = `${sessionId ?? ""}|${method}`;
    const handlers = this.eventHandlers.get(key) ?? [];
    this.eventHandlers.set(key, handlers);

    return new Promise((resolve, reject) => {
      const handler = (params: unknown) => {
        clearTimeout(timer);
        handlers.splice(handlers.indexOf(handler), 1);
        resolve(params);
      };
      const timer = setTimeout(() => {
        handlers.splice(handlers.indexOf(handler), 1);
        reject(new Error(`CDP event timeout: ${method}`));
      }, timeoutMs);
      handlers.push(handler);
    });
  }

  close(): void {
    this.ws.close();
  }
}

class CdpPageImpl implements CdpPage {
  constructor(
    private cdp: CdpSession,
    private targetId: string,
    private sessionId: string,
  ) {}

  private cmd(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return this.cdp.send(method, params, this.sessionId);
  }

  async goto(url: string, timeoutMs = 20_000): Promise<void> {
    // Register listener before sending to avoid missing a fast-firing event
    const domReady = this.cdp.onceEvent("Page.domContentEventFired", this.sessionId, timeoutMs);
    await this.cmd("Page.navigate", { url });
    await domReady;
  }

  async waitForSelector(selector: string, timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const res = await this.cmd("Runtime.evaluate", {
        expression: `document.querySelector(${JSON.stringify(selector)}) !== null`,
        returnByValue: true,
      }) as { result?: { value?: boolean } };
      if (res?.result?.value === true) return;
      await Bun.sleep(300);
    }
    throw new Error(`Selector "${selector}" not found within ${timeoutMs}ms`);
  }

  async content(): Promise<string> {
    const res = await this.cmd("Runtime.evaluate", {
      expression: "document.documentElement.outerHTML",
      returnByValue: true,
    }) as { result?: { value?: string } };
    return res?.result?.value ?? "";
  }

  async close(): Promise<void> {
    try { await this.cdp.send("Target.closeTarget", { targetId: this.targetId }); } catch {}
    this.cdp.close();
  }
}

export async function openPage(): Promise<CdpPage> {
  // Use browser-level WebSocket — avoids the /json/new HTTP endpoint which
  // was deprecated in newer Chromium (returns non-JSON for GET requests).
  const versionRes = await fetch(`${CDP_BASE}/json/version`);
  const { webSocketDebuggerUrl } = await versionRes.json() as { webSocketDebuggerUrl: string };

  const ws = new WebSocket(webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("CDP browser WebSocket timed out")), 5_000);
    ws.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
    ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("CDP browser WebSocket error")); }, { once: true });
  });

  const cdp = new CdpSession(ws);

  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" }) as { targetId: string };
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true }) as { sessionId: string };

  await cdp.send("Page.enable", {}, sessionId);

  // Patch headless indicators before any page scripts run
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      if (!window.chrome) {
        window.chrome = { runtime: {}, loadTimes: function(){}, csi: function(){}, app: {} };
      }
      Object.defineProperty(navigator, 'plugins', {
        get: () => [
          { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
          { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
          { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' }
        ]
      });
      Object.defineProperty(navigator, 'languages', { get: () => ['cs-CZ', 'cs', 'en-US', 'en'] });
    `,
  }, sessionId);

  return new CdpPageImpl(cdp, targetId, sessionId);
}
