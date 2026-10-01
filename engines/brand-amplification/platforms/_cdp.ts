/**
 * A small dependency-free CDP transport with checks at the UI boundary. A prior
 * script reused a matching /publish/post/ tab and silently replaced a finished
 * draft. Fresh drafts must always create a new target; deliberate reuse has its
 * own explicitly unsafe entry point. Technique alone cannot protect content:
 * check preconditions before acting and postconditions afterward, and never
 * retry an uncertain UI action. Report both the failure and its repair path.
 */

const DEFAULT_TIMEOUT_MS = 30_000;

function failure(what: string, fix: string, cause?: unknown): Error {
  return new Error(`${what}. Fix: ${fix}.`, { cause });
}

export interface CDP {
  send(method: string, params?: Record<string, unknown>): Promise<any>;
  evalSync(expression: string): Promise<any>;
  close(): void;
}

export class CdpClient implements CDP {
  private nextId = 0;
  private closed = false;
  private pending = new Map<number, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
    method: string;
  }>();

  constructor(private socket: WebSocket, private timeoutMs = DEFAULT_TIMEOUT_MS) {
    socket.addEventListener("message", event => {
      let message: any;
      try { message = JSON.parse(String(event.data)); }
      catch (cause) {
        this.shutdown(failure("CDP received malformed JSON", "verify the websocket endpoint and reconnect", cause));
        return;
      }
      const request = this.pending.get(message?.id);
      if (!request) return; // Unsolicited CDP events are not command responses.
      clearTimeout(request.timer);
      this.pending.delete(message.id);
      if (message.error) {
        request.reject(failure(`CDP: ${JSON.stringify(message.error)}`, "correct the command parameters and verify the target state"));
      } else request.resolve(message.result);
    });
    socket.addEventListener("close", () => this.shutdown(failure("CDP websocket closed", "reconnect to the intended target and check its state")));
    socket.addEventListener("error", () => this.shutdown(failure("CDP websocket failed", "verify Chrome remote debugging is available and reconnect")));
  }

  static async connect(wsUrl: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<CdpClient> {
    return new Promise((resolve, reject) => {
      let socket: WebSocket;
      try { socket = new WebSocket(wsUrl); }
      catch (cause) {
        reject(failure("CDP websocket construction failed", "verify the target websocket URL", cause));
        return;
      }
      const cleanup = () => {
        clearTimeout(timer);
        socket.removeEventListener("open", onOpen);
        socket.removeEventListener("error", onFailure);
        socket.removeEventListener("close", onFailure);
      };
      const onFailure = () => {
        cleanup();
        reject(failure("CDP websocket connection failed or timed out", "verify the target is still open and remote debugging is reachable"));
        socket.close();
      };
      const onOpen = () => {
        cleanup();
        resolve(new CdpClient(socket, timeoutMs));
      };
      const timer = setTimeout(onFailure, timeoutMs);
      socket.addEventListener("open", onOpen);
      socket.addEventListener("error", onFailure);
      socket.addEventListener("close", onFailure);
    });
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<any> {
    if (this.closed || this.socket.readyState !== 1) {
      return Promise.reject(failure(`CDP ${method} cannot run on a closed websocket`, "connect to the intended target before sending commands"));
    }
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(failure(`CDP ${method} timed out`, "inspect the target state and connection before issuing another action"));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      try { this.socket.send(JSON.stringify({ id, method, params })); }
      catch (cause) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(failure(`CDP ${method} could not be sent`, "check the connection and target state before continuing", cause));
      }
    });
  }

  async evalSync(expr: string): Promise<any> {
    const result = await this.send("Runtime.evaluate", {
      expression: expr, awaitPromise: false, returnByValue: true,
    });
    if (result.exceptionDetails) {
      const details = result.exceptionDetails;
      throw failure(`Page evaluation failed: ${JSON.stringify(details)}`, "correct the expression and verify its page preconditions");
    }
    return result.result?.value;
  }

  private shutdown(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
    this.socket.close();
  }

  close(): void {
    this.shutdown(failure("CDP tab connection was closed", "reconnect before sending further commands"));
  }
}

export const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
type Check = () => boolean | Promise<boolean>;

/** A failed action or observation is never retried; preserve the cause for diagnosis. */
export async function primitive<T>(name: string, pre: Check, act: () => T | Promise<T>,
  post: (result: T) => boolean | Promise<boolean>, fix: string): Promise<T> {
  const checked = async <V>(phase: string, run: () => V | Promise<V>): Promise<V> => {
    try { return await run(); }
    catch (cause) {
      throw failure(`${name}: ${phase}: ${cause instanceof Error ? cause.message : String(cause)}`, fix, cause);
    }
  };
  if (await checked("precondition check threw", pre) !== true)
    throw failure(`${name}: precondition failed`, fix);
  const result = await checked("action failed", act);
  if (await checked("postcondition check threw", () => post(result)) !== true)
    throw failure(`${name}: postcondition failed (no retry performed)`, fix);
  return result;
}

export async function realClick(c: CDP, x: number, y: number, pre: Check, post: Check, wait = sleep): Promise<void> {
  return primitive("realClick", async () => Number.isFinite(x) && Number.isFinite(y) && await pre(), async () => {
    await c.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await wait(80);
    await c.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await wait(80);
    await c.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    await wait(80);
  }, post, "Inspect the intended control and the whole page; correct the precondition without repeating the click.");
}

export interface BrowserTarget {
  readonly id: string;
  readonly url: string;
  readonly webSocketDebuggerUrl: string;
}
export interface BrowserTargets {
  list(): Promise<BrowserTarget[]>;
  create(url: string): Promise<BrowserTarget>;
}

export function browserTargets(host = `http://127.0.0.1:${process.env.CDP_PORT || 9222}`): BrowserTargets {
  async function request(path: string, method = "GET") {
    try {
      const response = await fetch(`${host}${path}`, { method, signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (cause) {
      throw failure("CDP target discovery/creation failed", "start Chrome with remote debugging and check CDP_PORT; inspect existing targets before creating another", cause);
    }
  }
  return {
    async list() {
      const targets = await request("/json/list");
      if (!Array.isArray(targets)) throw failure("Invalid browser target list", "inspect Chrome's remote debugging endpoint");
      return targets;
    },
    async create(url) { return await request(`/json/new?${encodeURIComponent(url)}`, "PUT"); },
  };
}

declare const draftAuthority: unique symbol;
export type DraftTarget = Readonly<BrowserTarget & { [draftAuthority]: true }>;
const issuedTargets = new WeakMap<DraftTarget, boolean>();
const writableClients = new WeakMap<CDP, boolean>();
function validTarget(t: BrowserTarget): boolean {
  return !!t && typeof t.id === "string" && !!t.id.trim() && typeof t.url === "string" &&
    typeof t.webSocketDebuggerUrl === "string" && /^wss?:\/\//.test(t.webSocketDebuggerUrl);
}
function issueTarget(t: BrowserTarget, fresh: boolean): DraftTarget {
  const issued = Object.freeze({ id: t.id, url: t.url, webSocketDebuggerUrl: t.webSocketDebuggerUrl }) as DraftTarget;
  issuedTargets.set(issued, fresh);
  return issued;
}

export async function createFreshDraftTarget(url: string, browser: BrowserTargets = browserTargets()): Promise<DraftTarget> {
  let existing: BrowserTarget[];
  const t = await primitive("createFreshDraftTarget", async () => {
    if (typeof url !== "string" || !/^https?:\/\//.test(url)) return false;
    existing = await browser.list();
    return Array.isArray(existing) && existing.every(validTarget);
  }, () => browser.create(url), t => {
    if (!validTarget(t) || existing.some(old => old.id === t.id || old.webSocketDebuggerUrl === t.webSocketDebuggerUrl))
      throw failure("browser returned an existing or invalid target", "inspect Chrome targets; never substitute an existing draft");
    return true;
  }, "Provide a valid new-draft URL and a working browser target endpoint; never reuse a matching tab.");
  return issueTarget(t, true);
}

export function explicitlyReuseExistingTarget(target: BrowserTarget, options: { allowDestructiveReuse: true }): DraftTarget {
  if (options?.allowDestructiveReuse !== true || !validTarget(target))
    throw failure("Existing target reuse denied", "verify the exact draft and explicitly set allowDestructiveReuse: true, or create a fresh target");
  return issueTarget(target, false);
}

export async function connectDraftTarget(target: DraftTarget,
  connect: (wsUrl: string) => Promise<CDP> = url => CdpClient.connect(url)): Promise<CDP> {
  if (!issuedTargets.has(target)) throw failure("Unissued target", "use createFreshDraftTarget or explicitlyReuseExistingTarget");
  const c = await primitive("connectDraftTarget", () => validTarget(target),
    () => connect(target.webSocketDebuggerUrl), c => !!c && typeof c.send === "function" && typeof c.evalSync === "function" && typeof c.close === "function",
    "Connect to the websocket of the issued target.");
  writableClients.set(c, issuedTargets.get(target)!);
  return c;
}

export function assertWritable(c: CDP, requireFresh = false): true {
  if (!writableClients.has(c) || (requireFresh && writableClients.get(c) !== true))
    throw failure("Unapproved destructive target", "connect a fresh issued target; existing drafts require explicit destructive reuse approval");
  return true;
}

/** Inspect the whole page: a modal may obscure an otherwise valid editor. */
export async function blockingOverlays(c: CDP): Promise<string[]> {
  return primitive("blockingOverlays", () => !!c, () => c.evalSync(`(() => {
    return [...document.querySelectorAll('[role="dialog"], [aria-modal="true"], dialog[open], .artdeco-modal, .article-editor__media-editor-modal')]
      .filter(el => { const r=el.getBoundingClientRect(), s=getComputedStyle(el);
        return r.width>0 && r.height>0 && s.display!=='none' && s.visibility!=='hidden'; })
      .map(el => (el.getAttribute('aria-label') || el.textContent || el.tagName).trim());
  })()`), v => Array.isArray(v) && v.every(x => typeof x === "string"),
  "Inspect the whole page and its overlays before interacting with the editor.");
}

export async function assertClean(c: CDP): Promise<true> {
  await primitive("assertClean", () => !!c, () => blockingOverlays(c), overlays => {
    if (overlays.length) throw failure("BLOCKED — something is in front of the page", "inspect and resolve the overlay before continuing; do not retry the UI action");
    return true;
  }, "Inspect and resolve page overlays before continuing.");
  return true;
}

if (import.meta.main) {
  console.log("Usage: bun run platforms/_cdp.ts --help\nImport CdpClient, primitive and the draft-target helpers to use CDP. CDP_PORT defaults to 9222.");
}
